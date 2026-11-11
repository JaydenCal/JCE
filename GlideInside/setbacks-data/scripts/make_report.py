#!/usr/bin/env python3 -I
"""Writes coverage-report.md from rules/ + simulation (node scripts/simulate.mjs)."""
import json, glob, os, subprocess, collections
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sim = json.loads(subprocess.check_output(['node', os.path.join(HERE, 'simulate.mjs')]))
allj = json.load(open(os.path.join(ROOT, 'setback-rules.json')))
fb = allj.get('fallbacks', {})
councils = allj['councils']
ZONES = ['R1', 'R2', 'R3', 'R5', 'RU5']
SHORT = {'Council DCP': 'DCP', 'Codes SEPP Housing Code (complying development pathway; exclusions such as bushfire, flood and heritage apply)': 'HC', 'QDC (default, council planning scheme may vary)': 'QDC'}
cnt = collections.Counter(c['status'] for c in councils)
L = []
A = L.append
# write the probe result back into the rule files so the app can see which zones are determinable from the DCP alone
for c in councils:
    c['zoneProbe'] = {z: {'dcpDeterminable': sim[c['lga_slug']][z]['dcp'], 'basisWithFallbacks': sim[c['lga_slug']][z]['basis'],
                          'reasonIfNot': sim[c['lga_slug']][z]['why']} for z in ZONES}
    json.dump(c, open(os.path.join(ROOT, 'rules', c['lga_slug'] + '.json'), 'w'), indent=1, ensure_ascii=False)
allj['councils'] = councils
json.dump(allj, open(os.path.join(ROOT, 'setback-rules.json'), 'w'), indent=1, ensure_ascii=False)
A('# Setback rules coverage report')
A('')
A('Generated 11/11/2026 from `source/setbacks_export.json` (3888 records, 128 councils) by `scripts/build_rules.py`, `scripts/merge_research.py`, `scripts/make_report.py`.')
A('')
A('## Summary')
A('')
A('| Status | Councils |'); A('|---|---|')
for k in ('ready', 'partial', 'none'):
    A('| %s | %d |' % (k, cnt[k]))
A('')
A('- Total rules: %d (from %d extract records; research rules merged: %s).' % (sum(len(c['rules']) for c in councils), sum(c['counts'].get('records', 0) for c in councils), ', '.join(allj['meta'].get('researchCouncilsMerged') or ['none yet'])))
A('- Fallback sets loaded: %s. NSW Housing Code: %s. QLD QDC: %s.' % (', '.join(allj['meta'].get('fallbacksLoaded') or ['none']), 'loaded' if 'NSW' in fb else 'PENDING (research agent output not yet available)', 'loaded' if 'QLD' in fb else 'PENDING'))
A('- QLD (owner decision 11/11/2026): the QDC default applies to every QLD council, labelled "QDC (default, council planning scheme may vary)"; no QLD council planning scheme lookups at launch.')
A('')
nf = sum(1 for c in councils for r in c['rules'] if r.get('flag'))
nt = sum(len(c['rules']) for c in councils)
A('- **Final status counts: %d ready, %d partial, %d none (128 councils).** An earlier build that counted a council as none only when it had no usable setback record gave 91 / 31 / 6. The final build also sets none when no rule gives a numeric front setback for a dwelling in a residential zone, which moves 8 partial councils to none (broken-hill, canada-bay, hay, mosman, north-sydney, strathfield, waverley, willoughby) and one more ready council to partial; the extra councils are those with averaging-only or side-only controls. Status is presence-based; the zone columns below show what is actually determinable.' % (cnt['ready'], cnt['partial'], cnt['none']))
A('- Rules marked `flag: "check_with_council"` (needsReview set or confidence low, owner ruling 11/11/2026): %d of %d rules. All rules are still shown; the flag and `flagReason` let the UI print "check with council".' % (nf, nt))
A('- Every picked setback carries `clause`, `page`, `source_file`, `dcp` (DCP name), `edition` (document edition/date as printed or UNVERIFIED) and `basis`.')
A('')
A('### How status and the basis column are determined')
A('')
A('- `ready`: numeric front, side and rear exist for each of R1, R2, R5, RU5 that appears in the council data (or via rules whose zone is not stated). `partial`: some rules but at least one of those zones lacks a numeric front, side or rear (text only, NCC/BCA reference, range, averaging only, or absent). `none`: no records, or no rule with a numeric front setback for a dwelling in a residential zone.')
A('- Basis columns come from running `pickRules` (`pocket-architect-source/src/site/setbacks.js`) for a standard lot per zone: single storey, wall height 3.0 m, building height 5.0 m, not a corner lot, no qualifiers, no precinct (R1/R2/R3 15 m x 600 m2; RU5 20 m x 800 m2; R5 60 m x 5000 m2). `DCP` = the council DCP rules give front, side and rear for that lot. `HC` = DCP could not be determined and the NSW Housing Code fallback gives it. `-` = nothing determinable (the app shows nothing). `DCP?` (HC pending) = DCP not determinable and the fallback set has not been loaded yet.')
A('- DCP is "not determinable" for a lot when a value is only an averaging rule (needs neighbour setbacks), is gated by a qualifier the app cannot know (battle-axe, laneway, classified road, established area, precinct), or two rules of equal specificity disagree. The reason for each is in the `why` of `scripts/simulate.mjs` output and in the council rule file `gaps`.')
A('')
A('## Zone basis summary (representative lot)')
A('')
tot = collections.Counter()
for z in ZONES:
    for c in councils:
        s = sim[c['lga_slug']][z]
        tot[(z, 'DCP' if s['dcp'] else ('HC' if s['basis'] else '-'))] += 1
A('| Zone | DCP | Housing Code fallback | Nothing |'); A('|---|---|---|---|')
for z in ZONES:
    A('| %s | %d | %d | %d |' % (z, tot[(z, 'DCP')], tot[(z, 'HC')], tot[(z, '-')]))
A('')
A('## Councils with status none')
A('')
for c in councils:
    if c['status'] == 'none':
        A('- **%s** (`%s`): %s' % (c['council'], c['lga_slug'], '; '.join(c['gaps'])[:380]))
A('')
A('What would be needed for each: the council DCP residential chapter (or a text-extractable copy) with front, side and rear setback tables, or a decision to rely on the NSW Housing Code fallback (the app then labels the result "SEPP Housing Code"). Councils with no extract records at all (balranald, cobar, gwydir, liverpool-plains) have no saved DCP text; councils with records that are not usable (cabonne, warren: rural buffer values only; canada-bay, hay, willoughby: a single non-front value; mosman, north-sydney, strathfield, waverley, broken-hill: averaging or side-only controls without a numeric front) need the front setback table or a streetscape rule the app can evaluate.')
A('')
A('## Per council')
A('')
A('Zone cells: basis for the representative lot per zone. Counts: extract records used / rules built.')
A('')
A('| Council | Status | ' + ' | '.join(ZONES) + ' | Records/Rules | Precinct-only | Main gaps |')
A('|---|---|' + '---|' * len(ZONES) + '---|---|---|')
for c in councils:
    cells = []
    for z in ZONES:
        s = sim[c['lga_slug']][z]
        if s['dcp']:
            cells.append('DCP')
        elif s['basis']:
            cells.append(SHORT.get(s['basis'], s['basis']))
        else:
            cells.append('DCP?/HC pending' if 'NSW' not in fb else '-')
    gap = '; '.join(g for g in c['gaps'] if not g.startswith('Extraction gaps'))[:160].replace('|', '/')
    A('| %s | %s | %s | %s/%s | %s | %s |' % (c['council'], c['status'], ' | '.join(cells), c['counts'].get('records', 0), c['counts'].get('rules', 0), 'yes' if c.get('needsPrecinct') else '', gap))
A('')
spot = os.path.join(HERE, 'spotcheck.md')
if os.path.exists(spot):
    A(open(spot).read())
open(os.path.join(ROOT, 'coverage-report.md'), 'w').write('\n'.join(L) + '\n')
print('written', cnt)
