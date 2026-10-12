"""FP-011 Rev B: 369 Shaw Road, Stage A and Stage B."""
import os
from jcedoc import Doc, money, GOLD, GREY
from common import ISSUE, CLIENT, TO_LINES, attachments, gantt

OUT = "/home/user/JCE/FP/FP-011_Shaw_Road"
REF = "FP-011 Rev B"

# ---------------- fees ----------------
STAGE_A = [
    ("A1", "Inception and approval baseline: review of MI16/0016, endorsed plans, referral conditions and the 2021 extension correspondence; engineering input to the town planner on approval currency and the DA extension; desktop waterway, fish passage and vegetation triggers.", 2200),
    ("A2", "Council pre-lodgement meeting (flood approach, design criteria, model use) and early Townsville Water advice on receiving connections and demand basis, with file notes.", 1600),
    ("A3", "Council flood model request and licence administration; data fitness review with Venant at inception; existing surface from LiDAR and survey provided; site constraints plan.", 1400),
    ("A4", "Footprint options: JCE design surfaces for up to three (3) agreed options; management of the Venant modelling; Hold Point 1 flood constraints memorandum and Hold Point 2 options memorandum.", 5200),
    ("A5", "Servicing feasibility before Hold Point 2: demands (equivalent population), water and sewer connection options, private or shared pump station basis, land and alignment allowances, and the status of capacity confirmation.", 1800),
]
STAGE_B = [
    ("B1", "Final filling and excavation concept plan, typical sections, cut and fill volumes and developable area schedule for the preferred footprint.", 1800),
    ("B2", "Access, internal road and waterway crossing concept, car parking, service vehicle and refuse circulation, swept paths, and coordination with the traffic engineer.", 2000),
    ("B3", "Concept site based stormwater management plan: hydrology, detention assessment, lawful point of discharge assessment (tailwater and erosion), concept drainage, MUSIC modelling and erosion and sediment control strategy.", 4200),
    ("B4", "Concept water and sewerage reticulation plans for the nominated servicing option, and electricity and telecommunications supply advice.", 1400),
    ("B5", "DA civil concept drawing set and Engineering Services Report with the engineering code responses for the planning report.", 2800),
    ("B6", "Lodgement support: coordination with Kingsun's town planner (input to the need report brief and the concept layout), project management, up to ten (10) hours of online meetings, one (1) round of consolidated comments and issue of the lodgement package.", 1600),
]
RPEQ = [
    ("R1", "Stage A: direction and review of the design basis, footprint options and servicing feasibility by Sunny Lotay, RPEQ (6 hours at $200/hr) [TBC].", 1200),
    ("R2", "Stage B: review and RPEQ certification of the stormwater management plan, concept drawings and Engineering Services Report (9 hours at $200/hr) [TBC].", 1800),
]
PS = [
    ("PS1", "Stage A. Flood modelling and Flood Impact Assessment by Venant Solutions: model review and site refinement, existing case, up to three (3) developed case options, final assessment, sensitivity, and the RPEQ certified report to SC6.7. Allowance pending Venant's quotation [TBC].", 18000),
    ("PS2", "Stages A and B. Traffic impact assessment by a traffic engineer engaged by JCE: current counts, the current use schedule, design horizons, the Dalrymple Road West access and SARA requirements. Allowance pending quotations [TBC].", 10000),
    ("PS3", "Stage A, only if needed. Detail survey of the waterway, culverts, inverts and road crests where Venant advises at inception that LiDAR is not fit for the assessment [TBC].", 5000),
    ("PS4", "Stage B. Responses to information requests and review of conditions from Council and SARA, including supplementary model runs: JCE at the Schedule of Rates and Venant at cost plus 10%.", 4000),
]
sa = sum(x[2] for x in STAGE_A)
sb = sum(x[2] for x in STAGE_B)
sr = sum(x[2] for x in RPEQ)
lump = sa + sb
fee = lump + sr
ps = sum(x[2] for x in PS)
assert (sa, sb, sr, fee, ps) == (12200, 13800, 3000, 29000, 37000)

MILESTONES = [
    ("M1", "On acceptance and lodgement of the flood model request", 15),
    ("M2", "On issue of the Hold Point 1 flood constraints memorandum (end of week 5)", 20),
    ("M3", "On issue of the Hold Point 2 options memorandum and servicing advice (end of week 8)", 25),
    ("M4", "On issue of the draft reports and DA civil concept set (end of week 11)", 25),
    ("M5", "On issue of the final lodgement package (end of week 13)", 15),
]
assert sum(m[2] for m in MILESTONES) == 100


def build():
    os.makedirs(OUT, exist_ok=True)
    png = os.path.join(OUT, "_build", "fp011_program.png")
    gantt(png, "Stages A and B: program from acceptance (weeks)", [
        ("A  Inception, baseline, DA extension input", 0, 3, "jce"),
        ("A  Council model supply (by Council)", 0, 3, "other"),
        ("A  Pre-lodgement meeting, Townsville Water advice", 1, 4, "jce"),
        ("A  Model review and existing case (Venant)", 3, 2, "sub"),
        ("A  Footprint options: JCE surfaces, Venant modelling", 5, 3, "jce"),
        ("A  Traffic impact assessment (PS2)", 4, 7, "sub"),
        ("B  Final runs and Flood Impact Assessment (Venant)", 8, 2, "sub"),
        ("B  SBSMP, DA concept set, ESR, RPEQ review", 8, 3, "jce"),
        ("B  Comments, certification, lodgement package", 11, 2, "jce"),
        ("B  Council assessment and RFIs (PS4)", 13, 13, "other"),
    ], [("HP1", 5, 3), ("HP2", 8, 4), ("Lodge", 13, 8)], 26)

    d = Doc(f"{REF}   |   369 Shaw Road, Shaw: DA extension, flood studies and DA approvals   |   {ISSUE}")
    d.letterhead("FEE PROPOSAL",
                 "369 Shaw Road, Shaw QLD 4818: further flood assessment studies and DA approvals",
                 "Stage A: DA extension and further flood assessment studies. Stage B: DA lodgement support and approvals. Lot 16 on SP232874.",
                 REF, ISSUE, TO_LINES)
    d.kv_table([
        ("Proposal", REF, "Supersedes", "FP-011 Rev 0 dated 03/10/2026"),
        ("Client", CLIENT, "Attention", "Mr Maverick Parker"),
        ("Site", "369 Shaw Road, Shaw QLD 4818 (Lot 16 on SP232874, 14.62 ha)", "Authorities", "Townsville City Council; SARA; Townsville Water"),
        ("Prepared by", "Jayden Callen, Director", "RPEQ review", "Sunny Lotay, RPEQ, Lotay Civil [TBC]"),
        ("Related proposal", "FP-012 Rev B: Stage C, operational works design and approval", "Validity", "60 days from 12/10/2026"),
    ])

    d.p("Dear Maverick,", before=4)
    d.p("Thank you for sending the Langtree DA package and your note of 03/10/2026. This revision follows the sequence you set out: exercise the DA extension and complete further flood assessment studies to support an increased-coverage DA (Stage A), lodge and carry the DA through to approval (Stage B), then proceed to operational works (Stage C, offered in FP-012 Rev B). I lead every stage personally as your single point of contact, and I coordinate Venant Solutions (flood modelling), the traffic engineer and your town planner to one program with two hold points before anything goes to Council. Sunny Lotay, RPEQ, directs and certifies JCE's engineering for this job.")
    d.p("Rev B also closes the scope items from our internal review of 04/10/2026: the footprint commitment is now limited to the options tested, servicing feasibility is confirmed before the footprint is fixed, survey and lawful discharge are qualified, specialist responsibilities are assigned, and every specialist cost is shown as a provisional sum until the quotation is in hand.")

    # 1 Understanding
    d.h("Project understanding")
    d.p("Kingsun owns Lot 16 on SP232874, a vacant and vegetated 14.62 ha parcel on the corner of Shaw Road and Dalrymple Road, next to the Townsville Ring Road interchange. An ephemeral tributary of the Bohle River crosses the site from west to east, and the Bohle River backs up into the site in major floods.")
    d.bullets([
        "**Previous approval.** Development Permit MI16/0016 (service station and warehouse) was approved by Council on 27/11/2017, with access limited to a new all movements intersection on Dalrymple Road West. An application to extend its currency (MCU21/0096) was withdrawn in 2021. Its current status is to be confirmed by Kingsun's town planner [TBC: which approval the DA extension applies to, and its lapse date]. The 2017 approval and the 2015 UDP concept (about 5.8 ha over three stages) are historic baselines, not a current development entitlement.",
        "**Current flood information.** Council's Bohle River Flood Study (2023) TUFLOW model supersedes the mapping used for the 2017 approval. The flood extent on the site may differ materially from the 2015 estimate of about 5.52 ha inundated in the 1% AEP event.",
        "**Increasing the footprint.** JCE and Venant will assess and compare up to three agreed development footprint options using Council's released flood model and recommend the preferred option from those tested. The options consider flood immunity and external flood impacts together with the access, servicing and other site constraints identified through the agreed scope and specialist inputs. The engagement does not establish an absolute maximum development area or guarantee a development yield or approval outcome.",
        "**Servicing.** The site has no reticulated water or sewerage. Options are water from the Cosgrove network (Drakeford Street) or the existing water main crossing Dalrymple Road, and sewerage by a private package pump station and rising main or a Council pump station shared with Kingsun's adjoining landholdings (325 Shaw Road and others). Early Townsville Water advice is obtained in Stage A so the footprint is not fixed on an untested servicing option.",
        "**Adjoining land.** The neighbouring Lot 19 (325 Shaw Road) has its own approval and design. JCE will use its access, drainage and servicing information for interface checks only, as its catchments and approvals differ from Lot 16.",
    ])
    d.sub("Council and State requirements addressed")
    d.bullets([
        "Townsville City Plan (Version 2025/01, commenced 08/12/2025): Flood hazard overlay code, Healthy waters code and Works code.",
        "SC6.7 Flood hazard planning scheme policy: RPEQ certified flood study, pre and post development scenarios, catchment-wide and site-specific critical durations, the 0.01 m tolerance, velocity and flow path tests, climate change and parameter sensitivity.",
        "SC6.4 Development manual planning scheme policy: SC6.4.2 DA requirements (concept SBSMP, flood study, concept filling and excavation plan, concept water and sewer plans, traffic impact assessment), SC6.4.7 to SC6.4.10 and QUDM.",
        "State Development Assessment Provisions, State code 1 (development in a state-controlled road environment), as the site adjoins Shaw Road and the Ring Road.",
        "Where a service station remains in the use schedule: protection of bulk fuel storage to the 0.2% AEP event (as required in 2017). JCE supplies the flood levels; fuel system design and certification sit with Kingsun's specialists (Section 6.0).",
    ])

    # 2 staging
    d.h("Staged delivery")
    d.table(["STAGE", "WHAT IT DELIVERS", "PROPOSAL"], [
        ("A", "DA extension engineering input; Council model; existing flood constraints (Hold Point 1); up to three footprint options with servicing feasibility (Hold Point 2).", "FP-011 Rev B"),
        ("B", "Final flood assessment and report, SBSMP, DA civil concept set, ESR, TIA, lodgement package; responses to Council and SARA information requests and review of conditions to approval.", "FP-011 Rev B"),
        ("C", "Operational works design, documentation and application, through to the For Construction issue.", "FP-012 Rev B"),
    ], [1.5, 12.5, 3.0])
    d.p("Each stage can be engaged separately. Kingsun can stop after Hold Point 1 or Hold Point 2 and pay only for the milestones reached.")

    # 3 Stage A
    d.h("Scope: Stage A, DA extension and further flood studies")
    d.numbered([
        "**Inception and approval baseline.** Review of the information package, MI16/0016 conditions and endorsed plans, referral conditions, title and easements, and services records. JCE records which drawings and conditions control the new brief and lists the missing items (Section 7.0).",
        "**DA extension input.** Where the town planner seeks an extension of the existing approval to hold it current during the flood studies, JCE provides the engineering input the planner needs: a short memorandum on the engineering basis of the approval, the status of its engineering conditions and the planned studies. The extension application itself is prepared and lodged by the planner.",
        "**Council pre-lodgement meeting.** One online meeting to confirm the flood modelling approach, design events, tolerances, climate change allowance and use of Council's model, with a file note to Kingsun and the planner.",
        "**Council flood model.** Flood Model Request Form, licence administration and return of model updates to Council as the licence requires. At inception Venant reviews the fitness of the terrain and structure data and advises whether survey is required (PS3).",
        "**Existing case (Venant, PS1).** Model review and site refinement (cut-down model, Quadtree grid refinement, roughness, LiDAR and any survey, Shaw Road and Dalrymple Road structures); runs for the 50%, 20%, 10%, 5%, 2% and 1% AEP events (1% AEP for both critical durations), the 0.2% AEP event and the 1% AEP climate change scenario; mapping of levels, depths, velocities, hazard and extents; 1% AEP flood surface to JCE.",
        "**Hold Point 1.** Flood constraints plan and memorandum: existing flood free area, fringe that is a candidate for filling, conveyance corridor to be retained and a preliminary developable area estimate.",
        "**Footprint options.** One option comprises one coordinated development layout, earthworks surface and crossing or access configuration, assessed for the 1% AEP event (both critical durations) and the minor drainage event. Each option is agreed before modelling. JCE prepares the surfaces; Venant models them and maps change in level and velocity, hazard, depth, extent, flow paths and floodplain storage against SC6.7 and State code 1. Corrections needed to complete an agreed assessment are included; extra client-requested options or changed inputs are variations.",
        "**Servicing feasibility.** Demands, water and sewer connection options and the private or shared pump station basis, with initial Townsville Water advice before Hold Point 2. The concepts identify the land and alignment allowances for the nominated option and record the status of capacity confirmation. Detailed network modelling is in Stage C. If Council requires network modelling to establish DA feasibility, JCE identifies and quotes it before the footprint is treated as confirmed.",
        "**Hold Point 2.** Options memorandum (developable area, earthworks volumes, flood impacts, servicing and access implications) and a recommended footprint. Hold Point 2 confirms the footprint, uses and staging basis, access and crossing arrangement, service reserves and specialist constraints. Material changes to these after confirmation may need further assessment and an agreed fee and program adjustment.",
    ], prefix="A.")

    # 4 Stage B
    d.h("Scope: Stage B, DA lodgement support and approvals")
    d.numbered([
        "**Final flood assessment (Venant, PS1).** Full suite of events for the preferred footprint from the 50% to the 0.2% AEP and the climate change scenario, sensitivity to roughness and structure blockage, and flood immunity levels.",
        "**Flood Impact Assessment report (Venant, PS1).** Prepared to SC6.7 and certified by Venant's RPEQ, issued by JCE with the Flood hazard overlay code response.",
        "**Filling and excavation concept.** Final concept plan and sections, cut and fill volumes, import or export balance and developable area schedule.",
        "**Access and internal road concept.** Internal road and waterway crossing (culvert sized in the flood model), connection to Dalrymple Road West to the traffic engineer's recommendations, car parking, service vehicle and refuse circulation, and swept paths for the 19.0 m articulated vehicle and refuse vehicle.",
        "**Concept SBSMP.** Pre and post development hydrology, the need for and effect of detention given the timing of tributary and Bohle River flows, assessment of the tributary as the lawful point of discharge (tailwater and erosion), concept minor and major drainage, MUSIC modelling to the Healthy waters code and SC6.4.10, and the erosion and sediment control strategy.",
        "**Water, sewerage, electricity and telecommunications.** Concept reticulation plans for the nominated option, and supply advice from Dial Before You Dig and network information.",
        "**Traffic impact assessment (PS2).** Prepared by the traffic engineer engaged by JCE, coordinated with the access concept.",
        "**DA concept set and ESR.** The drawings in Section 5.0 and the Engineering Services Report covering flood, earthworks, stormwater, access, traffic and servicing, with the engineering responses to the Flood hazard overlay, Healthy waters, Works and State code 1 provisions.",
        "**Lodgement support.** Input to the planner's need report brief and concept layout, one round of consolidated comments, RPEQ certification and issue of the lodgement package to the planner.",
        "**Approvals (PS4).** Review of Council and SARA information requests, technical responses and supplementary model runs, and review of the draft and final conditions with a short conditions memorandum that carries into Stage C. JCE advises Kingsun before PS4 is exhausted and obtains approval for any further work.",
    ], prefix="B.")

    # 5 Deliverables
    d.h("Deliverables")
    d.table(["SHEET", "TITLE (ISSUED FOR DEVELOPMENT APPLICATION)"], [
        ("CV-1000", "Cover sheet, drawing index, locality plan and general notes"),
        ("CV-1001", "Existing site, flood constraints and existing services plan"),
        ("CV-1100", "Filling and excavation concept plan with depths and volumes"),
        ("CV-1101", "Typical sections through the fill platforms, batters and waterway corridor"),
        ("CV-1200", "Access, internal road and waterway crossing concept, with swept paths"),
        ("CV-1300", "Stormwater management concept: catchments, drainage, treatment and discharge"),
        ("CV-1400", "Water and sewerage reticulation concept"),
        ("CV-1500", "Erosion and sediment control concept"),
    ], [2.6, 14.4])
    d.bullets([
        "Stage A: DA extension engineering memorandum; pre-lodgement and Townsville Water file notes; Hold Point 1 and Hold Point 2 memoranda.",
        "Stage B: Flood Impact Assessment (Venant, RPEQ certified); Concept SBSMP with MUSIC (RPEQ certified); Engineering Services Report (RPEQ certified); Traffic Impact Assessment (PS2); developable area and earthworks schedule; coordinated lodgement package; information request responses and conditions memorandum (PS4).",
        "Drawing numbers are indicative. Native CAD files and Council model data are not issued (Attachment A, clause 9).",
    ])

    # 6 Team and responsibilities
    d.h("Team, supervision and responsibilities")
    d.p("The professional civil engineering services are carried out by or under the direct supervision of Sunny Lotay, RPEQ [TBC: registration number and disciplines], Lotay Civil, JCE's associate certifying engineer under a standing associate agreement. Sunny is involved in the design basis, directs and reviews the work through its delivery, and certifies it within his competence. The specialist flood services are delivered under Venant's own RPEQ arrangement. Both arrangements are confirmed in writing before commencement.")
    d.table(["ITEM", "RESPONSIBLE"], [
        ("Project lead, civil design, coordination, single point of contact", "JCE (Jayden Callen)"),
        ("Direct supervision and RPEQ certification of JCE engineering", "Sunny Lotay, RPEQ (Lotay Civil), through JCE"),
        ("Flood modelling and Flood Impact Assessment, RPEQ certified", "Venant Solutions, through JCE (PS1)"),
        ("Traffic impact assessment", "Traffic engineer, through JCE (PS2)"),
        ("Planning pathway, DA extension application, planning report, need report, lodgement and public notification", "Kingsun's town planner [TBC: name]"),
        ("Waterway barrier, riverine protection, vegetation and other environmental approvals; inputs needed before Hold Point 2", "Kingsun's planner or environmental specialist"),
        ("Fuel storage and dispensing design, flood resistance, containment, spill isolation and certification (if a service station remains)", "Kingsun's fuel system and structural specialists; JCE supplies flood and drainage inputs"),
        ("Detail survey; geotechnical investigation", "Kingsun, or JCE under PS3 (survey); geotechnical is a Stage C item"),
        ("Bushfire, ecology, landscape, acoustic, contamination and cultural heritage", "Kingsun's specialists"),
    ], [10.0, 7.0])

    # 7 Assumptions / info
    d.h("Assumptions and information required")
    d.sub("Information required from Kingsun at commencement")
    d.bullets([
        "A dated development brief: uses, GFA and tenancies, pads and parking, staging, design vehicles, any bulk fuel or hazardous storage, and the target footprint.",
        "The planner's pathway advice and approval history: current status of MI16/0016, the DA extension details, complete endorsed DA101 to DA104 drawings, the SARA referral response and the 2017 Lot 16 stormwater management plan (KINA0006-20170220) if held.",
        "Current title, easements and the authorised owner entity (the 2021 owner's consent used a different company name and street address); any survey and Dial Before You Dig records.",
        "Kingsun's written authority for JCE to request Council's flood model and to liaise with Council, SARA and Townsville Water.",
    ])
    d.sub("Assumptions")
    d.numbered([
        "Council approves the model request and supplies the Bohle River model within three (3) weeks in a condition fit for purpose. Rebuild or recalibration of a deficient model is a variation.",
        "Design criteria are confirmed at the pre-lodgement meeting. Later changes to criteria are a variation.",
        "The fee assumes the flood mitigation earthworks can be achieved within Lot 16 without off-site compensatory earthworks or flood mitigation structures. The external access and service connection concepts remain as described. Off-site flood mitigation, third-party land agreements and works beyond the stated access and service scope need a separate agreement.",
        "The tributary is the proposed receiving waterway. Its acceptance as the lawful point of discharge is assessed in item B.5. The fee assumes no off-site drainage works or extra discharge easements; if that is not supported, JCE identifies the extra scope before Hold Point 2.",
        "Venant reviews the terrain and structure data at inception. Survey needed for a reliable assessment is provided by Kingsun or commissioned under PS3. The program depends on receipt of that information.",
        "Up to three (3) footprint options are included and Kingsun confirms the preferred option at Hold Point 2.",
        "Detailed network modelling, pump station and rising main design are in Stage C (FP-012 Rev B). Shared Council pump stations, trunk infrastructure and upgrades beyond the connection mains are not in the FP-012 lump sum.",
        "Provisional sums for sub-consultants are inclusive of JCE's 10% margin. JCE provides each specialist's defined scope and quotation before engagement, and no PS is drawn without Kingsun's approval.",
        "The program starts on receipt of the commencement information and depends on model supply, survey, traffic and servicing inputs, specialist availability and Kingsun's hold point decisions within five (5) business days. Council and SARA assessment periods are excluded.",
    ])

    # 8 Exclusions
    d.h("Exclusions")
    d.p("Anything not identified as included is excluded. In particular:")
    d.bullets([
        "Town planning services, the planning report, the DA extension application, need assessment, application forms and public notification (by Kingsun's planner; JCE can engage a planner on request, see Section 12.0).",
        "Road safety audits, and traffic engineering beyond PS2.",
        "Survey beyond PS3; geotechnical investigation, fill specification and pavement design (Stage C).",
        "Ecological, vegetation, bushfire, cultural heritage, contamination, acid sulfate soils, acoustic and landscape assessments.",
        "Applications for works in a waterway (riverine protection, waterway barrier works, vegetation clearing) beyond desktop identification of triggers.",
        "The probable maximum flood, flood emergency management plans and climate change scenarios other than Council's adopted 2100 scenario; footprint options beyond three; off-site mitigation modelling; independent peer review of the flood model.",
        "Water and sewer network modelling and design, pump stations, rising mains and connection applications (Stage C); fuel system, building, structural, electrical, trade waste and hydraulic services design.",
        "Site inspections and travel to Townsville; authority fees, infrastructure charges and statutory charges.",
        "Construction phase services of any kind.",
    ])

    # 9 Program
    d.h("Program")
    d.p("JCE can start on acceptance and lodges the model request in week 1. Subject to Council supplying the model within three (3) weeks, Stage A runs to Hold Point 2 at the end of week 8 and Stage B reaches the lodgement package at the end of week 13. Council's assessment then follows; Langtree's estimate for an impact assessable application of this kind is about six months including public notification.")
    d.figure(png, 17.0, "Figure 1: Stages A and B program. Gold: JCE. Black: Venant and the traffic engineer. Hatched: Council.")

    # 10 Fees
    d.h("Fee schedule")
    d.p("JCE's own work is a fixed lump sum by stage. The RPEQ review allowance and the sub-consultant provisional sums are shown separately so Kingsun can see each cost.")
    rows = [(a, b, money(c)) for a, b, c in STAGE_A] + [("", "Stage A lump sum (excl. GST)", money(sa))]
    d.table(["ITEM", "STAGE A: DA EXTENSION AND FURTHER FLOOD STUDIES", "FEE (EXCL. GST)"], rows, [1.4, 12.6, 3.0], total_rows=(-1,), align_right_cols=(2,))
    rows = [(a, b, money(c)) for a, b, c in STAGE_B] + [("", "Stage B lump sum (excl. GST)", money(sb))]
    d.table(["ITEM", "STAGE B: DA LODGEMENT SUPPORT AND APPROVALS", "FEE (EXCL. GST)"], rows, [1.4, 12.6, 3.0], total_rows=(-1,), align_right_cols=(2,))
    rows = [(a, b, money(c)) for a, b, c in RPEQ] + [("", "RPEQ review and certification allowance (excl. GST) [TBC]", money(sr))]
    d.table(["ITEM", "RPEQ REVIEW AND CERTIFICATION (SUNNY LOTAY, LOTAY CIVIL)", "FEE (EXCL. GST)"], rows, [1.4, 12.6, 3.0], total_rows=(-1,), align_right_cols=(2,))
    d.table(["SUMMARY", "FEE (EXCL. GST)"], [
        ("Stage A lump sum", money(sa)),
        ("Stage B lump sum", money(sb)),
        ("RPEQ review and certification allowance [TBC]", money(sr)),
        ("Total fee (excl. GST)", money(fee)),
        ("GST (10%)", money(fee * 0.1)),
        ("Total fee (incl. GST)", money(fee * 1.1)),
    ], [14.0, 3.0], total_rows=(3, 5), align_right_cols=(1,))
    d.sub("Provisional sums (not included in the total fee)")
    rows = [(a, b, money(c)) for a, b, c in PS] + [("", "Total provisional sums (excl. GST)", money(ps)), ("", "Total fee and provisional sums (excl. GST)", money(fee + ps))]
    d.table(["ITEM", "PROVISIONAL SUM", "AMOUNT (EXCL. GST)"], rows, [1.4, 12.6, 3.0], total_rows=(-2, -1), align_right_cols=(2,))
    d.p("The lump sums include incidental expenses. No site attendance or travel is included. The RPEQ allowance is invoiced monthly at $200/hr as incurred, up to the amount shown, and is confirmed with Sunny Lotay before commencement [TBC].")

    # 11 Payment
    d.h("Payment terms")
    d.p("The lump sum is invoiced against the milestones below. Payment is due within fourteen (14) days of invoice. Provisional sums and the RPEQ allowance are invoiced monthly as incurred.")
    rows = [(m, t, f"{p}%", money(lump * p / 100)) for m, t, p in MILESTONES] + [("", "Total", "100%", money(lump))]
    d.table(["MILESTONE", "TRIGGER", "%", "AMOUNT (EXCL. GST)"], rows, [2.0, 10.2, 1.6, 3.2], total_rows=(-1,), align_right_cols=(3,))

    # 12 Variations
    d.h("Variations and additional services")
    d.p("Work beyond the agreed scope is carried out at the Schedule of Rates (Attachment B) with Kingsun's prior written approval. Variations may apply for a change to the development brief after Hold Point 2, extra footprint options, a deficient Council model, changed criteria, information requests beyond PS4, extra meetings, or off-site works.")
    d.table(["ADDITIONAL SERVICE (NOT IN THE TOTAL FEE)", "FEE (EXCL. GST)"], [
        ("Additional footprint option (JCE surface and Venant 1% AEP and minor event runs, with mapping)", "$ 2,800.00 each [TBC against Venant rates]"),
        ("Town planning services through a planner engaged by JCE (pathway, need report brief, planning report and MCU lodgement)", "Allowance $ 20,000.00 [TBC on planner quotation]"),
        ("Probable maximum flood assessment and flood emergency management plan (Venant)", "By quotation"),
        ("Support for waterway barrier and riverine protection approvals", "By quotation"),
        ("Site inspection by JCE, including travel to Townsville", "$ 2,000.00"),
        ("Additional coordination meeting (up to 2 hours, with file note)", "$ 400.00 each"),
        ("Stage C: operational works design and approval", "FP-012 Rev B"),
    ], [11.5, 5.5])

    # 13 Commercial
    d.h("Insurance, liability and validity")
    d.bullets([
        "**Insurance.** Professional indemnity $10 million any one claim and $20 million in the aggregate; public liability $10 million. Venant and the traffic engineer carry their own professional indemnity cover. Certificates are available on request.",
        "**Liability cap.** Subject to Attachment A, JCE's total aggregate liability for the Services is limited to $250,000, to the extent permitted by law.",
        "**Order of precedence.** This proposal and scope; the fee schedule; Attachment A; other attachments.",
        "**Validity.** Sixty (60) days from 12/10/2026. Provisional sums are confirmed against quotations before engagement.",
    ])
    d.p("I would be glad to walk you through the staging and the Langtree comparison before you decide.", before=4)
    d.p("Yours faithfully,", keep=True)
    d.p("[Signature: Jayden to insert]", keep=True, color=GREY, italic=True)
    d.p("**Jayden Callen**", after=0, keep=True)
    d.p("Director, JCE Infrastructure Pty Ltd", after=0, keep=True)
    d.p("0477 207 027   |   jayden@jceinfrastructure.com.au")

    d.h("Acceptance and authority to proceed")
    d.p("To accept, please sign below and return a copy to JCE. Acceptance is agreement to Attachment A. Kingsun may accept Stage A only, or Stages A and B, by striking out the stage not accepted.", keep=True)
    d.signature_block(
        ["**OFFERED BY**", "JCE Infrastructure Pty Ltd (ABN 29 699 165 663)", "", "[Signature: Jayden to insert]", "", "Jayden Callen, BEng (Hons), MIEAust", "Director", "Date: 12/10/2026"],
        ["**ACCEPTED FOR AND ON BEHALF OF THE CLIENT**", CLIENT, "", "Signature: ____________________", "", "Name: _________________________", "Position: ______________________", "Date: ____ / ____ / ________", "Stages accepted:   A  [  ]     B  [  ]"],
    )
    attachments(d, REF)
    path = os.path.join(OUT, "JCE_FP-011_369_Shaw_Road_RevB.docx")
    d.save(path)
    print(path, fee, ps)


if __name__ == "__main__":
    build()
