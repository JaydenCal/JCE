"""SA7 tests. Synthetic PDFs are built with reportlab; ground truth is known exactly."""
from __future__ import annotations

import hashlib
import math
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pytest
from reportlab.pdfgen import canvas
from shapely import wkt as shapely_wkt
from shapely.affinity import affine_transform, rotate
from shapely.geometry import Polygon, box

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents.base import AgentError  # noqa: E402
from app.agents.sa7_pdf_align import align as al  # noqa: E402
from app.agents.sa7_pdf_align import pdf_extract as px  # noqa: E402
from app.agents.sa7_pdf_align import scale as sc  # noqa: E402
from app.agents.sa7_pdf_align import slab as sl  # noqa: E402
from app.agents.sa7_pdf_align.agent import Sa7PdfAligner  # noqa: E402
from app.common.contracts import AgentCode, BoundarySegment, LotContext, PlanUpload  # noqa: E402

A3_W, A3_H = 1190.55, 841.89
BASE = (334512.118, 6263901.442)                       # MGA zone 56 magnitudes
LOT_LOCAL = [(0.0, 0.0), (19.5, 1.2), (20.4, 22.8), (2.1, 24.0), (-0.8, 12.0)]   # irregular: no symmetry
THETA = 0.0412


def _lot_mga() -> Polygon:
    return Polygon([(BASE[0] + x, BASE[1] + y) for x, y in LOT_LOCAL])


def _slab_mga() -> Polygon:
    r = rotate(box(4.0, 5.0, 14.5, 17.0), 5.0, origin=(9.25, 11.0))      # rotated relative to the lot
    return Polygon([(BASE[0] + x, BASE[1] + y) for x, y in r.exterior.coords])


@dataclass
class Plan:
    path: Path
    data: bytes
    sha: str
    truth: tuple[float, float, float, float, float, float]      # paper -> MGA (proper case)
    lot: Polygon
    slab: Polygon
    s: float
    paper_lot: list[tuple[float, float]]
    paper_slab: list[tuple[float, float]]


def make_plan(tmp_path: Path, *, name="plan.pdf", draw_den=100, title="SCALE 1:100 @ A3", theta=THETA,
              mirror=False, boundary=True, dashed=False, dims=True, bar=True, page=(A3_W, A3_H)) -> Plan:
    s = sc.metres_per_point(draw_den)
    lot, slab = _lot_mga(), _slab_mga()
    centre_paper = np.array([450.0, 430.0])
    c, sn = math.cos(theta), math.sin(theta)
    A = s * np.array([[c, -sn], [sn, c]])
    t = np.array(lot.centroid.coords[0]) - A @ centre_paper

    def to_paper(poly: Polygon) -> list[tuple[float, float]]:
        pts = np.array(poly.exterior.coords)[:-1]
        pp = (np.linalg.inv(A) @ (pts - t).T).T
        if mirror:
            pp[:, 0] = 2 * centre_paper[0] - pp[:, 0]
        return [(float(x), float(y)) for x, y in pp]

    paper_lot, paper_slab = to_paper(lot), to_paper(slab)
    path = tmp_path / name
    cv = canvas.Canvas(str(path), pagesize=page)
    cv.setLineWidth(0.5)
    cv.rect(10, 10, page[0] - 20, page[1] - 20)                         # sheet frame
    cv.rect(900, 20, 270, 200)                                          # title block
    cv.setFont("Helvetica", 8)
    cv.drawString(910, 200, "PROJECT: SMITH RESIDENCE")
    cv.drawString(910, 180, "DRAWN: JB   CHECKED: AK")
    cv.drawString(910, 160, "SITE PLAN")
    if title:
        cv.drawString(910, 140, title)
    if boundary:
        cv.setLineWidth(0.7)
        n = len(paper_lot)
        for i in range(n):
            if dashed:
                cv.setDash(8, 3)
            cv.line(*paper_lot[i], *paper_lot[(i + 1) % n])
        cv.setDash()
        cv.setFont("Helvetica", 7)
        cv.drawString(paper_lot[0][0] + 6, paper_lot[0][1] + 6, "LOT 12 DP345678")
    # slab: heavy closed outline + a thin internal wall
    cv.setLineWidth(2.0)
    p = cv.beginPath()
    p.moveTo(*paper_slab[0])
    for q in paper_slab[1:]:
        p.lineTo(*q)
    p.close()
    cv.drawPath(p)
    cv.setLineWidth(0.5)
    m01 = ((paper_slab[0][0] + paper_slab[1][0]) / 2, (paper_slab[0][1] + paper_slab[1][1]) / 2)
    m23 = ((paper_slab[2][0] + paper_slab[3][0]) / 2, (paper_slab[2][1] + paper_slab[3][1]) / 2)
    cv.line(*m01, *m23)
    cx = sum(x for x, _ in paper_slab) / 4
    cy = sum(y for _, y in paper_slab) / 4
    cv.setFont("Helvetica", 9)
    cv.drawString(cx - 20, cy + 6, "GARAGE")
    cv.drawString(cx - 25, cy - 14, "ALFRESCO")
    if dims:
        cv.setLineWidth(0.4)
        mm_pt = s * 1000.0                       # ground mm -> never used; compute lengths in points
        for (x, y, mm, vertical) in ((60, 40, 3600, False), (60, 70, 5000, False), (30, 150, 4000, True)):
            length = (mm / 1000.0) / s
            if vertical:
                cv.line(x, y, x, y + length)
                cv.saveState()
                cv.translate(x + 7, y + length / 2)
                cv.rotate(90)
                cv.setFont("Helvetica", 8)
                cv.drawCentredString(0, 0, str(mm))
                cv.restoreState()
            else:
                cv.line(x, y, x + length, y)
                cv.setFont("Helvetica", 8)
                cv.drawCentredString(x + length / 2, y + 4, str(mm))
    if bar:
        cv.setLineWidth(0.6)
        x0, y0 = 300.0, 60.0
        ppm = 1.0 / s
        cv.line(x0, y0, x0 + 10 * ppm, y0)
        cv.setFont("Helvetica", 7)
        for v in (0, 5, 10):
            cv.line(x0 + v * ppm, y0, x0 + v * ppm, y0 + 4)
            cv.drawCentredString(x0 + v * ppm, y0 - 10, str(v))
    cv.showPage()
    cv.save()
    data = path.read_bytes()
    return Plan(path, data, hashlib.sha256(data).hexdigest(), (A[0, 0], A[0, 1], A[1, 0], A[1, 1], t[0], t[1]),
                lot, slab, s, paper_lot, paper_slab)


def make_upload(plan: Plan, *, envelope: Polygon | None = None, **kw) -> PlanUpload:
    lot = plan.lot
    coords = list(lot.exterior.coords)
    segs = [BoundarySegment(seq=i + 1, bearing_deg=0.0, bearing_dms="0", distance_m=math.dist(coords[i], coords[i + 1]),
                            start_xy=coords[i], end_xy=coords[i + 1]) for i in range(len(coords) - 1)]
    ctx = LotContext(lot_id=uuid.uuid4(), jurisdiction="NSW", lotplan="12//DP345678", lga_name="Hornsby",
                     mga_srid=7856, area_m2_calculated=lot.area, boundary_wkt=lot.wkt, segments=segs,
                     envelope_wkt=envelope.wkt if envelope is not None else None)
    return PlanUpload(upload_id=uuid.uuid4(), project_id=uuid.uuid4(), storage_path=str(plan.path),
                      file_sha256=plan.sha, lot=ctx, **kw)


def footprint_error(overlay, expected: Polygon) -> float:
    fp = shapely_wkt.loads(overlay.footprint_wkt)
    return max(fp.hausdorff_distance(expected), expected.hausdorff_distance(fp))


# ---------------------------------------------------------------------------
# extraction
# ---------------------------------------------------------------------------

def test_vector_extraction_coordinates_and_classification(tmp_path):
    plan = make_plan(tmp_path)
    c = px.extract_page(plan.data, 1)
    assert c.content_class == "vector"
    assert (round(c.width_pt, 2), round(c.height_pt, 2)) == (A3_W, A3_H)
    # title-block rect drawn at (900, 20, 270x200) with a bottom-left origin
    assert any(abs(r.x0 - 900) < 1e-3 and abs(r.y0 - 20) < 1e-3 and abs(r.x1 - 1170) < 1e-3 and abs(r.y1 - 220) < 1e-3
               for r in c.rects)
    sp = next(t for t in c.texts if t.text == "SITE PLAN")
    assert abs(sp.x0 - 910) < 1.0 and 155 < sp.y0 < 165           # y measured from the bottom
    rotated = [t for t in c.texts if t.text == "4000"]
    assert rotated and abs(rotated[0].angle_deg - 90) < 1.0
    assert c.n_vector_objects > 10


def test_curve_flattening():
    from reportlab.pdfgen import canvas as cvs
    import io
    buf = io.BytesIO()
    cv = cvs.Canvas(buf, pagesize=(400, 400))
    p = cv.beginPath()
    p.moveTo(50, 50)
    p.curveTo(100, 150, 200, 150, 250, 50)
    p.close()
    cv.drawPath(p)
    cv.save()
    c = px.extract_page(buf.getvalue(), 1)
    curve = c.curves[0]
    assert len(curve.points) > 10 and curve.closed
    ys = [y for _, y in curve.points]
    assert max(ys) > 100 and min(ys) == pytest.approx(50)         # bulged upward in bottom-origin space


# ---------------------------------------------------------------------------
# scale
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("text,n,paper", [
    ("1:100", 100, None), ("SCALE 1:200 @ A1", 200, "A1"), ("1:50 @ A3", 50, "A3"),
    ("Scale 1 : 250 (A2)", 250, "A2"), ("SITE PLAN 1:500 @A3", 500, "A3")])
def test_title_scale_parsing(text, n, paper):
    out = sc.parse_title_scales([px.TextSpan(text, 0, 0, 10, 10)])
    assert out and out[0].denominator == n and out[0].paper == paper


def test_title_scale_ignores_times_and_dates():
    assert sc.parse_title_scales([px.TextSpan("ISSUED 10:30 21:100", 0, 0, 1, 1)]) == []


def test_metres_per_point_formula():
    assert sc.metres_per_point(100) == pytest.approx(0.0352777778, abs=1e-10)
    assert sc.metres_per_point(1) == pytest.approx(25.4 / 72 / 1000)


def test_scale_detected_and_corroborated(tmp_path):
    plan = make_plan(tmp_path)
    r = sc.resolve_scale(px.extract_page(plan.data, 1))
    assert r.denominator == 100 and r.source == "title_block_text"
    assert r.paper_detected == "A3" and r.paper_stated == "A3" and not r.print_to_fit
    assert r.bar_denominator == pytest.approx(100, rel=0.01)
    assert r.dimension_denominator == 100 and r.dimension_support[0] == 3
    assert r.confidence >= 0.95
    assert r.metres_per_point == pytest.approx(0.0352777778, abs=1e-9)


def test_scale_only_from_bar_and_dims(tmp_path):
    plan = make_plan(tmp_path, title="")
    r = sc.resolve_scale(px.extract_page(plan.data, 1))
    assert r.denominator == 100 and r.source == "scale_bar_measure" and r.confidence >= 0.85


def test_user_scale_overrides(tmp_path):
    plan = make_plan(tmp_path)
    r = sc.resolve_scale(px.extract_page(plan.data, 1), user_denominator=200)
    assert r.denominator == 200 and r.source == "user_entered" and r.confidence == 1.0
    assert any("differs" in m for m in r.messages)


def test_print_to_fit_lowers_confidence(tmp_path):
    clean = sc.resolve_scale(px.extract_page(make_plan(tmp_path, name="a.pdf").data, 1))
    # A1 sheet reduced to an A3 page: geometry really is at 1:200, title still says 1:100 @ A1
    fitted_plan = make_plan(tmp_path, name="b.pdf", draw_den=200, title="SCALE 1:100 @ A1", dims=False, bar=False)
    r = sc.resolve_scale(px.extract_page(fitted_plan.data, 1))
    assert r.print_to_fit and r.paper_stated == "A1" and r.paper_detected == "A3"
    assert r.print_fit_factor == pytest.approx(2.0, rel=0.01)
    assert r.denominator == 200                     # effective scale, never silently 100
    assert r.confidence < clean.confidence and r.confidence < 0.7
    assert any("printed to fit" in m for m in r.messages)


def test_print_to_fit_corroborated_by_measurement_regains_confidence(tmp_path):
    p = make_plan(tmp_path, draw_den=200, title="SCALE 1:100 @ A1")
    r = sc.resolve_scale(px.extract_page(p.data, 1))
    assert r.print_to_fit and r.denominator == 200 and 0.7 <= r.confidence < 0.95


def test_title_vs_measurement_conflict_uses_measurement_and_flags(tmp_path):
    p = make_plan(tmp_path, draw_den=200, title="SCALE 1:100 @ A3")
    r = sc.resolve_scale(px.extract_page(p.data, 1))
    assert r.denominator == 200 and r.source in ("scale_bar_measure", "dimension_string")
    assert r.confidence < 0.7
    assert any("title block says" in m for m in r.messages)


# ---------------------------------------------------------------------------
# slab
# ---------------------------------------------------------------------------

def test_slab_found_with_boundary(tmp_path):
    plan = make_plan(tmp_path)
    c = px.extract_page(plan.data, 1)
    res = sl.find_slab(c, plan.s)
    assert res.best is not None and res.confidence >= 0.85
    assert "garage" in res.best.keywords
    assert res.best.area_m2 == pytest.approx(plan.slab.area, rel=0.01)
    assert res.boundary is not None
    assert res.boundary.area * plan.s ** 2 == pytest.approx(plan.lot.area, rel=0.01)


def test_slab_found_with_dashed_boundary(tmp_path):
    plan = make_plan(tmp_path, dashed=True)
    res = sl.find_slab(px.extract_page(plan.data, 1), plan.s)
    assert res.best is not None and res.boundary is not None
    assert res.boundary.area * plan.s ** 2 == pytest.approx(plan.lot.area, rel=0.03)


def test_hook_only_called_when_ambiguous():
    calls = []

    def hook(cands):
        calls.append(list(cands))
        return sl.HookDecision(chosen_id=cands[-1].id, confidence=0.9, rationale="test")

    content = px.PageContent(1, 842, 595, 0, "vector")
    # two identical, unlabelled, same-weight rectangles: genuinely ambiguous
    content.rects.append(px.RectEnt(100, 100, 300, 250, 1.0))
    content.rects.append(px.RectEnt(450, 100, 650, 250, 1.0))
    none_res = sl.find_slab(content, None)
    assert none_res.confidence < 0.85 and not none_res.classified_by_hook
    res = sl.find_slab(content, None, hook=hook)
    assert len(calls) == 1 and res.classified_by_hook and res.confidence == 0.9
    assert res.best.id == calls[0][-1].id
    # a bad hook answer is ignored
    res2 = sl.find_slab(content, None, hook=lambda c: sl.HookDecision(999, 0.99))
    assert not res2.classified_by_hook
    # clear plan: hook never consulted
    called = []
    plan_content = px.extract_page(make_plan(Path(__import__("tempfile").mkdtemp())).data, 1)
    sl.find_slab(plan_content, 0.03527, hook=lambda c: called.append(1))
    assert not called


# ---------------------------------------------------------------------------
# alignment maths
# ---------------------------------------------------------------------------

def _pts(sim_params, paper, noise=0.0, seed=1):
    a, b, d, e, xo, yo = sim_params
    rng = np.random.default_rng(seed)
    out = []
    for i, (x, y) in enumerate(paper):
        X, Y = a * x + b * y + xo, d * x + e * y + yo
        out.append(al.ControlPoint(f"p{i}", (x, y), (X + rng.normal(0, noise), Y + rng.normal(0, noise)), 1.0, "user_picked"))
    return out


TRUE = (0.0352777778 * math.cos(0.3), -0.0352777778 * math.sin(0.3),
        0.0352777778 * math.sin(0.3), 0.0352777778 * math.cos(0.3), 334500.0, 6263900.0)
PAPER = [(100.0, 100.0), (700.0, 120.0), (650.0, 600.0), (150.0, 520.0), (400.0, 300.0)]
S = 0.0352777778


def test_matrix_convention_and_st_affine_equivalence():
    r = al.align(_pts(TRUE, PAPER), S)
    a, b, d, e, xo, yo = r.sim.params
    s, t = r.sim.scale, r.sim.rotation_rad
    assert (a, b, d, e) == pytest.approx((s * math.cos(t), -s * math.sin(t), s * math.sin(t), s * math.cos(t)))
    assert r.sim.matrix_3x3 == [a, b, xo, d, e, yo, 0.0, 0.0, 1.0]
    assert t == pytest.approx(0.3, abs=1e-9)
    poly = Polygon(PAPER)
    moved = affine_transform(poly, [a, b, d, e, xo, yo])
    X = a * PAPER[0][0] + b * PAPER[0][1] + xo
    assert moved.exterior.coords[0][0] == pytest.approx(X)


def test_locked_recovers_to_millimetres_and_ignores_noise_free_scale():
    r = al.align(_pts(TRUE, PAPER), S)
    assert r.outcome == "accepted_unverified" and r.rmse_m < 1e-6
    assert r.sim.xoff == pytest.approx(TRUE[4], abs=1e-6) and r.sim.yoff == pytest.approx(TRUE[5], abs=1e-6)
    assert not r.scale_mismatch and r.scale_ratio == pytest.approx(1.0, abs=1e-9)


def test_two_points_locked_scale():
    r = al.align(_pts(TRUE, PAPER[:2]), S)
    assert r.sim.rotation_rad == pytest.approx(0.3, abs=1e-9) and r.rmse_m < 1e-6


def test_umeyama_free_scale_and_mismatch_flag():
    # points really sit at 3% larger scale than stated
    big = tuple(v * 1.03 if i < 4 else v for i, v in enumerate(TRUE))
    r = al.align(_pts(big, PAPER), S)
    assert r.scale_mismatch and r.scale_ratio == pytest.approx(1.03, rel=1e-4)
    assert r.outcome in ("needs_user_confirmation", "refused")
    free = al.align(_pts(big, PAPER), S, mode="free")
    assert free.sim.scale == pytest.approx(S * 1.03, rel=1e-6) and free.rmse_m < 1e-6
    assert not free.scale_mismatch or free.scale_ratio == pytest.approx(1.03, rel=1e-4)


def test_outcome_thresholds():
    assert al.outcome_for_rmse(0.10) == "accepted_unverified"
    assert al.outcome_for_rmse(0.1001) == "needs_user_confirmation"
    assert al.outcome_for_rmse(0.30) == "needs_user_confirmation"
    assert al.outcome_for_rmse(0.3001) == "refused"
    # a 1 % scale error over a ~25 m site gives a systematic ~0.11 m RMSE; 4 % pushes past 0.30 m
    r = al.align(_pts(TRUE, PAPER), S * 1.01)
    assert 0.10 < r.rmse_m <= 0.30 and r.outcome == "needs_user_confirmation"
    r = al.align(_pts(TRUE, PAPER), S * 1.04)
    assert r.rmse_m > 0.30 and r.outcome == "refused" and r.scale_mismatch
    assert r.free_rmse_m < 1e-6                      # scale-free fit is perfect: the stated scale is wrong


def test_reflection_detected_and_corrected():
    mirrored = [(1190.0 - x, y) for x, y in PAPER]            # drawing mirrored left-right
    pts = _pts(TRUE, PAPER)
    pts = [al.ControlPoint(p.label, m, p.site_xy, 1.0, "user_picked") for p, m in zip(pts, mirrored)]
    r = al.align(pts, S)
    assert r.reflection_applied and r.sim.reflected and r.rmse_m < 1e-6
    assert r.outcome == "needs_user_confirmation" and any("MIRRORED" in m for m in r.messages)
    assert np.linalg.det([[r.sim.a, r.sim.b], [r.sim.d, r.sim.e]]) < 0
    # the free-scale Umeyama path reports it too
    sim, flag = al.solve_umeyama([p.paper_xy for p in pts], [p.site_xy for p in pts])
    assert flag and sim.reflected
    # and no false positive on a proper drawing
    _, flag2 = al.solve_umeyama(PAPER, [(TRUE[0] * x + TRUE[1] * y + TRUE[4], TRUE[2] * x + TRUE[3] * y + TRUE[5]) for x, y in PAPER])
    assert not flag2


def test_ransac_rejects_outlier():
    pts = _pts(TRUE, PAPER + [(300.0, 580.0)], noise=0.003, seed=5)
    bad = pts[2]
    pts[2] = al.ControlPoint(bad.label, bad.paper_xy, (bad.site_xy[0] + 3.0, bad.site_xy[1] - 2.0), 1.0, "user_picked")
    r = al.align(pts, S)
    assert r.inlier_mask == [True, True, False, True, True, True]
    assert r.control_point_count == 5 and r.rmse_m < 0.02 and r.max_residual_m < 0.05
    assert r.outcome == "accepted_unverified"
    assert any("rejected" in m for m in r.messages)
    assert r.residuals_m[2] > 2.0


def test_insufficient_points_refused():
    r = al.align(_pts(TRUE, PAPER[:1]), S)
    assert r.outcome == "refused" and r.sim is None


# ---------------------------------------------------------------------------
# end to end
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("dashed", [False, True])
def test_end_to_end_recovers_rotation_and_translation(tmp_path, dashed):
    plan = make_plan(tmp_path, dashed=dashed)
    agent = Sa7PdfAligner()
    assert agent.code is AgentCode.SA7_PDF_ALIGN
    run = agent.run_detailed(make_upload(plan))
    o = run.overlay
    tol = 0.01 if not dashed else 0.05
    assert o.outcome == "accepted_unverified" and not o.reflection_applied
    assert o.rotation_rad == pytest.approx(THETA, abs=2e-4)
    a, b, d, e, xo, yo = o.transform
    # translation checked at the page centre (insensitive to rounding of the rotation about the origin)
    cx, cy = 450.0, 430.0
    truth_c = (plan.truth[0] * cx + plan.truth[1] * cy + plan.truth[4], plan.truth[2] * cx + plan.truth[3] * cy + plan.truth[5])
    got_c = (a * cx + b * cy + xo, d * cx + e * cy + yo)
    assert math.dist(truth_c, got_c) < tol
    assert math.dist((a, b, d, e, xo, yo)[:2], plan.truth[:2]) < 1e-5
    assert footprint_error(o, plan.slab) < tol
    assert o.footprint_area_m2 == pytest.approx(plan.slab.area, abs=0.2)
    assert o.rmse_m < tol and o.scale_denominator_used == 100 and o.scale_source == "title_block_text"
    assert o.scale_confidence >= 0.95 and o.metres_per_point == pytest.approx(0.0352777778, abs=1e-9)
    assert o.matrix_3x3 == [a, b, xo, d, e, yo, 0.0, 0.0, 1.0]
    assert o.control_point_count == 5
    assert run.page_number == 1 and run.slab.confidence >= 0.85


def test_end_to_end_envelope_encroachment(tmp_path):
    plan = make_plan(tmp_path)
    inside_env = plan.lot.buffer(-1.0)
    o = Sa7PdfAligner().run(make_upload(plan, envelope=inside_env))
    assert o.inside_envelope is True and o.envelope_encroachment_m2 == 0.0
    # cut a 1 m strip off the east side of the slab's bounding region
    minx, miny, maxx, maxy = plan.slab.bounds
    env = box(minx - 5, miny - 5, maxx - 1.0, maxy + 5)
    o2 = Sa7PdfAligner().run(make_upload(plan, envelope=env))
    expect = plan.slab.difference(env).area
    assert o2.inside_envelope is False
    assert o2.envelope_encroachment_m2 == pytest.approx(expect, abs=0.05) and expect > 5


def test_end_to_end_mirrored_flagged(tmp_path):
    plan = make_plan(tmp_path, mirror=True)
    o = Sa7PdfAligner().run(make_upload(plan))
    assert o.reflection_applied is True
    assert o.outcome == "needs_user_confirmation"
    assert any("mirrored" in m.lower() for m in o.messages)
    assert footprint_error(o, plan.slab) < 0.02             # corrected: footprint lands on the real slab
    assert o.transform[0] * o.transform[3] - o.transform[1] * o.transform[2] < 0


def test_end_to_end_print_to_fit_lowers_confidence_and_asks_user(tmp_path):
    plan = make_plan(tmp_path, draw_den=200, title="SCALE 1:100 @ A1", dims=False, bar=False)
    o = Sa7PdfAligner().run(make_upload(plan))
    assert o.scale_denominator_used == 200 and o.scale_confidence < 0.7
    assert o.outcome == "needs_user_confirmation"
    assert footprint_error(o, plan.slab) < 0.02


def test_end_to_end_wrong_user_scale_refused(tmp_path):
    plan = make_plan(tmp_path)
    with pytest.raises(AgentError) as ei:
        Sa7PdfAligner().run(make_upload(plan, user_scale_denominator=200))
    assert ei.value.error_code == "ALIGN_REFUSED"
    assert ei.value.partial_overlay.outcome == "refused"


def test_user_control_points_path(tmp_path):
    plan = make_plan(tmp_path, boundary=False)            # no lot boundary on the sheet
    with pytest.raises(AgentError) as ei:
        Sa7PdfAligner().run(make_upload(plan))
    assert ei.value.error_code == "NO_CONTROL_POINTS"
    a, b, d, e, xo, yo = plan.truth
    pairs = []
    for x, y in plan.paper_slab[:3]:
        pairs.append(((x, y), (a * x + b * y + xo, d * x + e * y + yo)))
    run = Sa7PdfAligner().run_detailed(make_upload(plan, user_control_points=pairs))
    assert run.overlay.outcome == "accepted_unverified" and run.overlay.control_point_count == 3
    assert all(cp.source == "user_picked" for cp in run.control_points)
    assert footprint_error(run.overlay, plan.slab) < 0.01


def test_user_control_points_outlier_rejected_end_to_end(tmp_path):
    plan = make_plan(tmp_path, boundary=False)
    a, b, d, e, xo, yo = plan.truth
    pts = plan.paper_slab + [(300.0, 300.0), (500.0, 700.0)]
    pairs = [((x, y), (a * x + b * y + xo, d * x + e * y + yo)) for x, y in pts]
    pairs[4] = (pairs[4][0], (pairs[4][1][0] + 3.0, pairs[4][1][1] + 1.0))
    o = Sa7PdfAligner().run(make_upload(plan, user_control_points=pairs))
    assert o.control_point_count == 5 and o.rmse_m < 0.01 and o.outcome == "accepted_unverified"
    assert any("outlier" in m for m in o.messages)


def test_ambiguous_symmetric_lot_needs_confirmation(tmp_path):
    # rectangle lot: 180 degree / mirror ambiguity cannot be resolved from the boundary alone
    ring = [(0.0, 0.0), (20.0, 0.0), (20.0, 30.0), (0.0, 30.0)]
    pap = [(100.0 + x / 0.0352777778, 100.0 + y / 0.0352777778) for x, y in ring]
    lot = [(BASE[0] + x, BASE[1] + y) for x, y in ring]
    m = al.propose_control_points(pap, lot, 0.0352777778)
    assert m is not None and m.ambiguous and m.n_equivalent > 1 and not m.flipped
    res = al.align(m.points, 0.0352777778, ambiguous=True)
    assert res.outcome == "needs_user_confirmation"


def test_auto_match_unequal_vertex_counts():
    ring = [(0.0, 0.0), (19.5, 1.2), (20.4, 22.8), (2.1, 24.0), (-0.8, 12.0)]
    lot = [(BASE[0] + x, BASE[1] + y) for x, y in ring]
    # paper drawing has an extra mid-edge vertex and a rotation
    pap_ring = ring[:2] + [(20.0, 12.0)] + ring[2:]
    s = 0.0352777778
    c, sn = math.cos(-0.7), math.sin(-0.7)
    pap = [((c * x - sn * y) / s + 500, (sn * x + c * y) / s + 300) for x, y in pap_ring]
    m = al.propose_control_points(pap, lot, s)
    assert m is not None and not m.ambiguous
    r = al.align(m.points, s)
    assert r.rmse_m < 0.02 and r.sim.rotation_rad == pytest.approx(0.7, abs=1e-3)


# ---------------------------------------------------------------------------
# error codes
# ---------------------------------------------------------------------------

def _upload_for_bytes(tmp_path, data: bytes, plan: Plan, name="x.pdf", sha=None, **kw):
    p = tmp_path / name
    p.write_bytes(data)
    up = make_upload(plan, **kw)
    up.storage_path = str(p)
    up.file_sha256 = sha or hashlib.sha256(data).hexdigest()
    return up


def test_error_pdf_unreadable_and_hash(tmp_path):
    plan = make_plan(tmp_path)
    up = _upload_for_bytes(tmp_path, b"this is not a pdf", plan)
    with pytest.raises(AgentError) as ei:
        Sa7PdfAligner().run(up)
    assert ei.value.error_code == "PDF_UNREADABLE"
    up2 = _upload_for_bytes(tmp_path, plan.data, plan, name="y.pdf", sha="0" * 64)
    with pytest.raises(AgentError) as ei:
        Sa7PdfAligner().run(up2)
    assert ei.value.error_code == "PDF_HASH_MISMATCH"
    up3 = make_upload(plan)
    up3.storage_path = str(tmp_path / "missing.pdf")
    with pytest.raises(AgentError) as ei:
        Sa7PdfAligner().run(up3)
    assert ei.value.error_code == "PDF_UNREADABLE"
    up4 = make_upload(plan, selected_page=5)
    with pytest.raises(AgentError) as ei:
        Sa7PdfAligner().run(up4)
    assert ei.value.error_code == "PDF_UNREADABLE"


def test_error_scale_unreadable_and_no_slab(tmp_path):
    plan = make_plan(tmp_path, title="", dims=False, bar=False)
    with pytest.raises(AgentError) as ei:
        Sa7PdfAligner().run(make_upload(plan))
    assert ei.value.error_code == "SCALE_UNREADABLE"
    # user scale rescues it
    o = Sa7PdfAligner().run(make_upload(plan, user_scale_denominator=100))
    assert o.scale_source == "user_entered" and o.scale_confidence == 1.0

    import io
    buf = io.BytesIO()
    cv = canvas.Canvas(buf, pagesize=(A3_W, A3_H))
    cv.drawString(100, 100, "SCALE 1:100 @ A3")
    cv.line(100, 200, 300, 200)
    cv.save()
    up = _upload_for_bytes(tmp_path, buf.getvalue(), plan, name="nogeom.pdf")
    with pytest.raises(AgentError) as ei:
        Sa7PdfAligner().run(up)
    assert ei.value.error_code == "NO_SLAB_FOUND"


def test_error_lot_geometry_invalid(tmp_path):
    plan = make_plan(tmp_path)
    up = make_upload(plan)
    up.lot.boundary_wkt = "POINT(1 2)"
    with pytest.raises(AgentError) as ei:
        Sa7PdfAligner().run(up)
    assert ei.value.error_code == "LOT_GEOMETRY_INVALID"


# ---------------------------------------------------------------------------
# raster path
# ---------------------------------------------------------------------------

def test_raster_page_deskew_and_polygons(tmp_path):
    import cv2
    import io
    w_px, h_px = 2480, 1754                                   # A4 landscape @ 300 dpi... drawn on an A4 page
    img = np.full((h_px, w_px), 255, np.uint8)
    cv2.rectangle(img, (600, 400), (1700, 1200), 0, 6)         # 800 x 1100?? -> 1100 wide, 800 high px
    cv2.rectangle(img, (800, 600), (1200, 900), 0, 14)
    m = cv2.getRotationMatrix2D((w_px / 2, h_px / 2), -1.5, 1.0)    # skew the "scan"
    img = cv2.warpAffine(img, m, (w_px, h_px), borderValue=255)
    png = tmp_path / "scan.png"
    cv2.imwrite(str(png), img)
    buf = io.BytesIO()
    page_w, page_h = 842.0, 595.0
    cv = canvas.Canvas(buf, pagesize=(page_w, page_h))
    cv.drawImage(str(png), 0, 0, page_w, page_h)
    cv.save()
    c = px.extract_page(buf.getvalue(), 1)
    assert c.content_class == "raster" and c.raster is not None
    assert abs(abs(c.raster.deskew_deg) - 1.5) < 0.3
    assert c.raster.dpi == 300
    a, b, d, e, xo, yo = c.raster.paper_to_pixel
    assert a == pytest.approx(300 / 72, rel=1e-3) and e == pytest.approx(-300 / 72, rel=1e-3) and yo == pytest.approx(page_h * 300 / 72, rel=1e-3)
    assert c.raster_polygons
    k = 72 / 300 * (page_w / (w_px * 72 / 300))                # == 1 : page spans the whole image
    polys = [Polygon(rp.points) for rp in c.raster_polygons]
    big = max(polys, key=lambda p: p.area)
    minx, miny, maxx, maxy = big.bounds
    # large rectangle was 1100 x 800 px at 842/2480 pt per px (stroke centre-line)
    assert (maxx - minx) == pytest.approx(1100 * page_w / w_px, rel=0.03)
    assert (maxy - miny) == pytest.approx(800 * page_h / h_px, rel=0.03)
    assert c.lines                                             # Hough segments present
    # scale cannot be read from a raster without OCR: user scale needed
    r = sc.resolve_scale(c)
    assert r.denominator is None
    assert sc.resolve_scale(c, 100).denominator == 100
