#!/usr/bin/env python3 -I
"""Build rules/<lga_slug>.json and setback-rules.json from source/setbacks_export.json.

Run from anywhere:  python3 -I GlideInside/setbacks-data/scripts/build_rules.py
"""
import json, re, sys, os, collections, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import parse_conditions as P

ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'source', 'setbacks_export.json')
OUT = ROOT

CORE = {'front_primary': 'front', 'front_secondary': 'secondaryFront', 'side_setback': 'side',
        'rear_setback': 'rear', 'garage_setback': 'garage', 'garage_setback_behind_facade': 'garageBehind',
        'front_infill_rule': 'front'}
FAMILY = {'setback_rural': 'RU*', 'setback_commercial': 'B*', 'setback_industrial': 'IN*',
          'setback_classified_road': None}
USE_FOR_PARAM = {'setback_commercial': ['commercial'], 'setback_industrial': ['industrial'],
                 'garage_setback': ['garage'], 'garage_setback_behind_facade': ['garage']}
MAIN_RES = ['R1', 'R2', 'R5', 'RU5']
EXCLUDE_NONBOUNDARY = re.compile(
    r'watercourse|riparian|buffer|odour|poultry|agricultural land|effluent|\bbore\b|\bdam\b|creek|river|flood|levee|\blake\b|'
    r'\bgate|cattle|stockpile|separation|wetland|bushland|waste|septic|piggery|feedlot|intensive|quarry|mining|cemetery|'
    r'sewer|pipeline|transmission|easement|top of bank|stream|drain|fire |bushfire|apz|vineyard|orchard|chemical|kennel|'
    r'aquaculture|crossing|culvert|absorption|trench|disposal|spray|sensitive|abattoir|animal|stable|dairy|horse|'
    r'swimming pool|retaining|fence|\bsign|signage|landfill|boundary of adjoining dwelling|tower|windfarm|solar|from a dwelling|'
    r'from (?:an? )?(?:existing )?(?:dwelling|residence|house)', re.I)


def infer_slots(cond):
    c = cond.lower()
    if EXCLUDE_NONBOUNDARY.search(c):
        return []
    if re.search(r'secondary|corner|side street|street side', c):
        return ['secondaryFront']
    if re.search(r'side\s*(?:and|&|/|or)\s*rear|side/rear|side and rear', c):
        return ['side', 'rear']
    if re.search(r'\brear\b', c):
        return ['rear']
    if re.search(r'\bside\b', c):
        return ['side']
    if re.search(r'front|road|street|frontage|building line|primary|main street|property boundary|road boundary|street boundary', c):
        return ['front']
    return []


def build_value(rec, slot):
    unit = (rec['unit'] or '').strip()
    vn, vmin, vmax = rec['value_num'], rec['value_min'], rec['value_max']
    vt = (rec['value_text'] or '').strip()
    v = {}
    flags = []
    if slot == 'garageBehind':
        if vn is not None and unit in ('m', 'mm', '') :
            v['minM'] = round(vn / 1000.0, 4) if unit == 'mm' else vn
            if unit == '':
                flags.append('unit not recorded')
        else:
            v['minM'] = None
        if vt:
            v['note'] = vt
        return v, flags
    basis = 'fixed'
    if vn is not None and unit in ('m', 'mm', ''):
        v['minM'] = round(vn / 1000.0, 4) if unit == 'mm' else vn
        if unit == '':
            if re.search(r'\d\s*(?:m|metres?)\b', vt + ' ' + rec['quote']) and 0 <= vn <= 120:
                pass
            else:
                flags.append('unit not recorded in extract; metres assumed')
        if unit == 'mm':
            v['printed'] = '%g mm' % vn
    elif vn is not None and unit.startswith('%'):
        v['minM'] = None
        if 'primary' in unit:
            basis = 'percent_of_primary'
            v['percent'] = vn
        else:
            v['formula'] = '%g%s' % (vn, unit if unit.startswith('%') else ' ' + unit)
    elif vn is not None:
        v['minM'] = None
        v['formula'] = '%g %s' % (vn, unit)
    elif vmin is not None or vmax is not None:
        v['minM'] = None
        v['rangeM'] = [vmin, vmax]
        flags.append('range printed (%s to %s); band not resolved' % (vmin, vmax))
    else:
        v['minM'] = None
    low = (vt + ' ' + rec['condition']).lower()
    if v.get('minM') is None:
        if re.search(r'average|adjoining|adjacent|neighbour|nearest|consistent with', low) and slot in ('front', 'secondaryFront'):
            basis = 'average_neighbours'
        elif re.search(r'\bbca\b|\bncc\b|national construction code|building code', low):
            basis = 'ncc'
        elif basis == 'fixed':
            basis = 'text'
    else:
        if re.search(r'greater of|whichever is (?:the )?greater|the greater|or the greater|whichever is greater|more than', vt.lower()):
            basis = 'greater_of'
        elif re.search(r'lesser of|whichever is (?:the )?less|the lesser|or the lesser', vt.lower()):
            basis = 'lesser_of'
        if slot == 'front' and re.search(r'average|neighbour|nearest', vt.lower() + ' ' + rec['condition'].lower()):
            flags.append('averaging alternative printed beside the fixed value')
    v['basis'] = basis
    if vt and not re.fullmatch(r'[\d.]+\s*(?:m|mm|metres?)?', vt):
        v['note'] = vt
    return v, flags


def clean_sig(v):
    return json.dumps({k: v[k] for k in sorted(v) if k not in ('sources', 'note', 'printed')}, sort_keys=True)


def lga_names(council):
    n = council
    n = re.sub(r'\(.*?\)', '', n).strip()
    base = n.upper()
    variants = []

    def add(x):
        x = re.sub(r'\s+', ' ', x).strip()
        if x and x not in variants:
            variants.append(x)
    stripped = re.sub(r'\b(THE COUNCIL OF THE MUNICIPALITY OF|COUNCIL OF THE CITY OF|COUNCIL OF)\b', '', base)
    stripped = re.sub(r'\bCOUNCIL\b', '', stripped).strip()
    core = re.sub(r'\b(CITY OF|CITY|SHIRE|MUNICIPAL|MUNICIPALITY)\b', '', stripped).strip()
    core = re.sub(r'\s+', ' ', core)
    add(core)
    add(stripped)
    add(re.sub(r'\bCITY OF\b', '', stripped).strip())
    add(core.replace(' REGIONAL', ''))
    if 'MIDCOAST' in core:
        add('MID-COAST')
    if core == 'MID-COAST':
        add('MIDCOAST')
    if core.startswith('THE '):
        add(core[4:])
        add(core + ' SHIRE')
    add(base)
    return variants


def main():
    d = json.load(open(SRC))
    councils = {c['lga_slug']: c for c in d['councils']}
    recs = collections.defaultdict(list)
    other_counts = collections.defaultdict(collections.Counter)
    for s in d['setbacks']:
        p = s['parameter']
        if p in CORE or p in FAMILY:
            recs[s['lga_slug']].append(s)
        else:
            other_counts[s['lga_slug']][p] += 1

    os.makedirs(os.path.join(OUT, 'rules'), exist_ok=True)
    allout = []
    stats = {}
    for slug, c in councils.items():
        res = build_council(c, recs.get(slug, []), other_counts.get(slug, {}))
        with open(os.path.join(OUT, 'rules', slug + '.json'), 'w') as f:
            json.dump(res, f, indent=1, ensure_ascii=False)
        allout.append(res)
    schema_ver = {'generated': '2026-11-11', 'source': 'source/setbacks_export.json', 'councilCount': len(allout)}
    with open(os.path.join(OUT, 'setback-rules.json'), 'w') as f:
        json.dump({'meta': schema_ver, 'councils': allout}, f, indent=1, ensure_ascii=False)
    cnt = collections.Counter(r['status'] for r in allout)
    print(dict(cnt))
    print('rules', sum(len(r['rules']) for r in allout))


def item_context(rec, slot):
    """Parse one record into (context dict, flags)."""
    cond = rec['condition']
    param = rec['parameter']
    zones, how = P.parse_zones(cond)
    zoneFlag = None
    if not zones:
        fam = FAMILY.get(param)
        if fam:
            zones = [fam]
            zoneFlag = 'Zone not stated in the record; zone family %s assumed from the parameter category (%s).' % (fam, param)
        else:
            zones = ['*']
    uses = P.parse_uses(cond)
    if param in USE_FOR_PARAM:
        base = USE_FOR_PARAM[param]
        uses = [u for u in uses if u not in ('dwelling',)] or []
        for b in base:
            if b not in uses and param != 'garage_setback' and param != 'garage_setback_behind_facade':
                uses.append(b)
    if param == 'setback_commercial' or param == 'setback_industrial':
        uses = USE_FOR_PARAM[param]
    if param in ('garage_setback', 'garage_setback_behind_facade'):
        # garage rules apply to the garage element of whatever building type is named
        pass
    quals, quals_not = P.parse_qualifiers(cond)
    if param == 'setback_classified_road' and 'classified_road' not in quals:
        quals.append('classified_road')
    if param == 'front_infill_rule' and 'established_area' not in quals:
        quals.append('established_area')
    if slot == 'secondaryFront':
        quals = [q for q in quals if q != 'corner_splay'] + (['corner_splay'] if 'corner_splay' in quals else [])
    # building_element, garage uses etc.
    st = P.parse_storeys(cond)
    wh = P.parse_wall_height(cond)
    lw = P.parse_lot_width(cond)
    la = P.parse_lot_area(cond)
    lsm = P.parse_land_size_map(cond)
    corner = P.parse_corner(cond) if slot != 'secondaryFront' else False
    prec = P.parse_precinct(cond)
    ctx = {'zones': zones, 'uses': uses or ['any'], 'quals': sorted(set(quals)), 'quals_not': sorted(set(quals_not)), 'precinct': prec,
           'storeys': st, 'wall': wh, 'width': lw, 'area': la, 'lsm': lsm, 'corner': corner}
    return ctx, zoneFlag, how


def ctx_key(ctx, zone):
    return json.dumps([zone, ctx['uses'], ctx['quals'], ctx['quals_not'], ctx['precinct'], sorted(ctx['storeys'].items()),
                       sorted(ctx['wall'].items()), sorted(ctx['width'].items()), sorted(ctx['area'].items()),
                       ctx['lsm'], ctx['corner']], sort_keys=True)


def conditions_from_ctx(ctx):
    c = {}
    st = ctx['storeys']
    for k in ('storeys', 'storeysMin', 'storeysMax', 'level'):
        if k in st:
            c[k] = st[k]
    for k, v in ctx['wall'].items():
        c[k] = v
    for k, v in ctx['width'].items():
        c[k] = v
    for k, v in ctx['area'].items():
        c[k] = v
    if ctx['corner']:
        c['cornerLot'] = True
    if ctx['lsm']:
        c['landSizeMap'] = ctx['lsm']
    if ctx['precinct']:
        c['precinct'] = ctx['precinct']
    if ctx['quals']:
        c['qualifiers'] = list(ctx['quals'])
    if ctx['quals_not']:
        c['qualifiersNot'] = list(ctx['quals_not'])
    return c


def build_council(c, records, other_counts):
    slug = c['lga_slug']
    try:
        gaps_in = json.loads(c['gaps']) if isinstance(c['gaps'], str) else (c['gaps'] or [])
    except Exception:
        gaps_in = [c['gaps']] if c['gaps'] else []
    out = {'lga_slug': slug, 'council': c['council'], 'lgaNames': lga_names(c['council']),
           'dcp': c['governing_dcp'], 'lep': c['lep'], 'status': 'none', 'rules': [], 'gaps': [], 'notes': None}
    if not records:
        out['gaps'] = ['No setback records in the extract (no front, side, rear, garage, rural, commercial, industrial or classified road setback values found in the saved council documents).']
        sg = [g for g in gaps_in if re.search(r'setback|building line|dcp|residential', g, re.I)]
        if sg:
            out['gaps'].append('Extraction gaps noted for this council (verbatim): ' + ' | '.join(sg)[:900])
        out['notes'] = 'Extract reviewed: %s.' % c.get('review_status')
        out['counts'] = {'records': 0, 'rules': 0}
        return out

    items = []  # dict per (record, slot, zone)
    unmodelled = []
    for rec in records:
        p = rec['parameter']
        if p in CORE:
            slots = [CORE[p]]
        else:
            slots = infer_slots(rec['condition'])
            if not slots:
                unmodelled.append(rec['id'])
                continue
        for slot in list(slots):
            pass
        txt = rec['condition'] + ' ' + (rec['quote'] or '') + ' ' + (rec['value_text'] or '')
        if slots == ['garage'] and re.search(r'behind|recess', txt, re.I) and not re.search(r'from (?:the )?(?:front|primary|road|street|rear|side)? ?(?:boundary|frontage|road)', rec['condition'], re.I):
            slots = ['garageBehind']
        if slots == ['garageBehind'] and re.search(r'projec|forward of|in front of|not forward|maximum width|width|share|%', rec['condition'] + ' ' + (rec['unit'] or ''), re.I):
            unmodelled.append(rec['id'])
            continue
        for slot in slots:
            if slot == 'garageBehind':
                if rec['unit'] not in ('m', 'mm', '', None) or (rec['value_num'] is None):
                    unmodelled.append(rec['id'])
                    continue
            val, flags = build_value(rec, slot)
            ctx, zflag, how = item_context(rec, slot)
            if zflag:
                flags.append(zflag)
            if how == 'named':
                flags.append('Zone code inferred from the zone name printed in the record')
            for z in ctx['zones']:
                items.append({'rec': rec, 'slot': slot, 'zone': z, 'ctx': ctx, 'val': val, 'flags': flags,
                              'key': ctx_key(ctx, z)})

    # group
    groups = collections.OrderedDict()
    for it in items:
        groups.setdefault(it['key'], []).append(it)

    raw_rules = []
    for key, its in groups.items():
        ctx = its[0]['ctx']
        zone = its[0]['zone']
        slots = collections.OrderedDict()
        for it in its:
            slots.setdefault(it['slot'], []).append(it)
        variants = []  # list of rule variants; first holds all non-conflicting
        main = {}
        extra = []
        for slot, sl in slots.items():
            byval = collections.OrderedDict()
            for it in sl:
                byval.setdefault(clean_sig(it['val']), []).append(it)
            vals = list(byval.values())
            main[slot] = vals[0]
            for alt in vals[1:]:
                extra.append((slot, alt))
        raw_rules.append(make_rule(main, ctx, zone, conflict=False))
        for slot, alt in extra:
            raw_rules.append(make_rule({slot: alt}, ctx, zone, conflict=True))

    # merge zone lists for identical rules
    merged = collections.OrderedDict()
    for r in raw_rules:
        sig = json.dumps({k: r[k] for k in r if k not in ('zones', 'id', 'sources', 'evidence', 'quote', 'clause', 'page', 'source_file', 'confidence', 'needsReview')}, sort_keys=True)
        sig += json.dumps(r['needsReview'])
        if sig in merged:
            m = merged[sig]
            for z in r['zones']:
                if z not in m['zones']:
                    m['zones'].append(z)
            for e in r['evidence']:
                if e['id'] not in [x['id'] for x in m['evidence']]:
                    m['evidence'].append(e)
            m['sources'] = sorted(set(m['sources']) | set(r['sources']))
        else:
            merged[sig] = r
    rules = list(merged.values())
    # order: zone, then context
    zrank = {z: i for i, z in enumerate(['R1', 'R2', 'R3', 'R4', 'R5', 'RU5', 'RU1', 'RU2', 'RU3', 'RU4', 'RU6', 'E4', 'C4', 'E3', 'C3', '*'])}
    rules.sort(key=lambda r: (zrank.get(r['zones'][0], 50), r['zones'][0], str(r['appliesTo']), json.dumps(r['conditions'], sort_keys=True)))
    for i, r in enumerate(rules, 1):
        r['id'] = '%s-%03d' % (slug, i)
        for z in r['zones']:
            pass
        r['zones'] = sorted(r['zones'], key=lambda z: (zrank.get(z, 50), z))
        r['sources'] = sorted(r['sources'])
        ev = r['evidence']
        first = ev[0]
        r['quote'] = first['quote']
        r['clause'] = first['clause']
        r['page'] = first['page']
        r['source_file'] = first['source_file']
        r['dcp'] = c['governing_dcp']
        r['edition'] = first.get('edition')
        flag_rule(r)
    out['rules'] = rules

    # counts and coverage
    cov = coverage(rules)
    out['coverage'] = cov
    out['status'] = status_from(cov, rules)
    precs = sorted({r['conditions']['precinct'] for r in rules if r['conditions'].get('precinct')})
    out['precincts'] = precs
    out['needsPrecinct'] = bool(rules) and all(r['conditions'].get('precinct') for r in rules if any(z in MAIN_RES or z == '*' for z in r['zones']) and ('front' in r or 'side' in r or 'rear' in r)) and bool(precs)
    gaps = compute_gaps(out, cov, rules, gaps_in, unmodelled, other_counts, records)
    out['gaps'] = gaps
    out['counts'] = {'records': len(records), 'rules': len(rules), 'recordsNotModelled': len(unmodelled),
                     'otherSetbackKeysNotModelled': sum(other_counts.values()) if other_counts else 0}
    out['notes'] = 'Built from %d extract records (review status: %s). Unit mm values are converted to metres (printed value kept in "printed"). Values not given as a metre figure are kept as null minM with the printed text.' % (len(records), c.get('review_status'))
    return out


def flag_rule(r):
    """Owner ruling 11/11/2026: rules with needsReview or low confidence are shown but marked check_with_council."""
    if r.get('needsReview') or r.get('confidence') == 'low':
        r['flag'] = 'check_with_council'
        nr = r.get('needsReview')
        reason = nr if isinstance(nr, str) and nr else 'Low confidence: value not given as a number or not confirmed'
        r['flagReason'] = reason if len(reason) <= 160 else reason[:157] + '...'
    else:
        r.pop('flag', None); r.pop('flagReason', None)


def make_rule(slotmap, ctx, zone, conflict):
    rule = {'id': None, 'zones': [zone], 'appliesTo': ctx['uses'], 'conditions': conditions_from_ctx(ctx)}
    rule['conditionText'] = None
    sources = []
    evidence = []
    flags = []
    conds = []
    confidence = 'high'
    confs = []
    for slot, its in slotmap.items():
        rep = its[0]
        v = dict(rep['val'])
        ids = [i['rec']['id'] for i in its]
        v['sources'] = ids
        slotname = slot
        if slot == 'garageBehind':
            g = rule.setdefault('garage', {'minM': None})
            g['behindBuildingLineM'] = v['minM']
            g.setdefault('sources', [])
            g['sources'] += ids
            if v.get('note'):
                g['note'] = v['note']
        elif slot == 'garage':
            g = rule.setdefault('garage', {'minM': None})
            g['minM'] = v.get('minM')
            if v.get('note'):
                g['note'] = v['note']
            g.setdefault('sources', [])
            g['sources'] += ids
            for k in ('basis', 'formula', 'rangeM', 'printed'):
                if v.get(k) not in (None, 'fixed', 'text') and k in v:
                    g[k] = v[k]
        else:
            rule[slot] = v
        for it in its:
            r = it['rec']
            sources.append(r['id'])
            conds.append(r['condition'])
            evidence.append({'id': r['id'], 'parameter': r['parameter'], 'slot': slot, 'quote': r['quote'], 'clause': r['clause'],
                             'page': r['page'], 'source_file': r['source_file'], 'condition': r['condition'],
                             'edition': r['document_edition']})
            flags += it['flags']
            if r['conflict']:
                flags.append('Source record %s is flagged conflict=true in the extract (two council documents disagree)' % r['id'])
        if v.get('minM') is None and slot in ('front', 'side', 'rear') and v.get('basis') not in ('average_neighbours',):
            confs.append('low')
        elif v.get('basis') == 'average_neighbours':
            confs.append('medium')
    for s in ('front', 'secondaryFront', 'side', 'rear', 'garage'):
        rule.setdefault(s, None)
    rule['conditionText'] = sorted(set(conds))
    if len(set(conds)) == 1:
        rule['conditionText'] = conds[0]
    zflags = [f for f in flags if f.startswith('Zone')]
    needs = []
    for f in dict.fromkeys(flags):
        needs.append(f)
    q = ctx['quals']
    unmod = [x for x in q if x in ('orientation_specific', 'adjoins_other', 'height_plane', 'slope', 'subdivision_stage', 'non_standard_street', 'shared_driveway', 'top_floor_attic', 'corner_splay', 'open_space_frontage')]
    if unmod:
        needs.append('Condition not expressible in the structured fields (%s); see conditionText' % ', '.join(unmod))
    if conflict:
        needs.append('CONFLICT: another rule with the same applicability gives a different %s value; both retained, no winner chosen' % ', '.join(slotmap))
        confs.append('low')
    if ctx['zones'] == ['*'] or zone == '*':
        confs.append('medium')
    if any('unit not recorded' in n for n in needs):
        confs.append('medium')
    if any(n.startswith('Zone') for n in needs):
        confs.append('medium')
    if unmod:
        confs.append('medium')
    if any('flagged conflict' in n for n in needs):
        confs.append('medium')
    if any('range printed' in n for n in needs):
        confs.append('low')
    confidence = 'low' if 'low' in confs else ('medium' if 'medium' in confs else 'high')
    rule['sources'] = sources
    rule['evidence'] = evidence
    rule['confidence'] = confidence
    rule['needsReview'] = '; '.join(needs) if needs else None
    return rule


def numeric(slotobj, front=False):
    if not slotobj:
        return False
    if slotobj.get('minM') is not None:
        return True
    return front and slotobj.get('basis') == 'average_neighbours'


def coverage(rules):
    """Per zone: which of front/side/rear exist (numeric) in any rule that could apply to a dwelling."""
    zones = collections.defaultdict(lambda: {'front': False, 'side': False, 'rear': False, 'secondaryFront': False, 'garage': False, 'rules': 0})
    for r in rules:
        dwelling_ok = any(u in ('any', 'dwelling', 'dual_occupancy', 'multi_dwelling', 'secondary_dwelling', 'residential_flat_building', 'seniors_housing') for u in r['appliesTo'])
        for z in r['zones']:
            zz = zones[z]
            zz['rules'] += 1
            if not dwelling_ok:
                continue
            if numeric(r.get('front'), True):
                zz['front'] = True
            if numeric(r.get('side')):
                zz['side'] = True
            if numeric(r.get('rear')):
                zz['rear'] = True
            if numeric(r.get('secondaryFront')) or (r.get('secondaryFront') or {}).get('basis') == 'percent_of_primary':
                zz['secondaryFront'] = True
            if r.get('garage'):
                zz['garage'] = True
    return dict(zones)


def status_from(cov, rules):
    if not rules:
        return 'none'
    # none: no rule anywhere gives a numeric front setback for a dwelling in a residential-type zone
    def res_zone(z):
        return z == '*' or z.startswith('R') or z in ('E4', 'C4', 'E3', 'C3')
    if not any(r.get('front') and r['front'].get('minM') is not None and res_zone(z) and
               any(u in ('any', 'dwelling', 'dual_occupancy', 'multi_dwelling', 'secondary_dwelling') for u in r['appliesTo'])
               for r in rules for z in r['zones']):
        return 'none'
    star = cov.get('*')
    star_full = bool(star and star['front'] and star['side'] and star['rear'])
    present = [z for z in MAIN_RES if z in cov]
    covered = []
    for z in MAIN_RES:
        zc = cov.get(z)
        f = (zc and zc['front']) or (star and star['front'])
        s = (zc and zc['side']) or (star and star['side'])
        r = (zc and zc['rear']) or (star and star['rear'])
        if f and s and r:
            covered.append(z)
    if star_full:
        return 'ready' if all(((cov.get(z) is None) or (cov[z]['front'] or star['front']) and (cov[z]['side'] or star['side']) and (cov[z]['rear'] or star['rear'])) for z in MAIN_RES) else 'partial'
    if present and all(z in covered for z in present):
        return 'ready'
    return 'partial'


def compute_gaps(out, cov, rules, gaps_in, unmodelled, other_counts, records):
    gaps = []
    for z in MAIN_RES:
        zc = cov.get(z)
        if zc is None:
            continue
        miss = [k for k in ('front', 'side', 'rear') if not zc[k] and not (cov.get('*') and cov['*'][k])]
        if miss:
            gaps.append('%s: no numeric %s setback rule (printed as text, BCA/NCC reference, range, or absent)' % (z, '/'.join(miss)))
    if not any(cov.get(z) for z in MAIN_RES) and not cov.get('*'):
        gaps.append('No rules tagged to R1, R2, R5 or RU5 and none with an unstated residential zone; only other zones or precinct-level text')
    if cov and not any(v['secondaryFront'] for v in cov.values()):
        gaps.append('No secondary (corner lot) frontage setback rule')
    if cov and not any(v['garage'] for v in cov.values()):
        gaps.append('No garage setback rule')
    if out.get('needsPrecinct'):
        gaps.append('All residential rules are tied to named precincts or DCP areas (%d); the app must supply the precinct for a lot' % len(out.get('precincts', [])))
    if unmodelled:
        gaps.append('%d records not modelled as lot-boundary setbacks (rural, commercial, industrial or garage records that are not front/side/rear controls, e.g. buffers, widths, gates): ids %s' % (len(unmodelled), ', '.join(map(str, unmodelled[:30])) + (' ...' if len(unmodelled) > 30 else '')))
    sg = [g for g in gaps_in if re.search(r'setback|building line|dcp.*(not|no)|residential|zone', g, re.I)]
    if sg:
        gaps.append('Extraction gaps noted for this council (verbatim, may be partly unrelated to setbacks): ' + ' | '.join(sg)[:700])
    return gaps


if __name__ == '__main__':
    main()
