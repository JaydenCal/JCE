"""Sub-Agent 5: CAD & annotation pipeline (DXF R2018 + vector PDF)."""
from __future__ import annotations

import hashlib
import logging
from pathlib import Path

from app.agents.base import AgentError
from app.agents.sa5_cad_dxf.annotate import generate_annotations
from app.agents.sa5_cad_dxf.dxf_builder import build_dxf
from app.agents.sa5_cad_dxf.gate import check_export_gate
from app.agents.sa5_cad_dxf.model import CadRequestSa5, build_plan_model
from app.agents.sa5_cad_dxf.pdf_builder import build_pdf
from app.agents.sa5_cad_dxf.sheet import compute_fit, content_bounds
from app.common.contracts import AgentCode, CadRequest, CadResult

log = logging.getLogger(__name__)


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class Sa5CadDxf:
    code = AgentCode.SA5_CAD_DXF
    version = "1.0.0"
    input_schema = "cad_request.v1"
    output_schema = "cad_result.v1"
    input_model = CadRequestSa5

    def __init__(self) -> None:
        # Non-contract side channel: warnings and fit info of the last run.
        self.last_run_info: dict = {}

    def run(self, payload: CadRequest) -> CadResult:
        # Gate first: nothing is generated unless all nine acknowledgements exist.
        check_export_gate(payload.acknowledgements_present)
        req = payload if isinstance(payload, CadRequestSa5) else CadRequestSa5(**payload.model_dump())
        model = build_plan_model(req)
        aset = generate_annotations(model, model.scale, include_disclaimer=True)
        acks = list(req.acknowledgements_present)
        fit_dxf = compute_fit(content_bounds(model, aset.items, True), model.scale)
        fit_pdf = compute_fit(content_bounds(model, aset.items, False), model.scale)

        stem = Path(req.output_path)
        if stem.suffix.lower() in (".dxf", ".pdf"):
            stem = stem.with_suffix("")
        stem.parent.mkdir(parents=True, exist_ok=True)
        warnings = list(model.warnings)
        if aset.unresolved:
            warnings.append(f"{aset.unresolved} label(s) could not be moved clear of a collision")

        result: dict = {"dxf_path": None, "dxf_sha256": None, "pdf_path": None, "pdf_sha256": None}
        dxf_path = stem.with_name(stem.name + ".dxf")
        build = build_dxf(model, aset, fit_dxf, acks, dxf_path if "dxf" in req.export_formats else None)
        auditor = build.doc.audit()
        if auditor.errors:
            raise AgentError("DXF_AUDIT_FAILED", "; ".join(e.message for e in auditor.errors[:5]))
        if "dxf" in req.export_formats:
            result["dxf_path"] = str(dxf_path)
            result["dxf_sha256"] = _sha256(dxf_path)
            if not fit_dxf.fits:
                warnings.append(fit_dxf.message)
        if "pdf" in req.export_formats:
            pdf_path = stem.with_name(stem.name + ".pdf")
            pb = build_pdf(model, aset, fit_pdf, acks, pdf_path)
            warnings.extend(w for w in pb.warnings if w not in warnings)
            result["pdf_path"] = str(pdf_path)
            result["pdf_sha256"] = _sha256(pdf_path)

        for w in warnings:
            log.warning("SA5: %s", w)
        self.last_run_info = {
            "warnings": warnings,
            "fits_a3": fit_pdf.fits,
            "suggested_scale_denominator": fit_pdf.suggested_scale,
            "unresolved_label_collisions": aset.unresolved,
        }
        return CadResult(layers_used=build.layers_used, entity_counts=build.entity_counts,
                         annotation_count=len(aset.drawn), **result)
