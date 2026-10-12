# VP528755: final subconsultant RFQs (TCW00728 Vickers Rd PS C6B)

Townsville City Council RFQ TCW00728, Vickers Rd PS C6B Diversion Project: Superintendent and Construction Verification Services.
Prepared 12/10/2026. Nothing has been sent. Jayden sends the emails himself.

- **Quote due from subconsultants:** 12:00 pm AEST Friday 23/10/2026
- **Head tender closes:** 5:00 pm AEST Friday 30/10/2026 (VendorPanel shows 6:00 pm AEDT)
- **Council question cut-off:** 5:00 pm AEST Friday 23/10/2026
- Dropbox bid folder: `/__JCE/01_BizDev/Fee_Proposals/Draft/2026-10-11_VP528755_Vickers-Rd-PS-C6B-Superintendent`

## Files

| Discipline | RFQ (generic, "To: Invited subconsultant") | Per-firm copies (To line filled) | Emails |
|---|---|---|---|
| Construction verification (Superintendent's Representative and Inspectors, Townsville) | `Construction_Verification/JCE_RFQ_Construction_Verification_Vickers-Rd-PS-C6B_Final.docx` and `.pdf` (6 pages) | `Construction_Verification/per_firm/*_PDM-Managers`, `*_Gnosis-Engineering`, `*_Steve-McKenzie-Consultant-Engineer-Pty-Ltd` (.docx and .pdf) | `Construction_Verification/Emails.txt` |
| M&E verification (PS C6B, Contract 2) | `ME_Verification/JCE_RFQ_ME_Verification_Vickers-Rd-PS-C6B_Final.docx` and `.pdf` (5 pages) | `ME_Verification/per_firm/*_Orana-Engineering`, `*_Clarence-Consultants` (.docx and .pdf) | `ME_Verification/Emails.txt` |

Email text is also saved in Dropbox (new files, nothing overwritten):
`03_Subconsultants/Construction_Verification/Email_Drafts_Final_2026-10-12.txt` and `03_Subconsultants/ME_Verification/Email_Drafts_Final_2026-10-12.txt`.

Attach with each email: the firm's per-firm RFQ PDF, plus Council's `TCW00728 Request for Quotation.pdf`, `TCW00728 AS 4122-2010 Consultancy Contract V2 Final.pdf` and `TCW00728 Price Schedule V3 Final.xlsx` (already in each Dropbox discipline folder).

## Firms (strongest first)

### Construction verification
| # | Firm | Email | Why |
|---|---|---|---|
| 1 | PDM Managers | **[email TBC]** | Its website (seen through search only) lists Superintendent's Representative and Clerk of Works roles for Townsville City Council sewerage works (Nelly Bay, Picnic Bay) and inspection and verification on the Ross River Dam pipeline duplication. Townsville base and contact not yet confirmed. |
| 2 | Gnosis Engineering, Townsville | admin@gnosisengineering.com.au (from website, per the 11/10 draft; not re-checked) | Website lists Superintendent and Superintendent's Representative services under Australian Standards. |
| 3 | Steve McKenzie Consultant Engineer Pty Ltd (SMCE), 18 Ingham Rd, West End, Townsville | admin@smce.net.au (from website, per the 11/10 draft; not re-checked) | North Queensland firm since 1997; lists construction supervision and contract administration. |

Reserve: aGnR Consultants (Townsville, water and wastewater infrastructure; phone 07 4772 4694 from a directory, email TBC). The 11/10 draft's ConsultCivil could not be confirmed online and was dropped.

### M&E verification
| # | Firm | Email | Why |
|---|---|---|---|
| 1 | Orana Engineering, Townsville head office | **[email TBC]** (contact form at oranaeng.com.au; phone 07 4755 0556 per 11/10 draft) | Mechanical, electrical and control systems consultancy headquartered in Townsville. Mostly mining and heavy industry; water and wastewater experience to be confirmed. |
| 2 | Clarence Consultants (Ken Heard), Coffs Harbour | Ken@clarenceconsultants.com.au (JCE register and network map) | JCE network contact; BE Electrical, MIEAust, NSW Professional Engineer (Electrical). RPEQ not known; the email asks. |

SMCE was dropped from the M&E list: its listed services are civil and structural.

## What changed from the 11/10 drafts
- Quote due moved from Thu 22/10 5:00 pm to **Fri 23/10/2026 12:00 pm AEST**; tender close shown as Fri 30/10/2026 5:00 pm AEST.
- Insurances set to Council's contract: PL $20 million (item 30.2), PI $10 million with one automatic reinstatement (item 30.4), WorkCover Queensland, certificates of currency.
- RPEQ section added (Professional Engineers Act 2002 (Qld)); Council's RFQ names no registration, but JCE's Superintendent is not an RPEQ, so the partner provides RPEQ supervision.
- Roles and site presence table: JCE Superintendent signs everything; partner provides the Representative (about 7 h a week) and Inspector (5 days a week, 2.5 h a day average, second Inspector in overlaps).
- Pricing schedule: hourly rates, lump sums by contract and role (CV) or by activity (M&E), exclusions, 90-day validity (to 21/01/2027), escalation basis.
- Independence and conflict of interest, confidentiality (including RTI disclosure), engagement conditional on JCE winning and Council approval, back-to-back AS 4122 terms (30 business days payment).

## Checks before sending
1. **Get the files to Dropbox/Outlook.** The .docx and .pdf files are only in this repo folder (not committed, and the Dropbox connector cannot upload binary files). Copy the per-firm PDFs to the Dropbox discipline folders or attach them from here.
2. **Find the two missing emails:** PDM Managers (pdmanagers.com.au, also confirm it is Townsville-based) and Orana Engineering (ring 07 4755 0556 or use the contact form). Re-check the Gnosis and SMCE addresses on their websites; they came from the 11/10 draft and could not be re-verified today (web fetch blocked).
3. **Validity:** subconsultant validity is 90 days (to 21/01/2027) as instructed, but Council's quotation validity is 150 days from 30/10/2026 (to 29/03/2027). Award is expected 11/12/2026, so 90 days covers it; the RFQ asks firms to say whether they will extend.
4. **Hours split** is JCE's (Representative 1,410 h = 45% of 3,135; Inspector 2,567 h; M&E 150 h inside the Inspector allowance), taken from the FP draft cost basis. Change in `_build_rfq.py` (python3, then soffice --headless --convert-to pdf) and regenerate if Jayden wants a different split.
5. **"JCE will ask Council"** for Appendix E.1, E.2 and the construction contracts: RFI 1 is still a draft. Lodge it on VendorPanel before 23/10.
6. **JCE's own gaps** (not for the RFQs, but they decide the bid): JCE PL is $10 million against $20 million required; no WorkCover Queensland certificate; no RPEQ in JCE.
7. Read each per-firm PDF once and send each email separately (no shared To or CC).
