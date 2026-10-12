"""Vector DBYD/BYDA response PDF -> georeferenced service assets (deterministic, no raster/LLM)."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

from shapely.geometry import LineString, Point, Polygon
from shapely import wkt as shp_wkt

from app.agents.base import AgentError
from app.agents.sa7_pdf_align import align as al
from app.agents.sa7_pdf_align import pdf_extract as px

from .models import Asset, DigitisedAsset, LegendEntry, default_legend

PT_M_PER_DEN = 0.0254 / 72.0
_DIA = [re.compile(r"(?:DN|Ø|ø)\s*(\d{2,4})\b", re.I), re.compile(r"\b(\d{2,4})\s*mm\b", re.I),
        re.compile(r"\b(\d{2,4})\s*dia\b", re.I)]
_DEPTH = [re.compile(r"(?:depth|dpth|cover)\s*[:=]?\s*(\d+(?:\.\d+)?)", re.I), re.compile(r"(\d+(?:\.\d+)?)\s*m\s*deep", re.I)]
_MAT = re.compile(r"\b(CICL|DICL|UPVC|PVC-?U|PVC|HDPE|MDPE|PE|AC|VC|FRC|RCP|CONC|STEEL|GRP|COPPER)\b", re.I)
_LEGEND_WORD = re.compile(r"water|sewer|sewage|storm|drain|electric|power|gas|telecom|comms|legend", re.I)


def _hex_to_rgb(h: str) -> tuple[int, int, int]:
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def classify(rgb: str | None, dashed: bool, legend: list[LegendEntry]) -> str | None:
    if not rgb or len(rgb) != 6:
        return None
    c = _hex_to_rgb(rgb)
    best, bd = None, 1e9
    for e in legend:
        d = math.dist(c, _hex_to_rgb(e.rgb))
        if d <= e.colour_tol and (e.dashed is None or e.dashed == dashed) and d < bd:
            best, bd = e.service, d
    return best


def parse_attrs(text: str) -> dict:
    out: dict = {}
    for rx in _DIA:
        m = rx.search(text)
        if m:
            out["diameter_mm"] = int(m.group(1))
            break
    for rx in _DEPTH:
        m = rx.search(text)
        if m:
            out["depth_m"] = float(m.group(1))
            break
    m = _MAT.search(text)
    if m:
        out["material"] = m.group(1).upper()
    return out


def _chain(segs: list[tuple[tuple, tuple]], eps: float = 0.6) -> list[list[tuple]]:
    lines: list[list[tuple]] = []
    for p, q in segs:
        for ln in lines:
            for end in (0, -1):
                if math.dist(ln[end], p) <= eps:
                    (ln.append(q) if end == -1 else ln.insert(0, q))
                    break
                if math.dist(ln[end], q) <= eps:
                    (ln.append(p) if end == -1 else ln.insert(0, p))
                    break
            else:
                continue
            break
        else:
            lines.append([p, q])
    return lines


@dataclass
class Georef:
    sim: al.Similarity
    rmse_m: float
    max_residual_m: float
    outcome: str
    n_points: int
    messages: list[str]


def _paper_boundary(pc: px.PageContent, boundary_rgb: str | None) -> list | None:
    cands = []
    for r in pc.rects:
        if r.stroked and (boundary_rgb is None or r.rgb == boundary_rgb):
            cands.append(r.corners())
    for c in pc.curves:
        if c.closed and (boundary_rgb is None or c.rgb == boundary_rgb):
            cands.append(list(c.points))
    if boundary_rgb:
        segs = [((l.p0), (l.p1)) for l in pc.lines if l.rgb == boundary_rgb]
        for ch in _chain(segs):
            if len(ch) >= 4 and math.dist(ch[0], ch[-1]) < 0.6:
                cands.append(ch[:-1])
    cands = [c for c in cands if len(c) >= 3 and Polygon(c).is_valid]
    return max(cands, key=lambda c: Polygon(c).area) if cands else None


def georeference(pc: px.PageContent, *, control_points, scale_denominator, lot_ring, boundary_rgb) -> Georef:
    mpp = scale_denominator * PT_M_PER_DEN if scale_denominator else None
    if control_points:
        pts = [al.ControlPoint(f"cp{i}", tuple(p), tuple(q)) for i, (p, q) in enumerate(control_points)]
        res = al.align(pts, mpp or 1.0, mode="locked" if mpp else "free")
    else:
        if not (mpp and lot_ring):
            raise AgentError("DBYD_GEOREF_FAILED", "supply control points, or a scale denominator plus lot boundary")
        ring = _paper_boundary(pc, boundary_rgb)
        if ring is None:
            raise AgentError("DBYD_GEOREF_FAILED", "no lot boundary found on the PDF; supply control points")
        m = al.propose_control_points(ring, list(lot_ring), mpp)
        if m is None:
            raise AgentError("DBYD_GEOREF_FAILED", "lot boundary on the PDF could not be matched to the cadastre")
        res = al.align(m.points, mpp, mode="locked")
        res.messages += m.messages + (["boundary match is ambiguous"] if m.ambiguous else [])
        if m.ambiguous and res.outcome == "accepted_unverified":
            res.outcome = "needs_user_confirmation"
    if res.outcome == "refused" or res.sim is None:
        raise AgentError("DBYD_GEOREF_FAILED", "; ".join(res.messages) or "alignment refused")
    return Georef(res.sim, res.rmse_m, res.max_residual_m, res.outcome, res.control_point_count, list(res.messages))


def parse_dbyd(pdf_bytes: bytes, *, page: int = 1, legend: list[LegendEntry] | None = None, control_points=(),
               scale_denominator: float | None = None, lot_ring=None, boundary_rgb: str | None = None,
               tolerance_m: float = 1.0, text_radius_pt: float = 60.0, legend_max_len_pt: float = 40.0,
               ) -> tuple[list[Asset], Georef]:
    legend = legend or default_legend()
    try:
        pc = px.extract_page(pdf_bytes, page)
    except px.PdfReadError as exc:
        raise AgentError("DBYD_PDF_UNREADABLE", str(exc)) from exc
    if pc.content_class == "raster" or pc.n_vector_objects == 0:
        raise AgentError("DBYD_RASTER_UNSUPPORTED", "digitise manually")

    by_service: dict[str, list] = {}
    strokes = [(l.p0, l.p1, l.rgb, l.dashed) for l in pc.lines]
    for c in pc.curves:
        strokes += [(a, b, c.rgb, c.dashed) for a, b in zip(c.points[:-1], c.points[1:])]
    for p0, p1, rgb, dashed in strokes:
        if rgb == boundary_rgb and boundary_rgb:
            continue
        s = classify(rgb, dashed, legend)
        if s:
            by_service.setdefault(s, []).append((p0, p1))
    legend_txt = [t for t in pc.texts if _LEGEND_WORD.search(t.text)]
    polys: list[tuple[str, list]] = []
    for s, segs in by_service.items():
        for ch in _chain(segs):
            ls = LineString(ch)
            if ls.length <= legend_max_len_pt and any(
                    min(ls.distance(Point(t.x0, t.centre[1])), ls.distance(Point(t.x1, t.centre[1]))) <= 60 for t in legend_txt):
                continue
            polys.append((s, ch))
    if not polys:
        raise AgentError("DBYD_NO_ASSETS", "no legend-coloured vector lines found; check legend map or digitise manually")

    geo = georeference(pc, control_points=control_points, scale_denominator=scale_denominator,
                       lot_ring=lot_ring, boundary_rgb=boundary_rgb)
    # attribute assignment: each text goes to its nearest line within radius
    attrs: list[dict] = [{} for _ in polys]
    near: list[dict] = [{} for _ in polys]
    lss = [LineString(ch) for _, ch in polys]
    for t in pc.texts:
        a = parse_attrs(t.text)
        if not a:
            continue
        cpt = Point(t.centre)
        i = min(range(len(lss)), key=lambda k: lss[k].distance(cpt))
        d = lss[i].distance(cpt)
        if d > text_radius_pt:
            continue
        for k, v in a.items():
            if k not in attrs[i] or d < near[i][k]:
                attrs[i][k], near[i][k] = v, d
    out: list[Asset] = []
    for (s, ch), at in zip(polys, attrs):
        xy = geo.sim.apply(__import__("numpy").array(ch))
        conf = 0.5 + 0.15 * ("diameter_mm" in at) + 0.1 * ("material" in at) + 0.1 * ("depth_m" in at)
        if geo.outcome != "accepted_unverified" or geo.rmse_m > 1.0:
            conf *= 0.6
        out.append(Asset(service=s, label=f"{s} (DBYD)", geometry_wkt=LineString(xy.tolist()).wkt,
                         diameter_mm=at.get("diameter_mm"), material=at.get("material"), depth_m=at.get("depth_m"),
                         depth_basis="plan_indicated" if "depth_m" in at else "unknown",
                         position_tolerance_m=tolerance_m, extraction_method="dbyd_pdf_vector",
                         extraction_confidence=round(min(conf, 0.95), 3)))
    return out, geo


def assets_from_digitised(items: list[DigitisedAsset], tolerance_m: float = 1.0) -> list[Asset]:
    return [Asset(service=d.service, label=d.label or f"{d.service} (digitised)", geometry_wkt=LineString(d.coords).wkt,
                  diameter_mm=d.diameter_mm, material=d.material, depth_m=d.depth_m,
                  depth_basis="plan_indicated" if d.depth_m is not None else "unknown",
                  position_tolerance_m=d.tolerance_m or tolerance_m, extraction_method="user_digitised",
                  extraction_confidence=0.5) for d in items]
