"""Load cited council requirements for the report from backend/knowledge/<lga>/ (lazy, optional)."""
from __future__ import annotations

import json
import re
from pathlib import Path

KNOWLEDGE_DIR = Path(__file__).parents[2] / "knowledge"


def derive_lga(lga_name: str | None, results) -> str:
    """lga_name if SA1 gave one, else the council named in a mapped LEP ('Gunnedah Local Environmental Plan 2012')."""
    if lga_name and lga_name.strip():
        return lga_name.strip()
    for r in results:
        for a in getattr(r, "attributes", []) or []:
            m = re.match(r"^(.*?) Local Environmental Plan\b", str(a.get("EPI_NAME", "")))
            if m:
                return m[1].strip()
    return ""


PLATFORM_DEFAULT_DIR = "platform_default"


def lga_dir_candidates(lga: str, state: str | None = None) -> list[str]:
    """Folder names to try for an LGA, best first: the lga_code folder ("nsw-gunnedah"), then the legacy lowercase
    name folder ("gunnedah", "mid_western"), then the bare slug and its underscore form ("mid_western")."""
    from app.agents.requirements.lgacode import STATES, lga_slug, normalise_lga_code
    raw = lga.strip()
    out: list[str] = []
    if raw.lower().startswith(tuple(s.lower() + "-" for s in STATES)):
        out.append(raw.lower())
    states = [state.upper()] if state and state.upper() in STATES else list(STATES)
    for st in states:
        c = normalise_lga_code(st, raw)
        if c:
            out.append(c)
    slug = lga_slug(raw)                            # status words stripped: "Mid-Western Regional" -> "mid-western"
    out += [raw.lower().replace(" ", "_"), slug, slug.replace("-", "_")]
    return [c for i, c in enumerate(out) if c and c not in out[:i]]


def lga_dir(lga: str, state: str | None = None, knowledge_dir: Path | None = None) -> Path:
    """Knowledge folder for an LGA: the first existing candidate, else the legacy name folder (which may not exist)."""
    base = knowledge_dir or KNOWLEDGE_DIR
    cands = lga_dir_candidates(lga, state)
    return next((base / c for c in cands if (base / c).is_dir()), base / lga.strip().lower().replace(" ", "_"))


def _read(d: Path) -> tuple[list[dict], list[dict]]:
    reqs: list[dict] = []
    unres: list[dict] = []
    try:
        reqs = json.loads((d / "requirements.json").read_text(encoding="utf-8")).get("requirements", [])
    except (OSError, ValueError):
        pass
    try:
        u = json.loads((d / "unresolved.json").read_text(encoding="utf-8"))
        unres = u if isinstance(u, list) else u.get("unresolved", [])
    except (OSError, ValueError):
        pass
    return reqs, unres


def load_platform_default(knowledge_dir: Path | None = None) -> list[dict]:
    """Platform default profile rows (status platform_default, each stamped PLATFORM DEFAULT, LGA RULE NOT LOADED)."""
    return _read((knowledge_dir or KNOWLEDGE_DIR) / PLATFORM_DEFAULT_DIR)[0]


def load_requirements(lga: str | None, knowledge_dir: Path | None = None, *, state: str | None = None,
                      include_platform_default: bool = False) -> tuple[list[dict], list[dict]]:
    """Cited requirement rows for an LGA from knowledge/<lga_code>/ (or the legacy knowledge/<lga name>/ folder).

    ``include_platform_default`` puts the platform default profile UNDERNEATH the LGA's own rows (default rows first, so
    a consumer that takes the last match sees the LGA row). It is off by default so that the council requirements
    report, which lists rows as cited council values, never shows a stamped default as a council requirement.
    Use ``load_requirement_set`` to resolve with the full order."""
    defaults = load_platform_default(knowledge_dir) if include_platform_default else []
    if not lga:
        return defaults, []
    reqs, unres = _read(lga_dir(lga, state, knowledge_dir))
    return defaults + reqs, unres


def _unresolved_entries(unres: list[dict], lga: str, jurisdiction: str | None):
    """Requirement rows (status unresolved, LGA selector set) for the entries of an LGA's unresolved.json."""
    from app.agents.requirements.models import Requirement, Selectors
    out = []
    for u in unres:
        if not isinstance(u, dict) or not u.get("key"):
            continue
        # a free-text key such as "driveway.max_grade_pct / driveway.max_grade_change_pct" names several keys; "x.*" is a prefix
        keys = re.findall(r"[a-z][a-z0-9_]*(?:\.[a-z0-9_*]+)+", str(u["key"]))
        if not keys:
            continue
        notes = []
        if u.get("applies_to"):
            notes.append(f"Applies to: {u['applies_to']}")
        if u.get("looked"):
            looked = u["looked"]
            notes.append("Looked in: " + ("; ".join(map(str, looked)) if isinstance(looked, list) else str(looked)))
        for key in dict.fromkeys(keys):
            out.append(Requirement(key=key, applies_to=Selectors(jurisdiction=jurisdiction, lga=lga), status="unresolved",
                                   prompt=u.get("prompt") or u.get("reason"), notes=" ".join(notes) or None))
    return out


def load_requirement_set(lga: str | None, knowledge_dir: Path | None = None, *, state: str | None = None):
    """RequirementSet of the LGA's rows, the LGA's explicit unresolved entries (unresolved.json) and the platform default
    profile. ``get_requirement`` resolves in the order user_confirmed > LGA > state-wide > platform default (stamped with
    why it applies) > UnresolvedRequirement; an LGA conflict entry raises."""
    from app.agents.requirements.models import Requirement, RequirementSet, Selectors
    reqs, unres = load_requirements(lga, knowledge_dir, state=state, include_platform_default=True)
    rows = [Requirement.model_validate(r) for r in reqs]
    rs = RequirementSet(requirements=rows)
    if lga:
        lga_rows = [r for r in rows if r.status != "platform_default"]
        juris = (state.upper() if state and state.upper() in ("NSW", "QLD") else None) or next(
            (r.applies_to.jurisdiction for r in lga_rows if r.applies_to.lga and r.applies_to.jurisdiction), None)
        if lga_rows or unres:
            rs.loaded.append(Selectors(jurisdiction=juris, lga=lga))
        rs.requirements += _unresolved_entries(unres, lga, juris)
    return rs
