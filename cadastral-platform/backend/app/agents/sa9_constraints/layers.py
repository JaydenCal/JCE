"""Constraint layer registry. Endpoints are CONFIG (env SA9_ENDPOINT_<KEY> or set_endpoints), never truth.
All shipped entries have endpoint=None and verified=False until an operator confirms a service URL."""
from __future__ import annotations

import json
import os
from pathlib import Path
from dataclasses import dataclass, field, replace


@dataclass(frozen=True)
class LayerType:
    key: str
    label: str
    jurisdiction: str                      # NSW | QLD
    category: str
    triggers_to_check: tuple[str, ...]
    attr_fields: tuple[str, ...] = ()      # attribute names to capture
    buffer_m: float = 0.0                  # >0: buffer-type constraint (distance reported)
    significant: bool = True               # gets a map page when affected
    endpoint: str | None = None            # ArcGIS REST FeatureServer/MapServer layer URL (config)
    verified: bool = False                 # False => "unverified" endpoint/config
    kind: str = "constraint"               # OverlayPolygon.kind
    where: str | None = None               # optional ArcGIS where filter (e.g. class subset of a shared layer)
    currency_fields: tuple[str, ...] = ()  # attribute names carrying the data currency date
    copyright: str | None = None


def _L(j, key, label, cat, trig, attrs=(), buf=0.0, sig=True, kind=None):
    return LayerType(f"{j.lower()}_{key}", label, j, cat, tuple(trig), tuple(attrs), buf, sig, None, False, kind or cat)


_N = [
    ("flood", "Flood planning area / flood hazard", "flood", ["flood_planning_level", "freeboard", "floor_level", "fill", "materials", "evacuation", "da_requirement"], ["FPL_M_AHD", "HAZARD", "FLOOD_CATEGORY"], 0, True),
    ("bushfire", "Bushfire prone land (vegetation category and buffer)", "bushfire", ["bal_assessment_as3959", "pbp_compliance", "asset_protection_zone", "rfs_referral"], ["VEG_CAT", "CATEGORY"], 100, True),
    ("heritage_item", "Heritage item", "heritage", ["heritage_impact_statement", "referral", "da_requirement"], ["ITEM_NAME", "SIGNIFICANCE"], 0, True),
    ("heritage_conservation", "Heritage conservation area", "heritage", ["heritage_impact_statement", "da_requirement"], ["HCA_NAME"], 0, True),
    ("acid_sulfate", "Acid sulfate soils class", "acid_sulfate", ["ass_management_plan", "work_below_rl"], ["ASS_CLASS", "CLASS"], 0, True),
    ("biodiversity", "Biodiversity values map", "biodiversity", ["bdar", "boc_threshold", "ecological_assessment"], ["BV_CATEGORY"], 0, True),
    ("coastal", "Coastal management area / coastal wetlands", "coastal", ["coastal_assessment", "referral", "da_requirement"], ["CM_AREA"], 100, True),
    ("riparian", "Riparian land / water", "water", ["controlled_activity_approval", "riparian_setback"], ["WATERCOURSE_ORDER"], 40, True),
    ("land_reservation", "Land reservation acquisition", "reservation", ["acquiring_authority", "da_requirement"], ["AUTHORITY"], 0, True),
    ("airport", "Airport noise (ANEF) / obstacle limitation", "airport", ["height_limit", "noise_attenuation", "referral"], ["ANEF", "OLS_HEIGHT_M"], 0, True),
    ("mine_subsidence", "Mine subsidence district", "mine_subsidence", ["subsidence_board_approval"], ["DISTRICT"], 0, True),
    ("contamination", "Contaminated / potentially contaminated land", "contamination", ["sepp_resilience_hazards_remediation", "preliminary_site_investigation"], ["STATUS"], 0, True),
    ("transport_corridor", "Transport corridors (road/rail)", "transport", ["referral_tfnsw", "noise_vibration_assessment"], ["CORRIDOR"], 60, True),
    ("sepp_area", "SEPP-mapped areas", "sepp", ["sepp_applicability"], ["SEPP_NAME"], 0, True),
    ("urban_release", "Urban release area", "urban_release", ["satisfactory_arrangements"], [], 0, False),
    ("lot_size_map", "Minimum lot size map", "controls_map", ["minimum_lot_size"], ["LOT_SIZE"], 0, False),
    ("height_map", "Height of buildings map", "controls_map", ["maximum_height"], ["MAX_B_H"], 0, False),
    ("fsr_map", "Floor space ratio map", "controls_map", ["maximum_fsr"], ["FSR"], 0, False),
]
_Q = [
    ("flood", "Flood hazard / flood overlay", "flood", ["flood_planning_level", "freeboard", "floor_level", "fill", "materials", "evacuation", "da_requirement"], ["FLOOD_LEVEL", "HAZARD"], 0, True),
    ("bushfire", "Bushfire hazard overlay", "bushfire", ["bal_assessment_as3959", "spp_bushfire_hazard", "asset_protection_zone"], ["HAZARD_LEVEL", "BPA"], 100, True),
    ("landslide", "Landslide hazard", "landslide", ["geotechnical_assessment", "da_requirement"], ["HAZARD"], 0, True),
    ("coastal_hazard", "Coastal hazard / erosion prone area", "coastal", ["coastal_hazard_assessment", "referral"], ["AREA"], 0, True),
    ("heritage", "Heritage (state/local)", "heritage", ["heritage_impact_statement", "referral"], ["PLACE_NAME"], 0, True),
    ("acid_sulfate", "Acid sulfate soils", "acid_sulfate", ["ass_management_plan", "work_below_rl"], ["ASS_CLASS", "LEVEL"], 0, True),
    ("biodiversity", "Biodiversity (MSES / MNES)", "biodiversity", ["ecological_assessment", "referral", "offset"], ["MSES_TYPE"], 0, True),
    ("waterway_wetland", "Waterway / wetland", "water", ["waterway_barrier_works", "setback"], ["WATERWAY_ORDER"], 40, True),
    ("airport", "Airport environs / ANEF", "airport", ["height_limit", "noise_attenuation", "referral"], ["ANEF", "OLS_HEIGHT_M"], 0, True),
    ("transport_corridor", "State transport corridors", "transport", ["referral_dtmr", "noise_assessment"], ["CORRIDOR"], 60, True),
    ("seq_designation", "SEQ Regional Plan designation", "regional_plan", ["regional_land_use_category"], ["RLRPA_CATEGORY"], 0, False),
    ("local_overlay", "Local plan overlays (by council)", "local_overlay", ["council_overlay_codes"], ["OVERLAY_NAME", "CODE"], 0, True),
]
REGISTRY: dict[str, LayerType] = {}
for j, rows in (("NSW", _N), ("QLD", _Q)):
    for key, label, cat, trig, attrs, buf, sig in rows:
        lt = _L(j, key, label, cat, trig, attrs, buf, sig)
        REGISTRY[lt.key] = lt

_CONFIG: dict[str, dict] = {}
ENDPOINTS_PATH = Path(__file__).with_name("endpoints_nsw.json")
_DEFAULTS: dict[str, dict] | None = None


def defaults() -> dict[str, dict]:
    """Committed, live-verified NSW endpoints (endpoints_nsw.json). Entries with no endpoint stay 'not checked'."""
    global _DEFAULTS
    if _DEFAULTS is None:
        _DEFAULTS = json.loads(ENDPOINTS_PATH.read_text(encoding="utf-8"))["layers"] if ENDPOINTS_PATH.exists() else {}
    return _DEFAULTS


def set_endpoints(cfg: dict[str, dict]) -> None:
    """cfg = {layer_key: {'endpoint': url, 'verified': bool}} (operator-supplied, e.g. from a JSON file)."""
    _CONFIG.update(cfg)


def get_layer(key: str) -> LayerType:
    lt = REGISTRY[key]
    c = _CONFIG.get(key) or defaults().get(key, {})
    env = os.environ.get("SA9_ENDPOINT_" + key.upper())
    ep = env or c.get("endpoint")
    if not ep:
        return lt
    use = c if not env else {}      # env override replaces the default endpoint; its verification is unknown
    return replace(lt, endpoint=ep, verified=bool(use.get("verified", False)), where=use.get("where"),
                   currency_fields=tuple(use.get("currency_fields", ())), copyright=use.get("copyright"),
                   attr_fields=tuple(use.get("key_fields", lt.attr_fields)) if use else lt.attr_fields)


def layers_for(jurisdiction: str) -> list[LayerType]:
    return [get_layer(k) for k, v in REGISTRY.items() if v.jurisdiction == jurisdiction]
