"""RFQ letters: Venant flood modelling; TIA consultant."""
import os
from jcedoc import Doc, GREY

OUT = "/home/user/JCE/FP/FP-011_Shaw_Road/RFQ"
ISSUE = "12/10/2026"
DUE = "5:00 pm AEST Monday 19/10/2026"


def sign(d):
    d.p("Yours faithfully,", keep=True, before=6)
    d.p("[Signature: Jayden to insert]", keep=True, color=GREY, italic=True)
    d.p("**Jayden Callen**", after=0, keep=True)
    d.p("Director, JCE Infrastructure Pty Ltd", after=0, keep=True)
    d.p("0477 207 027   |   jayden@jceinfrastructure.com.au")


def common_terms(d):
    d.h("Commercial basis")
    d.bullets([
        "Engagement is by JCE as a sub-consultant, subject to the client accepting JCE's proposal. JCE passes your fee through to the client as a provisional sum.",
        "Please price as a lump sum by task (excl. GST), with your hourly rates for variations and your assumptions and exclusions.",
        "Please confirm professional indemnity and public liability insurance levels, and the RPEQ who will carry out or directly supervise the work and certify it.",
        "Please tell us of any conflict of interest, including any current engagement on the adjoining land at 325 Shaw Road (Lot 19).",
        "Information in this request is confidential and supplied only for preparing your quotation.",
        f"Quotation due: {DUE}, by email to jayden@jceinfrastructure.com.au. Questions to Jayden on 0477 207 027.",
    ])


def site(d):
    d.h("Site and project")
    d.bullets([
        "369 Shaw Road, Shaw QLD 4818 (Lot 16 on SP232874), 14.62 ha on the corner of Shaw Road and Dalrymple Road, next to the Townsville Ring Road interchange. Townsville City Council; State-controlled road frontage (SARA referral expected).",
        "A tributary of the Bohle River crosses the site; Bohle River backwater affects it in major floods. Historic approval MI16/0016 (service station and warehouse, 27/11/2017) with access by an all movements intersection on Dalrymple Road West.",
        "The client intends to complete further flood studies to support a development application for an increased development footprint, then proceed to approvals and operational works.",
    ])


def venant():
    d = Doc(f"JCE RFQ-FP011-01 Rev B   |   369 Shaw Road, Shaw: flood modelling   |   {ISSUE}")
    d.letterhead("REQUEST FOR QUOTATION", "Flood modelling and Flood Impact Assessment: 369 Shaw Road, Shaw QLD",
                 "Stage A and B (development application) with an optional Stage C (operational works) verification",
                 "FP-011 Rev B (RFQ-FP011-01)", ISSUE,
                 ["Mr Richard Gale and Mr Michael South", "Venant Solutions", "richard.gale@venantsolutions.com.au; michael.south@venantsolutions.com.au"])
    d.p("Dear Richard and Michael,")
    d.p("JCE requests your quotation for the flood modelling and Flood Impact Assessment for a development application at 369 Shaw Road, Shaw. JCE leads the civil engineering and prepares the design surfaces; Venant would carry out the modelling and certify the report.")
    site(d)
    d.h("Scope requested")
    d.p("Please price each task separately:")
    d.numbered([
        "**Inception and data review.** Review of Council's Bohle River Flood Study (2023) TUFLOW model once released to JCE, and advice on the fitness of the terrain and structure data, including whether survey of culverts, inverts, road crests or channels is needed.",
        "**Model refinement and existing case.** Cut-down model where appropriate, Quadtree refinement, roughness, LiDAR and survey, Shaw Road and Dalrymple Road structures, local hydrology refinement and verification against Council's results. Runs for the 50%, 20%, 10%, 5%, 2% and 1% AEP (1% AEP for both catchment-wide and site-specific critical durations), the 0.2% AEP and the 1% AEP 2100 climate change scenario, with mapping and the 1% AEP surface to JCE.",
        "**Hold Point 1 input.** Flood constraints advice for JCE's memorandum.",
        "**Developed case options.** Up to three (3) options, each one JCE surface with crossing and access drainage, for the 1% AEP (both durations) and minor event, with impact mapping (level, velocity, hazard, depth, extent, flow paths, duration where relevant) and a floodplain storage comparison against SC6.7 and SDAP State code 1. Please also give a rate per additional option.",
        "**Final assessment.** Preferred option for the full event suite, climate change, sensitivity to roughness and blockage, and flood immunity levels.",
        "**Flood Impact Assessment report.** To SC6.7, RPEQ certified, with the Flood hazard overlay code response.",
        "**Information request allowance.** Your rates and an indicative allowance for Council or SARA requests and supplementary runs.",
        "**Optional, Stage C.** Verification of the detailed operational works earthworks, waterway works and crossing design in the approved model, where a material change or condition requires it (one round of runs, short report and model handover to Council).",
    ])
    d.h("Information available")
    d.bullets([
        "2015 UDP Flood Hazard Assessment (Lots 16 and 19), historic 50 and 100 year flood maps, 2017 decision notice MI16/0016, 2016 traffic reports and the 2017 access design report.",
        "Council model requested by JCE on engagement under Council's Flood Model Request Form and licence.",
        "Program target: Hold Point 1 at week 5 and Hold Point 2 at week 8 from engagement, final report at week 10, subject to model supply within three weeks.",
    ])
    common_terms(d)
    sign(d)
    p = os.path.join(OUT, "JCE_RFQ_Flood_Modelling_Venant_369_Shaw_Road_RevB.docx")
    d.save(p)
    return p


TIA_FIRMS = [
    ("Cambray_Consulting", "Cambray Consulting", "contact@cambray.com.au"),
    ("Amey_Townsville", "Amey (Townsville office)", "townsville@amey.com.au"),
    ("Premise_Townsville", "Mr Bradley Jones, Principal Traffic Engineer, Premise Australia (Townsville)", "[TBC: email not found]"),
]


def tia(firm=None):
    to = [firm[1], firm[2]] if firm else ["[Firm name]", "[Email]"]
    d = Doc(f"JCE RFQ-FP011-02 Rev B   |   369 Shaw Road, Shaw: traffic impact assessment   |   {ISSUE}")
    d.letterhead("REQUEST FOR QUOTATION", "Traffic impact assessment: 369 Shaw Road, Shaw QLD",
                 "Development application support for an increased development footprint",
                 "FP-011 Rev B (RFQ-FP011-02)", ISSUE, to)
    d.p("Dear Sir or Madam,")
    d.p("JCE requests your quotation for a traffic impact assessment to support a development application at 369 Shaw Road, Shaw. JCE leads the civil engineering, flood studies and access concept, and would engage you as a sub-consultant.")
    site(d)
    d.h("Scope requested")
    d.numbered([
        "Review of the 2016 combined traffic impact assessment (Lots 16 and 19), the 2015 count data and the 2017 access design report for the Dalrymple Road West intersection.",
        "Current traffic counts at the Dalrymple Road West access and the Shaw Road and Dalrymple Road intersection, and any further intersections you consider necessary (please state which and price them).",
        "Trip generation and distribution for the current use and GFA schedule (to be supplied by the client), including the adjoining 325 Shaw Road development.",
        "Intersection analysis for opening year and a ten-year horizon, with turn warrants and the treatment required at the access.",
        "Assessment against Townsville City Plan, SC6.4 and SDAP State code 1, and TMR's Guide to Traffic Impact Assessment where SARA requires it.",
        "Parking, service vehicle and refuse access review of JCE's concept layout and swept paths (19.0 m articulated vehicle and refuse vehicle).",
        "Report suitable for lodgement, RPEQ certified; one round of client comments.",
        "Rates and an indicative allowance for Council or SARA information requests. Please price a road safety audit of the access concept as a separate option.",
        "Optional, operational works stage: a traffic design report or review of JCE's intersection design.",
    ])
    d.h("Program")
    d.p("Engagement is expected after the client accepts JCE's proposal. Target: draft report by week 10 and final by week 12 from engagement, after the footprint and use schedule are confirmed at week 8.")
    common_terms(d)
    sign(d)
    suffix = f"_{firm[0]}" if firm else ""
    p = os.path.join(OUT, f"JCE_RFQ_TIA_369_Shaw_Road_RevB{suffix}.docx")
    d.save(p)
    return p


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    print(venant())
    print(tia())
    for f in TIA_FIRMS:
        print(tia(f))
