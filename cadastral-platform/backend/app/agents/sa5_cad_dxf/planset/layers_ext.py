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
)
BY_NAME: dict[str, LayerDef] = {**LAYER_BY_NAME, **{l.name: l for l in PLANSET_LAYERS}}


def layer(name: str) -> LayerDef:
    if name not in BY_NAME:
        BY_NAME[name] = _L(name, 3, "CONTINUOUS", 0.25, "Plan set layer (dynamic)", extra=True)
    return BY_NAME[name]


def all_layers() -> list[LayerDef]:
    return list(LAYERS) + list(PLANSET_LAYERS) + [l for n, l in BY_NAME.items() if n not in {x.name for x in LAYERS} | {x.name for x in PLANSET_LAYERS}]
