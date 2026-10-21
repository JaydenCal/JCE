"""Reader-facing explanations for the site report: how to read the results, buffers, per-layer WHAT / WHY / NEXT text and the glossary.

Rules for everything in this module:
  * generic and hedged: "may trigger", never "requires"; no requirement value is stated here (values come only from cited sources);
  * generic, widely used terms are named where a reader needs them (section 10.7 planning certificate, BAL, GDA2020, MGA, DBYD/BYDA, AHD, DEM),
    but NO clause number, Act section, standard number or requirement value is stated here; any specific reference shown in the report comes
    from a cited knowledge file at run time;
  * who publishes a dataset is NOT stated here: the report builds the source line from the layer's own service metadata
    (``endpoints_nsw.json``) and prints SOURCE NOT RECORDED where the metadata names no publisher;
  * no em or en dashes, no contractions.
"""
from __future__ import annotations

SOURCE_NOT_RECORDED = "SOURCE NOT RECORDED"
AI_STATEMENT = None          # stage 8: no AI statement in the report; the cover carries the verification block (app.common.statement)
SETTINGS_FILE = "app/agents/sa9_constraints/layers.py"          # internal reference only; never printed in the report
SETTINGS_NAME = "the platform screening settings"
LOAD_MARGIN_M = 150      # check_layer(..., margin=150.0): data is loaded this far around the lot (platform setting in intersect.py)

# ---------------------------------------------------------------------------------------------------------------- how to read
ABOUT_IS = [
    "An indicative, AI assisted draft that screens one lot against a fixed list of mapped planning and hazard layers.",
    "A written companion to the JCESITE plan set, explaining what each mapped layer is, why it may matter and what to do next.",
    "A prompt for questions to put to council, authorities and qualified people.",
]
ABOUT_IS_NOT = [
    "Not certified, not checked by a qualified person and not for approval, sale, finance or construction decisions.",
    "Not a survey. Lot boundaries come from the cadastre and are indicative.",
    "Not legal advice or planning advice, and not a section 10.7 planning certificate or council property report.",
    "Not a complete list of constraints. Only the layers listed in the constraint summary were screened.",
    "Site only. No building, footprint or floor level has been assessed in this report.",
]

# (term shown in the report, chip kind, plain words)
RESULT_TERMS = [
    ("INTERSECTS", "affected",
     "A mapped feature in the dataset overlaps the lot boundary. The overlap area and the share of the lot are shown. "
     "This is the strongest screening result. It still needs confirming with the authority."),
    ("WITHIN BUFFER (distance)", "nearby",
     "No mapped feature overlaps the lot, but one lies inside the screening distance measured out from the lot boundary. "
     "The distance shown is from the lot boundary to the nearest mapped feature. See Buffers explained."),
    ("NOT INTERSECTED BY THE DATA LOADED", "clear",
     "No mapped feature in the data loaded for this run overlaps the lot or lies inside the screening distance. "
     "This describes the data only. It does not mean the site is free of the issue, because the data may be out of date, "
     "incomplete or cover only part of the topic."),
    ("NOT CHECKED", "unchecked",
     "The layer could not be queried in this run (for example no data service is connected, or the service did not respond). "
     "NOT CHECKED IS NOT CLEAR. The site may be affected and the layer must be checked directly with the authority."),
    ("UNRESOLVED", "unresolved",
     "A requirement or value was not found in the cited sources. Nothing has been assumed in its place. It must be confirmed "
     "with the authority."),
    ("ASSUMED / PLATFORM DEFAULT", "mapped",
     "A value that the platform or the user supplied without a cited source (for example a screening distance, a placeholder "
     "accuracy or a user entered figure). It is labelled wherever it is used and is not a statutory requirement."),
]

# ---------------------------------------------------------------------------------------------------------------- buffers
BUFFER_WHAT = [
    "A buffer is a zone drawn at a set distance around something. In this report there are two kinds, and they are labelled differently.",
    "Screening buffer. The platform draws a ring at a fixed distance outward from the lot boundary and asks whether any mapped feature "
    "lies inside it. This is how a feature that does not touch the lot can still be reported.",
    "Mapped buffer. Some datasets publish their own buffer polygon (for example a vegetation buffer in bush fire prone land mapping). "
    "That polygon is part of the source data and is reported as a mapped feature like any other.",
]
BUFFER_WHY = [
    "Many hazards and protections extend beyond the edge of the mapped feature. Heat and embers travel beyond vegetation, "
    "water moves across land beside a watercourse, and noise and vibration spread from a road. Checking only for a direct overlap "
    "could miss features that sit just outside the lot.",
    "A screening distance lets the report flag nearby features for follow up. It is a prompt to ask a question, not a finding that a rule applies.",
]
BUFFER_VS = [
    ("INTERSECTS", "The mapped feature overlaps the lot. The overlap area is measured and shown."),
    ("WITHIN BUFFER (distance)", "The mapped feature does not touch the lot but lies inside the screening distance. The distance number is "
     "the shortest straight line from the lot boundary to the feature."),
    ("NOT INTERSECTED BY THE DATA LOADED", "No feature overlaps the lot or lies inside the screening distance in the data that was loaded."),
]
BUFFER_NUMBER = [
    "The distance number on a layer page is measured in metres from the lot boundary to the nearest edge of the mapped feature, "
    "in map grid coordinates.",
    f"Data is loaded for the lot plus a margin of {LOAD_MARGIN_M} m. Features beyond that margin are not seen by the check.",
]
BUFFER_STATUS = [
    ("Screening setting", "A distance set in the platform screening settings. It is not a statutory requirement. "
     "Treat it as a screening prompt only."),
    ("Cited rule", "A distance supplied by a cited requirement (document, page and quote shown). It is used in place of the screening "
     "setting only where the citation names that figure for that layer."),
    ("UNRESOLVED", "No screening setting and no cited rule is available for the distance. No figure is assumed."),
]


# ---------------------------------------------------------------------------------------------------------------- per layer
def _e(what: str, why: str, nxt: str) -> dict:
    return {"what": what, "why": why, "next": nxt}


_FLOOD = _e(
    "A map layer showing land that a planning instrument or flood mapping identifies as subject to flood related controls. "
    "The data loaded covers the flood mapping in the service named in the source line. Separate council flood studies and overland "
    "flow mapping may exist that are not in this data.",
    "Land shown as flood affected may be subject to controls on filling, drainage, access and works on the site. It may trigger a "
    "flood assessment, a referral or an approval. Whether it does depends on the authority and the proposal.",
    "Ask council for flood information for the lot, including whether a flood study applies. Obtain a section 10.7 planning "
    "certificate. A qualified flood engineer may be needed to interpret the information.")
_BUSHFIRE = _e(
    "A map layer showing land mapped as bush fire prone. It typically shows vegetation classed by hazard and may include a buffer "
    "zone around that vegetation. Who publishes the data is stated in the source line, from the layer's own metadata.",
    "Land mapped as bush fire prone may be subject to bushfire assessment and protection measures such as a Bushfire Attack Level "
    "assessment, an asset protection zone or a referral. These may apply to the site and to anything built on it.",
    "Confirm bush fire prone status on the section 10.7 planning certificate. Engage a qualified bushfire assessor if the lot is mapped "
    "or close to mapped vegetation. Ask council or the relevant fire authority what applies to the proposal.")
_HERITAGE_ITEM = _e(
    "A map layer showing places listed as heritage items in a planning instrument. The data loaded covers listed items only and does "
    "not cover unlisted or Aboriginal cultural heritage.",
    "Works on or near a heritage item may need approval and a heritage assessment. The lot may also be affected by an item on a "
    "neighbouring lot. This depends on the instrument and the proposal.",
    "Confirm with council whether any item affects the lot or its neighbours. Check the heritage schedule. Engage a qualified "
    "heritage consultant if an item is identified.")
_HERITAGE_AREA = _e(
    "A map layer showing areas identified in a planning instrument as having heritage significance as a whole.",
    "Works within a heritage conservation area may need approval and may need to respond to the character of the area. "
    "This depends on the instrument and the proposal.",
    "Confirm with council whether the lot is in a conservation area and what controls apply. Engage a qualified heritage consultant "
    "if it is.")
_ASS = _e(
    "A map layer classing land by the likelihood of acid sulfate soils being present at different depths. These soils can release "
    "acid and metals when disturbed or exposed to air.",
    "Excavation, drainage or lowering of groundwater on mapped land may trigger a management plan or an approval. The class "
    "and the depth of works usually decide this.",
    "Confirm the class and any local requirement with council. Obtain a geotechnical or soil assessment from a qualified person "
    "before excavation on mapped land.")
_BIODIV = _e(
    "A map layer showing land flagged as having biodiversity value, such as native vegetation or habitat.",
    "Clearing or works on mapped land may trigger an ecological assessment, a referral or a biodiversity offset. "
    "Clearing outside the mapped land can still need approval under other rules.",
    "Confirm with council whether the mapping applies and whether any clearing is proposed. Engage a qualified ecologist or "
    "accredited assessor if it does.")
_COASTAL = _e(
    "A map layer showing land mapped as part of the coastal zone, such as coastal wetlands or areas near them. "
    "Other coastal areas may exist that are not in the data loaded.",
    "Works on or near mapped coastal land may trigger an assessment, a referral or an approval, and may be tightly controlled.",
    "Confirm with council whether any coastal mapping applies to the lot. Obtain a section 10.7 planning certificate.")
_RIPARIAN = _e(
    "A map layer showing watercourses and the land beside them (riparian land). Unmapped creeks and drainage lines may not appear.",
    "Works on or near a watercourse may need a setback from the bank, an approval from the water regulator or an assessment of "
    "stormwater and bank stability. The screening ring helps flag watercourses close to the lot.",
    "Confirm with council and the water regulator whether a watercourse affects the lot. A qualified engineer or hydrologist may "
    "be needed to set out the bank and any setback.")
_LAND_RES = _e(
    "A map layer showing land reserved in a planning instrument for a future public purpose, such as a road or open space.",
    "Land reserved for acquisition may restrict what can be built on it. The acquiring authority may have a right to take it.",
    "Ask council which authority holds the reservation and what it means for the lot.")
_AIRPORT = _e(
    "A map layer showing land inside an airport noise forecast contour or under surfaces that limit the height of structures near an airport. "
    "Only the parts present in the data loaded are shown.",
    "Land in these areas may be subject to height limits, noise measures or a referral to the airport operator.",
    "Ask council or the airport operator what applies. Engage a qualified acoustic consultant if noise measures are raised.")
_MINE = _e(
    "A map layer showing declared districts where mining related ground movement may occur.",
    "Works in a declared district may need approval from the relevant authority as well as council.",
    "Confirm district status on the section 10.7 planning certificate and with the district authority.")
_CONTAM = _e(
    "A map layer showing land recorded as contaminated or potentially contaminated.",
    "A change of use, earthworks or excavation on affected land may trigger a site investigation and, if contamination is found, remediation.",
    "Check the records held by the environmental regulator and the section 10.7 planning certificate. Engage a qualified "
    "contaminated land consultant if needed.")
_TRANSPORT = _e(
    "A map layer showing road or rail corridors, or land next to them.",
    "Land next to a major road or railway may be subject to noise and vibration controls, access limits or a referral to the "
    "transport authority.",
    "Ask council and the transport authority what applies. Engage a qualified acoustic consultant if noise measures are raised.")
_SEPP = _e(
    "A map layer showing where a state level planning policy applies by its own land application map. Other state policies "
    "apply by their own rules and are not mapped here.",
    "A policy that applies to the lot may add assessment requirements or change which approval path is available.",
    "Confirm with council which state policies apply to the lot. Obtain a section 10.7 planning certificate.")
_URBAN = _e(
    "A map layer showing land identified for new urban development, where servicing arrangements may need to be in place first.",
    "Land in an urban release area may need arrangements for infrastructure before subdivision or development proceeds.",
    "Ask council whether arrangements apply to the lot.")
_LOTSIZE = _e(
    "A map layer showing the smallest lot size that the planning instrument allows to be created by subdivision.",
    "It guides subdivision potential. It does not by itself stop use of an existing lot. This report does not assess subdivision.",
    "Check the planning instrument and the map with council if subdivision is being considered.")
_HEIGHT = _e(
    "A map layer showing a building height control from the planning instrument. It is a building control and is shown for information only.",
    "It may limit building height. No building has been assessed in this report.",
    "Check the planning instrument with council when a building design is prepared.")
_FSR = _e(
    "A map layer showing a floor space ratio control from the planning instrument. It is a building control and is shown for information only.",
    "It may limit the floor area that can be built relative to the lot area. No building has been assessed in this report.",
    "Check the planning instrument with council when a building design is prepared.")
_LANDSLIDE = _e(
    "A map layer showing land with a mapped landslide hazard rating.",
    "Mapped landslide hazard may trigger a geotechnical assessment and limits on earthworks and construction.",
    "Ask council what applies. Obtain a geotechnical assessment from a qualified engineer.")
_COASTAL_HAZ = _e(
    "A map layer showing areas mapped as exposed to coastal hazards such as erosion.",
    "Land in a coastal hazard area may be subject to assessment, referral or limits on works.",
    "Ask council what applies and obtain the property planning report.")
_SEQ = _e(
    "A map layer showing the land use category given to the lot in a regional plan.",
    "The category may influence what uses and subdivision the planning scheme supports.",
    "Check the regional plan category with council.")
_LOCAL = _e(
    "A map layer showing overlays that a council adds to its planning scheme. The overlay names and codes are shown in the feature table.",
    "Each overlay may add its own assessment requirements. The effect depends on the overlay code and the council.",
    "Read the overlay code with council. Obtain the council property or planning report.")

LAYER_TEXT: dict[str, dict] = {
    "nsw_flood": _FLOOD, "qld_flood": _FLOOD,
    "nsw_bushfire": _BUSHFIRE, "qld_bushfire": _BUSHFIRE,
    "nsw_heritage_item": _HERITAGE_ITEM, "nsw_heritage_conservation": _HERITAGE_AREA,
    "qld_heritage": _e("A map layer showing places listed for state or local heritage significance.",
                       "Works on or near a listed place may need approval and a heritage assessment.",
                       "Confirm with council whether any place affects the lot. Engage a qualified heritage consultant if one does."),
    "nsw_acid_sulfate": _ASS, "qld_acid_sulfate": _ASS,
    "nsw_biodiversity": _BIODIV,
    "qld_biodiversity": _e("A map layer showing land flagged for state or national environmental values.",
                           "Works or clearing on mapped land may trigger an assessment, a referral or an offset.",
                           "Confirm with council whether the mapping applies. Engage a qualified ecologist if it does."),
    "nsw_coastal": _COASTAL, "qld_coastal_hazard": _COASTAL_HAZ,
    "nsw_riparian": _RIPARIAN,
    "qld_waterway_wetland": _e("A map layer showing waterways and wetlands, with the land beside them.",
                               "Works near a waterway or wetland may need a setback or an approval for barrier works. "
                               "The screening ring helps flag features close to the lot.",
                               "Confirm with council whether a waterway affects the lot. A qualified engineer may be needed to set out any setback."),
    "nsw_land_reservation": _LAND_RES,
    "nsw_airport": _AIRPORT, "qld_airport": _AIRPORT,
    "nsw_mine_subsidence": _MINE,
    "nsw_contamination": _CONTAM,
    "nsw_transport_corridor": _TRANSPORT, "qld_transport_corridor": _TRANSPORT,
    "nsw_sepp_area": _SEPP, "nsw_urban_release": _URBAN,
    "nsw_lot_size_map": _LOTSIZE, "nsw_height_map": _HEIGHT, "nsw_fsr_map": _FSR,
    "qld_landslide": _LANDSLIDE, "qld_seq_designation": _SEQ, "qld_local_overlay": _LOCAL,
}
GENERIC_LAYER = _e("A mapped layer screened by the platform. The dataset description was not recorded for this layer.",
                   "A mapped feature may trigger a referral, an assessment or an approval. What applies depends on the authority and the proposal.",
                   "Confirm with council and obtain a section 10.7 planning certificate.")


def layer_explain(key: str) -> dict:
    """WHAT / WHY / NEXT strings for a layer key (falls back to a generic hedged text, never to an empty one)."""
    return LAYER_TEXT.get(key) or GENERIC_LAYER


def source_line(meta: dict | None, host: str | None = None) -> str:
    """Source text built only from the layer's own service metadata. The publisher is named only if the metadata records one."""
    from app.report import fmt
    m = meta or {}
    if m.get("synthetic"):
        return "SYNTHETIC DEMO DATA. Not from any real service."
    bits = []
    if m.get("service") or m.get("layer_name"):
        bits.append(f"Service {m.get('service', 'not recorded')}, layer {m.get('layer_name', 'not recorded')}"
                    + (f" (layer id {m['layer_id']})" if m.get("layer_id") not in (None, "") else ""))
        if host:
            bits.append(f"host {host}")
    else:
        bits.append("No data service is recorded for this layer in the platform")
    pub = (m.get("copyright") or "").strip()
    bits.append(f"Publisher or copyright statement (shortened): {fmt.shorten_quote(pub, 170)}" if pub else f"Publisher: {SOURCE_NOT_RECORDED}")
    return ". ".join(bits) + "."


# ---------------------------------------------------------------------------------------------------------------- glossary
GLOSSARY: list[tuple[str, str]] = [
    ("AEP", "Annual exceedance probability. A 1% AEP flood has a 1 in 100 chance of being equalled or exceeded in any year."),
    ("AHD", "Australian Height Datum. The national reference surface for heights, close to mean sea level. Ground and flood levels are "
            "stated in metres AHD."),
    ("Asset protection zone", "An area around a building managed to reduce bushfire fuel. Its width, if any, is set by the relevant "
                              "authority for the site."),
    ("Assumed / platform default", "A value the platform or the user supplied without a cited source. It is labelled wherever it is used and "
                                   "is not a statutory requirement."),
    ("Batter", "The sloping face of a cut or fill embankment."),
    ("BAL (Bushfire Attack Level)", "A rating of how severely a site could be exposed to embers, radiant heat and flame contact in a bushfire. "
                                    "It is determined by a qualified assessor under the applicable standard."),
    ("Buffer", "A zone drawn at a set distance around a feature or a lot. See Buffers explained."),
    ("Bushfire prone land", "Land mapped as having bushfire hazard, usually the vegetation and a buffer zone around it. Bushfire "
                            "provisions may apply to development on or near it."),
    ("Cadastre", "The official record and map of land parcel boundaries."),
    ("Crossover", "The driveway connection across the road verge between the road pavement and the property boundary."),
    ("Cut and fill", "Excavating ground (cut) and placing material (fill) to change ground levels."),
    ("DBYD", "Before You Dig Australia (BYDA), formerly Dial Before You Dig. A referral service for finding out about underground assets before "
             "excavating. Asset owners hold the data and answer each enquiry."),
    ("DCDB", "Digital Cadastral Database. The state digital map of property boundaries. It is indicative and is not a survey."),
    ("DCP", "Development control plan. A council document setting detailed development requirements."),
    ("DEM", "Digital elevation model. A grid of ground heights. A coarse grid, such as 5 m, cannot show small level changes on a small lot."),
    ("DP", "Deposited plan. A registered plan lodged with the land registry that defines lots and easements."),
    ("Easement", "A legal right for someone to use part of a lot for a set purpose, such as drainage or services. It may limit what can be "
                 "built or planted on that part."),
    ("ESCP", "Erosion and sediment control plan. It shows how soil loss and sediment leaving the site will be limited during works."),
    ("Flood planning area", "Land that a planning instrument maps as subject to flood related development controls."),
    ("GDA2020", "Geocentric Datum of Australia 2020. The national coordinate system used for positions in this report."),
    ("Indicative", "Approximate and for guidance only. It has not been surveyed, checked or certified."),
    ("Intersects", "A mapped feature overlaps the lot boundary."),
    ("Kerb and gutter", "The raised edge of a road pavement (kerb) and the channel beside it (gutter) that carries stormwater runoff."),
    ("Layback", "The lowered section of kerb and gutter at a driveway so that a vehicle can cross it."),
    ("Layover", "The driveway slab across the road verge, between the lowered kerb (layback) and the property boundary."),
    ("LEP", "Local environmental plan. The main statutory planning instrument for a council area, with zones and maps."),
    ("LGA", "Local government area. The area of a council."),
    ("Lot", "A parcel of land created by a registered plan."),
    ("MGA zone", "Map Grid of Australia zone. Positions are in metres on a flat grid based on GDA2020, divided into zones 6 degrees of longitude "
                 "wide. The zone suits the location of the lot."),
    ("Not checked", "The layer could not be queried in this run. Not checked is not clear."),
    ("Not intersected by the data loaded", "No feature in the data loaded overlaps the lot or lies inside the screening distance. It does not "
                                           "prove the site is free of the issue."),
    ("Qualified person", "A person with the training, registration and insurance suited to the matter, such as a registered surveyor, a "
                         "chartered engineer, an accredited certifier or an accredited assessor."),
    ("RL", "Reduced level. A height above a stated datum, such as AHD."),
    ("Riparian", "Relating to land beside a river, creek or other watercourse."),
    ("Screening distance", "The distance from the lot boundary within which a mapped feature is reported as within buffer. In this report it is a "
                           "platform screening setting, not a statutory requirement."),
    ("Section 10.7 planning certificate", "A certificate issued by a NSW council listing planning controls and certain constraints that affect "
                                          "a lot. It is a primary source to confirm many of the layers in this report. It does not cover every matter "
                                          "(for example some watercourse, overland flow and transport noise issues)."),
    ("Swale", "A shallow, broad, usually grassed channel that carries and slows stormwater runoff."),
    ("UNRESOLVED", "A requirement or value was not found in the cited sources. Nothing has been assumed in its place."),
    ("Within buffer", "No mapped feature overlaps the lot, but one lies inside the screening distance from the lot boundary."),
    ("Zone", "A land use category given to land by the local environmental plan. It decides which uses are permitted and with what consent."),
]

SIGN_OFF = [
    "This report was produced by software using public map data and the inputs listed above. No person has checked or certified it.",
    "A qualified person must check and verify every result, source and figure before any use. Matters that need professional sign off "
    "include boundaries (registered surveyor), flood and drainage (qualified engineer), bushfire (qualified assessor), soils and ground "
    "(qualified geotechnical engineer) and approvals (council or an accredited certifier).",
    "Where a requirement is shown as UNRESOLVED, or a layer as NOT CHECKED, the matter remains open and must be confirmed with the authority.",
]
