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
from app.agents.sa5_cad_dxf.planset import style as _ref_style
from app.agents.sa5_cad_dxf.planset.core import A1, A3, CUSTOM_DASH, Item, Sheet, View
from app.agents.sa5_cad_dxf.planset.codes import VIEWPORT_LAYER
from app.agents.sa5_cad_dxf.planset.layers_ext import REF_LAYER_NAMES, all_layers, layer as layer_def

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


def ar_conc_density(lines) -> float:
    """Marks per unit area of a hatch pattern's line families (dots and dashes counted once per period)."""
    d = 0.0
    for l in lines:
        items = [abs(x) for x in l.dash_length_items] or [0.0]
        period = sum(items)
        marks = sum(1 for x in l.dash_length_items if x >= 0) or 1
        a = math.radians(l.angle)
        perp = abs(-math.sin(a) * l.offset.x + math.cos(a) * l.offset.y)
        if period > 1e-9 and perp > 1e-9:
            d += marks / (period * perp)
    return d


def ar_conc_scale() -> float | None:
    """Hatch scale (paper mm) at which the AR-CONC pattern has the same mark density as the PDF stipple (one mark per stipple_spacing_mm squared)."""
    try:
        d = ezdxf.new("R2018").modelspace().add_hatch()
        d.set_pattern_fill("AR-CONC", scale=1.0)
        d1 = ar_conc_density(d.pattern.lines)
        return math.sqrt(d1 * _ref_style.REF.stipple_spacing_mm ** 2) if d1 > 0 else None
    except Exception:  # noqa: BLE001
        return None


def _setup(doc, used_layers: set | None = None, used_dashes: set | None = None, only_used: bool = False) -> None:
    fonts.info()
    doc.styles.add(fonts.DXF_STYLE, font=fonts.DXF_FONT_FILE) if fonts.DXF_STYLE not in doc.styles else None
    st = doc.styles.get(fonts.DXF_STYLE)
    st.dxf.font = fonts.DXF_FONT_FILE
    doc.header["$INSUNITS"] = 6
    doc.header["$LTSCALE"] = 2.5
    doc.header["$PSLTSCALE"] = 1
    doc.header["$TEXTSTYLE"] = fonts.DXF_STYLE
    for name, pat in CUSTOM_DASH.items():            # reference-style dashes: pattern lengths are paper mm, divided by $LTSCALE
        if name == _ref_style.DASH_BDY and name not in (used_dashes or set()):
            continue                                  # registered only when used, so a legacy DXF keeps its baseline linetype list
        if name not in doc.linetypes:
            doc.linetypes.add(name, pattern=[sum(abs(p) for p in pat) / 2.5] + [p / 2.5 for p in pat], description=f"{name} dash (paper mm)")
    for l in all_layers():
        if l.name in doc.layers or ((only_used or l.name in REF_LAYER_NAMES) and l.name not in (used_layers or set())):
            continue                                  # reference-style layers are registered only when used
        lay = doc.layers.add(l.name, color=l.aci, linetype=l.linetype if l.linetype in doc.linetypes else "CONTINUOUS", lineweight=_lw(l.lineweight_mm) or 18)
        lay.description = l.description
        lay.dxf.plot = 1 if l.plot else 0


def render_dxf(sheets: list[tuple[Sheet, list[View]]], path: str | Path) -> dict:
    doc = ezdxf.new("R2018", setup=True)
    ref_paper = any(tuple(sh.paper) != tuple(A3) for sh, _v in sheets)          # reference (A1) style: JCESITE viewport layer, registered only then
    _setup(doc, {it.layer for _s, vs in sheets for v in vs for it in v.items} | ({VIEWPORT_LAYER} if ref_paper else set()), {it.dash for _s, vs in sheets for v in vs for it in v.items if it.dash}, ref_paper)
    msp = doc.modelspace()
    seen: set = set()
    stats = {"model_entities": 0, "layouts": 0}
    for sh, views in sheets:
        lay = doc.layouts.new(sh.number)
        pw, ph = sh.paper
        nm = ("ISO_A3_(420.00_x_297.00_MM)" if tuple(sh.paper) == tuple(A3) else
              (f"ISO_A1_({pw:.2f}_x_{ph:.2f}_MM)" if tuple(sh.paper) == tuple(A1) else f"CUSTOM_({pw:.2f}_x_{ph:.2f}_MM)"))
        lay.page_setup(size=(pw, ph), margins=(0, 0, 0, 0), units="mm", scale=(1, 1), name=nm, device="DWG To PDF.pc3")
        stats["layouts"] += 1
        used_by_view: list[tuple[View, set]] = []
        vp_of: dict = {}
        if tuple(sh.paper) != tuple(A3):
            for _vp0 in lay.viewports():                 # ezdxf's own paper-space viewport sits on layer VIEWPORTS: move it onto the JCS viewport layer
                if _vp0.dxf.layer == "VIEWPORTS":
                    _vp0.dxf.layer = VIEWPORT_LAYER
        if tuple(sh.paper) != tuple(A3):               # reference style: viewports first so paper-space annotation (dimensions, call-outs) draws over the model
            for v in views:
                if not v.paper:
                    vp_of[id(v)] = _add_viewport(lay, v, VIEWPORT_LAYER)
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
        all_names = [l.dxf.name for l in doc.layers]
        for v, used in used_by_view:
            vp = vp_of.get(id(v)) or _add_viewport(lay, v, VIEWPORT_LAYER if tuple(sh.paper) != tuple(A3) else "C-ANNO-VPRT")
            vp.frozen_layers = [n for n in all_names if n not in used and n != "0" and n != "Defpoints"]
    for name in list(doc.layout_names()):
        if name.lower().startswith("layout"):
            try:
                doc.layouts.delete(name)
            except Exception:  # noqa: BLE001
                pass
    doc.saveas(str(path))
    aud = doc.audit()
    stats["audit_errors"] = len(aud.errors)
    return stats


def dcs_centre(v: View) -> tuple[float, float]:
    """DXF group 12 (view centre) is in the DISPLAY coordinate system: the model point turned by the view twist about the target point (origin).
    The viewport maps a model point m to paper  centre + R(twist) (m - model_centre) k  (the same as View.tp); ezdxf's own matrix agrees."""
    a = math.radians(v.twist)
    return (v.centre[0] * math.cos(a) - v.centre[1] * math.sin(a), v.centre[0] * math.sin(a) + v.centre[1] * math.cos(a))


def _add_viewport(lay, v: View, layer: str = "C-ANNO-VPRT"):
    r = v.rect
    vp = lay.add_viewport(center=((r[0] + r[2]) / 2, (r[1] + r[3]) / 2), size=(r[2] - r[0], r[3] - r[1]),
                          view_center_point=dcs_centre(v) if v.twist else v.centre, view_height=(r[3] - r[1]) * v.scale / 1000.0)
    if v.twist:
        vp.dxf.view_twist_angle = round(v.twist % 360.0, 6)           # counter-clockwise rotation of the model drawing on the sheet (VIEWTWIST)
    vp.dxf.layer = layer
    vp.dxf.status = 1
    return vp


def _emit_paper(lay, v: View, it: Item) -> None:
    T = v.tp
    if it.kind == "line":
        pts = [T(x, y) for x, y in it.pts]
        e = lay.add_lwpolyline(pts, close=it.closed, dxfattribs=_attribs(it))
    elif it.kind == "fill":
        rings = [[T(x, y) for x, y in r] for r in it.pts]
        _hatch(lay, rings, it, 1.0)
        _edge(lay, rings, it)
    elif it.kind == "text":
        x, y = T(*it.pts[0])
        a = _attribs(it, {"style": fonts.DXF_STYLE, "height": it.h, "rotation": it.rot})
        a.pop("lineweight", None)
        a.pop("linetype", None)
        e = lay.add_text(it.text, dxfattribs=a)
        e.set_placement((x, y), align=ALIGN[it.anchor])


def _edge(lay, rings, it: Item) -> None:
    """Outline stroked around a fill (call-out boxes, concrete, building)."""
    if it.edge is None:
        return
    a = {"layer": it.layer, "lineweight": _lw(it.edge_lw or 0.254), "true_color": ec.rgb2int(tuple(int(round(x * 255)) for x in it.edge))}
    for r in rings:
        lay.add_lwpolyline(r, close=True, dxfattribs=a)


def _hatch(lay, rings, it: Item, pat_scale: float, twist: float = 0.0) -> None:
    """``twist``: model-space hatches sit under a twisted viewport, so the pattern angle is reduced by it to keep the paper angle."""
    a = {"layer": it.layer}
    col = it.color if it.color is not None else pdf_rgb(layer_def(it.layer).aci)
    h = lay.add_hatch(dxfattribs=a)
    h.rgb = tuple(int(round(x * 255)) for x in col)
    for i, r in enumerate(rings):
        h.paths.add_polyline_path(r, is_closed=True, flags=(1 if i == 0 else 16))
    if it.pattern == "AR-CONC":                    # grey base (above) with the black AR-CONC stipple on top of the same boundary
        h2 = lay.add_hatch(dxfattribs=a)
        h2.rgb = (0, 0, 0)
        for i, r in enumerate(rings):
            h2.paths.add_polyline_path(r, is_closed=True, flags=(1 if i == 0 else 16))
        try:
            sc = ar_conc_scale() or 1.0                 # calibrated so the mark density equals the PDF stipple (see ar_conc_scale)
            h2.set_pattern_fill("AR-CONC", scale=max(sc * pat_scale * ((it.stipple / _ref_style.REF.stipple_spacing_mm) if it.stipple else 1.0), 1e-5), angle=0.0)
        except Exception:  # noqa: BLE001
            lay.delete_entity(h2)
    elif it.hatch is not None:
        ang, sp = it.hatch
        h.set_pattern_fill("ANSI31", scale=max(sp / 3.175 * pat_scale, 1e-4), angle=((ang - 45.0) if it.pattern == "LINES" else ang) - twist)
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
        key = ("f", it.layer, tuple((round(x, 3), round(y, 3)) for x, y in it.pts[0]), it.hatch, v.scale, it.pattern, it.edge)
        if key in seen:
            return 0
        seen.add(key)
        _hatch(msp, it.pts, it, v.scale / 1000.0, v.twist)
        _edge(msp, it.pts, it)
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
