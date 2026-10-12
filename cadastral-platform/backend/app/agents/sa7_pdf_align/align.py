"""SA7 step 6-7: control points and the paper -> MGA similarity transform.

Matrix convention (identical to PostGIS ST_Affine(geom, a, b, d, e, xoff, yoff)):

    X = a*x + b*y + xoff
    Y = d*x + e*y + yoff
    a = s cos t, b = -s sin t, d = s sin t, e = s cos t          (proper similarity)
    matrix_3x3 (row-major) = [a, b, xoff, d, e, yoff, 0, 0, 1]

A mirrored drawing cannot be expressed with a = e, b = -d. When a reflection is
detected and corrected (`reflection_applied`), the paper x axis is flipped first
(x -> -x) and then the proper similarity is applied, giving
a = -s cos t, b = -s sin t, d = -s sin t, e = s cos t (det < 0). The six numbers still
feed ST_Affine unchanged and `rotation_rad` is the rotation t of the proper part.

All solves are done on centred coordinates, so MGA magnitudes (~6.3e6 m) do not cost
precision.
"""
from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field
from typing import Literal, Sequence

import numpy as np

Pt = tuple[float, float]
Outcome = Literal["accepted_unverified", "needs_user_confirmation", "refused"]
Mode = Literal["locked", "free"]

RMSE_ACCEPT_M = 0.10
RMSE_CONFIRM_M = 0.30
OUTLIER_FLOOR_M = 0.15
SCALE_MISMATCH_TOL = 0.015
_OUTCOME_RANK = {"accepted_unverified": 0, "needs_user_confirmation": 1, "refused": 2}


# --------------------------------------------------------------------------
# Types
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class ControlPoint:
    label: str
    paper_xy: Pt
    site_xy: Pt
    weight: float = 1.0
    source: Literal["lot_corner_match", "boundary_dimension_match", "user_picked", "dbyd_reference"] = "user_picked"


@dataclass(frozen=True)
class Similarity:
    a: float
    b: float
    d: float
    e: float
    xoff: float
    yoff: float
    scale: float                  # metres per point
    rotation_rad: float
    reflected: bool = False

    @property
    def params(self) -> tuple[float, float, float, float, float, float]:
        return (self.a, self.b, self.d, self.e, self.xoff, self.yoff)

    @property
    def matrix_3x3(self) -> list[float]:
        return [self.a, self.b, self.xoff, self.d, self.e, self.yoff, 0.0, 0.0, 1.0]

    def apply(self, pts: np.ndarray) -> np.ndarray:
        p = np.asarray(pts, float).reshape(-1, 2)
        return np.column_stack((self.a * p[:, 0] + self.b * p[:, 1] + self.xoff,
                                self.d * p[:, 0] + self.e * p[:, 1] + self.yoff))


@dataclass
class AlignResult:
    sim: Similarity | None
    outcome: Outcome
    mode: Mode
    solver: Literal["umeyama_similarity", "ransac_similarity", "user_manual"]
    rmse_m: float
    max_residual_m: float
    residuals_m: list[float]
    inlier_mask: list[bool]
    control_point_count: int
    reflection_applied: bool = False
    stated_mpp: float | None = None
    fitted_mpp: float | None = None
    scale_ratio: float | None = None          # fitted / stated
    scale_mismatch: bool = False
    free_rmse_m: float | None = None
    ambiguous: bool = False
    messages: list[str] = field(default_factory=list)


def worse(a: Outcome, b: Outcome) -> Outcome:
    return a if _OUTCOME_RANK[a] >= _OUTCOME_RANK[b] else b


def outcome_for_rmse(rmse_m: float) -> Outcome:
    if rmse_m <= RMSE_ACCEPT_M:
        return "accepted_unverified"
    if rmse_m <= RMSE_CONFIRM_M:
        return "needs_user_confirmation"
    return "refused"


# --------------------------------------------------------------------------
# Closed-form solvers (centred, weighted)
# --------------------------------------------------------------------------

def _prep(P, Q, w):
    P = np.asarray(P, float).reshape(-1, 2)
    Q = np.asarray(Q, float).reshape(-1, 2)
    w = np.ones(len(P)) if w is None else np.asarray(w, float)
    if not (len(P) == len(Q) == len(w)):
        raise ValueError("P, Q and weights must have equal length")
    if (w <= 0).any():
        raise ValueError("weights must be positive")
    return P, Q, w


def _build(Aprop: np.ndarray, flip: bool, pc: np.ndarray, qc: np.ndarray, s: float) -> Similarity:
    """Aprop: 2x2 s*R acting on (possibly flipped) centred paper coords; pc, qc are the
    centroids of the *flipped-if-flip* paper points and of the site points."""
    F = np.diag([-1.0, 1.0]) if flip else np.eye(2)
    A = Aprop @ F
    t = qc - Aprop @ pc
    a, b, d, e = A[0, 0], A[0, 1], A[1, 0], A[1, 1]
    theta = math.atan2(-d, -a) if flip else math.atan2(d, a)
    return Similarity(float(a), float(b), float(d), float(e), float(t[0]), float(t[1]), float(s), float(theta), flip)


def solve_scale_locked(P, Q, w=None, s: float = 1.0, *, reflect: bool = False) -> Similarity:
    """Fixed scale s (metres per point); closed-form weighted rotation + translation.
    theta = atan2( sum w (p x q), sum w (p . q) ) on centred points."""
    P, Q, w = _prep(P, Q, w)
    if len(P) < 2:
        raise ValueError("need at least 2 control points")
    if reflect:
        P = P * np.array([-1.0, 1.0])
    W = w.sum()
    pc = (w[:, None] * P).sum(0) / W
    qc = (w[:, None] * Q).sum(0) / W
    p, q = P - pc, Q - qc
    cross = float((w * (p[:, 0] * q[:, 1] - p[:, 1] * q[:, 0])).sum())
    dot = float((w * (p[:, 0] * q[:, 0] + p[:, 1] * q[:, 1])).sum())
    if abs(cross) < 1e-18 and abs(dot) < 1e-18:
        raise ValueError("degenerate control points (coincident)")
    th = math.atan2(cross, dot)
    c, sn = math.cos(th), math.sin(th)
    return _build(s * np.array([[c, -sn], [sn, c]]), reflect, pc, qc, s)


def _umeyama_core(P: np.ndarray, Q: np.ndarray, w: np.ndarray, flip: bool) -> tuple[Similarity, float]:
    if flip:
        P = P * np.array([-1.0, 1.0])
    W = w.sum()
    pc = (w[:, None] * P).sum(0) / W
    qc = (w[:, None] * Q).sum(0) / W
    p, q = P - pc, Q - qc
    var_p = float((w * (p ** 2).sum(1)).sum() / W)
    if var_p < 1e-18:
        raise ValueError("degenerate control points (coincident)")
    Sigma = (w[:, None, None] * (q[:, :, None] * p[:, None, :])).sum(0) / W      # cov(q, p)
    U, D, Vt = np.linalg.svd(Sigma)
    S = np.eye(2)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        S[1, 1] = -1.0
    R = U @ S @ Vt
    s = float((D * np.diag(S)).sum() / var_p)
    return _build(s * R, flip, pc, qc, s), float(np.linalg.det(Sigma))


def solve_umeyama(P, Q, w=None, *, allow_reflection: bool = True,
                  reflect: bool | None = None) -> tuple[Similarity, bool]:
    """Scale-free weighted Umeyama. Returns (similarity, reflection_detected).

    Reflection is detected when det(Sigma) < 0 for a well-conditioned (non-collinear,
    n >= 3) set AND the mirrored fit is clearly better; the mirrored fit is then used
    and `Similarity.reflected` is True. `reflect` forces the decision."""
    P, Q, w = _prep(P, Q, w)
    if len(P) < 2:
        raise ValueError("need at least 2 control points")
    if reflect is not None:
        sim, _ = _umeyama_core(P, Q, w, reflect)
        return sim, reflect
    sim, det_sigma = _umeyama_core(P, Q, w, False)
    if not allow_reflection or len(P) < 3 or det_sigma >= 0:
        return sim, False
    # conditioning: smallest singular value must be meaningful
    sv = np.linalg.svd(np.cov((P - P.mean(0)).T, aweights=w) if len(P) > 2 else np.eye(2), compute_uv=False)
    if sv[-1] < 1e-9 * max(sv[0], 1e-18):
        return sim, False
    mirrored, _ = _umeyama_core(P, Q, w, True)
    r0 = _rmse(sim, P, Q, w)
    r1 = _rmse(mirrored, P, Q, w)
    if r1 < 0.7 * r0:
        return mirrored, True
    return sim, False


def residuals(sim: Similarity, P, Q) -> np.ndarray:
    P = np.asarray(P, float).reshape(-1, 2)
    Q = np.asarray(Q, float).reshape(-1, 2)
    return np.linalg.norm(sim.apply(P) - Q, axis=1)


def _rmse(sim: Similarity, P, Q, w) -> float:
    r = residuals(sim, P, Q)
    return float(math.sqrt(float((w * r * r).sum() / w.sum())))


# --------------------------------------------------------------------------
# RANSAC
# --------------------------------------------------------------------------

def _fit(P, Q, w, mode: Mode, s: float, reflect: bool | None, allow_reflection: bool) -> tuple[Similarity, bool]:
    if mode == "locked":
        if reflect is None:
            sim_p = solve_scale_locked(P, Q, w, s, reflect=False)
            if allow_reflection and len(P) >= 3:
                sim_m = solve_scale_locked(P, Q, w, s, reflect=True)
                r0, r1 = _rmse(sim_p, P, Q, w), _rmse(sim_m, P, Q, w)
                if r1 < 0.5 * r0 and _non_collinear(P):
                    return sim_m, True
            return sim_p, False
        return solve_scale_locked(P, Q, w, s, reflect=reflect), reflect
    return solve_umeyama(P, Q, w, allow_reflection=allow_reflection, reflect=reflect)


def _non_collinear(P: np.ndarray) -> bool:
    c = P - P.mean(0)
    sv = np.linalg.svd(c, compute_uv=False)
    return len(sv) == 2 and sv[1] > 1e-6 * max(sv[0], 1e-18)


def robust_fit(P, Q, w=None, *, mode: Mode = "locked", s: float = 1.0, allow_reflection: bool = True,
               max_hypotheses: int = 400, seed: int = 7) -> tuple[Similarity, np.ndarray, bool, list[str]]:
    """RANSAC over minimal 2-point samples (all pairs when small). Inlier threshold is
    max(3 * RMSE_of_inliers, 0.15 m); the first pass uses the 0.15 m floor. Returns
    (similarity, inlier_mask, reflected, messages)."""
    P, Q, w = _prep(P, Q, w)
    n = len(P)
    msgs: list[str] = []
    if n < 2:
        raise ValueError("need at least 2 control points")
    if n == 2:
        sim, refl = _fit(P, Q, w, mode, s, None, allow_reflection)
        return sim, np.ones(2, bool), refl, msgs

    pairs = list(itertools.combinations(range(n), 2))
    if len(pairs) > max_hypotheses:
        rng = np.random.default_rng(seed)
        pairs = [pairs[i] for i in rng.choice(len(pairs), max_hypotheses, replace=False)]
    best = None   # (count, weight_sum, -sse, mask, reflect)
    reflect_options: Sequence[bool] = (False, True) if allow_reflection else (False,)
    for (i, j) in pairs:
        if np.linalg.norm(P[i] - P[j]) < 1e-9:
            continue
        for rf in reflect_options:
            try:
                if mode == "locked":
                    sim = solve_scale_locked(P[[i, j]], Q[[i, j]], w[[i, j]], s, reflect=rf)
                else:
                    sim, _ = solve_umeyama(P[[i, j]], Q[[i, j]], w[[i, j]], reflect=rf)
            except ValueError:
                continue
            r = residuals(sim, P, Q)
            mask = r <= OUTLIER_FLOOR_M
            key = (int(mask.sum()), float(w[mask].sum()), -float((r[mask] ** 2).sum()), not rf)
            if best is None or key > best[0]:
                best = (key, mask, rf)
    if best is None or best[0][0] <= n / 2.0:
        msgs.append("No consensus among control points; all points kept.")
        sim, refl = _fit(P, Q, w, mode, s, None, allow_reflection)
        return sim, np.ones(n, bool), refl, msgs

    _, mask, rf = best
    forced = rf if allow_reflection else False
    sim = None
    for _ in range(6):
        sim, _r = _fit(P[mask], Q[mask], w[mask], mode, s, forced, allow_reflection)
        r = residuals(sim, P, Q)
        rmse_in = math.sqrt(float((w[mask] * r[mask] ** 2).sum() / w[mask].sum()))
        thr = max(3.0 * rmse_in, OUTLIER_FLOOR_M)
        new = r <= thr
        if new.sum() <= n / 2.0 or (new == mask).all():
            break
        mask = new
    assert sim is not None
    sim, refl = _fit(P[mask], Q[mask], w[mask], mode, s, forced, allow_reflection)
    if (~mask).any():
        msgs.append(f"{int((~mask).sum())} control point(s) rejected as outliers.")
    return sim, mask, refl, msgs


# --------------------------------------------------------------------------
# Top-level alignment
# --------------------------------------------------------------------------

def align(points: Sequence[ControlPoint], metres_per_point: float, *, mode: Mode = "locked",
          allow_reflection: bool = True, ambiguous: bool = False, solver_hint: str | None = None) -> AlignResult:
    msgs: list[str] = []
    n = len(points)
    if n < 2:
        return AlignResult(None, "refused", mode, "umeyama_similarity", float("inf"), float("inf"), [], [],
                           n, stated_mpp=metres_per_point,
                           messages=["At least two control points are required."])
    P = np.array([p.paper_xy for p in points], float)
    Q = np.array([p.site_xy for p in points], float)
    w = np.array([p.weight for p in points], float)
    q0 = Q.mean(0)                           # centre site coords for precision, restore after
    Qc = Q - q0
    if np.linalg.norm(P - P.mean(0), axis=1).max() < 1e-9:
        return AlignResult(None, "refused", mode, "umeyama_similarity", float("inf"), float("inf"),
                           [], [], n, stated_mpp=metres_per_point,
                           messages=["Control points are coincident on the drawing."])

    try:
        sim_c, mask, reflected, rmsg = robust_fit(P, Qc, w, mode=mode, s=metres_per_point,
                                                  allow_reflection=allow_reflection)
    except ValueError as exc:
        return AlignResult(None, "refused", mode, "umeyama_similarity", float("inf"), float("inf"),
                           [], [], n, stated_mpp=metres_per_point, messages=[str(exc)])
    msgs.extend(rmsg)
    sim = Similarity(sim_c.a, sim_c.b, sim_c.d, sim_c.e, sim_c.xoff + q0[0], sim_c.yoff + q0[1],
                     sim_c.scale, sim_c.rotation_rad, sim_c.reflected)
    r_all = residuals(sim_c, P, Qc)
    wi = w[mask]
    rmse = float(math.sqrt(float((wi * r_all[mask] ** 2).sum() / wi.sum())))
    max_res = float(r_all[mask].max())

    # scale-free diagnostic on the inliers (always available when >= 2 inliers)
    fitted_mpp = ratio = free_rmse = None
    mismatch = False
    try:
        free_sim, _ = solve_umeyama(P[mask], Qc[mask], w[mask], allow_reflection=False, reflect=reflected)
        fitted_mpp = free_sim.scale
        ratio = fitted_mpp / metres_per_point
        free_rmse = _rmse(free_sim, P[mask], Qc[mask], w[mask])
        mismatch = abs(ratio - 1.0) > SCALE_MISMATCH_TOL
    except ValueError:
        pass

    outcome = outcome_for_rmse(rmse)
    if mask.sum() < 2:
        outcome = "refused"
    if reflected:
        outcome = worse(outcome, "needs_user_confirmation")
        msgs.append("Drawing appears MIRRORED relative to the site; a reflection was applied. Please confirm.")
    if mismatch:
        outcome = worse(outcome, "needs_user_confirmation")
        msgs.append(f"Fitted scale differs from the stated scale by {100 * (ratio - 1):+.1f}% "
                    f"(> {100 * SCALE_MISMATCH_TOL:.1f}%): possible wrong scale or non-uniform printing.")
    if ambiguous:
        outcome = worse(outcome, "needs_user_confirmation")
        msgs.append("More than one orientation fits the boundary equally well; confirm the north direction.")
    if mask.sum() == 2 and n >= 2:
        msgs.append("Only two effective control points: orientation is not independently checked.")
    if outcome == "refused":
        msgs.append(f"RMSE {rmse:.3f} m exceeds {RMSE_CONFIRM_M} m; manual control points are required.")

    solver = "ransac_similarity" if n > 2 else "umeyama_similarity"
    if solver_hint == "user_manual":
        solver = "user_manual"
    return AlignResult(sim, outcome, mode, solver, rmse, max_res, [float(x) for x in r_all],
                       [bool(m) for m in mask], int(mask.sum()), reflected, metres_per_point,
                       fitted_mpp, ratio, mismatch, free_rmse, ambiguous, msgs)


# --------------------------------------------------------------------------
# Automatic control-point proposal (PDF boundary polygon <-> surveyed lot)
# --------------------------------------------------------------------------

@dataclass
class AutoMatch:
    points: list[ControlPoint]
    cost_m: float                     # chamfer-style residual of the winning hypothesis
    flipped: bool
    scale_free: bool
    ambiguous: bool
    n_equivalent: int
    messages: list[str] = field(default_factory=list)


def _thin_ring(ring: list[Pt], max_n: int, tol0: float) -> np.ndarray:
    from shapely.geometry import Polygon
    poly = Polygon(ring)
    tol = tol0
    pts = ring
    while len(pts) > max_n:
        tol *= 1.6
        pts = list(poly.simplify(tol, preserve_topology=True).exterior.coords)[:-1]
    return np.asarray(pts, float)


def _dist_to_ring(pts: np.ndarray, ring: np.ndarray) -> np.ndarray:
    """Distance from each point to the closed polyline `ring` (vectorised)."""
    a = ring
    b = np.roll(ring, -1, axis=0)
    ab = b - a                                              # (m,2)
    ap = pts[:, None, :] - a[None, :, :]                    # (n,m,2)
    denom = np.maximum((ab ** 2).sum(1), 1e-18)
    t = np.clip((ap * ab[None]).sum(2) / denom[None], 0.0, 1.0)
    proj = a[None] + t[..., None] * ab[None]
    return np.linalg.norm(pts[:, None, :] - proj, axis=2).min(1)


def _search(P: np.ndarray, Q: np.ndarray, s_fixed: float | None, s_nominal: float) -> list[tuple]:
    """All similarity hypotheses from single vertex+edge correspondences, scored."""
    n, m = len(P), len(Q)
    out: list[tuple] = []
    for flip in (False, True):
        Pf = P * np.array([-1.0, 1.0]) if flip else P
        for i in range(n):
            for dp in (1, -1):
                vp = Pf[(i + dp) % n] - Pf[i]
                lp = float(np.hypot(*vp))
                if lp < 1e-9:
                    continue
                ap = math.atan2(vp[1], vp[0])
                for j in range(m):
                    for dq in (1, -1):
                        vq = Q[(j + dq) % m] - Q[j]
                        lq = float(np.hypot(*vq))
                        if lq < 1e-9:
                            continue
                        s = s_fixed if s_fixed is not None else lq / lp
                        if s_fixed is not None:
                            if abs(lq - s * lp) > 0.1 * lq + 0.5:
                                continue
                        elif not (0.3 * s_nominal <= s <= 3.0 * s_nominal):
                            continue
                        th = math.atan2(vq[1], vq[0]) - ap
                        c, sn = math.cos(th), math.sin(th)
                        A = s * np.array([[c, -sn], [sn, c]])
                        t = Q[j] - A @ Pf[i]
                        T = Pf @ A.T + t
                        a = _dist_to_ring(T, Q)            # paper vertices -> lot outline
                        b = _dist_to_ring(Q, T)            # lot vertices -> paper outline
                        cost = math.sqrt(float((a ** 2).mean())) + 0.5 * math.sqrt(float((b ** 2).mean()))
                        out.append((cost, flip, s, th, t[0], t[1]))
    return out


def propose_control_points(paper_ring: list[Pt], lot_ring: list[Pt], metres_per_point: float, *,
                           gate_m: float = 1.0) -> AutoMatch | None:
    """Match the boundary polygon found on the PDF to the lot boundary (MGA) by testing
    every vertex correspondence, both edge directions, both handedness. The hypothesis
    with the lowest residual wins; near-ties are reported as `ambiguous` and resolved
    towards the smallest |rotation| and no mirroring."""
    if len(paper_ring) < 3 or len(lot_ring) < 3:
        return None
    Q_all = np.asarray(lot_ring, float)
    off = Q_all.mean(0)
    P = _thin_ring(paper_ring, 40, 0.05)
    Q = _thin_ring([(x - off[0], y - off[1]) for x, y in lot_ring], 40, 0.02)
    msgs: list[str] = []

    cands = _search(P, Q, metres_per_point, metres_per_point)
    scale_free = False
    if not cands or min(c[0] for c in cands) > 0.5:
        free = _search(P, Q, None, metres_per_point)
        if free and (not cands or min(c[0] for c in free) < 0.5 * min(c[0] for c in cands)):
            cands = free
            scale_free = True
            msgs.append("Boundary only matches the lot with a different scale than stated.")
    if not cands:
        return None
    cands.sort(key=lambda c: c[0])
    best_cost = cands[0][0]
    near = [c for c in cands if c[0] <= best_cost + 0.02]
    distinct: list[tuple] = []
    for c in near:
        if not any(abs(math.atan2(math.sin(c[3] - d[3]), math.cos(c[3] - d[3]))) < math.radians(0.2) and c[1] == d[1]
                   and math.hypot(c[4] - d[4], c[5] - d[5]) < 0.05 for d in distinct):
            distinct.append(c)
    # prefer unmirrored, then smallest rotation magnitude
    distinct.sort(key=lambda c: (c[1], abs(math.atan2(math.sin(c[3]), math.cos(c[3])))))
    chosen = distinct[0]
    ambiguous = len(distinct) > 1
    _, flip, s, th, tx, ty = chosen
    Pf = P * np.array([-1.0, 1.0]) if flip else P
    c, sn = math.cos(th), math.sin(th)
    T = Pf @ (s * np.array([[c, -sn], [sn, c]])).T + np.array([tx, ty])
    D = np.linalg.norm(T[:, None, :] - Q[None, :, :], axis=2)
    pts: list[ControlPoint] = []
    for k in range(len(P)):
        j = int(D[k].argmin())
        if D[k, j] <= gate_m and int(D[:, j].argmin()) == k:
            pts.append(ControlPoint(f"lot_corner_{j + 1}", (float(P[k, 0]), float(P[k, 1])),
                                    (float(Q[j, 0] + off[0]), float(Q[j, 1] + off[1])),
                                    1.0, "lot_corner_match"))
    if len(pts) < 2:
        return None
    if ambiguous:
        msgs.append(f"{len(distinct)} distinct orientations fit the boundary equally well "
                    "(symmetric lot shape); smallest rotation chosen.")
    return AutoMatch(pts, float(best_cost), bool(flip), scale_free, ambiguous, len(distinct), msgs)
