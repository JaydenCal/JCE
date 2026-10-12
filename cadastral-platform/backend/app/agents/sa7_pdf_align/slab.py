"""SA7 step 5: candidate slab / footprint polygons on the architect's PDF.

Pipeline (deterministic, no LLM):
  1. reduce all strokes to segments (with stroke width);
  2. polygonise the line work with shapely (unary_union + polygonize) once per
     stroke-width tier (heaviest strokes only, then progressively more), plus a
     gap-closing pass for dashed work and the union of adjacent hole-free rooms;
  3. drop sheet frames, title blocks and tiny regions;
  4. rank by stroke weight of the outline, nearby garage/porch/alfresco text, plausible
     size, containment inside a larger region (the lot) and compactness;
  5. when the winning confidence is below 0.85 an OPTIONAL `ClassifierHook` may be
     consulted. The default is None: this module never calls an LLM itself.

A second product is the *boundary polygon* (the site-plan lot boundary drawn on the
PDF) that align.py matches to the surveyed lot.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Protocol, Sequence, runtime_checkable

import numpy as np
import shapely
from shapely.geometry import LineString, Polygon
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree

from .pdf_extract import PageContent, Pt

HOOK_THRESHOLD = 0.85

_KW_STRONG = re.compile(r"\b(garage|porch|alfresco|portico|carport|patio|verandah|veranda|slab|deck|terrace|entry)\b", re.I)
_KW_WEAK = re.compile(r"\b(dwelling|residence|house|ground\s*floor|gf|living|kitchen|bed(room)?|laundry|bath(room)?|fpl)\b", re.I)
_KW_BOUNDARY = re.compile(r"\b(boundary|lot|dp|lp|site\s*area|site\s*boundary|p\.?o\.?b|title\s*boundary)\b", re.I)
_KW_ENVELOPE = re.compile(r"\b(setback|envelope|building\s*line|bal|easement|zone)\b", re.I)
_KW_TITLE = re.compile(r"\b(drawn|checked|revision|project|client|drawing\s*no|sheet|date|architect|designer|issue)\b", re.I)


# --------------------------------------------------------------------------
# Public types
# --------------------------------------------------------------------------

@dataclass
class SlabCandidate:
    id: int
    polygon: Polygon                       # PDF points, bottom-left origin
    source: str
    area_pt2: float
    area_m2: float | None
    stroke_width_pt: float
    keywords: list[str] = field(default_factory=list)
    boundary_hits: int = 0
    heavy_score: float = 0.0
    keyword_score: float = 0.0
    size_score: float = 0.0
    contained_score: float = 0.0
    compact_score: float = 0.0
    score: float = 0.0

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        return tuple(round(v, 2) for v in self.polygon.bounds)  # type: ignore[return-value]


@dataclass(frozen=True)
class CandidateSummary:
    """Compact view of a candidate handed to a ClassifierHook (small JSON-able record)."""
    id: int
    area_pt2: float
    area_m2: float | None
    bbox: tuple[float, float, float, float]
    stroke_width_pt: float
    keywords: tuple[str, ...]
    score: float


@dataclass(frozen=True)
class HookDecision:
    chosen_id: int
    confidence: float
    rationale: str = ""


@runtime_checkable
class ClassifierHook(Protocol):
    """Optional ambiguity resolver, consulted only when heuristic confidence < 0.85.
    Return None to abstain. Implementations may call a model; this module does not."""

    def __call__(self, candidates: Sequence[CandidateSummary]) -> HookDecision | None: ...


@dataclass
class SlabResult:
    best: SlabCandidate | None
    alternatives: list[SlabCandidate]
    confidence: float
    boundary: Polygon | None
    boundary_confidence: float = 0.0
    classified_by_hook: bool = False
    messages: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------
# Geometry helpers
# --------------------------------------------------------------------------

def _clean(poly: Polygon) -> Polygon | None:
    if poly.is_empty:
        return None
    if not poly.is_valid:
        poly = poly.buffer(0)
        if poly.is_empty or poly.geom_type != "Polygon":
            if poly.geom_type == "MultiPolygon":
                poly = max(poly.geoms, key=lambda g: g.area)
            else:
                return None
    p = Polygon(poly.exterior)                 # fill holes: we want the outline
    p = p.simplify(0.02, preserve_topology=True)
    if p.is_empty or p.geom_type != "Polygon" or p.area <= 0:
        return None
    return p


def _iou(a: Polygon, b: Polygon) -> float:
    if not a.intersects(b):
        return 0.0
    inter = a.intersection(b).area
    union = a.area + b.area - inter
    return inter / union if union > 0 else 0.0


def _polygonise(segs: Sequence[tuple[Pt, Pt, float]]) -> list[Polygon]:
    if len(segs) < 3:
        return []
    lines = [LineString([a, b]) for a, b, _ in segs]
    noded = unary_union(lines)
    return list(polygonize(noded))


def _close_gaps(segs: Sequence[tuple[Pt, Pt, float]], tol: float = 2.5) -> list[Polygon]:
    """Regions enclosed by line work that has small gaps (dashes). Buffer the lines,
    take the holes, grow them back by the same amount (mitred, so rectangles stay exact)."""
    if len(segs) < 3 or len(segs) > 8000:
        return []
    buf = unary_union([LineString([a, b]).buffer(tol, cap_style=2, join_style=2) for a, b, _ in segs])
    geoms = list(buf.geoms) if buf.geom_type == "MultiPolygon" else [buf]
    out: list[Polygon] = []
    for g in geoms:
        for ring in g.interiors:
            hole = Polygon(ring)
            if hole.area < 4 * tol * tol:
                continue
            grown = hole.buffer(tol, join_style=2, mitre_limit=5.0)
            if grown.geom_type == "Polygon":
                out.append(grown)
    return out


def _weighted_median(values: Sequence[float], weights: Sequence[float]) -> float:
    if not values:
        return 0.0
    order = np.argsort(values)
    v = np.asarray(values, float)[order]
    w = np.asarray(weights, float)[order]
    c = np.cumsum(w)
    return float(v[int(np.searchsorted(c, c[-1] / 2.0))])


def clean_ring(poly: Polygon, tol: float = 0.05) -> list[Pt]:
    """Exterior vertices without the closing duplicate and without collinear points."""
    p = poly.simplify(tol, preserve_topology=True)
    coords = list(p.exterior.coords)[:-1]
    return [(float(x), float(y)) for x, y in coords]


# --------------------------------------------------------------------------
# Candidate generation
# --------------------------------------------------------------------------

def _generate(content: PageContent, segs: list[tuple[Pt, Pt, float]], ref_width: float) -> list[tuple[Polygon, str]]:
    found: list[tuple[Polygon, str]] = []
    widths = sorted({round(w, 2) for _, _, w in segs if w > 0}, reverse=True)
    heavy_thr = [w for w in widths if w >= 1.2 * ref_width][:3]
    tiers: list[tuple[float, str]] = [(w, f"tier>={w:g}") for w in heavy_thr] + [(0.0, "all_lines")]
    for thr, name in tiers:
        sub = [s for s in segs if s[2] >= thr - 1e-6]
        faces = _polygonise(sub)
        for f in faces:
            found.append((f, name))
        for f in _close_gaps(sub):
            found.append((f, name + "+gapclose"))
        if name == "all_lines":
            rooms = [f for f in faces if not list(f.interiors)]
            if len(rooms) >= 2:
                merged = unary_union([r.buffer(1e-6, join_style=2) for r in rooms])
                comps = list(merged.geoms) if merged.geom_type == "MultiPolygon" else [merged]
                for c in comps:
                    found.append((c.buffer(-1e-6, join_style=2), "rooms_union"))
    for rp in content.raster_polygons:
        if len(rp.points) >= 3:
            found.append((Polygon(rp.points), "raster"))
    return found


def _plausible_size_score(area_m2: float) -> float:
    if area_m2 < 15:
        return 0.0
    if area_m2 < 60:
        return (area_m2 - 15) / 45.0
    if area_m2 <= 450:
        return 1.0
    if area_m2 <= 1500:
        return max(0.0, 1.0 - (area_m2 - 450) / 1050.0)
    return 0.0


# --------------------------------------------------------------------------
# Main entry
# --------------------------------------------------------------------------

def find_slab(content: PageContent, metres_per_point: float | None = None, *,
              hook: ClassifierHook | None = None, hook_threshold: float = HOOK_THRESHOLD,
              max_alternatives: int = 4) -> SlabResult:
    msgs: list[str] = []
    page_area = max(content.width_pt * content.height_pt, 1.0)
    segs = content.segments()
    if len(segs) > 150_000:
        segs = [s for s in segs if math.dist(s[0], s[1]) >= 2.0]
        msgs.append("Very dense line work: segments shorter than 2 pt ignored.")
    w_pos = [(w, math.dist(a, b)) for a, b, w in segs if w > 0]
    ref_width = _weighted_median([w for w, _ in w_pos], [l for _, l in w_pos]) if w_pos else 0.5
    ref_width = max(ref_width, 0.05)

    raw = _generate(content, segs, ref_width)
    mpp2 = (metres_per_point ** 2) if metres_per_point else None

    # texts as numpy arrays for fast containment
    tx = np.array([t.centre[0] for t in content.texts], float)
    ty = np.array([t.centre[1] for t in content.texts], float)

    cands: list[SlabCandidate] = []
    kept_polys: list[Polygon] = []
    min_area_pt2 = (15.0 / mpp2) if mpp2 else 0.002 * page_area
    for poly0, src in raw:
        poly = _clean(poly0)
        if poly is None:
            continue
        minx, miny, maxx, maxy = poly.bounds
        if (maxx - minx) >= 0.85 * content.width_pt and (maxy - miny) >= 0.85 * content.height_pt:
            continue                                   # sheet frame
        if poly.area > 0.6 * page_area or poly.area < min_area_pt2:
            continue
        if any(_iou(poly, q) > 0.95 for q in kept_polys if q.bounds[0] <= maxx and q.bounds[2] >= minx
               and q.bounds[1] <= maxy and q.bounds[3] >= miny):
            continue
        inside_txt = [content.texts[i].text for i in np.nonzero(shapely.contains_xy(poly, tx, ty))[0]] if len(tx) else []
        if len({m.group(0).lower() for t in inside_txt for m in _KW_TITLE.finditer(t)}) >= 2:
            continue                                   # title block
        kept_polys.append(poly)
        cands.append(SlabCandidate(
            id=len(cands), polygon=poly, source=src, area_pt2=poly.area,
            area_m2=(poly.area * mpp2) if mpp2 else None, stroke_width_pt=0.0))

    if not cands:
        return SlabResult(None, [], 0.0, None, messages=msgs + ["No closed regions found in the line work."])

    # ---- features ---------------------------------------------------------
    seg_geoms = [LineString([a, b]) for a, b, _ in segs]
    seg_w = np.array([w for _, _, w in segs], float)
    tree = STRtree(seg_geoms) if seg_geoms else None
    for c in cands:
        ring = c.polygon.exterior
        # stroke weight along the outline
        if tree is not None:
            zone = ring.buffer(max(0.8, 0.5 * ref_width))
            idx = tree.query(zone, predicate="intersects")
            tot = 0.0
            acc = 0.0
            for i in idx:
                ln = seg_geoms[i].intersection(zone).length
                tot += ln
                acc += ln * float(seg_w[i])
            c.stroke_width_pt = acc / tot if tot > 0 else 0.0
            coverage = min(1.0, tot / max(ring.length, 1e-9))
        else:
            coverage = 0.0
        if c.source == "raster":
            for rp in content.raster_polygons:
                c.stroke_width_pt = max(c.stroke_width_pt, rp.width)
            c.heavy_score = 0.0
        else:
            c.heavy_score = max(0.0, min(1.0, (c.stroke_width_pt / ref_width - 1.0) / 1.5)) * min(1.0, coverage * 1.2)
        # keyword proximity
        if len(tx):
            inside_idx = np.nonzero(shapely.contains_xy(c.polygon, tx, ty))[0]
            near_idx = np.nonzero(shapely.contains_xy(c.polygon.buffer(30.0), tx, ty))[0]
            near_only = set(near_idx.tolist()) - set(inside_idx.tolist())
        else:
            inside_idx, near_only = np.array([], int), set()
        hits_in = hits_near = 0.0
        kws: list[str] = []
        for i in inside_idx:
            t = content.texts[int(i)].text
            for m in _KW_STRONG.finditer(t):
                hits_in += 1.0
                kws.append(m.group(0).lower())
            hits_in += 0.3 * len(list(_KW_WEAK.finditer(t)))
            c.boundary_hits += len(list(_KW_BOUNDARY.finditer(t)))
        for i in near_only:
            t = content.texts[int(i)].text
            for m in _KW_STRONG.finditer(t):
                hits_near += 1.0
                kws.append(m.group(0).lower() + "~")
            c.boundary_hits += len(list(_KW_BOUNDARY.finditer(t)))
        c.keywords = sorted(set(kws))
        c.keyword_score = min(1.0, 0.6 * hits_in + 0.3 * hits_near)
        # size
        if c.area_m2 is not None:
            c.size_score = _plausible_size_score(c.area_m2)
        else:
            frac = c.area_pt2 / page_area
            c.size_score = 1.0 if 0.02 <= frac <= 0.25 else (frac / 0.02 if frac < 0.02 else max(0.0, 1 - (frac - 0.25) / 0.35))
        if c.boundary_hits:
            c.size_score *= 0.4
        # compactness against the minimum rotated rectangle
        mrr = c.polygon.minimum_rotated_rectangle
        c.compact_score = float(c.polygon.area / mrr.area) if mrr.area > 0 else 0.0

    # containment: sits inside a clearly larger region (the lot)
    prep_area = [(c, c.polygon.buffer(0.05)) for c in cands]
    for c in cands:
        for o, ob in prep_area:
            if o is c or o.area_pt2 < 1.25 * c.area_pt2:
                continue
            if ob.contains(c.polygon):
                c.contained_score = 1.0
                break

    # fragments: a region whose outline lies on a larger plausible region's outline is a
    # room inside that region, not the slab itself
    fragment: set[int] = set()
    for c in cands:
        zone = c.polygon.exterior.buffer(0.5)
        perim = max(c.polygon.exterior.length, 1e-9)
        for o in cands:
            if o is c or o.area_pt2 < 1.25 * c.area_pt2 or o.size_score < 0.5 or o.boundary_hits:
                continue
            if not o.polygon.buffer(0.05).contains(c.polygon):
                continue
            if zone.intersection(o.polygon.exterior).length >= 0.15 * perim:
                fragment.add(c.id)
                break

    for c in cands:
        c.score = round(0.28 * c.heavy_score + 0.28 * c.keyword_score + 0.20 * c.size_score
                        + 0.14 * c.contained_score + 0.10 * c.compact_score, 4)
        if c.id in fragment:
            c.score = round(c.score * 0.5, 4)

    ranked = sorted(cands, key=lambda c: (c.score, c.heavy_score, c.area_pt2), reverse=True)
    top = ranked[0]
    second = ranked[1].score if len(ranked) > 1 else 0.0
    margin = (top.score - second) / top.score if top.score > 0 else 0.0
    conf = 0.6 * min(1.0, top.score / 0.8) + 0.4 * min(1.0, margin / 0.4)
    conf = round(max(0.0, min(1.0, conf)), 3)

    # ---- optional classifier hook ---------------------------------------
    by_hook = False
    if conf < hook_threshold and hook is not None:
        summaries = [CandidateSummary(c.id, c.area_pt2, c.area_m2, c.bbox, round(c.stroke_width_pt, 3),
                                      tuple(c.keywords), c.score) for c in ranked[:6]]
        try:
            decision = hook(summaries)
        except Exception as exc:  # noqa: BLE001 - a hook failure must never break alignment
            decision = None
            msgs.append(f"Classifier hook failed ({type(exc).__name__}); heuristic ranking kept.")
        if decision is not None:
            chosen = next((c for c in ranked[:6] if c.id == decision.chosen_id), None)
            if chosen is not None and 0.0 <= decision.confidence <= 1.0:
                ranked = [chosen] + [c for c in ranked if c is not chosen]
                top = chosen
                conf = round(float(decision.confidence), 3)
                by_hook = True
                msgs.append(f"Slab chosen by classifier hook: {decision.rationale}".strip())
            else:
                msgs.append("Classifier hook returned an invalid candidate; heuristic ranking kept.")
    if conf < hook_threshold:
        msgs.append(f"Slab confidence {conf:.2f} is below {hook_threshold}; confirm the highlighted outline.")

    boundary, bconf = _pick_boundary(top, cands, content, mpp2, page_area)
    alternatives = [c for c in ranked[1:] if c.score >= 0.15][:max_alternatives]
    return SlabResult(top, alternatives, conf, boundary, bconf, by_hook, msgs)


def _pick_boundary(slab: SlabCandidate, cands: list[SlabCandidate], content: PageContent,
                   mpp2: float | None, page_area: float) -> tuple[Polygon | None, float]:
    best: tuple[float, SlabCandidate] | None = None
    for c in cands:
        if c is slab or c.area_pt2 < 1.25 * slab.area_pt2:
            continue
        if not c.polygon.buffer(0.05).contains(slab.polygon):
            continue
        if c.source == "rooms_union":
            continue
        s = 0.0
        s += 0.5 * min(1.0, c.boundary_hits * 0.6)
        if mpp2 is not None:
            m2 = c.area_pt2 * mpp2
            s += 0.3 * (1.0 if 150 <= m2 <= 2500 else (0.4 if m2 <= 5000 else 0.0))
        else:
            s += 0.3 * (1.0 if c.area_pt2 / page_area <= 0.5 else 0.3)
        envelope_kw = 0
        for t in content.texts:
            if c.polygon.buffer(10).contains(shapely.Point(*t.centre)) and _KW_ENVELOPE.search(t.text):
                envelope_kw += 1
        s += 0.2 * (0.0 if envelope_kw else 1.0)
        s += 0.05 * min(1.0, c.heavy_score)          # slight tie-break towards bolder lines
        s += 1e-9 * c.area_pt2
        if best is None or s > best[0]:
            best = (s, c)
    if best is None:
        return None, 0.0
    conf = max(0.0, min(1.0, best[0]))
    return best[1].polygon, round(conf, 3)
