# JCE outreach pack (12/10/2026)

Everything Jayden needs to send to sub-consultants, partners, referees, Sunny Lotay, Webber and one buyer for the pursued bids. **Nothing has been sent.** Send each email yourself, one firm per email (no group sends, no shared CC).

## What is in the pack

| File | Use |
|---|---|
| `OUTREACH_LIST.xlsx` | Master list: 82 contacts sorted by due date, with priority, files to attach and a Status drop-down. Sheet "Missing emails" lists the 45 contacts with no confirmed email and any known phone number. |
| `OUTREACH_LIST.md` | The same list as text. |
| `EMAIL_TEMPLATES.md` | Ready-to-paste emails: Maverick Parker, Darren Quilliam, Craig Sullivan, Sunny Lotay, Webber, the Aurukun buyer, and the cover paragraph for every RFQ email. |
| `forms/QuoteReturn_<bid>_<Discipline>.pdf` | 25 fillable Quote Return Forms, one per bid and discipline, prefilled with the bid, discipline, quote due date, tender close and that RFQ's pricing items. |
| `forms/Referee_Consent_Form.pdf` | Fillable referee consent and details form (send to every referee). |
| `forms/Sunny_Consent_and_Details_Form.pdf` | Fillable form for Sunny: RPEQ, NER, CPEng, experience, insurance, a consent tick box for each bid. |
| `forms/Associate_Agreement_Sunny_Lotay_DRAFT.pdf` | 2-page draft standing associate agreement with a work order template. DRAFT, not legal advice: review before signing. |

The RFQ email texts themselves are unchanged in `FP/<bid>/<discipline>/Emails.txt` (newest revision: `Emails_RevC.txt` for Murray River road imaging, `Emails_RevD.txt` for Inner West data capture).

## Order of sending

### Today, Monday 12/10 (Priority 1: due by Friday 16/10)

1. **Webber** (email 5). PL $20M must be bound before the first lodgement (Mid-Western, aim 16/10). Also workers comp, motor and drone cover.
2. **Sunny Lotay** (email 4). Ring 0449 018 519 first to confirm the email. He is named on all eight bids and needs to consent, plus the Newstead RPE Vic quote is due 16/10.
3. **Referees**: Maverick Parker (email 1), Darren Quilliam (email 2, find his number first), Craig Sullivan (email 3), and a quick call to Brett Langtree and Livio Chiarot to confirm they know about the tenders. Identify the Katherine Aquatics and Underscore Projects (WSI) contacts. **The Rev G FPs print "Maverick Partner" (TN-1640786 Rev H already says Parker): correct the name in the other bids before lodging.**
4. **RFQs due Thursday 15/10 (12:00 pm)**: Mid-Western town planning and cost planning (TN-1640786), and all six Port Douglas disciplines (VP527224). Most Port Douglas and all three QS firms have no email: ring them today.
5. **RFQs due Friday 16/10 (12:00 pm)**: Newstead Levee (VP527574) floodplain, civil supervision, survey and geotechnical.
6. **Leppington architects** (BUYNSW-T026-2026): send the five teaming emails from `FP/BUYNSW-T026-2026/Architect-Teaming/Emails.txt` with each firm's **Rev D** brief (the files without `_RevC`). They confirm by Friday 16/10. No Quote Return Form for these.

### By Wednesday 14/10 (Priority 2)

7. **Inner West RFT 47-26** (VP527819): data capture Rev D (per_firm `_RevD_<Firm>.pdf`) and valuation. Quotes due 21/10; partners confirm intent by 14/10, so send now.
8. **Hawthorn Road** (VP523438) and **Gregadoo** (VP527469): quotes due 23/10.
9. **Aurukun buyer question** (email 6) by Monday 19/10, only if you still want to consider VP528349. Check the exact clause 2.8(b) wording first.

### This week (Priority 3)

10. **Murray River** (VP527277): road imaging Rev C (`_RevC_<Firm>.pdf`), bridges and valuation. Quotes due 28/10, but partners are asked to confirm by Monday 19/10, so send by Wednesday 14/10 if you can.

## How to send each RFQ email

1. Open the firm's row in `OUTREACH_LIST.xlsx`. The "What to send" column gives the exact RFQ PDF and Quote Return Form paths, plus any Council files from Dropbox.
2. Copy the email for that firm from the discipline's `Emails.txt` and add the cover paragraph from `EMAIL_TEMPLATES.md` section 7.
3. Attach the RFQ PDF, the Quote Return Form and the Dropbox files. For Murray River and Inner West use the per-firm RFQ named in the row.
4. Where the email is "TBC - phone", ring the number on the "Missing emails" sheet (or use the firm's website contact page). Do not guess addresses.
5. Set Status to "Sent". When quotes come back, set "Quote received" and fold the figures into the cost sheet and FP as the bid's SUBMISSION_CHECKLIST says.

## Notes and gaps

- 45 of 82 contacts have no confirmed email (32 of them also have no phone found). Most are Port Douglas, Murray River and Inner West firms from public sources.
- Webber broker name and email, Darren Quilliam, Craig Sullivan, Katherine Aquatics and Underscore Projects contacts are not in the files.
- Sunny's email (info@lotaycivil.com.au) and phone come from JCE's files and were not confirmed online.
- Venant (Michael South) is asked for two Newstead disciplines; IMG, APV, Australis and JRA are asked for both Murray River and Inner West; Spiire for two Newstead disciplines; Civiltest for Newstead and Gregadoo. Each has one row listing every bid.
- Excluded: VP527758 Mildura and VP528755 Vickers (no bid).
- The Quote Return Forms were checked with pypdf (`get_fields()`): every form opens and has its text fields and checkboxes.
