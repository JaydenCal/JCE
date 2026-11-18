#!/usr/bin/env python3
"""Derives the compact council rules JSON used by the site cost estimate and the siting report from the JCESite council database.

  python3 tools/build-council-rules.py [path/to/council_parameters.sqlite] [out.json]

Reads the sqlite (never shipped, 19 MB) and keeps only the parameter keys the estimate cites, at most 2 records per council and key, each with
its value, unit, condition and the council's own source file, page, clause and a short verbatim quote. Setbacks are NOT taken from here:
the app has its own setback rules. Default output: src/premium/site-costs/council-rules.json
"""
import json, re, sqlite3, sys, os, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DB = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/growth/jcesite-db/council_parameters.sqlite'
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '..', 'src', 'premium', 'site-costs', 'council-rules.json')

KEYS = {
    'stormwater': ['osd_required', 'osd_psd'],
    'access': ['driveway_width_residential', 'driveway_grade_max', 'driveway_distance_from_intersection'],
    'earthworks': ['cut_fill_max_dcp', 'retaining_wall_max_height_exempt'],
    'contributions': ['s711_plan', 's712_plan'],
}
PER_KEY = 2
QUOTE_MAX = 170
STOP = {'council', 'shire', 'city', 'municipal', 'regional', 'of', 'the', 'and'}

def norm(name):
    words = re.findall(r'[a-z]+', name.lower())
    return ''.join(w for w in words if w not in STOP)

def score(r):
    cond = (r['condition'] or '').lower()
    s = 0
    if re.search(r'residential|dwelling|house|single|domestic|small develop', cond): s += 2
    if re.search(r'\ball\b|general|standard', cond): s += 1
    if re.search(r'commercial|industrial|rural|large|subdivision|basin', cond): s -= 1
    if not r['conflict']: s += 1
    if r['value_num'] is not None or r['value_min'] is not None: s += 1
    return s

def clip(t, n):
    t = re.sub(r'\s+', ' ', t or '').strip()
    return t if len(t) <= n else t[: n - 3].rstrip() + '...'

def main():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    councils = {}
    for c in db.execute('select lga_slug, council from councils'):
        councils[c['lga_slug']] = {'n': c['council'], 'k': norm(c['council']), 'r': {}}
    seen = {}
    for slug, c in councils.items(): seen.setdefault(c['k'], []).append(slug)
    dupes = {k: v for k, v in seen.items() if len(v) > 1}
    total = 0
    for cat, params in KEYS.items():
        for p in params:
            for slug, c in councils.items():
                rows = db.execute('select * from parameters where lga_slug=? and category=? and parameter=?', (slug, cat, p)).fetchall()
                rows = sorted(rows, key=lambda r: (-score(r), r['id']))[:PER_KEY]
                recs = []
                for r in rows:
                    rec = {'c': clip(r['condition'], 90), 'u': r['unit'] or '', 'f': os.path.basename(r['source_file'] or ''), 'p': r['page'], 'cl': clip(r['clause'], 50), 'q': clip(r['quote'], QUOTE_MAX)}
                    if r['value_num'] is not None: rec['v'] = r['value_num']
                    if r['value_min'] is not None: rec['lo'] = r['value_min']
                    if r['value_max'] is not None: rec['hi'] = r['value_max']
                    if r['value_text']: rec['t'] = clip(r['value_text'], 170)
                    if r['conflict']: rec['x'] = 1
                    recs.append(rec)
                if recs:
                    c['r'][p] = recs
                    total += len(recs)
    out = {'schema': 'jce-council-rules', 'built': datetime.date.today().strftime('%d/%m/%Y'), 'source': 'JCESite council parameter database v2.1 (council DCPs, engineering guidelines and standard drawings)', 'records': total,
           'councils': {k: v for k, v in councils.items() if v['r']}}
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    with open(OUT, 'w') as f: json.dump(out, f, separators=(',', ':'), ensure_ascii=True)
    print(f'{len(out["councils"])} councils, {total} records, {os.path.getsize(OUT)/1024:.0f} KB -> {OUT}')
    if dupes: print('WARNING duplicate normalised names:', dupes)

main()
