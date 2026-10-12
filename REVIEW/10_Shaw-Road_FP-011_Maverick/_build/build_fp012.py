"""FP-012 Rev B: 369 Shaw Road, Stage C operational works."""
import os
from jcedoc import Doc, money, GREY
from common import ISSUE, CLIENT, TO_LINES, attachments, gantt

OUT = "/home/user/JCE/FP/FP-011_Shaw_Road"
REF = "FP-012 Rev B"

PA = [
    ("C-A1", "Kick-off, review of the DA approval, conditions and approved Flood Impact Assessment; condition compliance matrix; OW scope schedule (quantities and works boundaries) and design responsibility schedule; survey and geotechnical briefs.", 3500),
    ("C-A2", "Authority liaison: pre-design meeting with Council and Townsville Water (applicable codes recorded), coordination with TMR for works in Shaw Road and with Kingsun's electrical consultant; up to ten (10) hours of online meetings.", 2500),
    ("C-A3", "Operational works application, road works permit and road corridor applications for the service mains, and coordination of RPEQ certification.", 3000),
]
PB = [
    ("C-B1", "Dalrymple Road West all movements intersection: geometry, turn treatments and pavement widening, pavement design, drainage, kerbs, signs and pavement marking, frontage tie-ins and reinstatement within the agreed works boundary.", 17000),
    ("C-B2", "Safety in Design report for the intersection and external works.", 1500),
]
PC = [
    ("C-C1", "Bulk earthworks: 3D model consistent with the approved flood assessment, fill platforms (up to about 10 ha), compensatory excavation, waterway corridor works and scour protection.", 12000),
    ("C-C2", "Internal road (up to 600 m) and one waterway crossing of up to four culvert cells, including pavement design.", 14000),
    ("C-C3", "Stormwater drainage, detention and quality treatment, updated DRAINS and MUSIC models, and comparison of the detailed design with the approved flood model.", 13500),
    ("C-C4", "Water supply: network analysis, external connection main (up to 800 m) and internal reticulation.", 14500),
    ("C-C5", "Sewerage: network analysis, internal gravity reticulation, private package pump station civil design and rising main (up to 1,000 m).", 18000),
    ("C-C6", "Erosion and sediment control plans and details.", 3000),
    ("C-C7", "Documentation, Safety in Design register, quality review and one (1) round of consolidated comments.", 4000),
]
PD = [
    ("C-D1", "After OW approval: one coordinated For Construction set incorporating minor approval markups and conditions that do not require redesign.", 2000),
]
RP = [
    ("C-R1", "Direction and review through the design and RPEQ certification of the OW documentation by Sunny Lotay, RPEQ (35 hours at $200/hr) [TBC].", 7000),
]
PS = [
    ("PS1", "Flood verification by Venant Solutions where the flood specialist determines a material design change needs verification, or an approval condition requires it. Allowance pending Venant's quotation [TBC].", 4000),
    ("PS2", "Responses to information requests on the OW application from Council, SARA or TMR and Townsville Water, at the Schedule of Rates.", 5000),
    ("PS3", "Detail survey of the works areas, services and frontages to JCE's brief, if not commissioned directly by Kingsun [TBC].", 15000),
    ("PS4", "Geotechnical investigation for the fill platforms, pavements, culvert and pump station to JCE's brief, if not commissioned directly by Kingsun [TBC].", 15000),
]
s = lambda L: sum(x[2] for x in L)
lump = s(PA) + s(PB) + s(PC) + s(PD)
fee = lump + s(RP)
ps = s(PS)
assert (lump, fee, ps) == (108500, 115500, 39000)
MIL = [
    ("M1", "On acceptance and the kick-off meeting", 10),
    ("M2", "On issue of the preliminary design for review (end of week 6)", 30),
    ("M3", "On issue of the draft OW set for review (end of week 10)", 30),
    ("M4", "On issue of the final RPEQ certified set and lodgement (end of week 12)", 25),
    ("M5", "On issue of the For Construction set after OW approval", 5),
]
assert sum(m[2] for m in MIL) == 100


def ftable(d, title, L, label):
    rows = [(a, b, money(c)) for a, b, c in L] + [("", f"{label} (excl. GST)", money(s(L)))]
    d.table(["ITEM", title, "FEE (EXCL. GST)"], rows, [1.6, 12.4, 3.0], total_rows=(-1,), align_right_cols=(2,))


def build():
    png = os.path.join(OUT, "_build", "fp012_program.png")
    gantt(png, "Stage C: program from acceptance after DA approval (weeks)", [
        ("Kick-off, conditions, scope schedule, briefs", 0, 2, "jce"),
        ("Survey and geotechnical (Kingsun or PS3, PS4)", 1, 3, "sub"),
        ("Pre-design meeting, network analysis", 1, 4, "jce"),
        ("Preliminary design", 3, 3, "jce"),
        ("Detailed design, SiD, RPEQ review", 6, 4, "jce"),
        ("Comments, certification, lodgement", 10, 2, "jce"),
        ("Council assessment and RFIs (PS2)", 12, 8, "other"),
        ("For Construction issue", 20, 2, "jce"),
    ], [("M2", 6, 3), ("M3", 10, 4), ("M4", 12, 5), ("M5", 22, 7)], 24)

    d = Doc(f"{REF}   |   369 Shaw Road, Shaw: Stage C operational works   |   {ISSUE}")
    d.letterhead("FEE PROPOSAL",
                 "369 Shaw Road, Shaw QLD 4818: operational works design and approval",
                 "Stage C of the staged engagement. Follows Stages A and B in FP-011 Rev B. Lot 16 on SP232874.",
                 REF, ISSUE, TO_LINES)
    d.kv_table([
        ("Proposal", REF, "Supersedes", "FP-012 Rev 0 dated 03/10/2026"),
        ("Client", CLIENT, "Attention", "Mr Maverick Parker"),
        ("Site", "369 Shaw Road, Shaw QLD 4818 (Lot 16 on SP232874, 14.62 ha)", "Authorities", "Townsville City Council; Townsville Water; TMR (Shaw Road)"),
        ("Prepared by", "Jayden Callen, Director", "RPEQ review", "Sunny Lotay, RPEQ, Lotay Civil [TBC]"),
        ("Related proposal", "FP-011 Rev B: Stages A and B", "Validity", "12 months from 12/10/2026; fee confirmed against the approval"),
    ])
    d.p("Dear Maverick,", before=4)
    d.p("This proposal covers Stage C: the civil operational works design, documentation and application that follow the DA approval, through to a For Construction issue. I remain your single point of contact, coordinating survey, geotechnical, Venant and your electrical consultant, with Sunny Lotay, RPEQ, directing and certifying JCE's engineering. Rev B adds an agreed scope schedule, a drawn external works boundary, a design responsibility schedule for the pump station, flood verification triggered by design change, and a defined post-approval For Construction issue.")

    d.h("Project understanding")
    d.bullets([
        "**Works.** Bulk earthworks for flood immune fill platforms and the waterway corridor, the internal road and waterway crossing, the Dalrymple Road West intersection, stormwater drainage and treatment, and extension of water and sewerage to the site.",
        "**Expected conditions.** The 2017 approval (MI16/0016) required OW approval for water, sewerage, stormwater, roadworks and landscaping, and an all movements intersection on Dalrymple Road West with northern pavement widening. JCE expects similar conditions and prepares a condition compliance matrix at kick-off. Historic conditions indicate likely interfaces; the new approval governs.",
        "**Servicing.** The option confirmed in Stage A is designed and confirmed by network analysis. A private package pump station is the fee basis.",
        "**Flood consistency.** JCE compares the detailed terrain, drainage and crossing geometry with the approved flood assessment as part of design coordination (item C-C3).",
        "**Registration.** Professional engineering in Queensland is carried out by, or under the direct supervision of, an RPEQ. JCE's OW engineering is directed, reviewed and certified by Sunny Lotay, RPEQ [TBC: registration number and disciplines], Lotay Civil, JCE's associate certifying engineer under a standing associate agreement.",
    ])

    d.h("Scope schedule (fee basis)")
    d.p("The lump sum is based on one coordinated OW submission for the agreed ultimate site-wide civil scheme:")
    d.table(["ELEMENT", "INCLUDED QUANTITY"], [
        ("External intersection", "One, Dalrymple Road West (all movements, turn treatments, northern widening)"),
        ("Internal road", "Up to 600 m total length"),
        ("Waterway crossing", "One, up to four standard precast culvert cells"),
        ("Fill platforms", "About 10 ha"),
        ("External water main", "Up to 800 m"),
        ("Sewer rising main and pump station", "Up to 1,000 m; one private package pump station"),
        ("Internal pipe lengths, basins and outlets, stages", "[TBC: recorded in the scope schedule from the approved plans before commencement]"),
    ], [6.0, 11.0])
    d.p("Separate staged applications, interim drainage, service or flood arrangements, additional crossings or intersections, and works above these quantities are additional services unless listed in the schedule. Tenancy car parks, hardstands, internal drives and building connections are excluded and their owner is recorded in the interface schedule.")

    d.h("Scope of services")
    d.sub("Part C-A: General and approvals")
    d.numbered([
        "Kick-off, conditions review and condition compliance matrix; the OW scope schedule and design responsibility schedule; survey and geotechnical briefs.",
        "Pre-design meeting with Council and Townsville Water, at which the applicable Townsville Water CTM and SEQ codes, Council amendments and other standards are recorded; TMR coordination; coordination with Kingsun's electrical consultant for Ergon Energy and NBN Co.",
        "OW application, road works permit and road corridor applications for the service mains where required, and RPEQ certification.",
    ], prefix="C-A")
    d.sub("Part C-B: External works")
    d.numbered([
        "Dalrymple Road West intersection to the traffic engineer's design report. The external works boundary is shown on the agreed scope plan and identifies the included widening, drainage, frontage tie-ins and reinstatement. Minor road reinstatement for the included service mains is identified expressly. Utility relocation design, other intersection or network upgrades, specialist underbore design, contractor temporary works and construction traffic control are excluded unless listed in the schedule. Street lighting is excluded.",
        "Safety in Design report for the intersection and external works.",
    ], prefix="C-B")
    d.sub("Part C-C: Internal works")
    d.numbered([
        "Bulk earthworks: 3D model consistent with the approved flood assessment, platforms, batters, compensatory excavation, waterway corridor works, scour protection, volumes and staging.",
        "Internal road and waterway crossing: geometry, sections, pavement design to AGPT Part 2 from the geotechnical report, culvert with headwalls, wingwalls, scour protection and barrier, using standard precast units. A bridge or open-span solution, extra cells or crossings, project-specific structural or foundation design, or materially different waterway protection or fish passage works need scope and fee confirmation.",
        "Stormwater: trunk drainage and outlets, detention required by the approval, treatment devices, updated DRAINS and MUSIC models, and comparison of the design with the approved flood assessment. Where Venant determines that a material change needs verification, or a condition requires it, verification proceeds under PS1 once its scope is agreed.",
        "Water supply: demand assessment, network analysis for main sizes and fire flows, external connection main and internal reticulation.",
        "Sewerage: network analysis of the receiving system, internal gravity reticulation, civil design of the private package pump station (wet well, valve pit, emergency storage, access, layout) and the rising main. Before detailed design, the responsibility schedule names who provides hydraulic duty and storage criteria, wet well layout, structural and buoyancy assessment, equipment selection, mechanical, electrical and control design, power and backup, and owner acceptance. JCE's civil design and network analysis are coordinated with those parties.",
        "Erosion and sediment control plans and details to SC6.4.",
        "Documentation and quality: notes, drawing register, Safety in Design register, quality review and one round of consolidated client comments.",
    ], prefix="C-C")
    d.sub("Part C-D: After approval")
    d.numbered([
        "After OW approval and any agreed authority responses, one coordinated For Construction set based on the approved design, incorporating minor approval markups. Redesign arising from conditions, extra staged packages and further submissions are additional services.",
    ], prefix="C-D")

    d.h("Deliverables")
    d.table(["SHEET", "TITLE (FOR APPROVAL, THEN FOR CONSTRUCTION)"], [
        ("CV-1000", "Cover sheet, drawing index, locality plan and general notes"),
        ("CV-1001", "Existing site, existing services, clearing and demolition"),
        ("CV-1100", "Bulk earthworks plans, sections and volumes"),
        ("CV-1200", "Internal road plan, longitudinal section and cross sections"),
        ("CV-1210", "Waterway crossing culvert: plan, sections and details"),
        ("CV-1300", "Dalrymple Road West intersection: plan, sections, pavement, signs and marking"),
        ("CV-1400", "Stormwater drainage plans, longitudinal sections and schedules"),
        ("CV-1410", "Stormwater quality treatment and detention"),
        ("CV-1500", "Water supply reticulation"),
        ("CV-1600", "Sewerage reticulation, pump station and rising main"),
        ("CV-1700", "Erosion and sediment control"),
        ("CV-1800", "Standard and typical details"),
    ], [2.6, 14.4])
    d.bullets([
        "Condition compliance matrix; OW scope schedule; design responsibility schedule.",
        "Stormwater management design report with DRAINS and MUSIC (RPEQ certified); water and sewerage network analysis and design report (RPEQ certified); Safety in Design report and register.",
        "OW application package with RPEQ certification; road works permit and corridor applications; For Construction set after approval.",
    ])

    d.h("Responsibilities and exclusions")
    d.table(["ITEM", "RESPONSIBLE"], [
        ("Civil design, coordination, single point of contact", "JCE (Jayden Callen)"),
        ("Direct supervision and RPEQ certification", "Sunny Lotay, RPEQ (Lotay Civil), through JCE"),
        ("Flood verification where triggered", "Venant Solutions, through JCE (PS1)"),
        ("Detail survey; geotechnical investigation", "Kingsun, or JCE under PS3 and PS4"),
        ("Electrical, street lighting, Ergon Energy and NBN Co design", "Kingsun's electrical consultant"),
        ("Pump station mechanical, electrical and controls", "Pump supplier or electrical consultant, per the responsibility schedule"),
        ("Waterway barrier, riverine and environmental approvals", "Kingsun's planner or environmental specialist"),
        ("Tenancy works: pads beyond the platforms, car parks, hardstands, drives, building connections", "Kingsun's architect or other designer, or JCE by quotation"),
    ], [9.5, 7.5])
    d.p("Also excluded: landscape and irrigation; building and structural design beyond standard precast units and Council standard drawings; road works within Shaw Road (a second intersection is offered as an option in Section 10.0); traffic engineering, road safety audits and construction traffic management; Council standard or shared pump stations, trunk infrastructure and upgrades beyond the connection mains; tender documents, contract administration, inspections and certification of completed works; site visits and travel; authority fees and charges; redesign after a change to the approved layout or conditions.")

    d.h("Assumptions and information required")
    d.numbered([
        "The DA is approved generally in accordance with the Stage B footprint, with one external intersection on Dalrymple Road West and no road works in Shaw Road.",
        "Kingsun provides the approval, approved plans, referral response and approved Flood Impact Assessment, contact details for its other consultants, and written authority for JCE to lodge and liaise.",
        "Survey and geotechnical information are available within three (3) weeks of commencement, and review comments are returned within five (5) business days.",
        "Design is to the Council standards and codes current at the date of the DA approval, as recorded at the pre-design meeting.",
        "Sub-consultant provisional sums include JCE's 10% margin. PS2 covers Council, SARA or TMR and Townsville Water information requests. JCE advises Kingsun before a PS is exhausted.",
        "The lump sum is confirmed against the approved plans and conditions before commencement. Where the approval differs materially from the scope schedule, JCE provides a revised fee for approval.",
    ])

    d.h("Program")
    d.p("Twelve (12) weeks from acceptance to lodgement, then the For Construction set within two (2) weeks of OW approval. Council's assessment period is excluded.")
    d.figure(png, 17.0, "Figure 1: Stage C program. Gold: JCE. Black: survey and geotechnical. Hatched: Council.")

    d.h("Fee schedule")
    ftable(d, "PART C-A: GENERAL AND APPROVALS", PA, "Part C-A lump sum")
    ftable(d, "PART C-B: EXTERNAL WORKS", PB, "Part C-B lump sum")
    ftable(d, "PART C-C: INTERNAL WORKS", PC, "Part C-C lump sum")
    ftable(d, "PART C-D: AFTER APPROVAL", PD, "Part C-D lump sum")
    ftable(d, "RPEQ REVIEW AND CERTIFICATION (SUNNY LOTAY, LOTAY CIVIL)", RP, "RPEQ allowance [TBC]")
    d.table(["SUMMARY", "FEE (EXCL. GST)"], [
        ("Part C-A: General and approvals", money(s(PA))),
        ("Part C-B: External works", money(s(PB))),
        ("Part C-C: Internal works", money(s(PC))),
        ("Part C-D: After approval", money(s(PD))),
        ("RPEQ review and certification allowance [TBC]", money(s(RP))),
        ("Total fee (excl. GST)", money(fee)),
        ("GST (10%)", money(fee * 0.1)),
        ("Total fee (incl. GST)", money(fee * 1.1)),
    ], [14.0, 3.0], total_rows=(5, 7), align_right_cols=(1,))
    d.sub("Provisional sums (not included in the total fee)")
    rows = [(a, b, money(c)) for a, b, c in PS] + [("", "Total provisional sums (excl. GST)", money(ps)), ("", "Total fee and provisional sums (excl. GST)", money(fee + ps))]
    d.table(["ITEM", "PROVISIONAL SUM", "AMOUNT (EXCL. GST)"], rows, [1.4, 12.6, 3.0], total_rows=(-2, -1), align_right_cols=(2,))
    d.p("The lump sums include incidental expenses; no site attendance or travel is included. The RPEQ allowance is invoiced monthly at $200/hr as incurred up to the amount shown [TBC].")

    d.h("Payment terms")
    rows = [(m, t, f"{p}%", money(lump * p / 100)) for m, t, p in MIL] + [("", "Total", "100%", money(lump))]
    d.table(["MILESTONE", "TRIGGER", "%", "AMOUNT (EXCL. GST)"], rows, [2.0, 10.2, 1.6, 3.2], total_rows=(-1,), align_right_cols=(3,))
    d.p("Payment is due within fourteen (14) days of invoice. Provisional sums and the RPEQ allowance are invoiced monthly as incurred.")

    d.h("Variations and additional services")
    d.table(["ADDITIONAL SERVICE (NOT IN THE TOTAL FEE)", "FEE (EXCL. GST)"], [
        ("Second external intersection on Shaw Road (TMR), if required by the new approval, with Safety in Design", "$ 19,500.00"),
        ("Council standard sewage pump station in lieu of a private package station", "By quotation"),
        ("Tenancy works: pads, car parks, hardstands and service connections", "By quotation"),
        ("Bill of quantities and engineer's estimate", "By quotation"),
        ("Tender documentation and civil specification", "By quotation"),
        ("Site inspection by JCE, including travel to Townsville", "$ 2,000.00"),
        ("Additional coordination meeting (up to 2 hours, with file note)", "$ 400.00 each"),
        ("Construction phase services: RFIs, hold point inspections, WAE review, certification of completed works", "By separate proposal"),
    ], [12.0, 5.0])
    d.p("Other work beyond the agreed scope is carried out at the Schedule of Rates (Attachment B) with Kingsun's prior written approval.")

    d.h("Insurance, liability and validity")
    d.bullets([
        "**Insurance.** Professional indemnity $10 million any one claim and $20 million in the aggregate; public liability $10 million.",
        "**Liability cap.** Subject to Attachment A, $250,000, to the extent permitted by law.",
        "**Order of precedence.** This proposal and scope; the fee schedule; Attachment A; other attachments.",
        "**Validity.** Twelve (12) months from 12/10/2026, with the lump sum confirmed against the approved plans and conditions before commencement.",
    ])
    d.p("Yours faithfully,", keep=True, before=6)
    d.p("[Signature: Jayden to insert]", keep=True, color=GREY, italic=True)
    d.p("**Jayden Callen**", after=0, keep=True)
    d.p("Director, JCE Infrastructure Pty Ltd", after=0, keep=True)
    d.p("0477 207 027   |   jayden@jceinfrastructure.com.au")

    d.h("Acceptance and authority to proceed")
    d.p("To accept, please sign below and return a copy to JCE. Acceptance is agreement to Attachment A.", keep=True)
    d.signature_block(
        ["**OFFERED BY**", "JCE Infrastructure Pty Ltd (ABN 29 699 165 663)", "", "[Signature: Jayden to insert]", "", "Jayden Callen, BEng (Hons), MIEAust", "Director", "Date: 12/10/2026"],
        ["**ACCEPTED FOR AND ON BEHALF OF THE CLIENT**", CLIENT, "", "Signature: ____________________", "", "Name: _________________________", "Position: ______________________", "Date: ____ / ____ / ________"],
    )
    attachments(d, REF, venant=False)
    path = os.path.join(OUT, "JCE_FP-012_369_Shaw_Road_OW_RevB.docx")
    d.save(path)
    print(path, fee, ps)


if __name__ == "__main__":
    build()
