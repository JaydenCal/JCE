"""The Planning maps section of the site report: an index, how to read the maps, and one figure per zoning control and mapped constraint."""
from __future__ import annotations

from reportlab.lib.units import mm
from reportlab.platypus import KeepTogether, Spacer, Table, TableStyle

from app.report import fmt, theme as T
from app.report import maps as MP
from app.report.blocks import KS, Chip, P, callout, grid_table, st
from app.report.sections import Ctx, _fig_record, _sh

CW = T.CW
FIG_W = (CW - 4 * mm) / 2          # each figure is half the text width: two per row


def _bullets(items: list[str]) -> list:
    from reportlab.platypus import Paragraph
    return [Paragraph(fmt.esc(x), st()["bullet"], bulletText="•") for x in items]


def how_to_read_maps(ctx: Ctx) -> list[str]:
    out = ["The subject lot is outlined in bold. Thin lines show the adjoining lots.",
           "Layer polygons are clipped to the figure extent. Each class has its own fill, a label where it fits, and a legend entry that gives the share of the lot it covers.",
           "A hatched band marks part of a figure that the loaded data does not cover. It is not a finding that no feature exists there.",
           "MAP NOT AVAILABLE: LAYER NOT CHECKED (NOT CLEAR) means the layer was not queried in this run. Not checked is not clear.",
           "A map that shows no polygon states NOT INTERSECTED BY THE DATA LOADED. That describes the data loaded and not the land.",
           "Each map carries a source line: the dataset or instrument, the service, the data date, the retrieval date, and publisher or licence text only where the endpoint records it. "
           f"Otherwise it prints {MP.LICENCE_NOT_RECORDED}."]
    if any(m.aerial for m in ctx.maps):
        out.append("The base is aerial imagery supplied with the run. Its capture date is on each source line. Features may have changed since that date.")
    else:
        out.append("No aerial base is used: this run has no imagery provider, so the maps are vector only.")
    if "offline_fixture" in (ctx.meta.get("flags") or []):
        out.append("OFFLINE FIXTURE: the layer results come from a saved run. Their geometry was reconstructed and is approximate. It is not the geometry that the service holds.")
    return out


def figure_caption(ctx: Ctx, pm: MP.PlanMap) -> object:
    demo = "<b>SYNTHETIC DEMO DATA.</b> " if ctx.meta.get("synthetic_demo") else ""
    return P(f"<b>Figure {pm.number}.</b> {demo}{fmt.esc(MP.caption_text(pm, ctx.lot_label))}", "caption", raw=True)


def planning_maps_section(ctx: Ctx) -> list:
    maps = ctx.maps
    if not maps:
        return []
    assert ctx.fig_no == ctx.map_base, f"figure numbers reserved for the planning maps start at {ctx.map_base + 1}, but {ctx.fig_no} figures were numbered before the section"
    fl = _sh(ctx, "Planning maps", "One map extract for each zoning control and each mapped constraint used in this report, so that every statement can be checked against a map.")
    fl += _bullets(how_to_read_maps(ctx))
    fl.append(Spacer(1, 2.5 * mm))
    rows = []
    for pm in maps:
        rows.append([P(f"{pm.number}", "cellb"), P(pm.title, "cell"), Chip(pm.chip, pm.chip_kind, h=10, size=5.4)])
    idx = grid_table(["Figure", "Map", "Result"], rows, [16 * mm, CW - 16 * mm - 44 * mm, 44 * mm], zebra=True)
    fl += [KeepTogether([P("MAP INDEX", "label"), KS(2), idx]), Spacer(1, 3 * mm)]
    for i in range(0, len(maps), 2):
        cells = []
        for pm in maps[i:i + 2]:
            ctx.fig_no += 1
            rec = _fig_record(pm.number, pm.title, pm.fig) if pm.fig else {"figure": pm.number, "title": pm.title, "aerial": False, "imagery_date": None, "note": pm.state}
            ctx.figures.append({**rec, "planning_map": True, "state": pm.state})
            cells.append([MP.PlanMapBlock(pm, FIG_W), figure_caption(ctx, pm)])
        if len(cells) == 1:
            cells.append("")
        t = Table([cells], colWidths=[FIG_W + 2 * mm, FIG_W + 2 * mm])
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 2 * mm),
                               ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 2 * mm)]))
        fl.append(t)
    return fl
