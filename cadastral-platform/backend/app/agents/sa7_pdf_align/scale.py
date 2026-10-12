"""SA7 step 3-4: drawing scale from title-block text, scale bar and dimension strings.

    metres_per_point  s = (25.4 / 72) / 1000 * N          (N = scale denominator)

Evidence is combined into a single denominator with a 0..1 confidence. No LLM is
used here; ambiguous cases lower the confidence so the orchestrator asks the user.
"""
from __future__ import annotations

import math
import re
import statistics
from dataclasses import dataclass, field
from typing import Literal, Sequence

from .pdf_extract import PageContent, TextSpan

METRES_PER_POINT_AT_1 = (25.4 / 72.0) / 1000.0

# ISO 216 sheets in PDF points (portrait, short x long).
PAPER_PT: dict[str, tuple[float, float]] = {
    "A0": (2383.94, 3370.39),
    "A1": (1683.78, 2383.94),
    "A2": (1190.55, 1683.78),
    "A3": (841.89, 1190.55),
    "A4": (595.28, 841.89),
}
STANDARD_DENOMINATORS = (1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500,
                         750, 1000, 1250, 1500, 2000, 2500, 5000, 10000)

PAPER_TOL = 0.02            # relative tolerance for matching a page to an ISO sheet
AGREE_TOL = 0.03            # two scale estimates "agree" within 3 %

ScaleSource = Literal["title_block_text", "scale_bar_measure", "dimension_string", "user_entered"]


def metres_per_point(denominator: float) -> float:
    return METRES_PER_POINT_AT_1 * float(denominator)


def denominator_from_mpp(mpp: float) -> float:
    return mpp / METRES_PER_POINT_AT_1


def snap_denominator(n: float, tol: float = AGREE_TOL) -> tuple[float, bool]:
    best = min(STANDARD_DENOMINATORS, key=lambda s: abs(s - n) / s)
    if abs(best - n) / best <= tol:
        return float(best), True
    return float(n), False


def detect_paper(width_pt: float, height_pt: float, tol: float = PAPER_TOL) -> str | None:
    short, long_ = sorted((width_pt, height_pt))
    for name, (ps, pl) in PAPER_PT.items():
        if abs(short - ps) / ps <= tol and abs(long_ - pl) / pl <= tol:
            return name
    return None


# --------------------------------------------------------------------------
# Result types
# --------------------------------------------------------------------------

@dataclass
class TitleScale:
    text: str
    denominator: float
    paper: str | None
    has_keyword: bool
    in_site_span: bool
    standard: bool


@dataclass
class DimensionEvidence:
    denominator: float | None
    support: int                  # dimension strings in the winning cluster
    total: int                    # dimension strings that matched a line at all
    samples: list[tuple[str, float, float]] = field(default_factory=list)  # (text, length_pt, implied N)


@dataclass
class ScaleResult:
    denominator: float | None
    source: ScaleSource | None
    confidence: float
    metres_per_point: float | None
    title_text: str | None = None
    title_denominator: float | None = None
    paper_stated: str | None = None
    paper_detected: str | None = None
    print_to_fit: bool = False
    print_fit_factor: float = 1.0
    bar_denominator: float | None = None
    dimension_denominator: float | None = None
    dimension_support: tuple[int, int] = (0, 0)
    messages: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------
# Title block
# --------------------------------------------------------------------------

_SCALE_RE = re.compile(r"(?<![\d:./])1\s*:\s*(\d{1,5}(?:\.\d+)?)(?![\d:])")
_PAPER_RE = re.compile(r"(?:@|\bAT\b|\bON\b|\(|\bSIZE\s*:?)\s*A\s?([0-4])\b", re.I)
_PAPER_LOOSE_RE = re.compile(r"\bA\s?([0-4])\b(?:\s*(?:SIZE|SHEET|PAPER))", re.I)


def parse_title_scales(texts: Sequence[TextSpan]) -> list[TitleScale]:
    out: list[TitleScale] = []
    for t in texts:
        up = t.text.upper()
        for m in _SCALE_RE.finditer(up):
            n = float(m.group(1))
            if n < 2 or n > 10000:
                continue
            tail = up[m.end():]
            pm = _PAPER_RE.search(tail[:24]) or _PAPER_RE.search(up) or _PAPER_LOOSE_RE.search(up)
            paper = f"A{pm.group(1)}" if pm else None
            out.append(TitleScale(
                text=t.text.strip(), denominator=n, paper=paper,
                has_keyword="SCALE" in up, in_site_span="SITE" in up,
                standard=any(abs(n - s) < 1e-9 for s in STANDARD_DENOMINATORS)))
    return out


def _stated_paper(cands: Sequence[TitleScale], texts: Sequence[TextSpan]) -> str | None:
    papers = {c.paper for c in cands if c.paper}
    if len(papers) == 1:
        return papers.pop()
    if not papers:
        found = set()
        for t in texts:
            m = _PAPER_RE.search(t.text.upper()) or _PAPER_LOOSE_RE.search(t.text.upper())
            if m:
                found.add(f"A{m.group(1)}")
        if len(found) == 1:
            return found.pop()
    return None


def _score_title(c: TitleScale) -> float:
    s = 0.6
    if c.has_keyword:
        s += 0.2
    if c.in_site_span:
        s += 0.1
    if c.standard:
        s += 0.05
    if c.paper:
        s += 0.05
    return s


# --------------------------------------------------------------------------
# Scale bar
# --------------------------------------------------------------------------

_NUM_RE = re.compile(r"^\d+(?:\.\d+)?$")


def measure_scale_bar(content: PageContent) -> float | None:
    """Denominator implied by a graphic scale bar: a row of ascending numeric labels
    starting at 0 (metres), evenly spaced, sitting on a horizontal line."""
    nums = []
    for t in content.texts:
        s = t.text.strip().lower().rstrip("m").strip()
        if _NUM_RE.match(s) and abs(t.angle_deg) < 1.0:
            nums.append((float(s), t))
    if len(nums) < 3:
        return None
    # group by baseline
    nums.sort(key=lambda p: p[1].centre[1])
    rows: list[list[tuple[float, TextSpan]]] = []
    for item in nums:
        y = item[1].centre[1]
        if rows and abs(rows[-1][0][1].centre[1] - y) <= max(2.0, 0.35 * max(item[1].size, 4.0)):
            rows[-1].append(item)
        else:
            rows.append([item])
    horiz = [(min(a[0], b[0]), max(a[0], b[0]), a[1]) for a, b, _w in content.segments()
             if abs(a[1] - b[1]) < 0.5 and abs(a[0] - b[0]) > 10]
    best: list[float] = []
    for row in rows:
        row.sort(key=lambda p: p[1].centre[0])
        for start in range(len(row)):
            if row[start][0] != 0.0:
                continue
            seq = [row[start]]
            for v, t in row[start + 1:]:
                if v > seq[-1][0]:
                    seq.append((v, t))
            if len(seq) < 3:
                continue
            x0 = seq[0][1].centre[0]
            ppu = [(t.centre[0] - x0) / v for v, t in seq[1:] if v > 0]
            med = statistics.median(ppu)
            if med <= 0 or any(abs(p - med) / med > 0.04 for p in ppu):
                continue
            xl, xr = x0, seq[-1][1].centre[0]
            yb = seq[0][1].centre[1]
            has_line = any(lo <= xl + 0.15 * (xr - xl) and hi >= xr - 0.15 * (xr - xl)
                           and abs(y - yb) <= 30.0 for lo, hi, y in horiz)
            if not has_line:
                continue
            fit = (seq[-1][1].centre[0] - x0) / seq[-1][0]      # span across the whole bar
            best.append(denominator_from_mpp(1.0 / fit))
    if not best:
        return None
    return float(statistics.median(best))


# --------------------------------------------------------------------------
# Dimension strings
# --------------------------------------------------------------------------

_DIM_MM_RE = re.compile(r"^(\d{1,3}(?:[ ,]\d{3})+|\d{3,6})$")
_DIM_UNIT_RE = re.compile(r"^(\d+(?:\.\d+)?)\s*(mm|m)$", re.I)


def parse_dimension_mm(text: str) -> float | None:
    s = text.strip()
    m = _DIM_UNIT_RE.match(s)
    if m:
        v = float(m.group(1))
        return v if m.group(2).lower() == "mm" else v * 1000.0
    if _DIM_MM_RE.match(s):
        v = float(re.sub(r"[ ,]", "", s))
        return v if 300 <= v <= 80000 else None
    return None


def dimension_evidence(content: PageContent, *, max_matches: int = 200) -> DimensionEvidence:
    segs = [(a, b, w) for a, b, w in content.segments()]
    diag = math.hypot(content.width_pt, content.height_pt)
    matches: list[tuple[str, float, float]] = []
    for t in content.texts:
        mm = parse_dimension_mm(t.text)
        if mm is None:
            continue
        ang = math.radians(t.angle_deg)
        d = (math.cos(ang), math.sin(ang))
        cx, cy = t.centre
        tol_perp = max(3.0 * max(t.size, 4.0), 14.0)
        best = None
        for a, b, _w in segs:
            vx, vy = b[0] - a[0], b[1] - a[1]
            ln = math.hypot(vx, vy)
            if ln < 12.0 or ln > 0.9 * diag:
                continue
            if abs((vx * d[1] - vy * d[0])) / ln > 0.02:          # not parallel to the text
                continue
            # perpendicular distance of text centre to the line, projection along it
            rx, ry = cx - a[0], cy - a[1]
            perp = abs(rx * (-vy / ln) + ry * (vx / ln))
            proj = (rx * vx + ry * vy) / ln
            if perp > tol_perp or proj < -0.05 * ln or proj > 1.05 * ln:
                continue
            # score: nearest wins; prefer lines longer than the text
            tw = max(t.x1 - t.x0, t.y1 - t.y0)
            if ln < 1.2 * tw:
                continue
            if best is None or perp < best[0]:
                best = (perp, ln)
        if best is not None:
            length = best[1]
            implied = (mm / 1000.0) / (length * METRES_PER_POINT_AT_1)
            matches.append((t.text.strip(), length, implied))
            if len(matches) >= max_matches:
                break
    if not matches:
        return DimensionEvidence(None, 0, 0, [])
    # cluster implied denominators
    ns = sorted(m[2] for m in matches)
    best_cluster: list[float] = []
    for n0 in ns:
        cluster = [n for n in ns if abs(n - n0) / n0 <= AGREE_TOL]
        if len(cluster) > len(best_cluster):
            best_cluster = cluster
    n_med = statistics.median(best_cluster)
    snapped, _ = snap_denominator(n_med)
    return DimensionEvidence(snapped, len(best_cluster), len(matches), matches)


# --------------------------------------------------------------------------
# Resolution
# --------------------------------------------------------------------------

def _agree(a: float, b: float, tol: float = AGREE_TOL) -> bool:
    return abs(a - b) / max(a, b) <= tol


def resolve_scale(content: PageContent, user_denominator: float | None = None) -> ScaleResult:
    msgs: list[str] = []
    paper_detected = detect_paper(content.width_pt, content.height_pt)
    cands = parse_title_scales(content.texts)
    bar_n = measure_scale_bar(content)
    dim = dimension_evidence(content)
    if bar_n is not None:
        bar_n = snap_denominator(bar_n)[0]

    title: TitleScale | None = None
    distinct = {c.denominator for c in cands}
    paper_stated = _stated_paper(cands, content.texts)
    if cands:
        ranked = sorted(cands, key=_score_title, reverse=True)
        title = ranked[0]
        if len(distinct) > 1:
            msgs.append("Multiple scales found in the sheet text (" +
                        ", ".join(f"1:{d:g}" for d in sorted(distinct)) + "); picked the best-labelled one.")
        if title.paper is None and paper_stated is not None:
            title.paper = paper_stated

    result = ScaleResult(
        denominator=None, source=None, confidence=0.0, metres_per_point=None,
        title_text=title.text if title else None,
        title_denominator=title.denominator if title else None,
        paper_stated=title.paper if title else paper_stated,
        paper_detected=paper_detected,
        bar_denominator=bar_n,
        dimension_denominator=dim.denominator,
        dimension_support=(dim.support, dim.total),
        messages=msgs,
    )

    # ---- user override ----------------------------------------------------
    if user_denominator is not None:
        if user_denominator <= 0:
            msgs.append("Ignored non-positive user scale.")
        else:
            result.denominator = float(user_denominator)
            result.source = "user_entered"
            result.confidence = 1.0
            result.metres_per_point = metres_per_point(user_denominator)
            for label, n in (("title block", title.denominator if title else None),
                             ("scale bar", bar_n), ("dimension strings", dim.denominator)):
                if n is not None and not _agree(n, user_denominator):
                    msgs.append(f"User scale 1:{user_denominator:g} differs from {label} (1:{n:g}).")
            return result

    # ---- title block -----------------------------------------------------
    measured: list[tuple[ScaleSource, float, bool]] = []     # (source, N, strong)
    if bar_n is not None:
        measured.append(("scale_bar_measure", bar_n, True))
    if dim.denominator is not None and (dim.support >= 2 or dim.total == 1):
        measured.append(("dimension_string", dim.denominator, dim.support >= 3 or dim.support / max(dim.total, 1) >= 0.6))

    if title is not None:
        n_use = title.denominator
        conf = min(0.92, _score_title(title) + 0.05)
        if len(distinct) > 1:
            conf = min(conf, 0.6)
        if title.paper and paper_detected:
            if title.paper == paper_detected:
                conf = min(0.97, conf + 0.04)
            else:
                short_s, long_s = sorted(PAPER_PT[title.paper])
                factor = long_s / max(content.width_pt, content.height_pt)
                result.print_to_fit = True
                result.print_fit_factor = factor
                n_use = title.denominator * factor
                conf = 0.45
                msgs.append(
                    f"Title block says 1:{title.denominator:g} @ {title.paper} but the page is {paper_detected}: "
                    f"printed to fit? Effective scale is about 1:{n_use:.0f}.")
        elif title.paper and not paper_detected:
            short_s, long_s = sorted(PAPER_PT[title.paper])
            factor = long_s / max(content.width_pt, content.height_pt)
            if abs(factor - 1.0) > PAPER_TOL:
                result.print_to_fit = True
                result.print_fit_factor = factor
                n_use = title.denominator * factor
                conf = 0.4
                msgs.append(f"Page is not a standard sheet and differs from the stated {title.paper}; "
                            f"effective scale is about 1:{n_use:.0f}.")
        elif paper_detected is None:
            conf -= 0.1
            msgs.append("Page size is not a standard ISO sheet; the stated scale may not hold (print-to-fit?).")
        n_snap, _ = snap_denominator(n_use, 0.015)
        if result.print_to_fit:
            n_use = n_snap

        agree = [m for m in measured if _agree(m[1], n_use)]
        disagree = [m for m in measured if not _agree(m[1], n_use)]
        source: ScaleSource = "title_block_text"
        if agree and not disagree:
            conf = min(0.99, conf + 0.08 * len(agree))
            if result.print_to_fit:
                conf = max(conf, 0.75)
                msgs.append("Print-to-fit scale corroborated by measurement.")
        elif disagree and not agree:
            strongest = sorted(disagree, key=lambda m: (not m[2], m[0] != "scale_bar_measure"))[0]
            if strongest[2]:
                n_use = strongest[1]
                source = strongest[0]
                both_agree = len(disagree) == 2 and _agree(disagree[0][1], disagree[1][1])
                conf = 0.62 if both_agree else 0.55
                msgs.append(f"Drawing measures 1:{n_use:g} ({source}) but the title block says "
                            f"1:{title.denominator:g}; using the measured value, please confirm.")
            else:
                conf = min(conf, 0.5)
                msgs.append(f"Weak measurement suggests 1:{strongest[1]:g} versus stated 1:{title.denominator:g}.")
        elif agree and disagree:
            conf = min(conf, 0.65)
            msgs.append("Scale evidence is mixed (bar/dimension strings disagree with each other).")
        result.denominator = n_use
        result.source = source
        result.confidence = round(max(0.0, min(1.0, conf)), 3)
        result.metres_per_point = metres_per_point(n_use)
        return result

    # ---- no title scale ---------------------------------------------------
    if bar_n is not None:
        conf = 0.75
        if dim.denominator is not None and _agree(dim.denominator, bar_n):
            conf = 0.88
        elif dim.denominator is not None:
            conf = 0.5
            msgs.append("Scale bar and dimension strings disagree.")
        result.denominator, result.source = bar_n, "scale_bar_measure"
        result.confidence, result.metres_per_point = conf, metres_per_point(bar_n)
        return result
    if dim.denominator is not None and dim.support >= 2:
        conf = 0.6 if dim.support >= 3 and dim.support / dim.total >= 0.6 else 0.45
        result.denominator, result.source = dim.denominator, "dimension_string"
        result.confidence, result.metres_per_point = conf, metres_per_point(dim.denominator)
        msgs.append("Scale inferred from dimension strings only; please confirm.")
        return result
    msgs.append("No scale found in title block, scale bar or dimension strings.")
    return result
