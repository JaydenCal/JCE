# Decision log

| # | Decision | Date | Basis |
|---|---|---|---|
| 1 | Accept CC BY 4.0 data licences; LiDAR/DEM acceptable for cut/fill | 2026-10-12 | User: yes |
| 2 | BYDA: there is **no live database of buried assets**. Asset owners hold the data and answer each enquiry. BYDA offers a member **API** to lodge referral enquiries ([BYDA API](https://byda.com.au/2024/08/07/byda-api-improves-access-to-referral-information)). **Plan:** until a BYDA API agreement exists, users upload the response PDFs (Phase 2/3). In Phase 3 we add enquiry lodgement through the BYDA API if BYDA permits lodging for another party, and show returned plans straight away. The user still must verify and physically locate (Terms cl. 9). To confirm with BYDA: partner/intermediary rules, fees, and how the user's contact details are handled | 2026-10-12 | User asked for immediate display or lodging on their behalf |
| 3 | Keep `vector(1536)`. Works with common embedding models and can be reduced by truncation. Changing later needs a re-embed migration | 2026-10-12 | User delegated; our call |
| 4 | Australian-region hosting | 2026-10-12 | User: yes |
| 5 | Phase 2 approved | 2026-10-12 | User: PROCEED |
| 6 | Export both **DXF and complete PDF plan sheets**. Sheets show the driveway/crossover, council-specific overlays, vehicle turning circle/swept path and dimensions. SA3 computes, SA5 draws and exports | 2026-10-12 | User request |
| 7 | **RWT sizing and sewer/water connections derived from DBYD** are core SA4 deliverables (Phase 3); SA5 draws them from Phase 2 | 2026-10-12 | User request |
