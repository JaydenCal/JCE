"""DXF layer registry for SA5.

The first 22 rows mirror ``annotations.dxf_layers`` in db/001_schema.sql exactly
(name, ACI colour, linetype, lineweight in mm).  Rows flagged ``extra=True`` are
additions needed by the drawing pipeline and should be inserted into the same
table by the next schema migration (see ``LAYER_INSERT_SQL``).
"""
from __future__ import annotations

from dataclasses import dataclass

from ezdxf import colors as _dxf_colors
from ezdxf.document import Drawing


@dataclass(frozen=True)
class LayerDef:
    name: str
    aci: int
    linetype: str
    lineweight_mm: float
    description: str
    plot: bool = True
    extra: bool = False

    @property
    def lineweight_dxf(self) -> int:
        """DXF lineweight in 1/100 mm (valid AutoCAD values only)."""
        return int(round(self.lineweight_mm * 100))


_L = LayerDef
LAYERS: tuple[LayerDef, ...] = (
    # ---- mirrors annotations.dxf_layers -------------------------------------
    _L("C-PROP-BDY", 3, "CONTINUOUS", 0.50, "Lot boundary"),
    _L("C-PROP-EASE", 6, "DASHED", 0.25, "Easements"),
    _L("C-ROAD-BDY", 2, "CONTINUOUS", 0.35, "Road reserve / kerb"),
    _L("C-ZONE-SBAK", 1, "DASHED2", 0.25, "Setback lines"),
    _L("C-ZONE-ENVL", 1, "CONTINUOUS", 0.35, "Building envelope"),
    _L("A-BLDG-SLAB", 5, "CONTINUOUS", 0.50, "Proposed slab / footprint (from architect PDF)"),
    _L("C-TOPO-MAJR", 8, "CONTINUOUS", 0.35, "Major contours"),
    _L("C-TOPO-MINR", 9, "CONTINUOUS", 0.13, "Minor contours"),
    _L("C-EART-CUTT", 1, "CONTINUOUS", 0.25, "Cut zones"),
    _L("C-EART-FILL", 3, "CONTINUOUS", 0.25, "Fill zones"),
    _L("C-WALL-RETN", 4, "CONTINUOUS", 0.50, "Retaining walls"),
    _L("C-DRIV-XOVR", 7, "CONTINUOUS", 0.35, "Driveway crossover"),
    _L("C-UTIL-WATR", 5, "CONTINUOUS", 0.25, "Water mains/services"),
    _L("C-UTIL-SEWR", 3, "CONTINUOUS", 0.25, "Sewer"),
    _L("C-UTIL-STRM", 4, "CONTINUOUS", 0.25, "Stormwater"),
    _L("C-UTIL-ELEC", 1, "CONTINUOUS", 0.25, "Electricity"),
    _L("C-UTIL-EXCL", 1, "DASHED", 0.18, "DBYD exclusion buffers"),
    _L("C-ANNO-BRNG", 7, "CONTINUOUS", 0.18, "Bearing and distance text"),
    _L("C-ANNO-LOTN", 7, "CONTINUOUS", 0.25, "Lot / plan labels"),
    _L("C-ANNO-ROAD", 7, "CONTINUOUS", 0.25, "Road names"),
    _L("C-ANNO-NOTE", 7, "CONTINUOUS", 0.18, "General notes and disclaimers"),
    _L("C-ANNO-TTLB", 7, "CONTINUOUS", 0.25, "Title block"),
    # ---- additions ----------------------------------------------------------
    _L("C-DRIV-TURN", 30, "DASHDOT", 0.25, "Turning path / swept path and turning circle", extra=True),
    _L("C-DRIV-CNTR", 6, "CENTER", 0.18, "Driveway centreline", extra=True),
    _L("C-ANNO-DIMS", 4, "CONTINUOUS", 0.18, "Dimensions", extra=True),
    _L("C-UTIL-RWTK", 140, "CONTINUOUS", 0.35, "Rainwater tank", extra=True),
    _L("C-UTIL-GASS", 11, "CONTINUOUS", 0.25, "Gas", extra=True),
    _L("C-UTIL-TELC", 130, "CONTINUOUS", 0.25, "Telecommunications", extra=True),
    _L("C-UTIL-OTHR", 8, "CONTINUOUS", 0.25, "Other services", extra=True),
    _L("C-ZONE-OVLY", 40, "CONTINUOUS", 0.25, "Council overlays and controls", extra=True),
    _L("C-ANNO-LEVL", 7, "CONTINUOUS", 0.18, "Level spots", extra=True),
    _L("C-ANNO-SERV", 7, "CONTINUOUS", 0.18, "Service labels", extra=True),
    _L("C-ANNO-VPRT", 7, "CONTINUOUS", 0.13, "Paper-space viewport frames (not plotted)", plot=False, extra=True),
)

LAYER_BY_NAME: dict[str, LayerDef] = {l.name: l for l in LAYERS}

SERVICE_LAYER: dict[str, str] = {
    "water": "C-UTIL-WATR",
    "sewer": "C-UTIL-SEWR",
    "stormwater": "C-UTIL-STRM",
    "electricity": "C-UTIL-ELEC",
    "gas": "C-UTIL-GASS",
    "telecom": "C-UTIL-TELC",
    "other": "C-UTIL-OTHR",
}

# Standard AutoCAD linetype patterns (drawing units, + dash / - gap / 0 dot) as
# defined by ezdxf's setup.  Used by the PDF renderer so both outputs match.
# DXF $LTSCALE is N/250, which makes 1 pattern unit = 4 mm on paper.
LINETYPE_PATTERNS: dict[str, tuple[float, ...]] = {
    "CONTINUOUS": (),
    "DASHED": (1.27, -0.254),
    "DASHED2": (0.635, -0.127),
    "DASHDOT": (2.54, -0.508, 0.0, -0.508),
    "CENTER": (3.175, -0.635, 0.635, -0.635),
}
LTSCALE_DIVISOR = 250.0
PATTERN_UNIT_MM = 1000.0 / LTSCALE_DIVISOR  # paper mm per pattern unit

LAYER_INSERT_SQL = "\n".join(
    "INSERT INTO annotations.dxf_layers (layer_name, aci_colour, linetype, lineweight_mm, description, is_plottable) "
    f"VALUES ('{l.name}', {l.aci}, '{l.linetype}', {l.lineweight_mm:.2f}, '{l.description}', {str(l.plot).lower()}) "
    "ON CONFLICT (layer_name) DO NOTHING;"
    for l in LAYERS
    if l.extra
)


def pdf_rgb(aci: int) -> tuple[float, float, float]:
    """RGB (0..1) for printing on white paper: ACI 7 is black, pale colours darkened."""
    overrides = {7: (0.0, 0.0, 0.0), 2: (0.62, 0.52, 0.0), 3: (0.0, 0.55, 0.15), 30: (0.9, 0.45, 0.0), 40: (0.55, 0.45, 0.0)}
    if aci in overrides:
        return overrides[aci]
    r, g, b = _dxf_colors.aci2rgb(aci)
    return (r / 255.0, g / 255.0, b / 255.0)


def ensure_layers(doc: Drawing) -> None:
    """Create all registry layers (and any missing linetypes) in ``doc``."""
    for lt_name in {l.linetype for l in LAYERS if l.linetype != "CONTINUOUS"}:
        if lt_name not in doc.linetypes:
            raise RuntimeError(f"linetype {lt_name} missing from DXF template")
    for l in LAYERS:
        if l.name in doc.layers:
            continue
        layer = doc.layers.add(
            l.name, color=l.aci, linetype=l.linetype, lineweight=l.lineweight_dxf
        )
        layer.description = l.description
        layer.dxf.plot = 1 if l.plot else 0
