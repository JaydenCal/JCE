"""Extra layers used by the plan set (merged with the SA5 registry; ESC layers from SA10 are added on demand)."""
from __future__ import annotations

from app.agents.sa5_cad_dxf.layers import LAYER_BY_NAME, LAYERS, LayerDef

_L = LayerDef
PLANSET_LAYERS: tuple[LayerDef, ...] = (
    _L("C-PROP-ADJN", 9, "CONTINUOUS", 0.13, "Adjoining lot boundaries", extra=True),
    _L("C-IMAG-AERL", 8, "CONTINUOUS", 0.13, "Aerial imagery underlay (site)", extra=True),
    _L("C-IMAG-LOCL", 8, "CONTINUOUS", 0.13, "Aerial imagery underlay (locality plan)", extra=True),
    _L("C-ANNO-LOGO", 2, "CONTINUOUS", 0.13, "Company logo (vectorised)", extra=True),
    _L("C-ANNO-NRTH", 7, "CONTINUOUS", 0.18, "North arrow, scale bars", extra=True),
    _L("C-ANNO-WNDW", 1, "CONTINUOUS", 0.35, "Site window outline on key plan", extra=True),
    _L("C-ANNO-CNTR", 8, "CONTINUOUS", 0.13, "Contour labels", extra=True),
    _L("C-ANNO-TABL", 7, "CONTINUOUS", 0.18, "Tables, revision block, drawing index", extra=True),
    _L("C-ANNO-STMP", 1, "CONTINUOUS", 0.35, "Status stamp", extra=True),
    _L("C-TOPO-SPOT", 8, "CONTINUOUS", 0.13, "DEM spot levels (indicative)", extra=True),
    _L("C-EART-BATR", 4, "DASHED2", 0.25, "Batter top / toe lines", extra=True),
    _L("C-EART-PADD", 5, "CONTINUOUS", 0.35, "Building pad", extra=True),
    _L("C-UTIL-FLOW", 4, "CONTINUOUS", 0.18, "Overland flow arrows", extra=True),
    _L("C-UTIL-PROP", 5, "DASHED", 0.25, "Proposed service connections (schematic)", extra=True),
    _L("C-DRIV-LONG", 7, "CONTINUOUS", 0.25, "Driveway long section", extra=True),
    _L("C-DRIV-EXGD", 8, "DASHED", 0.18, "Existing ground in section", extra=True),
    _L("C-DETL-LINE", 7, "CONTINUOUS", 0.25, "Typical details linework", extra=True),
    _L("C-ESCP-GENL", 3, "CONTINUOUS", 0.25, "ESC elements (SA10)", extra=True),
    _L("C-DATA-NONE", 1, "CONTINUOUS", 0.25, "DATA NOT AVAILABLE panels", extra=True),
    # ---- reference drafting style (planset.style / sheets_ref) ---------------------------------------------------------
    _L("C-PROP-BDYD", 2, "CONTINUOUS", 0.80, "Boundary yellow dash overlay", extra=True),
    _L("C-ROAD-PAVE", 9, "CONTINUOUS", 0.13, "Road pavement (fill; assumed unless surveyed)", extra=True),
    _L("C-ROAD-KERB", 7, "CONTINUOUS", 0.25, "Kerb and gutter lines (assumed unless surveyed)", extra=True),
    _L("C-ROAD-CONC", 8, "CONTINUOUS", 0.25, "Crossover and kerb and gutter concrete (stipple)", extra=True),
    _L("A-BLDG-PROP", 7, "CONTINUOUS", 0.25, "Proposed works hatch and outline", extra=True),
    _L("A-BLDG-EXST", 7, "CONTINUOUS", 0.25, "Existing building hatch and outline", extra=True),
    _L("C-LAND-LAWN", 3, "CONTINUOUS", 0.13, "Landscape area fill", extra=True),
    _L("C-SITE-SYMB", 8, "CONTINUOUS", 0.18, "Site symbols: HYD, T, WM, grate, tree canopy", extra=True),
    _L("C-ANNO-CALL", 7, "CONTINUOUS", 0.25, "Call-out boxes and leaders", extra=True),
    _L("C-ANNO-GRID", 8, "CONTINUOUS", 0.11, "Zone grid reference ticks and labels", extra=True),
)
from app.agents.sa5_cad_dxf.planset.codes import all_jcs_layers  # noqa: E402

_JCS = all_jcs_layers()                                                  # JCESITE scheme (ref style only): codes.py is the single mapping table
REF_LAYER_NAMES = frozenset(l.name for l in PLANSET_LAYERS[-10:]) | frozenset(l.name for l in _JCS)      # registered in a DXF only when used
BY_NAME: dict[str, LayerDef] = {**LAYER_BY_NAME, **{l.name: l for l in PLANSET_LAYERS}, **{l.name: l for l in _JCS}}


def layer(name: str) -> LayerDef:
    if name not in BY_NAME:
        BY_NAME[name] = _L(name, 3, "CONTINUOUS", 0.25, "Plan set layer (dynamic)", extra=True)
    return BY_NAME[name]


def all_layers() -> list[LayerDef]:
    return list(LAYERS) + list(PLANSET_LAYERS) + [l for n, l in BY_NAME.items() if n not in {x.name for x in LAYERS} | {x.name for x in PLANSET_LAYERS}]
