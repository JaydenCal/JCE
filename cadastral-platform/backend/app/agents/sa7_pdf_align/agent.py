"""SA7 Architectural PDF Ingestor & Spatial Aligner.

PlanUpload (plan_upload.v1) -> PlanOverlay (plan_overlay.v1). Stateless and
deterministic: no model is called here. The only optional model seam is the
`classifier_hook` passed to the constructor and used by slab.find_slab when
heuristic confidence is below 0.85.

Stable error codes (AgentError.error_code):
  PDF_UNREADABLE        file missing / not a PDF / page out of range / no drawable content
  PDF_HASH_MISMATCH     bytes do not match PlanUpload.file_sha256
  SCALE_UNREADABLE      no scale in title block, scale bar or dimension strings and none supplied
  NO_SLAB_FOUND         no closed region qualifies as a slab/footprint
  LOT_GEOMETRY_INVALID  LotContext.boundary_wkt / envelope_wkt cannot be parsed
  NO_CONTROL_POINTS     no boundary polygon on the PDF matched the lot and no user points given
  ALIGN_REFUSED         RMSE > 0.30 m or the solve failed (partial overlay on `.partial_overlay`)
"""
from __future__ import annotations

import hashlib
import math
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import shapely
from shapely import wkt as shapely_wkt
from shapely.affinity import affine_transform
from shapely.geometry import MultiPolygon, Polygon
from shapely.geometry.polygon import orient

from app.agents.base import AgentError
from app.common.contracts import AgentCode, PlanOverlay, PlanUpload

from . import align as al
from . import pdf_extract as px
from . import scale as sc
from . import slab as sl

AGENT_VERSION = "0.1.0"
SCALE_CONFIDENCE_MIN = 0.7
SLAB_CONFIDENCE_MIN = 0.6
_NS = uuid.UUID("5a7b0c1e-7a11-4d6e-9c0a-5a7000000007")


@dataclass
class Sa7Run:
    """Everything produced by a run; `overlay` is the contract output, the rest lets the
    caller persist plans.plan_vector_entities / alignment_control_points."""
    overlay: PlanOverlay
    page_number: int
    content: px.PageContent
    scale: sc.ScaleResult
    slab: sl.SlabResult
    alignment: al.AlignResult
    control_points: list[al.ControlPoint]
    messages: list[str] = field(default_factory=list)


def _default_loader(path: str) -> bytes:
    p = path[7:] if path.startswith("file://") else path
    if re.match(r"^[a-z][a-z0-9+.-]*://", p, re.I):
        raise OSError(f"unsupported storage scheme in {path!r}; inject a loader")
    return Path(p).read_bytes()


def _largest_polygon(g) -> Polygon | None:
    if g is None or g.is_empty:
        return None
    if isinstance(g, MultiPolygon):
        return max(g.geoms, key=lambda x: x.area)
    return g if isinstance(g, Polygon) else None


def _parse_polygon(wkt_text: str, what: str) -> Polygon:
    try:
        g = shapely_wkt.loads(wkt_text)
    except Exception as exc:  # noqa: BLE001
        raise AgentError("LOT_GEOMETRY_INVALID", f"{what} is not valid WKT: {exc}") from exc
    if not g.is_valid:
        g = g.buffer(0)
    poly = _largest_polygon(g)
    if poly is None:
        raise AgentError("LOT_GEOMETRY_INVALID", f"{what} is not a polygon")
    return poly


class Sa7PdfAligner:
    code = AgentCode.SA7_PDF_ALIGN
    version = AGENT_VERSION
    input_schema = "plan_upload.v1"
    output_schema = "plan_overlay.v1"
    input_model = PlanUpload

    def __init__(self, *, classifier_hook: sl.ClassifierHook | None = None,
                 loader: Callable[[str], bytes] | None = None) -> None:
        self.classifier_hook = classifier_hook
        self._loader = loader or _default_loader

    # ------------------------------------------------------------------
    def run(self, payload: PlanUpload) -> PlanOverlay:
        return self.run_detailed(payload).overlay

    def run_detailed(self, payload: PlanUpload) -> Sa7Run:
        data = self._read(payload)
        page_no = payload.selected_page or self._choose_page(data)
        try:
            content = px.extract_page(data, page_no)
        except px.PdfReadError as exc:
            raise AgentError("PDF_UNREADABLE", str(exc)) from exc
        if not (content.n_vector_objects or content.raster_polygons or content.texts):
            raise AgentError("PDF_UNREADABLE", f"page {page_no} has no drawable content")

        scale = sc.resolve_scale(content, payload.user_scale_denominator)
        if scale.denominator is None or scale.metres_per_point is None:
            raise AgentError("SCALE_UNREADABLE", "; ".join(scale.messages) or "no scale found")
        mpp = scale.metres_per_point

        slab = sl.find_slab(content, mpp, hook=self.classifier_hook)
        if slab.best is None:
            raise AgentError("NO_SLAB_FOUND", "; ".join(slab.messages) or "no candidate slab polygon")

        lot_poly = _parse_polygon(payload.lot.boundary_wkt, "lot.boundary_wkt")
        msgs: list[str] = list(scale.messages) + list(slab.messages)

        points, ambiguous, solver_hint = self._control_points(payload, slab, lot_poly, mpp, msgs)
        result = al.align(points, mpp, ambiguous=ambiguous, solver_hint=solver_hint)
        msgs.extend(result.messages)
        if result.sim is None:
            raise AgentError("ALIGN_REFUSED", "; ".join(result.messages) or "alignment failed")

        outcome: al.Outcome = result.outcome
        if scale.confidence < SCALE_CONFIDENCE_MIN:
            outcome = al.worse(outcome, "needs_user_confirmation")
            msgs.append(f"Scale confidence {scale.confidence:.2f} is below {SCALE_CONFIDENCE_MIN}; confirm the scale.")
        if slab.confidence < SLAB_CONFIDENCE_MIN:
            outcome = al.worse(outcome, "needs_user_confirmation")
        if outcome == "refused" and result.free_rmse_m is not None and result.free_rmse_m <= al.RMSE_ACCEPT_M \
                and result.fitted_mpp:
            msgs.append(f"Control points fit well at about 1:{sc.denominator_from_mpp(result.fitted_mpp):.0f}; "
                        "the stated scale is probably wrong.")

        overlay = self._build_overlay(payload, scale, slab, result, outcome, msgs)
        if outcome == "refused":
            err = AgentError("ALIGN_REFUSED", f"RMSE {result.rmse_m:.3f} m > {al.RMSE_CONFIRM_M} m; " + "; ".join(msgs))
            err.partial_overlay = overlay  # type: ignore[attr-defined]
            raise err
        return Sa7Run(overlay, page_no, content, scale, slab, result, points, msgs)

    # ------------------------------------------------------------------
    def _read(self, payload: PlanUpload) -> bytes:
        try:
            data = self._loader(payload.storage_path)
        except OSError as exc:
            raise AgentError("PDF_UNREADABLE", f"cannot read {payload.storage_path}: {exc}") from exc
        if hashlib.sha256(data).hexdigest() != payload.file_sha256.lower():
            raise AgentError("PDF_HASH_MISMATCH", "stored bytes do not match file_sha256")
        if not data.lstrip()[:5].startswith(b"%PDF"):
            raise AgentError("PDF_UNREADABLE", "not a PDF (missing %PDF header)")
        try:
            px.page_count(data)
        except px.PdfReadError as exc:
            raise AgentError("PDF_UNREADABLE", str(exc)) from exc
        return data

    @staticmethod
    def _choose_page(data: bytes) -> int:
        """Pick the sheet most likely to be the site plan (text only; cheap)."""
        try:
            import pymupdf
            doc = pymupdf.open(stream=data, filetype="pdf")
        except Exception:  # noqa: BLE001
            return 1
        best, best_score = 1, -1
        try:
            for i in range(min(len(doc), 12)):
                txt = doc[i].get_text().upper()
                score = 0
                if "SITE PLAN" in txt:
                    score += 3
                if "SITE" in txt:
                    score += 1
                if re.search(r"1\s*:\s*\d{2,4}", txt):
                    score += 1
                if score > best_score:
                    best, best_score = i + 1, score
        finally:
            doc.close()
        return best

    def _control_points(self, payload: PlanUpload, slab: sl.SlabResult, lot_poly: Polygon, mpp: float,
                        msgs: list[str]) -> tuple[list[al.ControlPoint], bool, str | None]:
        user = payload.user_control_points
        if len(user) >= 2:
            pts = [al.ControlPoint(f"user_{i + 1}", (float(p[0]), float(p[1])), (float(q[0]), float(q[1])),
                                   1.0, "user_picked") for i, (p, q) in enumerate(user)]
            return pts, False, "user_manual"
        if len(user) == 1:
            msgs.append("A single user control point is not enough; trying automatic matching.")
        if slab.boundary is None:
            raise AgentError("NO_CONTROL_POINTS",
                             "no site-plan boundary polygon found on the sheet; supply two or more user control points")
        match = al.propose_control_points(sl.clean_ring(slab.boundary), list(lot_poly.exterior.coords)[:-1], mpp)
        if match is None:
            raise AgentError("NO_CONTROL_POINTS",
                             "the boundary on the sheet could not be matched to the lot; supply user control points")
        msgs.extend(match.messages)
        if match.flipped:
            msgs.append("Boundary matched the lot only when mirrored.")
        return match.points, match.ambiguous, None

    def _build_overlay(self, payload: PlanUpload, scale: sc.ScaleResult, slab: sl.SlabResult,
                       result: al.AlignResult, outcome: al.Outcome, msgs: list[str]) -> PlanOverlay:
        sim = result.sim
        assert sim is not None and slab.best is not None
        fp = affine_transform(slab.best.polygon, list(sim.params))
        fp = orient(fp) if fp.geom_type == "Polygon" else fp
        if fp.geom_type == "Polygon":
            fp = MultiPolygon([fp])
        area = float(fp.area)

        inside = encroach = None
        if payload.lot.envelope_wkt:
            env = _parse_polygon(payload.lot.envelope_wkt, "lot.envelope_wkt")
            outside = fp.difference(env)
            encroach = round(float(outside.area), 3)
            inside = bool(fp.difference(env.buffer(0.001)).area < 1e-4)
            if inside:
                encroach = 0.0

        rot = math.atan2(math.sin(sim.rotation_rad), math.cos(sim.rotation_rad))
        key = f"{payload.upload_id}|{payload.file_sha256}|{AGENT_VERSION}|" + ",".join(f"{v:.6f}" for v in sim.params)
        return PlanOverlay(
            overlay_id=uuid.uuid5(_NS, key),
            upload_id=payload.upload_id,
            scale_denominator_used=float(scale.denominator),  # type: ignore[arg-type]
            scale_source=scale.source,  # type: ignore[arg-type]
            scale_confidence=float(scale.confidence),
            metres_per_point=float(scale.metres_per_point),  # type: ignore[arg-type]
            rotation_rad=rot,
            transform=sim.params,
            matrix_3x3=sim.matrix_3x3,
            reflection_applied=bool(sim.reflected),
            control_point_count=int(result.control_point_count),
            rmse_m=round(float(result.rmse_m), 4),
            max_residual_m=round(float(result.max_residual_m), 4),
            footprint_wkt=shapely.to_wkt(fp, rounding_precision=4),
            footprint_area_m2=round(area, 3),
            inside_envelope=inside,
            envelope_encroachment_m2=encroach,
            outcome=outcome,
            messages=list(dict.fromkeys(m for m in msgs if m)),
        )
