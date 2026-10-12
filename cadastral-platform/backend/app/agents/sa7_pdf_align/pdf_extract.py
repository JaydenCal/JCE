"""SA7 step 1-2: page classification and geometry extraction.

All coordinates returned are PDF points with the origin at the bottom-left of
the page (the convention stored in plans.plan_vector_entities.paper_geom).
pdfplumber reports a top-left origin; every conversion happens in this module
so nothing downstream ever sees a top-origin coordinate.

Two paths:
  * vector  - pdfplumber lines / rects / curves (Beziers flattened) / text spans
  * raster  - render at 300 dpi (PyMuPDF), deskew by the dominant Hough angle,
              OpenCV edge + Hough + contour extraction, pixels mapped back to points.
"""
from __future__ import annotations

import io
import math
from dataclasses import dataclass, field
from typing import Literal

import numpy as np

PT_PER_INCH = 72.0
RASTER_DPI = 300
MAX_RASTER_SIDE_PX = 14000          # caps memory for A0 sheets (dpi is reduced to fit)
BEZIER_STEPS = 16

ContentClass = Literal["vector", "raster", "hybrid"]
Pt = tuple[float, float]


# --------------------------------------------------------------------------
# Data model
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class LineEnt:
    p0: Pt
    p1: Pt
    width: float = 0.0
    rgb: str | None = None
    dashed: bool = False

    @property
    def length(self) -> float:
        return math.hypot(self.p1[0] - self.p0[0], self.p1[1] - self.p0[1])


@dataclass(frozen=True)
class RectEnt:
    x0: float
    y0: float
    x1: float
    y1: float
    width: float = 0.0
    rgb: str | None = None
    stroked: bool = True
    filled: bool = False

    def corners(self) -> list[Pt]:
        return [(self.x0, self.y0), (self.x1, self.y0), (self.x1, self.y1), (self.x0, self.y1)]


@dataclass(frozen=True)
class CurveEnt:
    """A flattened path (Beziers sampled). closed => last point joins the first."""
    points: tuple[Pt, ...]
    closed: bool = False
    width: float = 0.0
    rgb: str | None = None
    dashed: bool = False
    filled: bool = False


@dataclass(frozen=True)
class TextSpan:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    size: float = 0.0
    angle_deg: float = 0.0          # direction of the baseline, anticlockwise from +x

    @property
    def centre(self) -> Pt:
        return ((self.x0 + self.x1) / 2.0, (self.y0 + self.y1) / 2.0)


@dataclass(frozen=True)
class RasterPolygon:
    """A closed region recovered from a raster page (already in points)."""
    points: tuple[Pt, ...]
    width: float = 0.0


@dataclass
class RasterInfo:
    dpi: int
    width_px: int
    height_px: int
    deskew_deg: float
    # points -> deskewed pixel: px = a*x + b*y + xoff ; py = d*x + e*y + yoff
    paper_to_pixel: tuple[float, float, float, float, float, float]


@dataclass
class PageContent:
    page_number: int                 # 1-based
    width_pt: float
    height_pt: float
    rotation_deg: int
    content_class: ContentClass
    lines: list[LineEnt] = field(default_factory=list)
    rects: list[RectEnt] = field(default_factory=list)
    curves: list[CurveEnt] = field(default_factory=list)
    texts: list[TextSpan] = field(default_factory=list)
    raster_polygons: list[RasterPolygon] = field(default_factory=list)
    raster: RasterInfo | None = None
    n_images: int = 0
    producer: str | None = None
    creator: str | None = None

    @property
    def n_vector_objects(self) -> int:
        return len(self.lines) + len(self.rects) + len(self.curves)

    def segments(self) -> list[tuple[Pt, Pt, float]]:
        """Every stroke reduced to straight segments (p0, p1, width). Rect edges and
        curve polylines are expanded. Thin filled rects are treated as lines."""
        out: list[tuple[Pt, Pt, float]] = []
        for ln in self.lines:
            out.append((ln.p0, ln.p1, ln.width))
        for r in self.rects:
            w = abs(r.x1 - r.x0)
            h = abs(r.y1 - r.y0)
            if r.filled and not r.stroked and min(w, h) <= 2.0:
                if w >= h:
                    ym = (r.y0 + r.y1) / 2
                    out.append(((r.x0, ym), (r.x1, ym), max(h, 0.05)))
                else:
                    xm = (r.x0 + r.x1) / 2
                    out.append(((xm, r.y0), (xm, r.y1), max(w, 0.05)))
                continue
            if not r.stroked:
                continue
            c = r.corners()
            for i in range(4):
                out.append((c[i], c[(i + 1) % 4], r.width))
        for cv in self.curves:
            pts = cv.points
            for i in range(len(pts) - 1):
                out.append((pts[i], pts[i + 1], cv.width))
            if cv.closed and len(pts) > 2 and pts[0] != pts[-1]:
                out.append((pts[-1], pts[0], cv.width))
        return [s for s in out if s[0] != s[1]]

    def entities(self) -> list[dict]:
        """Rows shaped for plans.plan_vector_entities (paper_geom as WKT, SRID 0)."""
        rows: list[dict] = []
        for ln in self.lines:
            rows.append(dict(entity_kind="line", paper_wkt=f"LINESTRING({ln.p0[0]} {ln.p0[1]},{ln.p1[0]} {ln.p1[1]})",
                             stroke_width_pt=ln.width, stroke_rgb=ln.rgb, text_content=None))
        for r in self.rects:
            c = r.corners() + [r.corners()[0]]
            rows.append(dict(entity_kind="rect", paper_wkt="POLYGON((" + ",".join(f"{x} {y}" for x, y in c) + "))",
                             stroke_width_pt=r.width, stroke_rgb=r.rgb, text_content=None))
        for cv in self.curves:
            pts = list(cv.points)
            if len(pts) < 2:
                continue
            if cv.closed and len(pts) >= 3:
                ring = pts + ([pts[0]] if pts[0] != pts[-1] else [])
                wkt = "POLYGON((" + ",".join(f"{x} {y}" for x, y in ring) + "))"
                kind = "curve"
            else:
                wkt = "LINESTRING(" + ",".join(f"{x} {y}" for x, y in pts) + ")"
                kind = "curve"
            rows.append(dict(entity_kind=kind, paper_wkt=wkt, stroke_width_pt=cv.width,
                             stroke_rgb=cv.rgb, text_content=None))
        for t in self.texts:
            rows.append(dict(entity_kind="text",
                             paper_wkt=f"POINT({t.centre[0]} {t.centre[1]})",
                             stroke_width_pt=None, stroke_rgb=None, text_content=t.text))
        return rows


class PdfReadError(Exception):
    """The file could not be opened or the requested page does not exist."""


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def _rgb_hex(colour) -> str | None:
    if colour is None:
        return None
    try:
        if isinstance(colour, (int, float)):
            v = max(0, min(255, round(float(colour) * 255)))
            return f"{v:02x}{v:02x}{v:02x}"
        vals = list(colour)
        if len(vals) == 1:
            return _rgb_hex(vals[0])
        if len(vals) == 3:
            return "".join(f"{max(0, min(255, round(float(c) * 255))):02x}" for c in vals)
        if len(vals) == 4:  # CMYK
            c, m, y, k = (float(v) for v in vals)
            r, g, b = (1 - min(1, c + k)), (1 - min(1, m + k)), (1 - min(1, y + k))
            return f"{round(r * 255):02x}{round(g * 255):02x}{round(b * 255):02x}"
    except (TypeError, ValueError):
        return None
    return None


def _flatten_bezier(p0: Pt, c1: Pt, c2: Pt, p3: Pt, steps: int = BEZIER_STEPS) -> list[Pt]:
    out = []
    for i in range(1, steps + 1):
        t = i / steps
        mt = 1 - t
        x = mt**3 * p0[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t**3 * p3[0]
        y = mt**3 * p0[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t**3 * p3[1]
        out.append((x, y))
    return out


def _is_dashed(dash) -> bool:
    if not dash:
        return False
    try:
        pattern = dash[0]
        return bool(pattern) and any(v > 0 for v in pattern)
    except (TypeError, IndexError):
        return False


# --------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------

def page_count(pdf_bytes: bytes) -> int:
    import pypdf
    try:
        return len(pypdf.PdfReader(io.BytesIO(pdf_bytes)).pages)
    except Exception as exc:  # noqa: BLE001 - library raises many types
        raise PdfReadError(f"cannot read PDF: {exc}") from exc


def extract_page(pdf_bytes: bytes, page_number: int = 1, *, force: ContentClass | None = None) -> PageContent:
    """Classify and extract one page (1-based). `force` overrides classification
    (used by tests and by the re-run path when a user marks a page as scanned)."""
    import pdfplumber

    try:
        pdf = pdfplumber.open(io.BytesIO(pdf_bytes))
    except Exception as exc:  # noqa: BLE001
        raise PdfReadError(f"cannot open PDF: {exc}") from exc
    try:
        if page_number < 1 or page_number > len(pdf.pages):
            raise PdfReadError(f"page {page_number} out of range (1..{len(pdf.pages)})")
        page = pdf.pages[page_number - 1]
        meta = pdf.metadata or {}
        content = _extract_vector(page, page_number)
        content.producer = _meta_str(meta.get("Producer"))
        content.creator = _meta_str(meta.get("Creator"))
        content.rotation_deg = int(getattr(page, "rotation", 0) or 0) % 360
        content.n_images = len(page.images)
        content.content_class = force or classify_page(content, page)
    except PdfReadError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise PdfReadError(f"extraction failed on page {page_number}: {exc}") from exc
    finally:
        pdf.close()

    if content.content_class in ("raster", "hybrid") and (
        content.content_class == "raster" or content.n_vector_objects < 20
    ):
        extract_raster(pdf_bytes, content)
    return content


def _meta_str(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, bytes):
        v = v.decode("latin-1", "replace")
    return str(v)[:200]


def classify_page(content: PageContent, page=None) -> ContentClass:
    """vector: real drawing operators dominate. raster: a page-sized image and
    (almost) no vectors. hybrid: both a substantial image and substantial vectors."""
    page_area = max(content.width_pt * content.height_pt, 1.0)
    img_cover = 0.0
    if page is not None:
        for im in page.images:
            w = max(0.0, float(im.get("x1", 0)) - float(im.get("x0", 0)))
            h = max(0.0, float(im.get("bottom", 0)) - float(im.get("top", 0)))
            img_cover += w * h
    img_frac = min(img_cover / page_area, 1.0)
    nvec = content.n_vector_objects
    if img_frac >= 0.5 and nvec < 50:
        return "raster"
    if img_frac >= 0.25 and nvec >= 50:
        return "hybrid"
    if img_frac >= 0.5 and nvec >= 50:
        return "hybrid"
    if nvec == 0 and content.n_images > 0:
        return "raster"
    return "vector"


def _extract_vector(page, page_number: int) -> PageContent:
    x_org = float(page.bbox[0])
    y_top = float(page.bbox[3])          # pdfplumber: bottom edge in top-origin space
    width = float(page.bbox[2] - page.bbox[0])
    height = float(page.bbox[3] - page.bbox[1])

    def cv(pt) -> Pt:                    # top-origin -> bottom-origin
        return (float(pt[0]) - x_org, y_top - float(pt[1]))

    content = PageContent(page_number=page_number, width_pt=width, height_pt=height,
                          rotation_deg=0, content_class="vector")

    for ln in page.lines:
        pts = ln.get("pts") or []
        if len(pts) < 2:
            continue
        p0, p1 = cv(pts[0]), cv(pts[-1])
        if p0 == p1:
            continue
        content.lines.append(LineEnt(p0, p1, float(ln.get("linewidth") or 0.0),
                                     _rgb_hex(ln.get("stroking_color")), _is_dashed(ln.get("dash"))))

    for r in page.rects:
        x0, x1 = float(r["x0"]) - x_org, float(r["x1"]) - x_org
        y0, y1 = y_top - float(r["bottom"]), y_top - float(r["top"])
        stroked = bool(r.get("stroke"))
        filled = bool(r.get("fill"))
        rgb = _rgb_hex(r.get("stroking_color") if stroked else r.get("non_stroking_color"))
        content.rects.append(RectEnt(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1),
                                     float(r.get("linewidth") or 0.0), rgb, stroked, filled))

    for c in page.curves:
        poly, closed = _curve_to_polyline(c, cv)
        if len(poly) < 2:
            continue
        content.curves.append(CurveEnt(tuple(poly), closed, float(c.get("linewidth") or 0.0),
                                       _rgb_hex(c.get("stroking_color")), _is_dashed(c.get("dash")),
                                       bool(c.get("fill"))))

    content.texts = _text_spans(page, cv)
    return content


def _curve_to_polyline(c: dict, cv) -> tuple[list[Pt], bool]:
    path = c.get("path")
    if not path:
        pts = [cv(p) for p in (c.get("pts") or [])]
        closed = len(pts) > 2 and pts[0] == pts[-1]
        return pts, closed
    pts: list[Pt] = []
    closed = False
    cur: Pt | None = None
    for cmd in path:
        op = cmd[0]
        if op == "m":
            cur = cv(cmd[1])
            pts.append(cur)
        elif op == "l":
            cur = cv(cmd[1])
            pts.append(cur)
        elif op == "c" and cur is not None:
            c1, c2, p3 = cv(cmd[1]), cv(cmd[2]), cv(cmd[3])
            pts.extend(_flatten_bezier(cur, c1, c2, p3))
            cur = p3
        elif op == "v" and cur is not None:       # first control point = current point
            c2, p3 = cv(cmd[1]), cv(cmd[2])
            pts.extend(_flatten_bezier(cur, cur, c2, p3))
            cur = p3
        elif op == "y" and cur is not None:       # second control point = end point
            c1, p3 = cv(cmd[1]), cv(cmd[2])
            pts.extend(_flatten_bezier(cur, c1, p3, p3))
            cur = p3
        elif op == "h":
            closed = True
    if closed and len(pts) > 2 and pts[0] != pts[-1]:
        pts.append(pts[0])
    if not closed and len(pts) > 2 and pts[0] == pts[-1]:
        closed = True
    return pts, closed


def _text_spans(page, cv) -> list[TextSpan]:
    """Group characters (content-stream order) into spans along their baseline.
    Handles rotated text (vertical dimension strings) which pdfplumber's word
    extractor does not."""
    spans: list[TextSpan] = []
    cur: dict | None = None

    def flush():
        nonlocal cur
        if cur is not None:
            text = "".join(cur["chars"]).strip()
            if text:
                xs = cur["xs"]
                ys = cur["ys"]
                spans.append(TextSpan(text, min(xs), min(ys), max(xs), max(ys), cur["size"], cur["angle"]))
        cur = None

    for ch in page.chars:
        txt = ch.get("text", "")
        if txt == "":
            continue
        m = ch.get("matrix") or (1, 0, 0, 1, 0, 0)
        angle = math.degrees(math.atan2(m[1], m[0])) % 360.0
        angle = float(round(angle)) % 360.0
        size = float(ch.get("size") or 0.0)
        a = cv((float(ch["x0"]), float(ch["top"])))
        b = cv((float(ch["x1"]), float(ch["bottom"])))
        bx0, bx1 = min(a[0], b[0]), max(a[0], b[0])
        by0, by1 = min(a[1], b[1]), max(a[1], b[1])
        d = (math.cos(math.radians(angle)), math.sin(math.radians(angle)))
        if cur is not None:
            same_dir = abs(((cur["angle"] - angle + 180) % 360) - 180) < 1.0
            same_size = abs(cur["size"] - size) <= max(0.35 * max(size, cur["size"]), 0.3)
            # advance along baseline from previous char end to this char start
            cx = (bx0 + bx1) / 2
            cy = (by0 + by1) / 2
            dx, dy = cx - cur["last"][0], cy - cur["last"][1]
            along = dx * d[0] + dy * d[1]
            perp = abs(-dx * d[1] + dy * d[0])
            ok = same_dir and same_size and -0.2 * size <= along <= 1.6 * max(size, 1.0) and perp <= 0.35 * max(size, 1.0)
            if not ok:
                flush()
        if cur is None:
            cur = dict(chars=[], xs=[], ys=[], size=size, angle=angle, last=(0.0, 0.0))
        cur["chars"].append(txt)
        cur["xs"].extend([bx0, bx1])
        cur["ys"].extend([by0, by1])
        cur["last"] = ((bx0 + bx1) / 2, (by0 + by1) / 2)
        cur["size"] = size or cur["size"]
    flush()
    return spans


# --------------------------------------------------------------------------
# Raster path
# --------------------------------------------------------------------------

def render_page_gray(pdf_bytes: bytes, page_number: int, dpi: int = RASTER_DPI) -> tuple[np.ndarray, int]:
    """Render to an 8-bit grayscale array. dpi is reduced so the longest side stays
    below MAX_RASTER_SIDE_PX. Returns (image, dpi_used)."""
    import pymupdf

    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        page = doc[page_number - 1]
    except Exception as exc:  # noqa: BLE001
        raise PdfReadError(f"cannot render page {page_number}: {exc}") from exc
    try:
        longest_pt = max(page.rect.width, page.rect.height)
        dpi_used = int(min(dpi, MAX_RASTER_SIDE_PX / longest_pt * PT_PER_INCH))
        dpi_used = max(dpi_used, 72)
        pix = page.get_pixmap(dpi=dpi_used, colorspace=pymupdf.csGRAY, alpha=False)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width).copy()
        return img, dpi_used
    finally:
        doc.close()


def estimate_skew_deg(gray: np.ndarray) -> float:
    """Dominant line angle modulo 90 degrees, in (-45, 45], image coordinates (y down,
    positive = line tilts clockwise on screen). Uses a length-weighted histogram of
    probabilistic Hough segments."""
    import cv2

    scale = 1.0
    work = gray
    longest = max(gray.shape)
    if longest > 3000:                      # Hough on a reduced copy is plenty for angle
        scale = 3000.0 / longest
        work = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    edges = cv2.Canny(work, 50, 150, apertureSize=3)
    min_len = max(30, int(0.04 * max(work.shape)))
    segs = cv2.HoughLinesP(edges, 1, np.pi / 720, threshold=80, minLineLength=min_len, maxLineGap=6)
    if segs is None or len(segs) == 0:
        return 0.0
    s = segs.reshape(-1, 4).astype(float)
    dx, dy = s[:, 2] - s[:, 0], s[:, 3] - s[:, 1]
    lengths = np.hypot(dx, dy)
    ang = np.degrees(np.arctan2(dy, dx))
    ang = (ang + 45.0) % 90.0 - 45.0         # fold into [-45, 45)
    bins = np.arange(-45.0, 45.0 + 0.1, 0.1)
    hist, edges_b = np.histogram(ang, bins=bins, weights=lengths)
    # smooth with +-0.3 degree window
    k = np.ones(7) / 7.0
    hs = np.convolve(hist, k, mode="same")
    i = int(np.argmax(hs))
    lo, hi = max(0, i - 3), min(len(edges_b) - 1, i + 4)
    sel = (ang >= edges_b[lo]) & (ang < edges_b[hi])
    if not sel.any():
        return float((edges_b[i] + edges_b[i + 1]) / 2)
    return float(np.average(ang[sel], weights=lengths[sel]))


def extract_raster(pdf_bytes: bytes, content: PageContent, *, dpi: int = RASTER_DPI) -> PageContent:
    """Raster path. Fills content.raster, content.lines (Hough) and
    content.raster_polygons (enclosed regions) in the deskewed frame, in points."""
    import cv2

    gray, dpi_used = render_page_gray(pdf_bytes, content.page_number, dpi)
    h_px, w_px = gray.shape
    skew = estimate_skew_deg(gray)
    deskew = 0.0
    if 0.05 <= abs(skew) <= 15.0:
        centre = (w_px / 2.0, h_px / 2.0)
        m = cv2.getRotationMatrix2D(centre, skew, 1.0)
        gray = cv2.warpAffine(gray, m, (w_px, h_px), flags=cv2.INTER_LINEAR,
                              borderMode=cv2.BORDER_CONSTANT, borderValue=255)
        deskew = skew

    k = dpi_used / PT_PER_INCH              # pixels per point
    height_pt = h_px / k

    def px_to_pt(x: float, y: float) -> Pt:
        return (x / k, height_pt - y / k)

    content.raster = RasterInfo(dpi=dpi_used, width_px=w_px, height_px=h_px, deskew_deg=deskew,
                                paper_to_pixel=(k, 0.0, 0.0, -k, 0.0, height_pt * k))

    # binary ink mask
    _, ink = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    ink = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))

    # straight segments
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    min_len = max(20, int(0.015 * max(w_px, h_px)))
    segs = cv2.HoughLinesP(edges, 1, np.pi / 360, threshold=60, minLineLength=min_len, maxLineGap=8)
    stroke_px = _stroke_thickness_px(ink)
    if segs is not None:
        for x0, y0, x1, y1 in segs.reshape(-1, 4):
            content.lines.append(LineEnt(px_to_pt(x0, y0), px_to_pt(x1, y1), stroke_px / k))

    # enclosed regions: holes in the ink mask, grown by half the stroke so the polygon
    # sits on the stroke centre-line rather than its inner edge.
    contours, hier = cv2.findContours(ink, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if hier is not None:
        from shapely.geometry import Polygon
        min_area = (0.004 * w_px * h_px) * 0.1
        for idx, cnt in enumerate(contours):
            if hier[0][idx][3] < 0:          # outer contours of ink; we want holes (children)
                continue
            area = cv2.contourArea(cnt)
            if area < min_area or area > 0.9 * w_px * h_px:
                continue
            eps = 0.003 * cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, eps, True).reshape(-1, 2)
            if len(approx) < 3:
                continue
            poly = Polygon(approx)
            if not poly.is_valid or poly.is_empty:
                continue
            grown = poly.buffer(stroke_px / 2.0, join_style=2, mitre_limit=5.0)
            if grown.geom_type != "Polygon":
                continue
            pts = tuple(px_to_pt(x, y) for x, y in list(grown.exterior.coords)[:-1])
            content.raster_polygons.append(RasterPolygon(pts, stroke_px / k))
    return content


def _stroke_thickness_px(ink: np.ndarray) -> float:
    import cv2
    dt = cv2.distanceTransform((ink > 0).astype(np.uint8), cv2.DIST_L2, 3)
    vals = dt[dt > 0]
    if vals.size == 0:
        return 1.0
    return float(max(1.0, 4.0 * np.mean(vals)))
