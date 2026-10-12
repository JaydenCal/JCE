# SA11 pathway + application pack: status

## Done (46 tests pass: tests/test_sa11_pathway.py, test_pack_compliance.py, test_pack_soee.py, test_pack_assemble.py)
- `app/agents/sa11_pathway/`: data-driven engine (rules in `knowledge/pathway/rules.json`, built and quote-validated by `knowledge/pathway/build_rules.py`). Per pathway (exempt / CDC / DA): ELIGIBLE / NOT_ELIGIBLE (failing criterion + citation) / UNRESOLVED / NOT_APPLICABLE, card pills Required / Possible / Not applicable / Unresolved, `PathwayResult.ui_model()`. Recommendation is always "May apply: verify with council or a certifier."
- `app/pack/compliance.py`: compliance table (DA from Gunnedah Requirements; CDC from SA11 rows). PASS/FAIL only from numeric comparison; booleans/text and missing data are UNRESOLVED.
- `app/pack/soee.py`: deterministic SoEE (TO BE COMPLETED for unknowns, each statement has a source field), optional `LlmClient` with guard rails (rejects new numbers / altered TBC lines), DOCX + PDF with DRAFT watermark and disclaimer.
- `app/pack/assemble.py`: ZIP (numbered index, cover sheet, checklist from Gunnedah's own checklists, cited Planning Portal lodgement guidance, manifest.json sha256, pack.json for UI). `app/pack/samples.py` builds packs from test-runs; samples in `test-runs/pack_lot2_dwelling`, `pack_quia_granny`.

## Resolved (65 cited rules)
Inland Code residential standard lot (R1-R4, RU5; lot size/width, storeys, height, GFA bands, primary/secondary/side/rear setbacks, parking), Inland Code rural dwelling (lot area, height, setbacks, watercourse), Inland LGA list (Gunnedah = no. 30, read from map image), Housing Code lot size/width, secondary dwelling (zones R1-R5, 450 m2, no subdivision, principal dwelling, not strata, BAL-FZ), exempt and CDC farm building (partial), general CDC exclusions (fact sheet), Gunnedah DA/CDC checklists, portal guidance. Sources are Dept summary tables dated Oct 2018 (Housing Code June 2018): flagged `verify_current`.

## Blocked / UNRESOLVED (16 rules + documents)
Blocked (Cloudflare): Codes SEPP 2008, Housing SEPP 2021 (Sched 1 secondary dwelling standards), EP&A Regulation 2021 (SoEE content, Sched 1), Gunnedah LEP 2012 (permissibility, lot size, height, cl 5.4/5.5). Not located: Rural Housing Code tables, official Portal SoEE guide, PBP 2019.
Unresolved rules: flood control lot, easements, LEP permissibility (user input), bushfire clauses, corner/battle-axe/parallel and R5 tables, Housing Code standards, Rural Housing Code, rural adjoining land use / sloping siting, secondary dwelling Sched 1 standards, LEP cl 5.5, exempt garden shed standards (cl 2.17-2.18), non-farm CDC outbuildings, farm aggregate/siting/CDC footprint columns. See `knowledge/pathway/unresolved.json`.

## Known gaps
- No pathway can reach ELIGIBLE for secondary dwellings or farm sheds (unresolved standards remain); dwelling ELIGIBLE needs all inputs supplied.
- Layout-derived inputs (setbacks, heights, GFA) are not wired from SA8; callers pass `ProposalFacts`/`PathwayInput`. Real test runs therefore show mostly UNRESOLVED.
- Table column boundaries for some Inland rows were read from rendered images (confidence 0.65-0.75, noted per rule).
- Exempt-not-applicable for dwellings is inferred (confidence 0.5).
- Gunnedah council page says 3 paper copies, conflicting with its portal page: flagged in guidance.
- Raw downloads are git-ignored; rebuild with `fetch_pathway_docs.py` then `build_rules.py`.
