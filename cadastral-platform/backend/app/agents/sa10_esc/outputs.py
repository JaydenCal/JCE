"""DXF, GeoJSON, 3D-viewer parts and the short ESC report."""
from __future__ import annotations

import json
import math
from pathlib import Path

import ezdxf
from shapely import wkt as swkt
from shapely.geometry import LineString, mapping

from app.agents.sa5_cad_dxf.layers import ensure_layers
from app.agents.sa6_glide3d import geom as G
from app.agents.sa6_glide3d.models import Part

from app.branding.brand import Brand
from .layers import ESC_LAYERS
from .logo import logo_polylines
from .layout import Layout, lines_of, polys_of
from .models import DISCLAIMER, Sa10EscInput, Sa10EscOutput
from .reqs import ReqView

HEX = {"fence": "#cc1414", "return": "#cc1414", "access": "#7f4d0d", "stockpile": "#e67300", "topsoil": "#8c661a", "laydown": "#737373",
       "washout": "#008094", "bin": "#4d4d4d", "toilet": "#4d4d4d", "inlet": "#b31a99", "diversion": "#1a4dd9", "berm": "#1a4dd9",
       "check_dam": "#1a33a6", "limit": "#1a8c33", "nogo": "#1a8c33"}


def write_dxf(inp: Sa10EscInput, L: Layout, path: str | Path) -> dict:
    doc = ezdxf.new("R2018", setup=True, units=6)
    ensure_layers(doc)
    for l in ESC_LAYERS:
        if l.name not in doc.layers:
            lay = doc.layers.add(l.name, color=l.aci, linetype=l.linetype, lineweight=l.lineweight_dxf)
            lay.description = l.description
    doc.header["$INSUNITS"] = 6
    doc.header["$MEASUREMENT"] = 1
    doc.styles.add("JCE", font="arial.ttf")
    msp = doc.modelspace()
    counts: dict[str, int] = {}

    def poly(g, layer, close_polys=True):
        for pg in polys_of(g):
            msp.add_lwpolyline(list(pg.exterior.coords)[:-1], close=True, dxfattribs={"layer": layer})
            counts[layer] = counts.get(layer, 0) + 1
        for ln in lines_of(g) if not polys_of(g) else []:
            msp.add_lwpolyline(list(ln.coords), close=False, dxfattribs={"layer": layer})
            counts[layer] = counts.get(layer, 0) + 1

    poly(L.lot, "C-PROP-BDY")
    if inp.footprint_wkt:
        poly(L.footprint, "A-BLDG-SLAB")
    if L.crossover is not None:
        poly(L.crossover, "C-DRIV-XOVR")
    h = 0.5
    for e in L.elements:
        g = swkt.loads(e.geometry_wkt)
        if e.kind == "limit":
            msp.add_lwpolyline(list(g.coords), close=True, dxfattribs={"layer": e.layer})
            counts[e.layer] = counts.get(e.layer, 0) + 1
        elif e.kind == "nogo":
            for pg in polys_of(g):
                c = pg.centroid
                msp.add_circle((c.x, c.y), (pg.area / math.pi) ** 0.5, dxfattribs={"layer": e.layer})
                counts[e.layer] = counts.get(e.layer, 0) + 1
        else:
            poly(g, e.layer)
        c = g.representative_point()
        txt = f"{e.id} {e.label}" + (f" {e.quantity:g} {e.quantity_unit}" if e.quantity is not None and e.quantity_unit in ("m", "m2") else "") + ("" if e.status == "resolved" else " (TBC)")
        t = msp.add_text(txt, height=h, dxfattribs={"layer": "C-ESC-NOTE", "style": "JCE"})
        t.set_placement((c.x + 0.3, c.y + 0.3))
        counts["C-ESC-NOTE"] = counts.get("C-ESC-NOTE", 0) + 1
    # symbol blocks + legend (1 unit = 1 m; swatch 2 m)
    def blk(name, fn):
        b = doc.blocks.new(name=name)
        fn(b)
    blk("ESC_SF", lambda b: ([b.add_line((0, 0), (2, 0), dxfattribs={"layer": "C-ESC-FENC"})] + [b.add_line((x - .12, -.12), (x + .12, .12), dxfattribs={"layer": "C-ESC-FENC"}) for x in (.5, 1, 1.5)]))
    blk("ESC_ACCESS", lambda b: (b.add_lwpolyline([(0, -.35), (2, -.35), (2, .35), (0, .35)], close=True, dxfattribs={"layer": "C-ESC-ACCS"}), b.add_line((.3, 0), (1.7, 0), dxfattribs={"layer": "C-ESC-ACCS"}), b.add_line((1.45, .15), (1.7, 0), dxfattribs={"layer": "C-ESC-ACCS"}), b.add_line((1.45, -.15), (1.7, 0), dxfattribs={"layer": "C-ESC-ACCS"})))
    blk("ESC_SP", lambda b: (b.add_ellipse((1, 0), major_axis=(1, 0), ratio=0.35, dxfattribs={"layer": "C-ESC-STOK", "linetype": "DASHED"}), b.add_text("SP", height=.3, dxfattribs={"layer": "C-ESC-STOK"}).set_placement((.8, -.12))))
    blk("ESC_TS", lambda b: (b.add_ellipse((1, 0), major_axis=(1, 0), ratio=0.35, dxfattribs={"layer": "C-ESC-STOK", "linetype": "DASHED"}), b.add_text("TS", height=.3, dxfattribs={"layer": "C-ESC-STOK"}).set_placement((.8, -.12))))
    blk("ESC_BOX", lambda b: b.add_lwpolyline([(0, -.35), (2, -.35), (2, .35), (0, .35)], close=True, dxfattribs={"layer": "C-ESC-STOK"}))
    blk("ESC_DIVR", lambda b: ([b.add_line((0, 0), (2, 0), dxfattribs={"layer": "C-ESC-DIVR"})] + [b.add_lwpolyline([(x - .2, .15), (x, 0), (x - .2, -.15)], dxfattribs={"layer": "C-ESC-DIVR"}) for x in (.8, 1.6)]))
    blk("ESC_CHKD", lambda b: (b.add_line((0, 0), (2, 0), dxfattribs={"layer": "C-ESC-CHKD"}), b.add_line((0, -.3), (0, .3), dxfattribs={"layer": "C-ESC-CHKD"}), b.add_line((2, -.3), (2, .3), dxfattribs={"layer": "C-ESC-CHKD"})))
    blk("ESC_LIMT", lambda b: b.add_line((0, 0), (2, 0), dxfattribs={"layer": "C-ESC-LIMT", "linetype": "DASHDOT"}))
    blk("ESC_NOGO", lambda b: (b.add_circle((1, 0), .35, dxfattribs={"layer": "C-ESC-NOGO"}), b.add_line((.75, -.25), (1.25, .25), dxfattribs={"layer": "C-ESC-NOGO"}), b.add_line((.75, .25), (1.25, -.25), dxfattribs={"layer": "C-ESC-NOGO"})))
    blk("ESC_FLOW", lambda b: (b.add_line((0, 0), (2, 0), dxfattribs={"layer": "C-ESC-NOTE"}), b.add_lwpolyline([(1.6, .2), (2, 0), (1.6, -.2)], dxfattribs={"layer": "C-ESC-NOTE"})))
    leg = [("ESC_SF", "Sediment fence (SF)"), ("ESC_ACCESS", "Stabilised site access (SA)"), ("ESC_SP", "Soil stockpile (SP)"), ("ESC_TS", "Topsoil stockpile (TS)"),
           ("ESC_BOX", "Laydown LD / washout CW / bin BIN / toilet WC / inlet trap IP"), ("ESC_DIVR", "Clean-water diversion (DD)"), ("ESC_CHKD", "Check dam (CD)"),
           ("ESC_LIMT", "Limit of works"), ("ESC_NOGO", "No-go / tree protection (NG)"), ("ESC_FLOW", "Direction of fall")]
    lx, ly = L.lot.bounds[2] + 3, L.lot.bounds[1] + 2 + 1.2 * len(leg)
    msp.add_lwpolyline([(lx - 1, ly + 2), (lx + 22, ly + 2), (lx + 22, ly - 1.2 * len(leg) - .2), (lx - 1, ly - 1.2 * len(leg) - .2)], close=True, dxfattribs={"layer": "C-ESC-NOTE"})
    msp.add_text("LEGEND - ESC", height=.6, dxfattribs={"layer": "C-ESC-NOTE", "style": "JCE"}).set_placement((lx, ly + .9))
    for i, (bn, lab) in enumerate(leg):
        yy = ly - 1.2 * (i + 1) + .6
        msp.add_blockref(bn, (lx, yy), dxfattribs={"layer": "C-ESC-NOTE"})
        msp.add_text(lab, height=.4, dxfattribs={"layer": "C-ESC-NOTE", "style": "JCE"}).set_placement((lx + 2.6, yy - .15))
    # company logo (vectorised) beside the lot, layer C-ANNO-LOGO
    if "C-ANNO-LOGO" not in doc.layers:
        doc.layers.add("C-ANNO-LOGO", color=2)
    bx0, by0, bx1, by1 = L.lot.bounds
    try:
        brand = Brand.from_env()
        for pts, closed in logo_polylines(brand, 12.0):
            msp.add_lwpolyline([(bx1 + 3 + px, by1 - 6 + py) for px, py in pts], close=closed, dxfattribs={"layer": "C-ANNO-LOGO"})
        t = msp.add_text(brand.company_name, height=0.7, dxfattribs={"layer": "C-ANNO-LOGO", "style": "JCE"})
        t.set_placement((bx1 + 3, by1 - 8))
    except Exception:  # noqa: BLE001
        pass
    # note block beside the lot
    x0, y0, x1, y1 = L.lot.bounds
    lines = [DISCLAIMER, f"Flow: {L.flow.source}", f"Site {inp.lot.lotplan}; est. disturbed area {L.quantities['disturbed_area_estimate_m2']} m2"]
    for i, ln in enumerate(lines):
        t = msp.add_text(ln, height=0.6, dxfattribs={"layer": "C-ESC-NOTE", "style": "JCE"})
        t.set_placement((x0, y0 - 2.0 - i * 1.0))
    counts["C-ESC-NOTE"] = counts.get("C-ESC-NOTE", 0) + len(lines)
    errors = doc.audit().errors
    doc.saveas(str(path))
    return {"entity_counts": counts, "audit_errors": [e.message for e in errors]}


def _elev(L: Layout, x: float, y: float) -> float:
    if L.z_plane is None:
        return 0.0
    a, b, c = L.z_plane
    return a * x + b * y + c


def build_parts_and_geojson(inp: Sa10EscInput, L: Layout, out_dir: Path, stem: str) -> tuple[Path, Path]:
    """GeoJSON (MGA) + SA6-compatible scene Parts for layer 'esc' (local metres relative to origin; Z from the fitted plane or 0)."""
    c = L.lot.centroid
    E0, N0 = math.floor(c.x / 10) * 10.0, math.floor(c.y / 10) * 10.0
    feats, parts = [], []
    for e in L.elements:
        g = swkt.loads(e.geometry_wkt)
        feats.append({"type": "Feature", "geometry": mapping(g), "properties": {
            "id": e.id, "kind": e.kind, "layer": "esc", "dxf_layer": e.layer, "label": e.label, "status": e.status, "req_keys": e.req_keys,
            "unresolved_keys": e.unresolved_keys, "quantity": e.quantity, "quantity_unit": e.quantity_unit, "srid": inp.lot.mga_srid}})
        col = HEX[e.kind]
        lift = 0.05
        segs: list[float] = []
        soup = None
        if e.kind in ("fence", "return", "diversion", "berm", "check_dam", "limit"):
            lg = lines_of(g)
            for ln in lg:
                pts = list(ln.coords)
                for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
                    z0, z1 = _elev(L, x0, y0) + lift, _elev(L, x1, y1) + lift
                    if e.kind == "fence":                       # 0.9 m high fabric as a vertical strip (two triangles)
                        pass
                    segs += [x0 - E0, y0 - N0, z0, x1 - E0, y1 - N0, z1]
            part = dict(n=f"{e.id} {e.label}", c="esc", col=col, a=1.0, lines=segs, lw=2.0 if e.kind == "fence" else 1.2)
            if e.kind == "fence":
                tris = []
                for ln in lg:
                    pts = list(ln.coords)
                    for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
                        z0, z1 = _elev(L, x0, y0), _elev(L, x1, y1)
                        a_ = (x0 - E0, y0 - N0, z0); b_ = (x1 - E0, y1 - N0, z1)
                        a2 = (a_[0], a_[1], a_[2] + 0.9); b2 = (b_[0], b_[1], b_[2] + 0.9)
                        tris += [*a_, *b_, *b2, *a_, *b2, *a2]
                part["v"] = tris
                part["a"] = 0.7
        else:
            tris = []
            import numpy as np
            for pg in polys_of(g):
                t = G.tri_polygon(pg)
                for tri in t:
                    for (x, y) in tri:
                        tris += [float(x - E0), float(y - N0), float(_elev(L, x, y) + lift + (0.8 if e.kind in ("stockpile", "topsoil") else 0.0))]
            part = dict(n=f"{e.id} {e.label}", c="esc", col=col, a=0.85, v=tris)
        if part.get("v") or part.get("lines"):
            parts.append(Part(**part).model_dump(exclude_none=True))
    gj = {"type": "FeatureCollection", "name": f"{stem}_esc", "crs": {"type": "name", "properties": {"name": f"EPSG:{inp.lot.mga_srid}"}},
          "features": feats, "properties": {"layer": "esc", "label": "Erosion and sediment control", "status": "unverified"}}
    pj = {"layer": {"c": "esc", "n": "Erosion and sediment control (indicative)", "on": True}, "origin": [E0, N0, 0.0], "srid": inp.lot.mga_srid,
          "z_note": "Z from a fitted ground plane" if L.z_plane else "No levels: Z = 0", "parts": parts}
    p1, p2 = out_dir / f"{stem}.geojson", out_dir / f"{stem}_scene_parts.json"
    p1.write_text(json.dumps(gj))
    p2.write_text(json.dumps(pj))
    return p1, p2


def write_report(inp: Sa10EscInput, L: Layout, rq: ReqView, out: Sa10EscOutput, path: Path) -> None:
    q = L.quantities
    md = [f"# Erosion and sediment control report - {inp.project_title}", "",
          f"**{DISCLAIMER}.**", "",
          f"- Lot/plan: {inp.lot.lotplan} ({inp.lot.lga_name}), zone {inp.lot.zone_code or 'n/a'}, {inp.lot.area_m2_calculated:.0f} m2 (calculated)",
          f"- Development: {inp.development_type.label}",
          f"- Flow: {L.flow.source}; bearing {L.flow.bearing_deg:.0f} deg (MGA grid)" + (" - **ASSUMED**" if L.flow.assumed else ""),
          f"- Estimated disturbed area: {q['disturbed_area_estimate_m2']} m2 ({q['disturbed_area_basis']}); limit of works {q['limit_of_works_area_m2']} m2", "",
          "## Controls and quantities", "", "| ID | Control | Quantity | Status | Cited requirements relied on | To be confirmed |", "|---|---|---|---|---|---|"]
    for e in out.elements:
        qty = f"{e.quantity:g} {e.quantity_unit}" if e.quantity is not None else ""
        cits = "<br>".join(e.citations) or "-"
        md.append(f"| {e.id} | {e.label} | {qty} | {e.status} | {cits} | {', '.join(e.unresolved_keys) or '-'} |")
    md += ["", "### Notes per control", ""]
    for e in out.elements:
        for n in e.notes:
            md.append(f"- **{e.id}**: {n}")
    md += ["", "## Source citations (exact quotes)", ""]
    for k, r in sorted(rq.used.items()):
        s = r.req.source
        md.append(f"- `{k}` = {r.value} {r.req.unit or ''} - {s.document_title}, p.{s.page}, {s.section_ref}: \"{' '.join(s.quote.split())}\""
                  + (f" _Confirm: {r.req.prompt}_" if r.req.prompt else ""))
    md += ["", "## Unresolved (to be confirmed by the designer/certifier)", ""]
    for u in out.unresolved:
        md.append(f"- `{u['key']}`: {u['prompt']}")
    md += ["", "## Layout assumptions (drawing parameters, not requirements)", ""] + [f"- {a}" for a in out.assumptions]
    if out.warnings:
        md += ["", "## Warnings", ""] + [f"- {w}" for w in out.warnings]
    path.write_text("\n".join(md) + "\n")
