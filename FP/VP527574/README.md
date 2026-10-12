# VP527574: Newstead Levee Design 26/27, final fee proposal and sub-consultant RFQs

Mount Alexander Shire Council RFQ M2025-125 (VendorPanel VP527574). Prepared 12/10/2026. Nothing has been sent or lodged.

- **Quote due from sub-consultants:** 12:00 pm (AEDT) Friday 16/10/2026 (questions to JCE by 5:00 pm Wednesday 14/10/2026)
- **Council question cut-off:** 2:00 pm Wednesday 21/10/2026 (lodge by Monday 19/10)
- **Tender closes:** 2:00 pm (AEDT) Friday 23/10/2026
- Dropbox bid folder: `/__JCE/01_BizDev/Fee_Proposals/Draft/2026-10-07_VP527574_Newstead-Levee-Design`

## Final fee proposal (`Final/`)

Main offer $113,600 ex GST ($124,960 inc GST, inside Council's $125,000 budget); Alternative A full scope $237,220 ex GST. See `Final/SUBMISSION_CHECKLIST.md`.

## RFQs (value-engineered scope)

| Discipline | RFQ (Rev C FINAL, generic "To: invited sub-consultant") | Emails |
|---|---|---|
| Floodplain modelling | `Floodplain_Modelling/JCE_RFQ_Floodplain-Modelling_Newstead-Levee-Design_Final.docx` / `.pdf` | `Floodplain_Modelling/Emails.txt` |
| Civil supervision and approval (RPE Vic, Civil) | `Civil_Supervision_RPEV/JCE_RFQ_Civil-Supervision-RPEV_Newstead-Levee-Design_Final.docx` / `.pdf` | `Civil_Supervision_RPEV/Emails.txt` |
| Survey | `Survey/JCE_RFQ_Survey_Newstead-Levee-Design_Final.docx` / `.pdf` | `Survey/Emails.txt` |
| Geotechnical (provisional sum PS-A) | `Geotechnical/JCE_RFQ_Geotechnical_Newstead-Levee-Design_Final.docx` / `.pdf` | `Geotechnical/Emails.txt` |

Email texts are also in Dropbox as `03_Subconsultants/<discipline>/Email_Drafts_Final_2026-10-12.txt`. Attach the RFQ PDF (repo only) and `Attachment_1-Project_Brief_and_General_Specification.pdf` (already in each Dropbox discipline folder).

Each RFQ prices the lean main-offer items separately from Alternative A items and options, states JCE's allowance, and covers: insurances per the tender (PL $20M, PI $5M held 5 years, workers compensation, certificates), Victorian registration, OHS Act 2004 (Vic) and SWMS, independence and conflict declaration, confidentiality (no contact with Council), pricing schedule with hourly rates, 90-day validity (to 14/01/2027), and engagement conditional on JCE winning.

**Dropped:** Structural (main offer uses standard headwalls and proprietary gates; bespoke structures are provisional sum PS-F) and Heritage/Ecology (PS-B and PS-C allowances; Council usually sponsors the CHMP). Their Rev B drafts remain in Dropbox for Alternative A or a directed PS.

## Firms

| Discipline | # | Firm | Email | Basis |
|---|---|---|---|---|
| Floodplain | 1 | Venant Solutions (Michael South, Atoosa Towzihian) | michael.south@venantsolutions.com.au; atoosa.towzihian@venantsolutions.com.au | JCE partner; CVs on file; Harcourt Flood Study (Mount Alexander Shire) |
| | 2 | HARC, Blackburn VIC | [email TBC] (03 9908 2160) | Victorian flood studies per harc.com.au |
| Civil supervision | 1 | Lotay Civil (Sunny Lotay), Ballarat | info@lotaycivil.com.au (0449 018 519) | JCE files; not confirmed online today |
| | 2 | Venant Solutions (Michael South) | michael.south@venantsolutions.com.au | Fallback if RPE area covers civil |
| | 3 | Spiire, Bendigo | [email TBC] (03 5448 2500, 2017 drawing) | Local (Greater Bendigo) |
| Survey | 1 | Adrian Cummins & Associates, East Bendigo | [email TBC] ((03) 5442 5133) | Licensed surveyor, ISO 9001 (Yellow Pages) |
| | 2 | Spiire, Bendigo | [email TBC] | Coliban Water consultant register |
| | 3 | BCE Spatial (Gerald Donn), Travancore VIC | gerald@bcespatial.com.au | Surveyor register entry seen in search results; not local |
| Geotechnical | 1 | Geotechnical Testing Services (Sandhurst Geotech), Bendigo | info@geotestsouthern.com.au (03 5441 4881) | Council planning document in search results; local |
| | 2 | Provincial Geotechnical | [email TBC] (11/10 draft had admin@pgvic.com.au; not confirmed) | 11/10 draft web search |
| | 3 | Civiltest Pty Ltd | [email TBC] | Geotech consulting and NATA labs |

JCE's register (27 contacts), the network map and the one capability statement in `Subconsultant Cap Statements` hold no Victorian survey or geotechnical firms. Web fetch of firm sites was not available, so every email above should be checked on the firm's website before sending.

## Build scripts

In the session scratchpad (`VP527574_final/nl_*.py`): pricing, content, renderer, Schedule C, RFQs and emails. Regenerate with python3 then `soffice --headless --convert-to pdf`.
