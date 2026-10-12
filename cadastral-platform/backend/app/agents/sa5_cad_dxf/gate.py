"""Export gate: all nine acknowledgements must be on file (mirrors legal.export_gate_missing)."""
from __future__ import annotations

from typing import Iterable

from app.agents.base import AgentError
from app.common.contracts import AckKind

ACK_TEXT: dict[AckKind, str] = {
    AckKind.dbyd_physical_verification: "Services: BYDA plans and physical location (potholing) required before excavation.",
    AckKind.setback_user_verification: "Setbacks and envelope to be verified with the consent authority.",
    AckKind.cut_fill_indicative_only: "Cut/fill quantities are indicative only.",
    AckKind.retaining_wall_not_structural: "Retaining walls shown are not structurally designed.",
    AckKind.crossover_not_certified: "Driveway and crossover are not certified to council standards.",
    AckKind.cadastre_not_survey: "Cadastral boundaries are not a survey; engage a registered surveyor.",
    AckKind.uploaded_plan_accuracy: "Uploaded architectural plan alignment is approximate.",
    AckKind.upload_rights_warranty: "User warrants rights to use the uploaded plans.",
    AckKind.hydrology_not_certified: "Hydrology/RWT sizing is not certified.",
}


def missing_acknowledgements(present: Iterable[AckKind]) -> list[AckKind]:
    have = set(present)
    return [k for k in AckKind if k not in have]


def check_export_gate(present: Iterable[AckKind]) -> None:
    """Raise AgentError('EXPORT_GATE_BLOCKED', 'missing: ...') unless all 9 kinds are present."""
    missing = missing_acknowledgements(present)
    if missing:
        raise AgentError("EXPORT_GATE_BLOCKED", "missing: " + ", ".join(k.value for k in missing))
