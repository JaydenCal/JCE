"""Plain-language descriptions of each mapped layer (platform wording, not statutory text) and consequence labels."""
from __future__ import annotations

COUNCIL = "your council (planning or building team)"

# key -> dict(short, what, caveat, nc_action, rank)
LAYERS: dict[str, dict] = {
    "nsw_flood": dict(
        short="Flood planning area", rank=1,
        what=("Land shown on the council's Local Environmental Plan (LEP) flood planning map as at or below the flood planning "
              "level, which is usually the 1% annual exceedance probability (1-in-100 year) flood plus a freeboard allowance. "
              "Development on this land normally needs a flood assessment, and floor levels, fill, materials and evacuation are controlled."),
        caveat=("This layer only covers LEP flood planning maps. Council flood studies, overland-flow mapping and local "
                "flood-prone areas are not included, so 'not mapped' does not mean flood-free."),
        clear_note=("The lot is not within the mapped flood planning area, but council may still apply flood controls from its flood "
                    "studies. Ask council for flood information (or a flood certificate) before design."),
        nc_action="Ask council for flood information for the lot (flood planning level and any flood study data)."),
    "nsw_bushfire": dict(
        short="Bush fire prone land", rank=2,
        what=("Bush fire prone land (BFPL) maps are prepared by councils and certified by the NSW Rural Fire Service. They show "
              "vegetation Category 1, 2 and 3 (higher to lower fire risk) and a buffer around that vegetation. When land is bush fire "
              "prone, new habitable buildings must be designed and built for the assessed Bushfire Attack Level (BAL) and Planning for "
              "Bush Fire Protection applies."),
        caveat=("This report screens the lot against mapped vegetation within the screening distance stated on the constraint page. Whether the land is "
                "formally designated bush fire prone is confirmed on the s10.7 planning certificate."),
        nc_action="Check the s10.7 planning certificate or the RFS Check and Plan map for bush fire prone land status."),
    "nsw_heritage_item": dict(
        short="Heritage item", rank=3,
        what=("A place listed as a local heritage item in the LEP. Works to, or near, an item usually need development consent and a "
              "heritage impact statement."),
        caveat="Only LEP heritage mapping is checked. The State Heritage Register and unlisted Aboriginal heritage are not covered.",
        nc_action="Check the LEP heritage schedule and the NSW State Heritage Inventory for the lot and its neighbours."),
    "nsw_heritage_conservation": dict(
        short="Heritage conservation area", rank=3,
        what=("An area the LEP identifies as having heritage significance as a whole. Demolition, new buildings and some external changes "
              "need consent and must respect the area's character."),
        caveat="Only LEP conservation-area mapping is checked.",
        nc_action="Check the LEP heritage conservation area map with council."),
    "nsw_acid_sulfate": dict(
        short="Acid sulfate soils", rank=4,
        what=("The LEP classes land from 1 (highest risk) to 5 by how likely acid sulfate soils are to be disturbed. Works below the "
              "natural surface (excavation, drainage, dewatering) can need consent and a management plan on mapped land."),
        caveat="Class 5 land only matters if works could lower the water table on adjacent higher-class land.",
        nc_action="Check the LEP acid sulfate soils map and any local ASS clause with council."),
    "nsw_biodiversity": dict(
        short="Biodiversity values", rank=5,
        what=("The Biodiversity Values Map (Biodiversity Conservation Act 2016) flags land with high biodiversity value. Clearing or "
              "development on mapped land can trigger the Biodiversity Offsets Scheme and a biodiversity assessment report."),
        caveat="The map is a trigger only: clearing outside mapped land can still need approval under other rules.",
        nc_action="Check the Biodiversity Values Map and whether native vegetation clearing is proposed."),
    "nsw_coastal": dict(
        short="Coastal wetlands", rank=5,
        what="Land mapped under the Resilience and Hazards SEPP as coastal wetlands or their proximity area. Development is tightly controlled.",
        caveat="Only coastal wetlands are queried. Coastal environment and coastal use areas are not checked.",
        nc_action="Check the Resilience and Hazards SEPP coastal maps with council."),
    "nsw_riparian": dict(
        short="Riparian land and watercourses", rank=5,
        what=("Land near a mapped watercourse. Works within the riparian area can need consent, a setback from the bank, or a controlled "
              "activity approval from the NSW water regulator."),
        caveat="Only LEP riparian and watercourse mapping is queried; unmapped creeks and drainage lines are not covered.",
        nc_action="Check the watercourse and any controlled-activity requirements with council."),
    "nsw_land_reservation": dict(
        short="Land reservation acquisition", rank=4,
        what="Land the LEP reserves for future public purposes (for example a road or park). The authority may acquire it, and development is restricted.",
        caveat="", nc_action="Ask council which authority holds the reservation and whether it affects the proposal."),
    "nsw_airport": dict(
        short="Airport noise and obstacles", rank=5,
        what=("Land inside an airport noise contour (ANEF) or under an obstacle limitation surface. Building height can be capped and "
              "noise attenuation may be required."),
        caveat="Only LEP airport noise mapping is queried. The obstacle limitation surface layer is not yet connected.",
        nc_action="Check height and noise controls with council or the airport operator."),
    "nsw_mine_subsidence": dict(
        short="Mine subsidence district", rank=5,
        what="A declared district where buildings need approval from Subsidence Advisory NSW as well as council.",
        caveat="", nc_action="Check the Subsidence Advisory NSW district map."),
    "nsw_contamination": dict(
        short="Contaminated land", rank=4,
        what="Land recorded as contaminated or potentially contaminated. A preliminary site investigation is usually needed before a change of use or earthworks.",
        caveat="", nc_action="Check the NSW EPA contaminated land record and the council's s10.7 certificate."),
    "nsw_transport_corridor": dict(
        short="Road and rail corridors", rank=5,
        what="Land next to a major road or railway where noise, vibration and access controls can apply and Transport for NSW may need to be consulted.",
        caveat="", nc_action="Check classified road and rail corridor controls with council and Transport for NSW."),
    "nsw_sepp_area": dict(
        short="State policy land application", rank=9,
        what=("State Environmental Planning Policies (SEPPs) apply across NSW. This layer lists the policy land-application maps that "
              "include the lot (currently the Resilience and Hazards SEPP only)."),
        caveat="Other SEPPs (for example Housing, Transport and Infrastructure) apply by their own rules and are not mapped here.",
        nc_action=""),
    "nsw_urban_release": dict(
        short="Urban release area", rank=9,
        what="Land the LEP identifies for new urban development, where infrastructure arrangements must be satisfied before subdivision or building.",
        caveat="", nc_action="Ask council whether satisfactory-arrangements provisions apply."),
    "nsw_lot_size_map": dict(short="Minimum lot size", rank=9,
                             what="The LEP lot size map sets the smallest lot that can be created by subdivision. It does not stop building on an existing smaller lot.",
                             caveat="", nc_action="Check LEP clause 4.1 and the lot size map."),
    "nsw_height_map": dict(short="Maximum building height", rank=9,
                           what="The LEP height of buildings map sets the maximum building height in metres.",
                           caveat="", nc_action="Check the LEP height clause and DCP height controls."),
    "nsw_fsr_map": dict(short="Floor space ratio", rank=9,
                        what="The LEP floor space ratio map sets the maximum gross floor area as a ratio of the site area.",
                        caveat="", nc_action="Check the LEP floor space ratio clause."),
}
CONTROL_KEYS = ("nsw_lot_size_map", "nsw_height_map", "nsw_fsr_map")
INFO_KEYS = ("nsw_sepp_area", "nsw_urban_release") + CONTROL_KEYS      # shown in tables, no full page
# requirement-key prefixes that belong to a layer page
REQ_PREFIX = {"nsw_flood": ("flood.",), "nsw_bushfire": ("bushfire.",), "qld_flood": ("flood.",), "qld_bushfire": ("bushfire.",)}

ZONES = {
    "R1": "General Residential", "R2": "Low Density Residential", "R3": "Medium Density Residential", "R4": "High Density Residential",
    "R5": "Large Lot Residential", "RU1": "Primary Production", "RU2": "Rural Landscape", "RU3": "Forestry", "RU4": "Primary Production Small Lots",
    "RU5": "Village", "RU6": "Transition", "B1": "Neighbourhood Centre", "B2": "Local Centre", "B3": "Commercial Core", "B4": "Mixed Use",
    "B5": "Business Development", "B6": "Enterprise Corridor", "B7": "Business Park", "B8": "Metropolitan Centre", "IN1": "General Industrial",
    "IN2": "Light Industrial", "IN3": "Heavy Industrial", "IN4": "Working Waterfront", "SP1": "Special Activities", "SP2": "Infrastructure",
    "SP3": "Tourist", "RE1": "Public Recreation", "RE2": "Private Recreation", "E1": "Local Centre", "E2": "Commercial Centre",
    "E3": "Productivity Support", "E4": "General Industrial", "E5": "Heavy Industrial", "MU1": "Mixed Use", "W1": "Natural Waterways",
    "W2": "Recreational Waterways", "W3": "Working Waterways", "C1": "National Parks and Nature Reserves", "C2": "Environmental Conservation",
    "C3": "Environmental Management", "C4": "Environmental Living", "SP4": "Enterprise",
}

# consequence item -> (plain label, who to ask)
ITEMS: dict[str, tuple[str, str]] = {
    "flood_planning_level": ("Flood planning level (the design flood level used by council)", "Council flood information / flood certificate"),
    "freeboard": ("Freeboard added to the flood level", "Council (DCP flood section)"),
    "floor_level": ("Minimum habitable floor level", "Council, with a flood engineer if required"),
    "fill": ("Whether filling of the land is allowed", "Council"),
    "materials": ("Flood-compatible building materials", "Council / certifier"),
    "evacuation": ("Evacuation and flood-free access requirements", "Council / SES"),
    "da_requirement": ("Whether a development application is required", "Council"),
    "bal_assessment_as3959": ("Bushfire Attack Level (BAL) assessment", "Accredited bushfire consultant"),
    "pbp_compliance": ("Compliance with state bushfire planning guidance", "Bushfire consultant / council"),
    "spp_bushfire_hazard": ("State planning policy bushfire hazard assessment", "Council"),
    "asset_protection_zone": ("Asset protection zone width (if any)", "Bushfire consultant / NSW RFS"),
    "rfs_referral": ("Referral to the state fire authority", "Council / NSW RFS"),
    "class10a_bushfire_applicability": ("Whether bushfire construction rules apply to a Class 10a shed", "Certifier / bushfire consultant"),
    "separation_from_dwelling": ("Separation distance from a dwelling or boundary", "Certifier"),
    "heritage_impact_statement": ("Heritage impact statement", "Council heritage adviser"),
    "referral": ("Referral to another authority", "Council"),
    "ass_management_plan": ("Acid sulfate soils management plan", "Council / geotechnical consultant"),
    "work_below_rl": ("Depth or level of works that triggers consent", "Council"),
    "bdar": ("Biodiversity development assessment report", "Accredited assessor"),
    "boc_threshold": ("Biodiversity offsets scheme threshold", "Accredited assessor"),
    "ecological_assessment": ("Ecological assessment", "Ecologist / council"),
    "offset": ("Biodiversity offset", "Accredited assessor"),
    "height_limit": ("Height limit under the obstacle surface", "Council / airport operator"),
    "noise_attenuation": ("Noise attenuation measures", "Acoustic consultant / council"),
    "exempt_development_eligibility": ("Whether the exempt development pathway is available", "Accredited certifier / council"),
    "complying_development_eligibility": ("Whether the complying development pathway is available", "Accredited certifier"),
    "max_floor_area": ("Maximum floor area", "Council / certifier"),
    "min_lot_size": ("Minimum lot size for this development", "Council / certifier"),
    "setbacks": ("Setbacks from boundaries", "Council DCP"),
    "private_open_space": ("Private open space", "Council DCP"),
    "parking": ("Car parking", "Council DCP"),
    "basix_certificate": ("BASIX certificate", "BASIX assessor / designer"),
    "max_height": ("Maximum height", "Council / certifier"),
    "max_site_cover": ("Maximum site cover", "Council DCP"),
    "stormwater_disposal": ("Stormwater disposal", "Council engineering"),
    "sewer_connection": ("Sewer connection and capacity", "Water authority"),
    "water_connection": ("Water connection and capacity", "Water authority"),
    "electricity_connection": ("Electricity connection", "Electricity distributor"),
    "separate_metering": ("Separate metering", "Electricity distributor"),
    "section_73_certificate": ("Section 73 certificate (water authority)", "Water authority"),
}
DEV_LABEL = {"dwelling_house": "dwelling house", "secondary_dwelling": "secondary dwelling (granny flat)", "shed": "shed (Class 10a outbuilding)"}
