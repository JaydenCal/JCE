"""DXF (R2018): geometry in model space (MGA metres, deduplicated), one paper-space layout per sheet with viewports; text and
symbols in paper space; text style 'ARIAL NARROW' (arialn.ttf); vectorised logo on C-ANNO-LOGO (self-contained)."""
from __future__ import annotations

import math
from pathlib import Path

import ezdxf
from ezdxf import colors as ec
from ezdxf.enums import TextEntityAlignment

from app.agents.sa5_cad_dxf.layers import pdf_rgb
from app.agents.sa5_cad_dxf.planset import fonts
from app.agents.sa5_cad_dxf.planset.core import A3, Item, Sheet, View
from app.agents.sa5_cad_dxf.planset.layers_ext import all_layers, layer as layer_def

VALID_LW = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211]
ALIGN = {f"{v}_{h}": getattr(TextEntityAlignment, f"{v}_{h}") for v in ("TOP", "MIDDLE", "BOTTOM") for h in ("LEFT", "CENTER", "RIGHT")}


def _lw(mm_: float | None) -> int | None:
    if mm_ is None:
        return None
    k = mm_ * 100
    return min(VALID_LW[1:], key=lambda v: abs(v - k))


def _attribs(it: Item, extra: dict | None = None) -> dict:
    a = {"layer": it.layer}
    if it.lw is not None:
        a["lineweight"] = _lw(it.lw)
    if it.dash:
        a["linetype"] = it.dash
    if it.color is not None:
        a["true_color"] = ec.rgb2int(tuple(int(round(x * 255)) for x in it.color))
    if extra:
        a.update(extra)
    return a


def _setup(doc) -> None:
    fonts.info()
    doc.styles.add(fonts.DXF_STYLE, font=fonts.DXF_FONT_FILE) if fonts.DXF_STYLE not in doc.styles else None
    st = doc.styles.get(fonts.DXF_STYLE)
    st.dxf.font = fonts.DXF_FONT_FILE
    doc.header["$INSUNITS"] = 6
    doc.header["$LTSCALE"] = 2.5
    doc.header["$PSLTSCALE"] = 1
    doc.header["$TEXTSTYLE"] = fonts.DXF_STYLE
    for l in all_layers():
        if l.name in doc.layers:
            continue
        lay = doc.layers.add(l.name, color=l.aci, linetype=l.linetype if l.linetype in doc.linetypes else "CONTINUOUS", lineweight=_lw(l.lineweight_mm) or 18)
        lay.description = l.description
        lay.dxf.plot = 1 if l.plot else 0


def render_dxf(sheets: list[tuple[Sheet, list[View]]], path: str | Path) -> dict:
    doc = ezdxf.new("R2018", setup=True)
    _setup(doc)
    msp = doc.modelspace()
    seen: set = set()
    stats = {"model_entities": 0, "layouts": 0}
    for name in list(doc.layout_names()):
        if name.lower().startswith("layout"):
            doc.layouts.delete(name)
    for sh, views in sheets:
        lay = doc.layouts.new(sh.number)
        lay.page_setup(size=A3, margins=(0, 0, 0, 0), units="mm", scale=(1, 1), name="ISO_A3_(420.00_x_297.00_MM)", device="DWG To PDF.pc3")
        stats["layouts"] += 1
        used_by_view: list[tuple[View, set]] = []
        for v in views:
            layers_geo: set = set()
            for it in v.items:
                if v.paper or it.anno:
                    _emit_paper(lay, v, it)
                else:
                    layers_geo.add(it.layer)
                    stats["model_entities"] += _emit_model(msp, doc, v, it, seen)
            if not v.paper:
                used_by_view.append((v, layers_geo))
        all_names = [l.name for l in doc.layers]
        for v, used in used_by_view:
            r = v.rect
            vp = lay.add_viewport(center=((r[0] + r[2]) / 2, (r[1] + r[3]) / 2), size=(r[2] - r[0], r[3] - r[1]),
                                  view_center_point=v.centre, view_height=(r[3] - r[1]) * v.scale / 1000.0)
            vp.dxf.layer = "C-ANNO-VPRT"
            vp.dxf.status = 1
            vp.frozen_layers = [n for n in all_names if n not in used and n != "0" and n != "Defpoints"]
    doc.saveas(str(path))
    aud = doc.audit()
    stats["audit_errors"] = len(aud.errors)
    return stats


def _emit_paper(lay, v: View, it: Item) -> None:
    T = v.tp
    if it.kind == "line":
        pts = [T(x, y) for x, y in it.pts]
        e = lay.add_lwpolyline(pts, close=it.closed, dxfattribs=_attribs(it))
    elif it.kind == "fill":
        _hatch(lay, [[T(x, y) for x, y in r] for r in it.pts], it, 1.0)
    elif it.kind == "text":
        x, y = T(*it.pts[0])
        a = _attribs(it, {"style": fonts.DXF_STYLE, "height": it.h, "rotation": it.rot})
        a.pop("lineweight", None)
        a.pop("linetype", None)
        e = lay.add_text(it.text, dxfattribs=a)
        e.set_placement((x, y), align=ALIGN[it.anchor])


def _hatch(lay, rings, it: Item, pat_scale: float) -> None:
    a = {"layer": it.layer}
    col = it.color if it.color is not None else pdf_rgb(layer_def(it.layer).aci)
    h = lay.add_hatch(dxfattribs=a)
    h.rgb = tuple(int(round(x * 255)) for x in col)
    for i, r in enumerate(rings):
        h.paths.add_polyline_path(r, is_closed=True, flags=(1 if i == 0 else 16))
    if it.hatch is not None:
        ang, sp = it.hatch
        h.set_pattern_fill("ANSI31", scale=max(sp / 3.175 * pat_scale, 1e-4), angle=ang)
    elif it.alpha < 1.0:
        h.transparency = 1.0 - it.alpha


def _emit_model(msp, doc, v: View, it: Item, seen: set) -> int:
    if it.kind == "line":
        key = ("l", it.layer, tuple((round(x, 3), round(y, 3)) for x, y in it.pts), it.closed, it.lw, it.dash)
        if key in seen:
            return 0
        seen.add(key)
        msp.add_lwpolyline(it.pts, close=it.closed, dxfattribs=_attribs(it))
        return 1
    if it.kind == "fill":
        key = ("f", it.layer, tuple((round(x, 3), round(y, 3)) for x, y in it.pts[0]), it.hatch, v.scale)
        if key in seen:
            return 0
        seen.add(key)
        _hatch(msp, it.pts, it, v.scale / 1000.0)
        return 1
    if it.kind == "image":
        key = ("i", it.image)
        if key in seen:
            return 0
        seen.add(key)
        x0, y0, x1, y1 = it.extent
        from PIL import Image
        w, h = Image.open(it.image).size
        d = doc.add_image_def(filename=Path(it.image).name, size_in_pixel=(w, h))
        im = msp.add_image(d, insert=(x0, y0), size_in_units=(x1 - x0, y1 - y0), rotation=0, dxfattribs={"layer": it.layer})
        im.dxf.fade = int(min(100, max(0, it.fade * 100)))
        return 1
    return 0
