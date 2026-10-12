"""R2018 DXF builder: model space in real MGA metres + A3 paper-space layout."""
from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import ezdxf
from ezdxf.document import Drawing
from ezdxf.enums import TextEntityAlignment
from shapely.geometry.base import BaseGeometry

from app.agents.sa5_cad_dxf.annotate import AnnotationSet, H_DIM
from app.agents.sa5_cad_dxf.gate import ACK_TEXT  # noqa: F401  (re-exported for callers)
from app.agents.sa5_cad_dxf.layers import (LAYER_BY_NAME, LTSCALE_DIVISOR, SERVICE_LAYER, ensure_layers)
from app.agents.sa5_cad_dxf.model import PlanModel, left_normal, lines_of, polygons_of
from app.agents.sa5_cad_dxf.sheet import (FRAME, VIEWPORT, Circle, FitResult, Line, Poly, Prim, Text, SHEET_H,
                                          SHEET_W, build_panel, viewport_size)
from app.common.contracts import AckKind

LAYOUT_NAME = "A3 Plan"
OVERLAY_STYLE = {  # kind -> (ACI, pattern, angle)
    "flood": (5, "ANSI31", 45), "bushfire": (1, "ANSI31", 135), "heritage": (6, "ANSI37", 0),
    "dcp_envelope": (3, "ANSI32", 45), "biodiversity": (3, "ANSI37", 45),
}
DEFAULT_OVERLAY_STYLE = (40, "ANSI31", 45)


@dataclass
class DxfBuild:
    doc: Drawing
    layers_used: list[str]
    entity_counts: dict[str, int]


def _poly(layout, geom: BaseGeometry, layer: str, **attrs) -> None:
    for ln in lines_of(geom):
        pts = list(ln.coords)
        closed = len(pts) > 2 and pts[0] == pts[-1]
        if closed:
            pts = pts[:-1]
        layout.add_lwpolyline(pts, close=closed, dxfattribs={"layer": layer, **attrs})


def _setup_styles(doc: Drawing, scale: int) -> None:
    doc.styles.add("JCE", font="arial.ttf")
    doc.styles.add("JCE_BOLD", font="arialbd.ttf")
    doc.header["$INSUNITS"] = 6
    doc.header["$MEASUREMENT"] = 1
    doc.header["$LUNITS"] = 2
    doc.header["$LUPREC"] = 3
    doc.header["$LTSCALE"] = scale / LTSCALE_DIVISOR
    doc.header["$PSLTSCALE"] = 1
    k = scale / 1000.0
    h = H_DIM * k
    doc.dimstyles.new("JCE", dxfattribs={
        "dimtxt": h, "dimasz": 1.4 * k, "dimexe": 1.0 * k, "dimexo": 0.6 * k, "dimgap": 0.7 * k,
        "dimtad": 1, "dimdec": 2, "dimtxsty": "JCE", "dimclrd": 256, "dimclre": 256, "dimclrt": 256,
        "dimlwd": -1, "dimlwe": -1, "dimcen": 0.0, "dimtih": 0, "dimtoh": 0, "dimzin": 0,
        "dimsah": 0, "dimtix": 0, "dimtofl": 1,
    })


def _signed_distance(p1, p2, side, offset_m: float) -> float:
    nx, ny = left_normal(p2[0] - p1[0], p2[1] - p1[1])
    return offset_m if (nx * side[0] + ny * side[1]) >= 0 else -offset_m


def _draw_model(doc: Drawing, model: PlanModel, aset: AnnotationSet) -> None:
    msp = doc.modelspace()
    k = model.scale / 1000.0
    _poly(msp, model.lot, "C-PROP-BDY")
    if model.envelope is not None:
        _poly(msp, model.envelope, "C-ZONE-ENVL")
    if model.footprint is not None:
        _poly(msp, model.footprint, "A-BLDG-SLAB")

    # council overlays: hatch + outline
    for o in model.overlays:
        aci, pattern, angle = OVERLAY_STYLE.get(o.kind.lower(), DEFAULT_OVERLAY_STYLE)
        for poly in polygons_of(o.geom):
            hatch = msp.add_hatch(color=aci, dxfattribs={"layer": "C-ZONE-OVLY"})
            hatch.set_pattern_fill(pattern, color=aci, angle=angle, scale=2.5 * k / 3.175)
            hatch.paths.add_polyline_path(list(poly.exterior.coords)[:-1], is_closed=True)
            for r in poly.interiors:
                hatch.paths.add_polyline_path(list(r.coords)[:-1], is_closed=True)
        _poly(msp, o.geom, "C-ZONE-OVLY", color=aci)

    # setback measurement lines
    for d in model.dims:
        if d.kind == "setback":
            msp.add_line(d.p1, d.p2, dxfattribs={"layer": "C-ZONE-SBAK"})

    # driveway
    if model.drive_poly is not None:
        _poly(msp, model.drive_poly, "C-DRIV-XOVR")
        _poly(msp, model.crossover, "C-DRIV-XOVR")
        _poly(msp, model.drive_centreline, "C-DRIV-CNTR")
    if model.turn_path is not None:
        _poly(msp, model.turn_path, "C-DRIV-TURN")
    if model.turn_centre is not None and model.turn_radius:
        cx, cy = model.turn_centre
        msp.add_circle((cx, cy), model.turn_radius, dxfattribs={"layer": "C-DRIV-TURN"})
        m = 1.2 * k
        msp.add_line((cx - m, cy), (cx + m, cy), dxfattribs={"layer": "C-DRIV-TURN"})
        msp.add_line((cx, cy - m), (cx, cy + m), dxfattribs={"layer": "C-DRIV-TURN"})

    # services
    for sv in model.services:
        layer = SERVICE_LAYER[sv.service]
        extra = {"linetype": "DASHDOT"} if sv.is_proposed else {}
        if sv.geom.geom_type == "Point":
            msp.add_circle((sv.geom.x, sv.geom.y), 0.5 * k, dxfattribs={"layer": layer})
        else:
            _poly(msp, sv.geom, layer, **extra)
        if sv.exclusion is not None:
            _poly(msp, sv.exclusion, "C-UTIL-EXCL")
    if model.rwt is not None:
        msp.add_circle((model.rwt[0], model.rwt[1]), model.rwt[2] / 2, dxfattribs={"layer": "C-UTIL-RWTK"})

    # level spot symbols
    for x, y, _z in model.level_spots:
        m = 0.8 * k
        msp.add_line((x - m, y), (x + m, y), dxfattribs={"layer": "C-ANNO-LEVL"})
        msp.add_line((x, y - m), (x, y + m), dxfattribs={"layer": "C-ANNO-LEVL"})

    # dimensions
    for d in model.dims:
        dist = _signed_distance(d.p1, d.p2, d.side, d.offset_mm * k)
        dim = msp.add_aligned_dim(p1=d.p1, p2=d.p2, distance=dist, text=d.text, dimstyle="JCE",
                                  dxfattribs={"layer": "C-ANNO-DIMS"})
        dim.render()
    if model.radius_dim is not None:
        rd = model.radius_dim
        dim = msp.add_radius_dim(center=rd.centre, radius=rd.radius, angle=rd.angle_deg, text=rd.text,
                                 dimstyle="JCE", dxfattribs={"layer": "C-ANNO-DIMS"})
        dim.render()

    # annotations
    for a in aset.drawn:
        t = msp.add_text(a.content, height=a.height_m, rotation=a.rotation_deg,
                         dxfattribs={"layer": a.layer, "style": "JCE"})
        t.set_placement((a.x, a.y), align=TextEntityAlignment[a.attachment])


def _render_prims(layout, prims: list[Prim]) -> None:
    for p in prims:
        if isinstance(p, Line):
            at = {"layer": p.layer}
            if p.lw:
                at["lineweight"] = int(round(p.lw * 100))
            layout.add_line((p.x1, p.y1), (p.x2, p.y2), dxfattribs=at)
        elif isinstance(p, Poly):
            at = {"layer": p.layer}
            if p.lw:
                at["lineweight"] = int(round(p.lw * 100))
            layout.add_lwpolyline(p.pts, close=p.closed, dxfattribs=at)
            if p.fill:
                h = layout.add_hatch(dxfattribs={"layer": p.layer})
                h.set_solid_fill()
                h.paths.add_polyline_path(p.pts, is_closed=True)
        elif isinstance(p, Circle):
            layout.add_circle((p.x, p.y), p.r, dxfattribs={"layer": p.layer})
        elif isinstance(p, Text):
            t = layout.add_text(p.text, height=p.h, dxfattribs={"layer": p.layer, "style": "JCE_BOLD" if p.bold else "JCE",
                                                                  "color": 8 if p.grey else 256})
            t.set_placement((p.x, p.y), align=TextEntityAlignment[p.anchor])


def _draw_paper(doc: Drawing, model: PlanModel, fit: FitResult, acks: list[AckKind]) -> None:
    doc.layouts.rename("Layout1", LAYOUT_NAME)
    layout = doc.layout(LAYOUT_NAME)
    layout.page_setup(size=(SHEET_W, SHEET_H), margins=(0, 0, 0, 0), units="mm", scale=16,
                      name="ISO_A3_(420.00_x_297.00_MM)")
    vw, vh = viewport_size()
    cx, cy = (VIEWPORT[0] + VIEWPORT[2]) / 2, (VIEWPORT[1] + VIEWPORT[3]) / 2
    layout.add_lwpolyline([(FRAME[0], FRAME[1]), (FRAME[2], FRAME[1]), (FRAME[2], FRAME[3]), (FRAME[0], FRAME[3])],
                          close=True, dxfattribs={"layer": "C-ANNO-TTLB", "lineweight": 50})
    vp = layout.add_viewport(center=(cx, cy), size=(vw, vh), view_center_point=fit.centre,
                             view_height=vh * model.scale / 1000.0, status=1,
                             dxfattribs={"layer": "C-ANNO-VPRT"})
    _render_prims(layout, build_panel(model, model.scale, acks, fit, model.issue_date))
    doc.layouts.set_active_layout(LAYOUT_NAME)


def _attach_basemap(doc: Drawing, model: PlanModel, dxf_path) -> None:
    """Optional georeferenced IMAGE entity (lower-left insert, metres per pixel from extent)."""
    req = model.request
    img, ext = getattr(req, "basemap_image_path", None), getattr(req, "basemap_extent", None)
    if not img or not ext or not Path(img).exists():
        return
    from PIL import Image
    w, h = Image.open(img).size
    if "C-AERIAL" not in doc.layers:
        doc.layers.add("C-AERIAL", color=8)
    idef = doc.add_image_def(filename=str(img), size_in_pixel=(w, h))
    doc.modelspace().add_image(idef, insert=(ext[0], ext[1]), size_in_units=(ext[2] - ext[0], ext[3] - ext[1]),
                               rotation=0, dxfattribs={"layer": "C-AERIAL"})


def build_dxf(model: PlanModel, aset: AnnotationSet, fit: FitResult, acks: list[AckKind],
              path: str | Path | None = None) -> DxfBuild:
    doc = ezdxf.new("R2018", setup=True, units=6)
    _setup_styles(doc, model.scale)
    ensure_layers(doc)
    _attach_basemap(doc, model, path)
    _draw_model(doc, model, aset)
    _draw_paper(doc, model, fit, acks)
    ext = (fit.centre[0], fit.centre[1])
    doc.set_modelspace_vport(height=vh_model(fit, model), center=ext)

    msp = doc.modelspace()
    counts = Counter(e.dxftype() for e in msp)
    layers = {e.dxf.layer for e in msp}
    layers |= {e.dxf.layer for e in doc.layout(LAYOUT_NAME)}
    layers.discard("0")
    ordered = [l for l in LAYER_BY_NAME if l in layers]
    if path is not None:
        doc.saveas(str(path))
    return DxfBuild(doc, ordered, dict(counts))


def vh_model(fit: FitResult, model: PlanModel) -> float:
    return fit.available_mm[1] * model.scale / 1000.0
