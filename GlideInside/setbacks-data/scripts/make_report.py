#!/usr/bin/env python3 -I
"""Writes coverage-report.md from rules/ + simulation (node scripts/simulate.mjs)."""
import json, glob, os, subprocess, collections
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sim = json.loads(subprocess.check_output(['node', os.path.join(HERE, 'simulate.mjs')]))
allj = json.load(open(os.path.join(ROOT, 'setback-rules.json')))
fb = allj.get('fallbacks', {})
councils = allj['councils']
ZONES = ['R1', 'R2', 'R3', 'R5', 'RU5']
SHORT = {'Council DCP': 'DCP', 'Codes SEPP Housing Code (complying development pathway; exclusions such as bushfire, flood and heritage apply)': 'HC', 'QDC MP1.1 (default; council planning scheme or the Queensland Housing Code may vary)': 'QDC',
         'Codes SEPP Inland Code (complying development pathway; exclusions such as bushfire, flood and heritage apply)': 'IC'}
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
A('- QLD (owner decision 11/11/2026): the QDC default applies to every QLD council, labelled "QDC MP1.1 (default; council planning scheme or the Queensland Housing Code may vary)"; MP1.1 only (lots 450 m2 and under), lots over 450 m2 return null until MP1.2 is verified; no QLD council planning scheme lookups at launch.')
A('')
nf = sum(1 for c in councils for r in c['rules'] if r.get('flag'))
nt = sum(len(c['rules']) for c in councils)
A('- **Final status counts after merging the research for the 11 councils: %d ready, %d partial, %d none (128 councils).** Before the research merge the build gave 90 ready / 24 partial / 14 none; an earlier presence-only build gave 91 / 31 / 6 (it did not set none for councils whose only rules lack a numeric front setback). Research moved 6 of the 14 none councils to partial or ready (see per-council table); the 8 still none are councils with no DCP setback rules found (balranald and the other Inland Code councils listed below keep a Part 3D fallback). Status is presence-based; the zone columns show what is actually determinable.' % (cnt['ready'], cnt['partial'], cnt['none']))
A('- Rules marked `flag: "check_with_council"` (needsReview set or confidence low, owner ruling 11/11/2026): %d of %d rules. All rules are still shown; the flag and `flagReason` let the UI print "check with council".' % (nf, nt))
A('- Every picked setback carries `clause`, `page`, `source_file`, `dcp` (DCP name), `edition` (document edition/date as printed or UNVERIFIED) and `basis`.')
A('')
A('### How status and the basis column are determined')
A('')
A('- `ready`: numeric front, side and rear exist for each of R1, R2, R5, RU5 that appears in the council data (or via rules whose zone is not stated). `partial`: some rules but at least one of those zones lacks a numeric front, side or rear (text only, NCC/BCA reference, range, averaging only, or absent). `none`: no records, or no rule with a numeric front setback for a dwelling in a residential zone.')
A('- Basis columns come from running `pickRules` (`pocket-architect-source/src/site/setbacks.js`) for a standard lot per zone: single storey, wall height 3.0 m, building height 5.0 m, not a corner lot, no qualifiers, no precinct (R1/R2/R3 15 m x 600 m2; RU5 20 m x 800 m2; R5 60 m x 5000 m2). `DCP` = the council DCP rules give front, side and rear for that lot. `HC` = DCP could not be determined and the NSW Codes SEPP Housing Code fallback gives it; `IC` = the Inland Code (Part 3D) gives it, for the inland councils. `-` = nothing determinable (the app shows nothing). `DCP?` (HC pending) = DCP not determinable and the fallback set has not been loaded yet.')
A('- DCP is "not determinable" for a lot when a value is only an averaging rule (needs neighbour setbacks), is gated by a qualifier the app cannot know (battle-axe, laneway, classified road, established area, precinct), or two rules of equal specificity disagree. The reason for each is in the `why` of `scripts/simulate.mjs` output and in the council rule file `gaps`.')
A('')
A('## Zone basis summary (representative lot)')
A('')
tot = collections.Counter()
for z in ZONES:
    for c in councils:
        s = sim[c['lga_slug']][z]
        tot[(z, 'DCP' if s['dcp'] else ('HC' if s['basis'] else '-'))] += 1
A('| Zone | DCP | Code fallback (Housing Code, or Inland Code for inland LGAs) | Nothing (no envelope) |'); A('|---|---|---|---|')
for z in ZONES:
    A('| %s | %d | %d | %d |' % (z, tot[(z, 'DCP')], tot[(z, 'HC')], tot[(z, '-')]))
A('')
A('## Councils with status none')
A('')
for c in councils:
    if c['status'] == 'none':
        A('- **%s** (`%s`): %s' % (c['council'], c['lga_slug'], '; '.join(c['gaps'])[:380]))
A('')
A('Research for the 11 originally expected councils is merged (flagged check_with_council); those still none have no usable DCP setbacks. The Inland Code list has only 8 of 69 LGAs (TODO: add the rest in merge_research.py INLAND). What would be needed for each: the council DCP residential chapter (or a text-extractable copy) with front, side and rear setback tables, or a decision to rely on the NSW Housing Code fallback (the app then labels the result "SEPP Housing Code"). Councils with no extract records at all (balranald, cobar, gwydir, liverpool-plains) have no saved DCP text; councils with records that are not usable (cabonne, warren: rural buffer values only; canada-bay, hay, willoughby: a single non-front value; mosman, north-sydney, strathfield, waverley, broken-hill: averaging or side-only controls without a numeric front) need the front setback table or a streetscape rule the app can evaluate.')
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
