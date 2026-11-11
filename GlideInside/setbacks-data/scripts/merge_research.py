#!/usr/bin/env python3 -I
"""Merge the research agent's output (/home/claude/research-setbacks) into rules/ and setback-rules.json.

Idempotent: previously merged research rules (origin == "research") are removed before re-adding.
  councils/<slug>.json            same shape as rules/<slug>.json  (rules added; status/gaps taken if provided)
  fallback/nsw-housing-code.json  -> fallback/nsw-housing-code.json (and setback-rules.json .fallbacks.NSW)
  fallback/qld-qdc.json           -> fallback/qld-qdc.json          (and setback-rules.json .fallbacks.QLD)
Run build_rules.py first (it regenerates rules/ from the extract), then this script.
"""
import json, os, sys, glob, shutil, re
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_rules as B
ROOT = os.path.dirname(HERE)
# Research inputs are kept in the repo (source/research) so the pipeline can be re-run from a clean checkout.
RES = os.environ.get('RESEARCH_DIR', os.path.join(ROOT, 'source', 'research'))


# Inland local government areas: Codes SEPP cl 3D.1(4) as made by SEPP (Exempt and Complying Development Codes)
# Amendment (Inland Code) 2018 (epi-2018-569), 69 LGAs, read 11/11/2026. The Part 3D Inland Code applies there
# instead of the Housing Code. Later amendments to the list have not been checked.
INLAND_LGAS = [
    'Albury City', 'Armidale Regional', 'Balranald', 'Bathurst Regional', 'Berrigan', 'Bland', 'Blayney', 'Bogan', 'Bourke',
    'Brewarrina', 'Broken Hill', 'Cabonne', 'Carrathool', 'Central Darling', 'Cobar', 'Coolamon', 'Coonamble',
    'Cootamundra-Gundagai Regional', 'Cowra', 'Dubbo Regional', 'Dungog', 'Edward River', 'Federation', 'Forbes', 'Gilgandra',
    'Glen Innes Severn Shire', 'Goulburn Mulwaree', 'Greater Hume Shire', 'Griffith', 'Gunnedah', 'Gwydir', 'Hay', 'Hilltops',
    'Inverell', 'Junee', 'Lachlan', 'Leeton', 'Lithgow', 'Liverpool Plains', 'Lockhart', 'Mid-Western Regional', 'Moree Plains',
    'Murray River', 'Murrumbidgee', 'Muswellbrook', 'Narrabri', 'Narrandera', 'Narromine', 'Oberon', 'Orange', 'Parkes',
    'Queanbeyan-Palerang Regional', 'Singleton', 'Snowy Monaro Regional', 'Snowy Valleys', 'Tamworth Regional', 'Temora',
    'Tenterfield', 'Upper Hunter Shire', 'Upper Lachlan Shire', 'Uralla', 'Wagga Wagga', 'Walcha', 'Walgett', 'Warren',
    'Warrumbungle Shire', 'Weddin', 'Wentworth', 'Yass Valley']


def _lga_key(name):
    n = re.sub(r"\b(the|council|of|city|shire|regional|municipal|municipality)\b", ' ', name.lower().replace('-', ' '))
    return ' '.join(n.split())


def inland_slugs():
    """Match the LGA names to the rule file slugs; fails loudly if a name matches no file or more than one."""
    slugs = [os.path.basename(f)[:-5] for f in glob.glob(os.path.join(ROOT, 'rules', '*.json'))]
    by = {}
    for sl in slugs:
        by.setdefault(_lga_key(sl), []).append(sl)
    out = set()
    for name in INLAND_LGAS:
        hit = by.get(_lga_key(name), [])
        if len(hit) != 1:
            raise SystemExit('Inland LGA %r matched %r' % (name, hit))
        out.add(hit[0])
    return out


USE_MAP = {'detached_house': 'dwelling', 'dwelling_house': 'dwelling', 'dwelling house': 'dwelling', 'house': 'dwelling', 'dual_occupancy': 'dual_occupancy',
           'secondary_dwelling': 'secondary_dwelling', 'multi_dwelling_housing': 'multi_dwelling', 'multi_dwelling': 'multi_dwelling'}


def dcp_name(d):
    if isinstance(d, dict):
        n = d.get('name') or ''
        return n + (' (%s)' % d['adopted'] if d.get('adopted') else ''), d.get('adopted') or 'UNVERIFIED', d.get('url')
    return d, None, None


def norm_slot(sl):
    if not isinstance(sl, dict):
        return sl
    sl = dict(sl)
    ps = sl.pop('perStorey', None)
    if ps and not sl.get('bands'):
        bands = []
        for e in ps:
            b = {k: v for k, v in e.items() if k in ('minM', 'wallHeightMaxM', 'wallHeightMinM', 'lotWidthMinM', 'lotWidthMaxM', 'lotAreaMinM2', 'lotAreaMaxM2', 'buildingHeightMinM', 'buildingHeightMaxM')}
            if 'storey' in e:
                b['storeys'] = e['storey']
            bands.append(b)
        sl['bands'] = bands
    if 'basis' not in sl:
        sl['basis'] = 'fixed' if sl.get('minM') is not None else 'text'
    sl.setdefault('minM', None)
    return sl


HEIGHT_KEYS = {'heightMinM': 'buildingHeightMinM', 'heightMaxM': 'buildingHeightMaxM'}
FORMULA = re.compile(r'\(\s*building height\s*-\s*([\d.]+)\s*\)\s*/\s*([\d.]+)\s*\+\s*([\d.]+)', re.I)


def norm_bands(bands):
    out = []
    for b in bands or []:
        nb = {}
        for k, v in b.items():
            nb[HEIGHT_KEYS.get(k, k)] = v
        f = nb.get('formula')
        if f and nb.get('minM') is None:
            m = FORMULA.search(f)
            if m:
                nb['formulaParams'] = {'offsetM': float(m.group(1)), 'divisor': float(m.group(2)), 'plusM': float(m.group(3))}
                nb['minM'] = None
        if nb.get('minM') is None and 'formulaParams' not in nb:
            continue  # cannot be evaluated (kept in the note)
        nb['basis'] = 'fixed'
        out.append(nb)
    # make touching bounds exclusive on the upper band so that a boundary value falls in one band only
    for key_min, key_max in (('lotWidthMinM', 'lotWidthMaxM'), ('lotAreaMinM2', 'lotAreaMaxM2'), ('buildingHeightMinM', 'buildingHeightMaxM')):
        maxes = {b.get(key_max) for b in out if b.get(key_max) is not None}
        for b in out:
            if b.get(key_min) is not None and b[key_min] > 0 and b[key_min] in maxes:
                b[key_min] = round(b[key_min] + 0.01, 3)
    return out


def norm_rule(r, dcp_str, edition, url):
    r = dict(r)
    bands = r.pop('bands', None)
    if isinstance(bands, dict):
        for slot, bl in bands.items():
            if slot not in ('front', 'secondaryFront', 'side', 'rear'):
                continue
            nb = norm_bands(bl)
            if nb:
                cur = dict(r.get(slot) or {})
                cur['bands'] = nb
                cur['minM'] = None
                cur.setdefault('basis', 'fixed')
                if cur.get('basis') in ('average_neighbours', 'by_lot_area'):
                    cur['note'] = (cur.get('note') or '') + ' [Figure used when neighbour setbacks are not supplied: lot area band.]'
                    cur['basis'] = 'fixed'
                r[slot] = cur
    for slot in ('side', 'rear'):
        sl = r.get(slot)
        if isinstance(sl, dict) and sl.get('perHeight') and not sl.get('bands'):
            nb = norm_bands(sl['perHeight'])
            if nb:
                sl = dict(sl); sl['bands'] = nb; sl['minM'] = None; r[slot] = sl
    # QLD MP1.1 Table A2: single minimum printed in a table that varies with lot width; do not apply the lowest figure to every width
    for slot in ('side', 'rear'):
        sl = r.get(slot)
        if isinstance(sl, dict) and not sl.get('bands') and 'Table A2' in (sl.get('note') or '') and (r.get('conditions') or {}).get('lotWidthMaxM'):
            r[slot] = dict(sl, minM=None)
            r['needsReview'] = (r.get('needsReview') if isinstance(r.get('needsReview'), str) else '') or 'Table A2 values vary with lot width; not applied as a single figure'
    ap = r.get('appliesTo') or ['any']
    if isinstance(ap, str):
        ap = [ap]
    r['appliesTo'] = [USE_MAP.get(a, a) for a in ap]
    if isinstance(r.get('zones'), str):
        r['zones'] = [r['zones']]
    notes = {}
    for k in ('front', 'secondaryFront', 'side', 'rear'):
        sl = norm_slot(r.get(k))
        if isinstance(sl, dict) and sl.get('minM') is None and not sl.get('bands') and sl.get('basis') in ('text', 'fixed', None) and not sl.get('formula'):
            if sl.get('note'):
                notes[k] = sl['note']
            sl = None  # placeholder without a value
        r[k] = sl
    if notes:
        r['slotNotes'] = notes
    g = r.get('garage')
    r['garage'] = dict(g) if isinstance(g, dict) else g
    nr = r.get('needsReview')
    if nr is True:
        nr = r.get('reviewReason') or 'Flagged for review by the research agent'
    elif nr is False or nr is None:
        nr = None
    r['needsReview'] = nr
    r.setdefault('dcp', dcp_str)
    r.setdefault('edition', edition)
    r.setdefault('source_file', r.get('sourceUrl') or url or r.get('document'))
    r.setdefault('clause', None); r.setdefault('page', None); r.setdefault('quote', '')
    r.setdefault('sources', [])
    return r

# ---------------------------------------------------------------- QLD QDC MP 1.1
def _table_a2():
    """QDC MP 1.1 Table A2 (side clearance, road frontage 15 m or less), built from the figures recorded by the research:
    10.5 m or less 0.750 m (height 4.5 m or less) and 1.000 m (4.5 m to 7.5 m), rising 0.075 m and 0.100 m per 0.5 m of
    frontage to 1.425 m and 1.900 m at 14.501 m to 15.000 m."""
    bands = []
    for i in range(10):
        wmax = 10.5 + 0.5 * i
        w = {'lotWidthMaxM': wmax}
        if i:
            w['lotWidthMinM'] = round(wmax - 0.5 + 0.001, 3)
        bands.append(dict(w, buildingHeightMaxM=4.5, minM=round(0.75 + 0.075 * i, 3), basis='fixed'))
        bands.append(dict(w, buildingHeightMinM=4.51, buildingHeightMaxM=7.5, minM=round(1.0 + 0.1 * i, 3), basis='fixed'))
    return bands


def qld_rule(r):
    """Make the QDC rules usable by pickRules: not zone based, street type bands, Table A2 by frontage, A2(a) for the rear."""
    r = dict(r)
    r['zones'] = ['*']
    for slot in ('front', 'secondaryFront'):
        sl = r.get(slot)
        if isinstance(sl, dict) and sl.get('bands'):
            sl = dict(sl); nb = []
            for b in sl['bands']:
                b = dict(b); st = (b.get('streetType') or '').lower()
                if st:
                    b['streetType'] = 'collector' if 'collector' in st else 'access'
                nb.append(b)
            sl['bands'] = nb; r[slot] = sl
    cond = r.get('conditions') or {}
    notes = r.get('slotNotes') or {}
    if 'A2(a)' in (r.get('clause') or '') and isinstance(r.get('side'), dict) and r['side'].get('bands'):
        # A2(a) covers side and rear clearances: the rear takes the same height bands (not a flat 1.5 m)
        r['rear'] = {'minM': None, 'basis': 'fixed', 'bands': [dict(b) for b in r['side']['bands']],
                     'note': 'A2(a) applies to side and rear boundary clearances. Above 7.5 m: 2 m plus 0.5 m for every 3 m or part.'}
    if cond.get('lotWidthMaxM') == 15 and 'Table A2' in (r.get('clause') or ''):
        note = (r.get('side') or {}).get('note') or notes.get('side') or 'QDC MP 1.1 Table A2'
        r['side'] = {'minM': None, 'basis': 'fixed', 'bands': _table_a2(), 'note': note}
        r['needsReview'] = 'Table A2 applies to rectangular or near rectangular narrow lots; values rebuilt from the recorded table end points'
    r['needsReview'] = r.get('needsReview') or 'QDC default; the council planning scheme or the Queensland Housing Code may vary it'
    return r


def main():
    merged_c = []
    inland = inland_slugs()
    if os.path.isdir(os.path.join(RES, 'councils')):
        for f in sorted(glob.glob(os.path.join(RES, 'councils', '*.json'))):
            slug = os.path.basename(f)[:-5]
            tgt = os.path.join(ROOT, 'rules', slug + '.json')
            if not os.path.exists(tgt):
                print('skip (unknown council):', slug); continue
            cur = json.load(open(tgt)); new = json.load(open(f))
            cur['rules'] = [r for r in cur['rules'] if r.get('origin') != 'research']
            have = {r['id'] for r in cur['rules']}
            dstr, ded, durl = dcp_name(new.get('dcp'))
            for i, r in enumerate(new.get('rules', []), 1):
                r = norm_rule(r, dstr, ded, durl)
                r['origin'] = 'research'
                if not r.get('id') or r['id'] in have:
                    r['id'] = '%s-RES-%03d' % (slug, i)
                have.add(r['id'])
                for k in ('front', 'secondaryFront', 'side', 'rear', 'garage', 'conditions', 'appliesTo', 'sources'):
                    r.setdefault(k, {} if k == 'conditions' else (['any'] if k == 'appliesTo' else ([] if k == 'sources' else None)))
                r.setdefault('confidence', 'medium'); r.setdefault('needsReview', None)
                r.setdefault('dcp', cur.get('dcp'))
                B.flag_rule(r)
                cur['rules'].append(r)
            cov = B.coverage(cur['rules'])
            cur['coverage'] = cov
            cur['status'] = new.get('status') or B.status_from(cov, cur['rules'])
            if new.get('gaps'):
                cur['gaps'] = [g for g in cur['gaps'] if not g.startswith('Research:')] + ['Research: ' + g for g in new['gaps']]
            if dstr and not cur.get('dcp'):
                cur['dcp'] = dstr
            cur['notes'] = ((cur.get('notes') or '').split(' | Research merged')[0]) + ' | Research merged from research-setbacks/councils/%s.json' % slug
            cur['counts']['rules'] = len(cur['rules'])
            if slug in inland:
                cur['fallbackSet'] = 'NSW_INLAND'
            json.dump(cur, open(tgt, 'w'), indent=1, ensure_ascii=False)
            merged_c.append(slug)
    for slug in sorted(inland):
        t = os.path.join(ROOT, 'rules', slug + '.json')
        if os.path.exists(t):
            cur = json.load(open(t)); cur['fallbackSet'] = 'NSW_INLAND'
            json.dump(cur, open(t, 'w'), indent=1, ensure_ascii=False)
    fb = {}
    os.makedirs(os.path.join(ROOT, 'fallback'), exist_ok=True)
    for key, name in (('NSW', 'nsw-housing-code.json'), ('NSW_INLAND', 'nsw-inland-code.json'), ('QLD', 'qld-qdc.json')):
        src = os.path.join(RES, 'fallback', name)
        if os.path.exists(src):
            f = json.load(open(src))
            dstr, ded, durl = dcp_name(f.get('dcp') or f.get('name'))
            f.setdefault('name', f.get('instrument') or dstr or key)
            edition = f.get('edition') or ded or ('as retrieved %s; currency against the in-force text not verified' % f.get('retrieved', 'date not recorded'))
            f['edition'] = edition
            f['rules'] = [norm_rule(r, f['name'], edition, durl) for r in f.get('rules', [])]
            if key == 'QLD':
                f['rules'] = [qld_rule(r) for r in f['rules']]
            for i, r in enumerate(f['rules'], 1):
                r['id'] = r.get('id') or '%s-%03d' % (f.get('id') or key.lower(), i)
                if not r.get('edition'):
                    r['edition'] = edition
                r.setdefault('confidence', 'medium')
                if key == 'NSW_INLAND' and isinstance(r.get('side'), dict) and 'not extracted' in (r['side'].get('formula') or ''):
                    r['needsReview'] = 'Table minimum shown. Parts of a building more than 4.5 m above ground need a larger side setback (cl 3D.21(8) formula not captured)'
                B.flag_rule(r)  # owner ruling: needsReview rules are shown and marked check_with_council
            json.dump(f, open(os.path.join(ROOT, 'fallback', name), 'w'), indent=1, ensure_ascii=False)
            fb[key] = f
    allc = [json.load(open(f)) for f in sorted(glob.glob(os.path.join(ROOT, 'rules', '*.json')))]
    out = {'meta': {'generated': '2026-11-11', 'source': 'source/setbacks_export.json',
                    'councilCount': len(allc), 'researchCouncilsMerged': merged_c,
                    'fallbacksLoaded': sorted(fb)}, 'councils': allc, 'fallbacks': fb}
    json.dump(out, open(os.path.join(ROOT, 'setback-rules.json'), 'w'), indent=1, ensure_ascii=False)
    print('merged councils:', merged_c, 'fallbacks:', sorted(fb))


if __name__ == '__main__':
    main()
