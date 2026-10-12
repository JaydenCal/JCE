"""ESC DXF layers (to be inserted into annotations.dxf_layers by db/005_esc_layers.sql; 001 is not edited)."""
from __future__ import annotations

from app.agents.sa5_cad_dxf.layers import LayerDef

ESC_LAYERS: tuple[LayerDef, ...] = (
    LayerDef("C-ESC-FENC", 1, "CONTINUOUS", 0.35, "ESC: sediment fence and returns", extra=True),
    LayerDef("C-ESC-ACCS", 30, "CONTINUOUS", 0.35, "ESC: stabilised site access and diversion berm at access", extra=True),
    LayerDef("C-ESC-STOK", 40, "CONTINUOUS", 0.25, "ESC: stockpiles, topsoil, materials laydown", extra=True),
    LayerDef("C-ESC-DIVR", 5, "DASHED", 0.25, "ESC: clean-water diversion drains, bunds and berms", extra=True),
    LayerDef("C-ESC-INLT", 6, "CONTINUOUS", 0.25, "ESC: kerb inlet and gutter sediment traps", extra=True),
    LayerDef("C-ESC-WSHT", 4, "CONTINUOUS", 0.25, "ESC: concrete washout and wash-down area", extra=True),
    LayerDef("C-ESC-BINS", 8, "CONTINUOUS", 0.25, "ESC: waste bin and portable toilet", extra=True),
    LayerDef("C-ESC-CHKD", 150, "CONTINUOUS", 0.35, "ESC: check dams", extra=True),
    LayerDef("C-ESC-LIMT", 3, "DASHDOT", 0.25, "ESC: limit of works", extra=True),
    LayerDef("C-ESC-NOGO", 3, "DASHED", 0.25, "ESC: no-go areas and tree protection", extra=True),
    LayerDef("C-ESC-NOTE", 7, "CONTINUOUS", 0.18, "ESC: labels and notes", extra=True),
)
ESC_LAYER_NAMES = [l.name for l in ESC_LAYERS]


def insert_sql() -> str:
    head = "-- ESC (erosion and sediment control) DXF layers for annotations.dxf_layers. Idempotent. Generated from app/agents/sa10_esc/layers.py.\n"
    return head + "\n".join(
        "INSERT INTO annotations.dxf_layers (layer_name, aci_colour, linetype, lineweight_mm, description, is_plottable) "
        f"VALUES ('{l.name}', {l.aci}, '{l.linetype}', {l.lineweight_mm:.2f}, '{l.description}', {str(l.plot).lower()}) "
        "ON CONFLICT (layer_name) DO NOTHING;" for l in ESC_LAYERS) + "\n"
