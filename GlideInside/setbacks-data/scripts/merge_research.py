#!/usr/bin/env python3 -I
"""Merge the research agent's output (/home/claude/research-setbacks) into rules/ and setback-rules.json.

Idempotent: previously merged research rules (origin == "research") are removed before re-adding.
  councils/<slug>.json            same shape as rules/<slug>.json  (rules added; status/gaps taken if provided)
  fallback/nsw-housing-code.json  -> fallback/nsw-housing-code.json (and setback-rules.json .fallbacks.NSW)
  fallback/qld-qdc.json           -> fallback/qld-qdc.json          (and setback-rules.json .fallbacks.QLD)
Run build_rules.py first (it regenerates rules/ from the extract), then this script.
"""
import json, os, sys, glob, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_rules as B
ROOT = os.path.dirname(HERE)
RES = os.environ.get('RESEARCH_DIR', '/home/claude/research-setbacks')


USE_MAP = {'dwelling_house': 'dwelling', 'dwelling house': 'dwelling', 'house': 'dwelling', 'dual_occupancy': 'dual_occupancy',
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


def norm_rule(r, dcp_str, edition, url):
    r = dict(r)
    ap = r.get('appliesTo') or ['any']
    if isinstance(ap, str):
        ap = [ap]
    r['appliesTo'] = [USE_MAP.get(a, a) for a in ap]
    if isinstance(r.get('zones'), str):
        r['zones'] = [r['zones']]
    for k in ('front', 'secondaryFront', 'side', 'rear'):
        r[k] = norm_slot(r.get(k))
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


def main():
    merged_c = []
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
            json.dump(cur, open(tgt, 'w'), indent=1, ensure_ascii=False)
            merged_c.append(slug)
    fb = {}
    os.makedirs(os.path.join(ROOT, 'fallback'), exist_ok=True)
    for key, name in (('NSW', 'nsw-housing-code.json'), ('QLD', 'qld-qdc.json')):
        src = os.path.join(RES, 'fallback', name)
        if os.path.exists(src):
            f = json.load(open(src))
            dstr, ded, durl = dcp_name(f.get('dcp') or f.get('name'))
            f.setdefault('name', dstr or ('NSW Codes SEPP Housing Code' if key == 'NSW' else 'QDC'))
            f['rules'] = [norm_rule(r, f['name'], f.get('edition') or ded, durl) for r in f.get('rules', [])]
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
