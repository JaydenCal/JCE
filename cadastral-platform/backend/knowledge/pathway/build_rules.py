"""Build knowledge/pathway/rules.json from the hand-read rule definitions below.

    python -I knowledge/pathway/build_rules.py

Every RESOLVED rule carries a citation (document, PDF page, exact quote, url, sha256).  The quote is checked against the
text of the cited page of the stored document (SA2 `norm`: case/whitespace/dash tolerant); a rule that fails the check is
NOT written as resolved: it is moved to unresolved.json with the reason.  Rules that could not be sourced are written with
status "unresolved" and a prompt.  No value here is invented: each number is read from the quoted summary table.

Currency warning: the Inland Code / Housing Code summary tables are the Department's OCTOBER 2018 / JUNE 2018 summaries.
The Codes SEPP itself (legislation.nsw.gov.au) is Cloudflare-blocked, so amendments since are NOT reflected: every standard
is flagged `verify_current: true`.
"""
from __future__ import annotations
import json, re, subprocess, sys, html
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[1]
sys.path.insert(0, str(BACKEND))
from app.agents.sa2_dcp_rag.extract import norm  # noqa: E402

RAW = HERE / "raw"
PSRC = {s["id"]: s for s in json.loads((HERE / "sources.json").read_text())["sources"]}
GMAN = {s["id"]: s for s in json.loads((BACKEND / "knowledge" / "manifest.json").read_text())["sources"]}
GRAW = BACKEND / "knowledge" / "raw"
GMAP = {  # manifest docs from the Gunnedah knowledge base, reused
    "overview": "nsw_exempt_complying_overview", "sec_dw": "nsw_page_secondary_dwellings", "inland_page": "nsw_page_inland_code",
}


def doc_meta(doc: str) -> tuple[dict, Path, str]:
    if doc in PSRC:
        s = PSRC[doc]; return s, RAW / s["file"], s["file"]
    s = GMAN[GMAP.get(doc, doc)]; return s, GRAW / s["filename"], s["filename"]


def page_text(path: Path, page: int, mode: str) -> str:
    if path.suffix == ".pdf":
        args = ["pdftotext", "-f", str(page), "-l", str(page)] + (["-layout"] if mode == "layout" else []) + [str(path), "-"]
        return subprocess.run(args, capture_output=True, text=True).stdout
    t = path.read_text(errors="ignore")
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", t, flags=re.S)
    return html.unescape(re.sub(r"<[^>]+>", "\n", t))


def cite(doc, page, quote, section_ref=None, mode="layout"):
    return dict(doc=doc, page=page, quote=quote, section_ref=section_ref, mode=mode)

RULES: list[dict] = []
UNRES: list[dict] = []
ALL_DEV = ["dwelling_house", "secondary_dwelling", "shed"]
RES = ["R1", "R2", "R3", "R4", "RU5"]
RURAL = ["RU1", "RU2", "RU3", "RU4", "RU6"]
INL_V = "Inland Code summary tables dated October 2018 (Codes SEPP not obtained; amendments since not reflected)"


def rule(id, code, pathway, label, cite_, *, dev=None, zones=None, category="standard", field=None, op=None, value=None,
         unit=None, bands=None, band_field=None, applies_if=None, assumes=None, fail_if_true=None, note=None, confidence=0.8,
         else_unresolved=False):
    RULES.append(dict(id=id, code=code, pathway=pathway, label=label, category=category, dev_types=dev or ALL_DEV, zones=zones,
                      field=field, op=op, value=value, unit=unit, bands=bands, band_field=band_field, applies_if=applies_if or [],
                      assumes=assumes or {}, note=note, confidence=confidence, verify_current=True, status="resolved",
                      else_unresolved=else_unresolved, cite=cite_))


def unresolved(id, code, pathway, label, prompt, *, dev=None, zones=None, category="standard", field=None, applies_if=None, looked=None):
    RULES.append(dict(id=id, code=code, pathway=pathway, label=label, category=category, dev_types=dev or ALL_DEV, zones=zones,
                      field=field, op=None, value=None, unit=None, bands=None, band_field=None, applies_if=applies_if or [],
                      assumes={}, note=None, confidence=0.0, verify_current=True, status="unresolved", prompt=prompt, cite=None,
                      else_unresolved=False, looked=looked or []))


def band(lo, hi, value, lo_incl=False):
    return dict(lo=lo, hi=hi, value=value, lo_incl=lo_incl)

# ----------------------------------------------------------------------------------------------------------------------
# 1. General CDC exclusions (all codes): fields are DATA to resolve; True => not complying development
# ----------------------------------------------------------------------------------------------------------------------
OV = "overview"
GENERAL = [
 ("heritage_conservation_area", "Land is not within a heritage conservation area or draft heritage conservation area", 2,
  "Land within a heritage conservation area or a draft heritage conservation area (there are some exceptions; please check the relevant development standards for more information)", "Codes SEPP cl 1.17A/1.18 (as summarised)"),
 ("land_reserved_public_purpose", "Land is not reserved for a public purpose", 2, "Land reserved for a public purpose", "Codes SEPP cl 1.19 (as summarised)"),
 ("acid_sulfate_class_1_or_2", "Land is not Class 1 or Class 2 on the council acid sulfate soils map", 2, "Class 1 or Class 2 land on council’s acid sulfate soils map", "Codes SEPP cl 1.19 (as summarised)"),
 ("buffer_area", "Land is not in a buffer area", 2, "Land in a bufer area", "Codes SEPP cl 1.19 (as summarised)"),
 ("riverfront_area", "Land is not in a riverfront area", 2, "Land in a riverfront area", "Codes SEPP cl 1.19 (as summarised)"),
 ("ecologically_sensitive_area", "Land is not in an ecologically sensitive area", 2, "Land in an ecologically sensitive area", "Codes SEPP cl 1.19 (as summarised)"),
 ("protected_area", "Land is not in a protected area", 2, "Land in a protected area", "Codes SEPP cl 1.19 (as summarised)"),
 ("coastal_hazard", "Land is not affected by a coastline hazard, coastal hazard or coastal erosion hazard", 2, "Land afected by a coastline hazard, coastal hazard or coastal erosion hazard", "Codes SEPP cl 1.19 (as summarised)"),
 ("foreshore_area", "Land is not in a foreshore area", 2, "Land in a foreshore area", "Codes SEPP cl 1.19 (as summarised)"),
 ("anef_25_or_higher", "Land is not within the 25 ANEF contour or higher (in some instances)", 2, "Land in the 25 Australian Noise Exposure Forecast (ANEF) system contour or a higher ANEF contour (in some instances)", "Codes SEPP cl 1.19 (as summarised)"),
 ("unsewered_drinking_water_catchment", "Land is not unsewered land in a drinking water catchment", 2, "Unsewered land in a drinking water catchment identifed in an environmental planning instrument", "Codes SEPP cl 1.19 (as summarised)"),
 ("special_area", "Land is not a declared special area", 2, "Land declared as a special area", "Codes SEPP cl 1.19 (as summarised)"),
 ("environmentally_sensitive_area", "Land is not in an environmentally sensitive area", 2, "Land in an environmentally sensitive area", "Codes SEPP cl 1.19 (as summarised)"),
 ("state_heritage_item", "Land does not contain an item listed on the State Heritage Register or subject to an interim heritage order", 3, "Contains an item listed in the State Heritage Register", "Codes SEPP cl 1.19 (as summarised)"),
 ("heritage_item", "Land is not, and does not contain, a heritage item in an environmental planning instrument", 3, "environmental heritage or a heritage item in an environmental planning instrument", "Codes SEPP cl 1.19 (as summarised)"),
 ("critical_habitat_or_wilderness", "Land is not critical habitat or a wilderness area", 3, "Is a wilderness area under the Wilderness Act", "Codes SEPP cl 1.19 (as summarised)"),
]
for fld, label, pg, q, sec in GENERAL:
    rule(f"cdc.general.excl.{fld}", "cdc_general", "cdc", label, cite(OV, pg, q, sec, "raw"), category="exclusion", field=fld, op="is_false",
         note="Fact-sheet summary of the general requirements for complying development; the Codes SEPP text itself was not obtained.", confidence=0.7)

# flood control lots and bushfire (general): cited as 'subject to the requirements of the code' only -> flood unresolved
unresolved("cdc.flood_control_lot", "cdc_general", "cdc", "Flood control lot requirements",
           "Confirm with the council (s10.7 planning certificate) whether the lot is a flood control lot; the definition (Codes SEPP cl 1.5) and the flood control lot standards (Housing Code cl 3.5 / Inland Code cl 3D.7) were not obtained (legislation.nsw.gov.au is Cloudflare-blocked).",
           category="exclusion", field="flood_control_lot")
unresolved("cdc.easements", "cdc_general", "cdc", "Easements / restrictions affecting the building footprint",
           "No cited complying-development exclusion for easements was obtainable. Supply the title/DP easement information and confirm with the certifier and utility owners (see also build-over-sewer requirements).",
           category="exclusion", field="easements_present")
unresolved("cdc.lep_permissibility", "cdc_general", "cdc", "Development is permissible with consent in the zone under the LEP",
           "Gunnedah LEP 2012 land use table not obtained (Cloudflare). Supply the LEP land use table result for this zone and development.",
           category="applicability", field="lep_permissibility")

# ----------------------------------------------------------------------------------------------------------------------
# 2. Inland Code (Part 3D), dwelling houses
# ----------------------------------------------------------------------------------------------------------------------
IR = "inland_std_res"
rule("inland.res.lot_area_min", "inland_code", "cdc", "Lot area at least 200 m2", cite(IR, 1, "The area of the lot must not be less than 200m2 and the width of the lot must not be less than 6m measured at the primary road building line (clause 3D.18 (1))", "cl 3D.18(1)"),
     dev=["dwelling_house"], zones=RES, field="lot_area_m2", op=">=", value=200, unit="m2", category="applicability")
rule("inland.res.lot_width_min", "inland_code", "cdc", "Lot width at least 6 m at the primary road building line", cite(IR, 1, "The area of the lot must not be less than 200m2 and the width of the lot must not be less than 6m measured at the primary road building line (clause 3D.18 (1))", "cl 3D.18(1)"),
     dev=["dwelling_house"], zones=RES, field="lot_width_m", op=">=", value=6, unit="m", category="applicability")
rule("inland.res.one_dwelling", "inland_code", "cdc", "Only one dwelling house on the lot (excluding a secondary dwelling)", cite(IR, 1, "Only 1 dwelling house is permitted on the lot (excluding a secondary dwelling) (clause 3D.18 (1)(c))", "cl 3D.18(1)(c)"),
     dev=["dwelling_house"], zones=RES, field="existing_dwelling_houses_on_lot", op="<=", value=0, unit="count", category="applicability",
     note="Compares existing dwelling houses on the lot (before the new one) with 0.")
rule("inland.res.storeys", "inland_code", "cdc", "Maximum 2 storeys", cite(IR, 2, "3D.3 (1) Maximum number of 2", "cl 3D.3(1)"),
     dev=["dwelling_house"], zones=RES, field="storeys", op="<=", value=2, unit="storeys", assumes={"lot_type": "standard"})
rule("inland.res.height", "inland_code", "cdc", "Maximum building height 8.5 m", cite(IR, 2, "3D.19 Maximum building height 8.5m", "cl 3D.19"),
     dev=["dwelling_house"], zones=RES, field="building_height_m", op="<=", value=8.5, unit="m", assumes={"lot_type": "standard"})
GFA_B = [band(200, 250, {"pct": 78}, True), band(250, 300, {"pct": 75}), band(300, 350, {"abs": 235}), band(350, 450, {"pct_plus": [25, 150]}),
         band(450, 560, {"abs": 290}), band(560, 600, {"pct_plus": [25, 150]}), band(600, 740, {"abs": 335}), band(740, 900, {"pct_plus": [25, 150]}),
         band(900, 920, {"abs": 380}), band(920, 1400, {"pct_plus": [25, 150]}), band(1400, 1500, {"abs": 500}), band(1500, None, {"abs": 500})]
rule("inland.res.gfa", "inland_code", "cdc", "Maximum gross floor area (by lot area)", cite(IR, 2, "3D.20 Maximum gross floor area 78% 75% 235m2 25% + 290m2 25% + 335m2 25% + 380m2 25% + 500m2", "cl 3D.20"),
     dev=["dwelling_house"], zones=RES, field="gfa_m2", op="<=", bands=GFA_B, band_field="lot_area_m2", unit="m2", assumes={"lot_type": "standard"},
     note="Band columns read from the rendered table: the 500 m2 cell spans the >1400-1500 and >1500 columns. One car parking space is excluded from GFA (table footnote 1).", confidence=0.75)
PRIM_B = [band(200, 300, {"num": 3}, True), band(300, 1500, {"num": 4.5}), band(1500, None, {"num": 10})]
rule("inland.res.primary_setback_avg", "inland_code", "cdc", "Primary road setback: not less than the average of the 2 nearest dwelling houses (if 2 within 40 m on the same side)", cite(IR, 2, "Setback must not be less than the average primary road setback of the 2 nearest dwelling houses on the same side of the road", "cl 3D.21(1)-(3)"),
     dev=["dwelling_house"], zones=RES, field="setback_primary_m", op=">=", value=None, unit="m", assumes={"lot_type": "standard"},
     applies_if=[dict(field="neighbour_avg_primary_setback_m", op="not_null")], note="Uses neighbour_avg_primary_setback_m.", band_field="@neighbour_avg_primary_setback_m")
rule("inland.res.primary_setback_abs", "inland_code", "cdc", "Primary road setback where there are not 2 dwelling houses within 40 m (by lot area)", cite(IR, 2, "In the 3m 4.5m 10m", "cl 3D.21(1)-(3)"),
     dev=["dwelling_house"], zones=RES, field="setback_primary_m", op=">=", bands=PRIM_B, band_field="lot_area_m2", unit="m", assumes={"lot_type": "standard"},
     applies_if=[dict(field="neighbour_avg_primary_setback_m", op="is_null")], confidence=0.7,
     note="Bands read from the rendered table (3 m for 200-300 m2, 4.5 m for >300-1500 m2, 10 m for >1500 m2). Applies only in the absence of 2 dwelling houses within 40 m on the same side.")
rule("inland.res.secondary_setback", "inland_code", "cdc", "Secondary road setback (by lot area)", cite(IR, 3, "3D.21 (4) Minimum secondary road 2m 3m 5m", "cl 3D.21(4)"),
     dev=["dwelling_house"], zones=RES, field="setback_secondary_m", op=">=", unit="m", band_field="lot_area_m2",
     bands=[band(200, 600, {"num": 2}, True), band(600, 1500, {"num": 3}), band(1500, None, {"num": 5})], applies_if=[dict(field="lot_type", op="eq", value="corner")], confidence=0.65,
     note="Band boundaries inferred from the rendered table (2 m / 3 m / 5 m columns); only relevant to corner lots.")
rule("inland.res.side_setback_low", "inland_code", "cdc", "Side setback for building up to 4.5 m high (by lot width)", cite(IR, 4, "3D.21 (7) Side setback 6m - 18m 0m – 4.5m 900mm", "cl 3D.21(7)-(8)"),
     dev=["dwelling_house"], zones=RES, field="setback_side_m", op=">=", unit="m", band_field="lot_width_m", assumes={"lot_type": "standard"},
     bands=[band(6, 18, {"num": 0.9}, True), band(18, 24, {"num": 1.5}), band(24, None, {"num": 2.5})],
     applies_if=[dict(field="wall_height_side_m", op="le", value=4.5)], note="18-24 m: 1.5 m and >24 m: 2.5 m per the same table (rows 'Lot width >18-24m 0m - 4.5m 1.5m', '>24m 0m - 4.5m 2.5m'). Built-to-boundary options (cl 3D.21(9)-(10)) are not evaluated.")
rule("inland.res.side_setback_high", "inland_code", "cdc", "Side setback for building above 4.5 m high, lot width 6-18 m: building height minus 3 m", cite(IR, 4, ">4.5m – 8.5m Building height – 3m", "cl 3D.21(7)-(8)"),
     dev=["dwelling_house"], zones=RES, field="setback_side_m", op=">=", unit="m", band_field="lot_width_m", assumes={"lot_type": "standard"},
     bands=[band(6, 18, {"formula": "wall_height_side_m - 3"}, True), band(18, 24, {"formula": "wall_height_side_m - 3"}), band(24, None, {"formula_max": ["wall_height_side_m - 3", 2.5]})],
     applies_if=[dict(field="wall_height_side_m", op="gt", value=4.5)], note="Greater of (building height - 3 m) and 2.5 m for lots wider than 24 m (quote: '(Building height – 3m) or 2.5m, whichever is greater').")
REAR_LOW = [band(200, 900, {"num": 3}, True), band(900, 1500, {"num": 5}), band(1500, None, {"num": 10})]
rule("inland.res.rear_setback_low", "inland_code", "cdc", "Rear setback for parts of building 0-4.5 m high (by lot area)", cite(IR, 3, "0 - 4.5m 3m 5m 10m", "cl 3D.21(14)"),
     dev=["dwelling_house"], zones=RES, field="setback_rear_m", op=">=", unit="m", band_field="lot_area_m2", bands=REAR_LOW, assumes={"lot_type": "standard"},
     applies_if=[dict(field="wall_height_rear_m", op="le", value=4.5)], confidence=0.7,
     note="3 m for 200-900 m2, 5 m for >900-1500 m2, 10 m for >1500 m2 (rendered table).")
REAR_HIGH = [band(200, 300, {"unresolved": "lesser of 10 m or the average of the 2 adjoining dwellings measured at 4.5 m above existing ground level"}, True),
             band(300, 900, {"num": 8}), band(900, 1500, {"num": 12}), band(1500, None, {"num": 15})]
rule("inland.res.rear_setback_high", "inland_code", "cdc", "Rear setback for parts of building above 4.5 m and up to 8.5 m high (by lot area)", cite(IR, 3, ">4.5 - Lesser of 10m or 8m 12m 15m", "cl 3D.21(14)"),
     dev=["dwelling_house"], zones=RES, field="setback_rear_m", op=">=", unit="m", band_field="lot_area_m2", bands=REAR_HIGH, assumes={"lot_type": "standard"},
     applies_if=[dict(field="wall_height_rear_m", op="gt", value=4.5)], confidence=0.65,
     note="Quote is an approximation of the layout text; validated against the normalised page text.")
rule("inland.res.parking", "inland_code", "cdc", "Car parking space on the lot (1 space where lot width is 8-10 m or more)", cite(IR, 5, "3D.27 (1) Car parking space required on the lot Not required 1 space required", "cl 3D.27(1)"),
     dev=["dwelling_house"], zones=RES, field="parking_spaces", op=">=", value=1, unit="spaces", applies_if=[dict(field="lot_width_m", op="gt", value=8)], confidence=0.65,
     note="Table: 'Not required' for lot width 6-<8 m, '1 space required' from 8 m (column boundary read from rendered table).")
for sec, fld, val, q in [("lot_type", None, None, None)]:
    pass
unresolved("inland.res.lot_type_tables", "inland_code", "cdc", "Corner, battle-axe and parallel-road lot tables",
           "The Department publishes separate Inland Code summary tables for corner, battle-axe and parallel road lots (see Inland Code page); they were not encoded. Standard-lot values are NOT valid for these lots: confirm lot type and apply the matching table.",
           dev=["dwelling_house"], zones=RES, applies_if=[dict(field="lot_type", op="ne_notnull", value="standard")])
unresolved("inland.r5.tables", "inland_code", "cdc", "Large lot residential (R5) tables", "R5 summary tables exist (Inland Code page) but were not encoded in this release.", dev=["dwelling_house"], zones=["R5"])

IRU = "inland_rural"
rule("inland.rural.lot_area_min", "inland_code", "cdc", "Lot area not less than the LEP minimum lot size (4,000 m2 if none specified)", cite(IRU, 1, "The area of the lot must not be less than that specified in an EPI, or 4,000m2 if not specified (see clause 3D.10 (1))", "cl 3D.10(1)"),
     dev=["dwelling_house"], zones=RURAL, field="lot_area_m2", op=">=", value="@lep_min_lot_size_m2|4000", unit="m2", category="applicability",
     note="Compared with lep_min_lot_size_m2 when supplied (LEP Lot Size Map), otherwise 4,000 m2 only if the LEP specifies none; if unknown, UNRESOLVED.")
rule("inland.rural.not_ru3", "inland_code", "cdc", "New dwelling houses are excluded in zone RU3", cite(IRU, 1, "the construction of a new 1 or 2 storey dwelling house (excluding new dwelling houses on zone RU3)", "Inland Code rural summary"),
     dev=["dwelling_house"], zones=["RU3"], field="zone", op="not_in", value=["RU3"], category="applicability")
rule("inland.rural.one_dwelling", "inland_code", "cdc", "Only one dwelling house on the lot (excluding secondary dwellings)", cite(IRU, 1, "Only 1 dwelling house is permitted on the lot (excluding secondary dwellings)", "Inland Code rural summary"),
     dev=["dwelling_house"], zones=RURAL, field="existing_dwelling_houses_on_lot", op="<=", value=0, unit="count", category="applicability")
rule("inland.rural.height", "inland_code", "cdc", "Maximum building height 10 m", cite(IRU, 2, "3D.11 Maximum building height 10m", "cl 3D.11"), dev=["dwelling_house"], zones=RURAL, field="building_height_m", op="<=", value=10, unit="m")
rule("inland.rural.storeys", "inland_code", "cdc", "Maximum 2 storeys", cite(IRU, 2, "3D.3 Maximum no. storeys 2", "cl 3D.3"), dev=["dwelling_house"], zones=RURAL, field="storeys", op="<=", value=2, unit="storeys")
rule("inland.rural.primary_setback", "inland_code", "cdc", "Primary road setback 50 m (RU1, RU2, RU3, RU6; sealed primary road)", cite(IRU, 2, "3D.12 (1) Minimum primary Primary road (sealed) 50m", "cl 3D.12(1)"),
     dev=["dwelling_house"], zones=["RU1", "RU2", "RU3", "RU6"], field="setback_primary_m", op=">=", value=50, unit="m", note="Unsealed primary or secondary road: 50 m also (same table).")
rule("inland.rural.primary_setback_ru4", "inland_code", "cdc", "Primary road setback 30 m (RU4, sealed road); 50 m if unsealed", cite(IRU, 2, "Primary road (sealed) 30m in zone RU4", "cl 3D.12(1)"),
     dev=["dwelling_house"], zones=["RU4"], field="setback_primary_m", op=">=", value=30, unit="m", applies_if=[dict(field="primary_road_sealed", op="eq", value=True)])
rule("inland.rural.primary_setback_unsealed", "inland_code", "cdc", "Unsealed primary or secondary road setback 50 m", cite(IRU, 2, "Unsealed primary or 50m", "cl 3D.12(1)"),
     dev=["dwelling_house"], zones=["RU4"], field="setback_primary_m", op=">=", value=50, unit="m", applies_if=[dict(field="primary_road_sealed", op="eq", value=False)])
rule("inland.rural.secondary_setback", "inland_code", "cdc", "Secondary road setback 10 m (sealed)", cite(IRU, 2, "Secondary road 10m (sealed)", "cl 3D.12(1)"),
     dev=["dwelling_house"], zones=RURAL, field="setback_secondary_m", op=">=", value=10, unit="m", applies_if=[dict(field="lot_type", op="eq", value="corner")], confidence=0.7)
rule("inland.rural.side_setback", "inland_code", "cdc", "Side setback 10 m", cite(IRU, 2, "3D.12 (4) Minimum side setbacks 2 10m", "cl 3D.12(4)"), dev=["dwelling_house"], zones=RURAL, field="setback_side_m", op=">=", value=10, unit="m")
rule("inland.rural.rear_setback", "inland_code", "cdc", "Rear setback 15 m", cite(IRU, 2, "3D.12 (5) Minimum rear setback 15m", "cl 3D.12(5)"), dev=["dwelling_house"], zones=RURAL, field="setback_rear_m", op=">=", value=15, unit="m")
rule("inland.rural.watercourse", "inland_code", "cdc", "Setback from a watercourse 40 m", cite(IRU, 3, "3D.12 (7) Minimum setback from a watercourse 3 40m", "cl 3D.12(7)"), dev=["dwelling_house"], zones=RURAL, field="watercourse_distance_m", op=">=", value=40, unit="m")
unresolved("inland.rural.adjoining_land_use", "inland_code", "cdc", "New dwelling house 250 m from adjoining forestry, intensive livestock/plant agriculture, mines, railway lines, rural industries",
           "Confirm whether any listed adjoining land use is within 250 m (Inland Code cl 3D.13: 'New dwelling house setback from the following adjoining land 250m'); no data layer.", dev=["dwelling_house"], zones=RURAL, field="near_incompatible_land_use_250m")
unresolved("inland.rural.sloping_siting", "inland_code", "cdc", "Siting controls on sloping land (lots > 4 ha)", "Inland Code cl 3D.11(2) siting controls for lots over 4 ha on sloped land: clause text not obtained; confirm with the certifier.", dev=["dwelling_house"], zones=RURAL)

# ----------------------------------------------------------------------------------------------------------------------
# 3. Housing Code (non-inland LGAs) - only the lot-size/width applicability, rest unresolved
# ----------------------------------------------------------------------------------------------------------------------
HS = "housing_std"
rule("housing.res.lot_area_min", "housing_code", "cdc", "Lot area at least 200 m2 (standard lot)", cite(HS, 1, "The area of a standard lot must not be less than 200m2 and the width of a lot must not be less than 6m measured at the primary road building line", "Housing Code cl 3.1/3.18"),
     dev=["dwelling_house"], zones=RES, field="lot_area_m2", op=">=", value=200, unit="m2", category="applicability")
rule("housing.res.lot_width_min", "housing_code", "cdc", "Lot width at least 6 m at the primary road building line", cite(HS, 1, "The area of a standard lot must not be less than 200m2 and the width of a lot must not be less than 6m measured at the primary road building line", "Housing Code"),
     dev=["dwelling_house"], zones=RES, field="lot_width_m", op=">=", value=6, unit="m", category="applicability")
unresolved("housing.other_standards", "housing_code", "cdc", "Housing Code development standards (height, GFA, setbacks, landscaping, privacy)",
           "The Housing Code summary table for the lot type was obtained (June 2018) but not encoded in this release, and the Codes SEPP text is blocked. Resolve from the Housing Code summary tables / Codes SEPP Part 3.", dev=["dwelling_house"], zones=RES)
unresolved("rural_housing.standards", "rural_housing_code", "cdc", "Rural Housing Code development standards", "Rural Housing Code summary tables could not be obtained (no URL located; Codes SEPP blocked).", dev=["dwelling_house"], zones=["R5"] + RURAL)

# ----------------------------------------------------------------------------------------------------------------------
# 4. Secondary dwelling (Housing SEPP 2021 as summarised by NSW Planning / Portal)
# ----------------------------------------------------------------------------------------------------------------------
SD = "sec_dw"
rule("sd.zone", "housing_sepp_secondary", "cdc", "Zone R1-R5 (secondary dwellings permitted); other zones only if the LEP permits", cite(SD, 1, "Secondary dwellings are permitted in residential zones (R1, R2, R3, R4, and R5). They may also be permitted in other zones under a council’s local environmental plan.", "Housing SEPP 2021 (NSW Planning summary)", "raw"),
     dev=["secondary_dwelling"], field="zone", op="in", value=["R1", "R2", "R3", "R4", "R5"], category="applicability", else_unresolved=True,
     note="Outside R1-R5 the result is UNRESOLVED (depends on the LEP), not a fail.")
rule("sd.lot_area", "housing_sepp_secondary", "cdc", "Lot area at least 450 m2 (unless the secondary dwelling is entirely within an existing dwelling)", cite(SD, 1, "One of the requirements for secondary dwelling development to be carried out as complying development is that it is on a lot that has an area of at least 450 m", "Housing SEPP Sched 1 (NSW Planning summary)", "raw"),
     dev=["secondary_dwelling"], field="lot_area_m2", op=">=", value=450, unit="m2", category="applicability", applies_if=[dict(field="within_existing_dwelling", op="ne", value=True)])
rule("sd.no_subdivision", "housing_sepp_secondary", "cdc", "The lot is not subdivided", cite(SD, 1, "A lot on which a secondary dwelling is constructed cannot be subdivided.", "Housing SEPP 2021 (NSW Planning summary)", "raw"),
     dev=["secondary_dwelling"], field="involves_subdivision", op="is_false", category="applicability")
rule("sd.principal", "housing_sepp_secondary", "cdc", "Established in conjunction with a principal dwelling on the same lot", cite("pp_granny_flats", 1, "established in conjunction with another dwelling (the principal dwelling)", "Housing SEPP (NSW Planning Portal)", "raw"),
     dev=["secondary_dwelling"], field="principal_dwelling_present", op="is_true", category="applicability")
rule("sd.not_strata", "housing_sepp_secondary", "cdc", "Not an individual lot in a strata plan or community title scheme", cite("pp_granny_flats", 1, "on the same lot of land as the principal dwelling (and not an individual lot in a strata plan or community title scheme)", "Housing SEPP (NSW Planning Portal)", "raw"),
     dev=["secondary_dwelling"], field="lot_is_strata_or_community", op="is_false", category="applicability")
rule("sd.bushfire_flame_zone", "housing_sepp_secondary", "cdc", "Not land at risk of exposure to flames (flame zone, BAL-FZ)", cite("inland_page_sd", 1, "If your land is zoned as at risk of ember attack or of exposure to flames from a fire front, you cannot do a complying development.", "Housing SEPP (NSW Planning: Secondary dwellings (granny flats))", "raw"),
     dev=["secondary_dwelling"], category="exclusion", field="bal", op="not_in", value=["BAL-FZ"], confidence=0.6,
     note="The page wording ('ember attack or ... exposure to flames') is ambiguous: only BAL-FZ is treated as a fail; other BAL ratings are UNRESOLVED pending the Housing SEPP text.")
unresolved("sd.standards", "housing_sepp_secondary", "cdc", "Housing SEPP Schedule 1 site and design standards (floor area, setbacks, height, landscaping, parking)",
           "Housing SEPP 2021 Schedule 1 not obtained (Cloudflare). The NSW page says the floor area calculation includes the principal dwelling, the secondary dwelling and attached carports/garages/decks etc., but gives no limit. Resolve from Schedule 1 before relying on CDC.", dev=["secondary_dwelling"])
unresolved("sd.rural_cl_5_5", "housing_sepp_secondary", "da", "LEP optional clause 5.5 (rural secondary dwelling floor area and distance)",
           "Whether Gunnedah LEP 2012 includes optional cl 5.5 (and its limits) is unknown: LEP not obtained.", dev=["secondary_dwelling"], zones=RURAL + ["R5"])

# ----------------------------------------------------------------------------------------------------------------------
# 5. Farm buildings / sheds
# ----------------------------------------------------------------------------------------------------------------------
EF = "exempt_farm"
rule("farm_ex.zone", "exempt_farm", "exempt", "Permitted zones RU1, RU2, RU3, RU4, RU6", cite(EF, 4, "2.31(a) Permitted zones RU1, RU2, RU3, RU4, and RU6", "cl 2.31(a)"),
     dev=["shed"], field="zone", op="in", value=RURAL, category="applicability", applies_if=[dict(field="farm_building", op="eq", value=True)])
rule("farm_ex.height_lt10", "exempt_farm", "exempt", "Farm building height 7 m (landholding under 10 ha); 10 m for 10-400 ha", cite(EF, 4, "2.32(1) (a) Maximum height 3 7m 10m", "cl 2.32(1)(a)"),
     dev=["shed"], zones=RURAL, field="building_height_m", op="<=", unit="m", band_field="landholding_area_m2",
     bands=[band(0, 100000, {"num": 7}, True), band(100000, 4000000, {"num": 10}), band(4000000, None, {"unresolved": "table column for >400 ha not separately legible"})],
     applies_if=[dict(field="farm_building", op="eq", value=True)], confidence=0.7, note="Landholding bands in m2 (10 ha = 100,000 m2; 400 ha = 4,000,000 m2). 7 m also applies on scenic land (footnote 3).")
rule("farm_ex.footprint", "exempt_farm", "exempt", "Maximum footprint 200 m2 per farm building", cite(EF, 4, "2.32(1) (d) Maximum footprint (per 200m2", "cl 2.32(1)(d)"),
     dev=["shed"], zones=RURAL, field="footprint_m2", op="<=", value=200, unit="m2", applies_if=[dict(field="farm_building", op="eq", value=True)])
rule("farm_ex.road_setback", "exempt_farm", "exempt", "Setback from any road 20 m", cite(EF, 4, "2.32(1) (f) Setback from any road 20m", "cl 2.32(1)(f)"),
     dev=["shed"], zones=RURAL, field="setback_primary_m", op=">=", value=20, unit="m", applies_if=[dict(field="farm_building", op="eq", value=True)], note="Applies to primary, secondary, parallel and classified roads.")
rule("farm_ex.side_setback_small", "exempt_farm", "exempt", "Side/rear setback 10 m for footprint up to 100 m2; 50 m for >100-200 m2", cite(EF, 4, "0 – 100m2 10m", "cl 2.32(1)(f)"),
     dev=["shed"], zones=RURAL, field="setback_side_m", op=">=", unit="m", band_field="footprint_m2", bands=[band(0, 100, {"num": 10}, True), band(100, 200, {"num": 50})],
     applies_if=[dict(field="farm_building", op="eq", value=True)])
rule("farm_ex.other_building", "exempt_farm", "exempt", "Minimum setback 6 m from any other building", cite(EF, 4, "2.32(1) (g) Minimum setback from 6m", "cl 2.32(1)(g)"),
     dev=["shed"], zones=RURAL, field="distance_to_other_building_m", op=">=", value=6, unit="m", applies_if=[dict(field="farm_building", op="eq", value=True)])
rule("farm_ex.waterbody", "exempt_farm", "exempt", "Minimum waterbody setback 50 m", cite(EF, 4, "2.32(1) (h) Minimum waterbody 50m", "cl 2.32(1)(h)"),
     dev=["shed"], zones=RURAL, field="watercourse_distance_m", op=">=", value=50, unit="m", applies_if=[dict(field="farm_building", op="eq", value=True)])
rule("farm_ex.heritage", "exempt_farm", "exempt", "Not on or in a heritage item, draft heritage item or environmentally sensitive area", cite(EF, 3, "must not be constructed or installed on or in a heritage item or draft heritage item or an environmentally sensitive area (clause 2.31(b))", "cl 2.31(b)"),
     dev=["shed"], category="exclusion", field="heritage_item", op="is_false", applies_if=[dict(field="farm_building", op="eq", value=True)])
rule("farm_ex.engineer", "exempt_farm", "exempt", "Designed to the specifications of a professional engineer", cite(EF, 3, "The development must be designed and constructed in accordance with the specifications of a professional engineer (clause 2.32 (1)(i))", "cl 2.32(1)(i)"),
     dev=["shed"], field="engineer_design_provided", op="is_true", category="applicability", applies_if=[dict(field="farm_building", op="eq", value=True)])
unresolved("farm_ex.aggregate_and_siting", "exempt_farm", "exempt", "Aggregate footprint of all farm buildings; sloping-land siting (landholding >4 ha); shipping containers",
           "Aggregate footprint limit and siting controls (cl 2.32(1)(e), (c)) are in the Farm Buildings exempt summary but the column split is not encoded; confirm against the Codes SEPP.", dev=["shed"], zones=RURAL, applies_if=[dict(field="farm_building", op="eq", value=True)])
unresolved("shed.exempt_standards", "exempt_shed", "exempt", "Exempt cabana/cubby house/garden shed/gazebo/greenhouse standards (Codes SEPP cl 2.17-2.18)",
           "Numeric exempt-development standards for garden sheds (area, height, setbacks, materials) are only in Codes SEPP Part 2 Subdivision 12: not obtained. The NSW fact sheet for sheds has no numbers. Supply them from the SEPP or confirm with the council/certifier.",
           dev=["shed"], applies_if=[dict(field="farm_building", op="ne", value=True)])
unresolved("shed.cdc_standards", "cdc_outbuilding", "cdc", "CDC standards for sheds/outbuildings (Inland Code Part 3D / Rural Housing Code / Housing Code Division 4)",
           "The Inland Code complying standards for non-farm outbuildings (e.g. detached sheds in R2) were not obtained: only the farm building summary was. Confirm with the certifier.", dev=["shed"], applies_if=[dict(field="farm_building", op="ne", value=True)])
IFC = "inland_farm_cdc"
rule("farm_cdc.landholding", "inland_farm_cdc", "cdc", "Landholding at least 4,000 m2", cite(IFC, 1, "The area of the landholding must not be less than 4,000m2", "Inland Code Division (farm buildings)"),
     dev=["shed"], zones=RURAL + ["R5"], field="landholding_area_m2", op=">=", value=4000, unit="m2", category="applicability", applies_if=[dict(field="farm_building", op="eq", value=True)])
rule("farm_cdc.height", "inland_farm_cdc", "cdc", "Farm building maximum height 7 m (landholding 0.4-10 ha) / 10 m (>10 ha)", cite(IFC, 2, "3D.56(1) Maximum height 7m 10m", "cl 3D.56(1)"),
     dev=["shed"], zones=RURAL + ["R5"], field="building_height_m", op="<=", unit="m", band_field="landholding_area_m2", bands=[band(4000, 100000, {"num": 7}, True), band(100000, None, {"num": 10})],
     applies_if=[dict(field="farm_building", op="eq", value=True)], confidence=0.7)
unresolved("farm_cdc.footprint_setbacks", "inland_farm_cdc", "cdc", "Farm building CDC footprint, aggregate footprint and road/side/rear setbacks (cl 3D.57-3D.59)",
           "The summary table was obtained but its landholding/footprint columns were not encoded; footprints of 500 m2 or more need 200 m from every boundary (table footnote 4). Resolve against the table/SEPP.", dev=["shed"], zones=RURAL + ["R5"], applies_if=[dict(field="farm_building", op="eq", value=True)])

# ----------------------------------------------------------------------------------------------------------------------
# 6. Exempt development for dwellings (inferred not applicable)
# ----------------------------------------------------------------------------------------------------------------------
rule("exempt.dwelling.na", "exempt_general", "exempt", "Exempt development covers minor, low-impact works; a new dwelling is not in the exempt development list",
     cite("pp_exempt_development", 1, "Exempt development can be done for certain residential, commercial and industrial properties including decks, gardens sheds, carports, fences, window repairs and house painting.", "Exempt development (NSW Planning Portal)", "raw"),
     dev=["dwelling_house", "secondary_dwelling"], category="applicability", field="__always_not_applicable__", op="na", confidence=0.5,
     note="INFERRED: the portal list of exempt works does not include a dwelling; the Codes SEPP Part 2 list was not obtained. Verify with the council.")
# DA
rule("da.local_dev", "da", "da", "Development needing consent is lodged as a development application with the consent authority via the NSW Planning Portal", cite("pp_local_development", 1, "If your development needs consent, a development application must be lodged with the local council.", "Local development (NSW Planning Portal)", "raw"),
     category="applicability", field="__info__", op="info")


unresolved("cdc.bushfire", "cdc_general", "cdc", "Bushfire-prone land requirements (BAL assessment, AS 3959, Planning for Bush Fire Protection)",
           "Bushfire-prone land: complying development is allowed only subject to the code's bushfire clauses (Housing Code cl 3.4 / Inland Code cl 3D.6), which were not obtained; BAL-FZ (flame zone) land is excluded for secondary dwellings (cited). Obtain a BAL assessment (AS 3959) from an accredited practitioner and the s10.7 certificate.",
           category="exclusion", field="bushfire_prone")
rule("exempt.general.state_heritage", "exempt_general", "exempt", "Land is not, and has no item that is, on the State Heritage Register or subject to an interim heritage order",
     cite("pp_exempt_development", 1, "Exempt development cannot occur on land that is, or on which there is, an item that is listed on the State Heritage Register or that is subject to an interim heritage order.", "Exempt development exclusions (NSW Planning Portal)", "raw"),
     dev=["shed"], category="exclusion", field="state_heritage_item", op="is_false")
rule("exempt.general.critical_habitat", "exempt_general", "exempt", "Land is not a wilderness area or critical habitat",
     cite("pp_exempt_development", 1, "Exempt development cannot take place within a wilderness area or critical habitat", "Exempt development exclusions (NSW Planning Portal)", "raw"),
     dev=["shed"], category="exclusion", field="critical_habitat_or_wilderness", op="is_false")


# ----------------------------------------------------------------------------------------------------------------------
# 7. Submission checklists (Gunnedah Shire Council's own checklists) and lodgement guidance
# ----------------------------------------------------------------------------------------------------------------------
CHECKS: list[dict] = []
GUIDE: list[dict] = []

def chk(id, pathway, label, evidence, requirement, c, *, dev=None, applies=None, na_if=None, note=""):
    CHECKS.append(dict(id=id, pathway=pathway, label=label, evidence=evidence, requirement=requirement, dev_types=dev or ALL_DEV,
                       applies=applies or {}, na_if=na_if or {}, note=note, cite=c))

GD, GF1, GC = "g_da_checklist", "g_fact1", "g_cdc_checklist"
chk("da.form", "da", "Development application form lodged via the NSW Planning Portal", ["portal_form"], "required", cite(GD, 1, "All applications are to be lodged via the NSW Planning Portal", "DA Lodgement Checklist"))
chk("da.owner_consent", "da", "Landowner's consent", ["owner_consent"], "required", cite(GD, 1, "Landowner’s Consent", "DA Lodgement Checklist"))
chk("da.site_plan", "da", "Site plan (scaled, distances from all boundaries, existing buildings, north arrow)", ["site_plan"], "required", cite(GD, 1, "Must include distances from lot all boundaries, location and use of existing buildings,", "DA Lodgement Checklist"))
chk("da.floor_plan", "da", "Floor plan (building dimensions)", ["floor_plan"], "required", cite(GD, 1, "Must include building dimensions", "DA Lodgement Checklist"))
chk("da.elevations", "da", "Elevations (height, external finishes, finished ground level)", ["elevations"], "required", cite(GD, 1, "Must include height of the building, all external finishes and finished ground level", "DA Lodgement Checklist"))
chk("da.sections", "da", "Section plans (footings to top of proposed works)", ["section_plans"], "required", cite(GD, 1, "Showing a through image of the development from the footings to the top of the proposed works", "DA Lodgement Checklist"))
chk("da.soee", "da", "Statement of Environmental Effects (generic residential form for single dwellings)", ["soee"], "required", cite(GD, 1, "Generic – Residential (Not including dual occupancies or multi-unit developments)", "DA Lodgement Checklist"))
chk("da.eis", "da", "Environmental Impact Statement (designated development only)", ["eis"], "not_applicable", cite(GD, 1, "Environmental Impact Statement (Designated development only)", "DA Lodgement Checklist"), na_if={"always": True}, note="Not applicable unless the development is designated development.")
chk("da.fire_cat1", "da", "Category 1 fire safety provisions (change of use only)", ["fire_cat1"], "not_applicable", cite(GD, 1, "Category 1 Fire Safety Provisions (Change of use only", "DA Lodgement Checklist"), na_if={"always": True})
chk("da.basix", "da", "BASIX certificate (dwellings/additions over $50,000, pools over 40,000 L)", ["basix"], "required", cite(GD, 1, "(For dwellings/additions over $50,000 and swimming pools over 40,000L and assessors’", "DA Lodgement Checklist"), dev=["dwelling_house", "secondary_dwelling"])
chk("da.shadow", "da", "Shadow diagram (two storey buildings: 9 am and 3 pm, 21 June)", ["shadow_diagram"], "required", cite(GF1, 2, "Required for buildings that are two storeys or greater.", "Fact Sheet 1"), applies={"storeys_ge": 2}, na_if={"storeys_lt": 2})
chk("da.notification", "da", "Notification plans (A4 site and elevation plans)", ["notification_plans"], "may_be_required", cite(GF1, 2, "A4 site and elevation plans are required to allow Council to", "Fact Sheet 1"))
chk("da.landscape", "da", "Landscaping plan", ["landscape_plan"], "may_be_required", cite(GF1, 2, "Should identify the quantities, botanical names and mature", "Fact Sheet 1"))
chk("da.escp", "da", "Erosion and sediment control plan", ["escp"], "may_be_required", cite(GF1, 2, "Required for construction works in order to minimise", "Fact Sheet 1"))
chk("da.finishes", "da", "External finishes and materials (samples of colours and materials)", ["finishes"], "may_be_required", cite(GF1, 2, "Samples of all external colours and materials are required.", "Fact Sheet 1"))
chk("da.contamination", "da", "Preliminary contamination assessment (if the site has a history of contaminating uses)", ["contamination"], "may_be_required", cite(GF1, 2, "If the site has a history of potentially contaminating land", "Fact Sheet 1"))
chk("da.servicing", "da", "Servicing strategy", ["servicing"], "may_be_required", cite(GF1, 2, "For all resident development proposals and subdivision.", "Fact Sheet 1"), dev=["dwelling_house", "secondary_dwelling"])
chk("da.donations", "da", "Political donation and gift disclosure statement (where a donation or gift has been made)", ["donation_statement"], "may_be_required", cite(GF1, 2, "To be completed for all development applications, where", "Fact Sheet 1"))
chk("da.flood", "da", "Flood information / floor level evidence (if flood affected)", ["flood_evidence"], "may_be_required", cite("g_da_checklist", 1, "All applications are to be lodged via the NSW Planning Portal", "DA Lodgement Checklist"), applies={"flood": True},
    note="Triggered by the SA9 flood layer; the council's flood requirement is in the DCP (see compliance table). Not listed on the checklist itself.")
chk("da.bushfire", "da", "Bushfire assessment (BAL) if bushfire prone land", ["bushfire_evidence"], "may_be_required", cite("g_da_checklist", 1, "All applications are to be lodged via the NSW Planning Portal", "DA Lodgement Checklist"), applies={"bushfire": True},
    note="Triggered by the SA9 bushfire layer; not listed on the council checklist itself (Council has a BAL Certificate Application form).")
chk("cdc.form", "cdc", "Complying Development Certificate application form (with landowner's declaration)", ["cdc_form", "owner_consent"], "required", cite(GC, 1, "Complying Development Certificate Application Form", "CDC Lodgement Checklist"))
chk("cdc.site_plan", "cdc", "Site plan (boundaries, distances, existing buildings and vegetation, adjoining buildings, north arrow, existing ground levels, scale)", ["site_plan"], "required", cite(GC, 1, "Must include location and measurements of the boundaries of the land", "CDC Lodgement Checklist"))
chk("cdc.floor_plan", "cdc", "Floor plan", ["floor_plan"], "required", cite(GC, 1, "Must include existing building layout and building dimensions", "CDC Lodgement Checklist"))
chk("cdc.elevations", "cdc", "Elevations", ["elevations"], "required", cite(GC, 1, "Must include height of the building, all external finishes and finished ground level and should include", "CDC Lodgement Checklist"))
chk("cdc.sections", "cdc", "Section plans (with fire safety and resistance measures)", ["section_plans"], "required", cite(GC, 1, "and details of fire safety and resistance measures for their full extent)", "CDC Lodgement Checklist"))
chk("cdc.specs", "cdc", "Specifications (materials, drainage of sewerage and water, second-hand materials)", ["specifications"], "required", cite(GC, 1, "To include construction materials and description, and their compliance with relevant standards", "CDC Lodgement Checklist"))
chk("cdc.bca", "cdc", "Documentation demonstrating compliance with the Building Code of Australia", ["bca_compliance"], "required", cite(GC, 1, "Documentation demonstrating compliance with the Building Code of Australia", "CDC Lodgement Checklist"))
chk("cdc.compliance_cert", "cdc", "A compliance certificate", ["compliance_certificate"], "required", cite(GC, 1, "A Compliance Certificate", "CDC Lodgement Checklist"))
chk("cdc.basix", "cdc", "BASIX certificate (dwellings/additions $50,000 and over)", ["basix"], "required", cite(GC, 1, "(For dwellings/additions $50,000 and over and swimming pools 40,000L and over", "CDC Lodgement Checklist"), dev=["dwelling_house", "secondary_dwelling"])
chk("cdc.fire_existing", "cdc", "List of existing fire safety measures (if existing buildings onsite)", ["fire_measures"], "may_be_required", cite(GC, 1, "List of existing fire safety measures", "CDC Lodgement Checklist"))
chk("ex.none", "exempt", "No application is lodged for exempt development (confirm the standards are met; keep records)", [], "not_applicable",
    cite("pp_exempt_development", 1, "Exempt development does not need planning or construction approval from a council or private certifier.", "Exempt development (NSW Planning Portal)", "raw"), na_if={"always": True})

def guide(text, c, note=""):
    GUIDE.append(dict(text=text, note=note, cite=c))
guide("From 1 July 2021, development applications and certificates must be lodged through the NSW Planning Portal.", cite("g_portal", 1, "From 1 July 2021, development applications and certificates must be lodged through the", "NSW Planning Portal (Gunnedah Shire Council)", "raw"))
guide("Council can no longer accept hardcopy or emailed documents and cannot place applications on the portal on behalf of applicants.", cite("g_portal", 1, "These changes mean Council can no longer accept hardcopy or emailed documents", "NSW Planning Portal (Gunnedah Shire Council)", "raw"))
guide("Before using the portal, get advice from the council's planning team; a free Duty Planner service is offered (02 6740 2100).", cite("g_portal", 1, "Council provides a free Duty Planner Service to assist with enquiries", "NSW Planning Portal (Gunnedah Shire Council)", "raw"))
guide("Log in with an existing Service NSW account or register for a NSW Planning Portal account.", cite("g_portal", 1, "Use your existing Service NSW account or register for a NSW Planning Portal account.", "NSW Planning Portal (Gunnedah Shire Council)", "raw"))
guide("Click 'New' to start the application, fill in the online form, and upload the required documents; the application can be saved and resumed.", cite("g_portal", 1, "Upload required documents to the portal. You can save your application and come back to it later.", "NSW Planning Portal (Gunnedah Shire Council)", "raw"))
guide("A council officer reviews the application in the portal for completeness and emails if more information is needed.", cite("g_portal", 1, "A Council officer will review your application in the portal to make sure all documentation is correct.", "NSW Planning Portal (Gunnedah Shire Council)", "raw"))
guide("Once accepted for lodgement an 'Additional Information Request' with the tax invoice is issued; fees must be paid and confirmed by responding in the portal before the DA is formally lodged.", cite("g_portal", 1, "Fees must be paid before your DA is formally lodged in Council’s system.", "NSW Planning Portal (Gunnedah Shire Council)", "raw"))
guide("A development consent application must include a description of the development, the estimated cost, a plan of the land, a sketch of the development and an environmental assessment (e.g. a statement of environmental effects).", cite("pp_local_development", 1, "environmental assessment, for example, environmental impact statement or statement of environment effects.", "Local development (NSW Planning Portal)", "raw"))
guide("The fee is calculated on the value of the work proposed and/or the type of development.", cite("g_lodging", 1, "The fee payable for the development application is calculated on the value of the work proposed", "Lodging an Application (Gunnedah Shire Council)", "raw"))
guide("CONFLICT TO CONFIRM WITH COUNCIL: the council's Lodging an Application page asks for a minimum of three paper copies, which conflicts with its own NSW Planning Portal page (no hardcopy accepted).", cite("g_lodging", 1, "A minimum of three (3) paper copies of all the required documentation must be prepared", "Lodging an Application (Gunnedah Shire Council)", "raw"))
guide("For complying development, the applicant provides the council with an electronic copy of all documentation and at least 1 copy of the development plans.", cite(GC, 1, "Applicant is to provide Council with an electronic copy of all documentation", "CDC Lodgement Checklist"))

def resolve_list(items):
    out, bad = [], []
    for it in items:
        c = it.pop("cite"); r, err = resolve(dict(cite=c, id=it.get("id") or it["text"][:30]))
        if err:
            bad.append(dict(id=it.get("id") or it["text"][:40], reason=err)); it["citation"] = None; it["unverified"] = True
        else:
            it["citation"] = r["citation"]
        out.append(it)
    return out, bad

UNKNOWN_DOCS = {"inland_page_sd": ("nsw_page_granny_flats_rebuild",)}

def resolve(r):
    c = r.get("cite")
    if not c: return r, None
    docid = c["doc"]
    if docid == "inland_page_sd": docid = "nsw_page_granny_flats_rebuild"
    meta, path, fname = doc_meta(docid)
    if meta.get("status") != "obtained" or not path.exists():
        return r, f"document {docid} not available"
    txt = page_text(path, c["page"] if path.suffix == ".pdf" else 1, c["mode"])
    if norm(c["quote"]) not in norm(txt):
        return r, f"quote not found on page {c['page']} of {fname}"
    eff = None
    r["citation"] = dict(document_title=meta["title"], authority=meta.get("authority", ""), version=meta.get("version"), effective_date=eff,
                         page=c["page"] if path.suffix == ".pdf" else 1, section_ref=c.get("section_ref"), quote=c["quote"],
                         source_url=meta.get("url"), retrieved_at=meta.get("retrieved_at"), sha256=meta.get("sha256", ""), chunk_id=docid)
    r.pop("cite"); return r, None


def main():
    out, bad = [], []
    for r in RULES:
        if r["status"] == "resolved":
            r2, err = resolve(dict(r))
            if err:
                bad.append(dict(id=r["id"], reason=err)); r2 = dict(r); r2.update(status="unresolved", citation=None, value=None, bands=None,
                    prompt=f"Citation could not be validated ({err}); resolve manually.")
                r2.pop("cite", None)
            out.append(r2)
        else:
            r2 = dict(r); r2.pop("cite", None); r2["citation"] = None; out.append(r2)
    # inland LGA list (read from the Inland Code LGA map image, 69 LGAs)
    lgas = ["Albury City", "Armidale Regional", "Balranald", "Bathurst Regional", "Berrigan", "Bland", "Blayney", "Bogan", "Bourke", "Brewarrina",
            "Broken Hill", "Cabonne", "Carrathool", "Central Darling", "Cobar", "Coolamon", "Coonamble", "Cootamundra-Gundagai", "Cowra", "Dubbo Regional",
            "Dungog", "Edward River", "Federation", "Forbes", "Gilgandra", "Glen Innes Severn Shire", "Goulburn Mulwaree", "Greater Hume Shire", "Griffith",
            "Gunnedah", "Gwydir", "Hay", "Hilltops", "Inverell", "Junee", "Lachlan", "Leeton", "Lithgow", "Liverpool Plains", "Lockhart", "Mid-western Regional",
            "Moree Plains", "Murray River", "Murrumbidgee", "Muswellbrook", "Narrabri", "Narrandera", "Narromine", "Oberon", "Orange", "Parkes", "Queanbeyan-Palerang Regional",
            "Singleton", "Snowy Monaro Regional", "Snowy Valleys", "Tamworth Regional", "Temora", "Tenterfield", "Upper Hunter Shire", "Upper Lachlan Shire", "Uralla",
            "Wagga Wagga", "Walcha", "Walgett", "Warren", "Warrumbungle Shire", "Weddin", "Wentworth", "Yass Valley"]
    assert len(lgas) == 69, len(lgas)
    m = PSRC["inland_lga_map"]
    inland = dict(lgas=lgas, citation=dict(document_title=m["title"], authority=m["authority"], version=m["version"], page=1, section_ref="legend: 30 Gunnedah (Inland Code applies)",
                  quote="30 Gunnedah", source_url=m["url"], retrieved_at=m["retrieved_at"], sha256=m["sha256"], chunk_id="inland_lga_map"),
                  note="Read visually from the map image (key 'Inland Code applies'): the list names the 69 LGAs shown; the map shows boundaries at 2023 date. Councils renamed/merged since are not reflected.")
    (HERE / "rules.json").write_text(json.dumps(dict(schema=1, built_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        currency_warning=INL_V, inland_code_lgas=inland, rules=out), indent=1, ensure_ascii=False))
    unres = [dict(id=r["id"], label=r["label"], prompt=r.get("prompt"), code=r["code"]) for r in out if r["status"] == "unresolved"]
    (HERE / "unresolved.json").write_text(json.dumps(dict(unresolved=unres, failed_validation=bad, blocked_documents=json.loads((HERE / "sources.json").read_text())["blocked"]), indent=1))
    ck, b1 = resolve_list(CHECKS); gd, b2 = resolve_list(GUIDE)
    (HERE / "checklists.json").write_text(json.dumps(dict(schema=1, council="Gunnedah Shire Council", checklists=ck, lodgement_guidance=gd, failed_validation=b1 + b2), indent=1, ensure_ascii=False))
    for b in b1 + b2: print("  CHECK FAIL", b)
    res = sum(r["status"] == "resolved" for r in out)
    print(f"{res} resolved, {len(unres)} unresolved, {len(bad)} failed validation")
    for b in bad: print("  FAIL", b)

if __name__ == "__main__":
    main()
