"""A4 PDF + JSON + GeoJSON + OverlayPolygon outputs."""
from __future__ import annotations

import json
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.graphics.shapes import Drawing, Polygon as RPoly, String
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from shapely import wkt
from shapely.geometry import mapping

from app.agents.sa9_constraints.intersect import LayerResult
from app.agents.sa9_constraints.layers import REGISTRY
from app.agents.sa9_constraints.triggers import TriggerResult
from app.common.contracts import OverlayPolygon
from app.imagery.figure import OverlaySpec, render_figure
from app.imagery.provider import provider_from_env

LEGAL = ("This report is informational only. It is NOT a planning certificate (NSW s10.7 certificate) or a council "
         "property/planning report. Verify all matters with the council and the relevant authority. Mapping data may "
         "be out of date, incomplete or inaccurate. 'Not checked' means the layer could not be queried; it does not mean clear.")
STATUS = {"affected": "Affected", "not_affected": "Not affected", "not_checked": "Not checked"}


def overlay_polygons(results: list[LayerResult]) -> list[OverlayPolygon]:
    return [OverlayPolygon(label=r.label, kind=REGISTRY[r.key].kind if r.key in REGISTRY else "constraint", geometry_wkt=w)
            for r in results if r.status == "affected" for w in r.geometries_wkt]


def geojson(results: list[LayerResult], lot_wkt: str, footprint_wkt: str | None, srid: int) -> dict:
    feats = [{"type": "Feature", "properties": {"role": "lot"}, "geometry": mapping(wkt.loads(lot_wkt))}]
    if footprint_wkt:
        feats.append({"type": "Feature", "properties": {"role": "footprint"}, "geometry": mapping(wkt.loads(footprint_wkt))})
    for r in results:
        if r.status == "affected":
            for w, i in zip(r.geometries_wkt, range(len(r.geometries_wkt))):
                a = r.attributes[i] if i < len(r.attributes) else {}
                feats.append({"type": "Feature", "geometry": mapping(wkt.loads(w)),
                              "properties": {"role": "constraint", "layer": r.key, "label": r.label,
                                             "kind": REGISTRY[r.key].kind if r.key in REGISTRY else "constraint", **a}})
    return {"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": f"EPSG:{srid}"}}, "features": feats}


def _polys(g):
    return list(g.geoms) if hasattr(g, "geoms") else [g]


def _map(lot_wkt, fp_wkt, r: LayerResult, w=170 * mm, h=110 * mm) -> Drawing:
    geoms = [wkt.loads(lot_wkt)] + [wkt.loads(x) for x in r.geometries_wkt] + ([wkt.loads(fp_wkt)] if fp_wkt else [])
    x0 = min(g.bounds[0] for g in geoms); y0 = min(g.bounds[1] for g in geoms)
    x1 = max(g.bounds[2] for g in geoms); y1 = max(g.bounds[3] for g in geoms)
    s = min((w - 20) / max(x1 - x0, 1e-6), (h - 30) / max(y1 - y0, 1e-6))
    d = Drawing(w, h)

    def draw(g, stroke, fill):
        for p in _polys(g):
            if p.geom_type != "Polygon":
                continue
            pts = [c for x, y in p.exterior.coords for c in (10 + (x - x0) * s, 10 + (y - y0) * s)]
            d.add(RPoly(pts, strokeColor=stroke, fillColor=fill, strokeWidth=1))
    for x in r.geometries_wkt:
        draw(wkt.loads(x), colors.HexColor("#b03a2e"), colors.Color(0.85, 0.2, 0.2, alpha=0.3))
    draw(wkt.loads(lot_wkt), colors.black, None)
    if fp_wkt:
        draw(wkt.loads(fp_wkt), colors.HexColor("#1f4e79"), colors.Color(0.1, 0.3, 0.6, alpha=0.25))
    d.add(String(10, h - 14, "Black: lot   Blue: footprint   Red: constraint polygons (MGA, indicative)", fontSize=7))
    return d


def build_report(path_pdf: Path, path_json: Path, meta: dict, results: list[LayerResult], triggers: list[TriggerResult],
                 lot_wkt: str, fp_wkt: str | None, acknowledgements: list[str], imagery=None) -> None:
    imagery = imagery if imagery is not None else provider_from_env(meta.get('jurisdiction', 'NSW'))
    fig_no = 0
    ss = getSampleStyleSheet(); P = lambda t, s="BodyText": Paragraph(escape(t), ss[s])
    st = [Spacer(1, 40 * mm), P("Planning Constraints & Triggers Report", "Title"),
          P(f"Lot/Plan: {meta['lotplan']}"), P(f"Council: {meta['lga_name']} ({meta['jurisdiction']})"),
          P(f"Development type: {meta.get('development_type', 'not stated')}"), P(f"Report date: {meta['date']}"), P(f"Data currency: {meta['data_currency']}"), Spacer(1, 10 * mm), P(LEGAL), PageBreak(),
          P("Summary of layers", "Heading1")]
    rows = [["Layer", "Status", "Overlap m2", "% of lot", "Footprint", "Currency"]]
    for r in results:
        rows.append([Paragraph(escape(r.label), ss["BodyText"]), STATUS[r.status] + (" (endpoint unverified)" if r.status != "not_checked" and not r.endpoint_verified else ""),
                     f"{r.overlap_area_m2:.1f}", f"{r.pct_of_lot:.1f}",
                     "-" if r.footprint_affected is None else ("Affected" if r.footprint_affected else "No"), r.data_currency or r.error or "unknown"])
    t = Table(rows, repeatRows=1, colWidths=[55 * mm, 32 * mm, 20 * mm, 16 * mm, 20 * mm, 35 * mm])
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.3, colors.grey), ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                           ("FONTSIZE", (0, 0), (-1, -1), 7), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    st += [t]
    for r in results:
        if r.status == "affected" and REGISTRY.get(r.key) and REGISTRY[r.key].significant:
            fig_no += 1
            fig = render_figure(lot_wkt, [OverlaySpec(wkt.loads(g), label=r.label) for g in r.geometries_wkt], imagery,
                                srid=int(meta.get("mga_srid", 7856)), number=fig_no, footprint=fp_wkt,
                                caption=f"{r.label}: constraint overlay on lot (MGA, indicative)")
            st += [PageBreak(), P(f"Map: {r.label}", "Heading2"), fig.as_flowable(),
                   P(f"Overlap {r.overlap_area_m2:.1f} m2 ({r.pct_of_lot:.1f}% of lot); nearest distance {r.nearest_distance_m} m.")]
    st += [PageBreak(), P("Triggers and next steps", "Heading1")]
    if not triggers:
        st.append(P("No affected layers produced triggers. Layers marked Not checked must still be verified."))
    for tr in triggers:
        st += [P(f"{tr.title} - {tr.layer_label}", "Heading2"), P(f"Rule: {tr.rule_id}. Source: {tr.source}."),
               P(f"Attributes: {tr.attributes}"), P(f"Pathway (may apply: verify with council): {tr.development_pathway_hint}")]
        for c in tr.consequences:
            st.append(P(f"- {c.item}: " + (f"{c.value} [{c.citation}]" if c.status == "resolved" else f"TO BE CONFIRMED. {c.instruction}")))
        st.append(P("Next steps: " + "; ".join(tr.next_steps)))
    st += [PageBreak(), P("Acknowledgements", "Heading1")] + [P("- " + a) for a in acknowledgements] + [Spacer(1, 6 * mm), P("Legal statement", "Heading2"), P(LEGAL)]
    SimpleDocTemplate(str(path_pdf), pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm, bottomMargin=15 * mm,
                      title="Planning Constraints & Triggers Report").build(st)
    path_json.write_text(json.dumps({"meta": meta, "layers": [r.model_dump() for r in results],
                                     "triggers": [t.model_dump() for t in triggers], "legal": LEGAL}, indent=1, default=str))
