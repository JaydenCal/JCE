"""Requirement lookups for the site design engines (driveway profile, grading).

Every limit used by a check comes from here, and here only from the requirements resolver (``RequirementSet.get_requirement``: the user's
confirmed value, then the LGA rule, then the state rule, then a platform default where the platform defines one, otherwise UNRESOLVED). The
engines never carry a grade, a transition, a width, an offset or a batter slope of their own. A value the resolver cannot give is returned as
a ``Rule`` with ``value=None`` and basis ``UNRESOLVED``; the check built from it is "NOT EVALUATED" and says which key is missing.

The JCE drainage conventions are not used anywhere in this module or in the engines that call it.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from app.agents.requirements.models import RequirementSet, UnresolvedRequirement

from . import object_keys as OK

#: how a rule was resolved, as shown on a check and on the object
LGA, STATE, DEFAULT, USER, UNRESOLVED = "LGA RULE", "STATE RULE", "PLATFORM DEFAULT", "USER", "UNRESOLVED"
#: bases of a parameter read from a DBYD plan (parsed, not measured) and of a value the server computed from a requirement
PLAN_INDICATED, DERIVED = "PLAN INDICATED", "DERIVED"

KEY_MAX_GRADE = "driveway.max_grade_pct"
KEY_MAX_CHANGE = "driveway.max_grade_change_pct"
KEY_MIN_WIDTH = "driveway.min_width_m"
KEY_MAX_WIDTH = "driveway.max_width_m"
KEY_MIN_SEPARATION = "driveway.min_separation_m"
#: kerb return splay of the crossover footprint (m). Registered as an extension key (``app.agents.requirements.models.DRIVEWAY_KEY_HELP``); the platform
#: default profile has NO row for it, so it is UNRESOLVED until an LGA row or a user entry supplies it and the engines then draw no splay.
KEY_SPLAY = "driveway.crossover_splay_m"
KEY_BATTER_CUT = "earthworks.batter.cut_max_slope"
KEY_BATTER_FILL = "earthworks.batter.fill_max_slope"
KEY_BATTER_ANY = "earthworks.batter.max_slope"
KEYS = (KEY_MAX_GRADE, KEY_MAX_CHANGE, KEY_MIN_WIDTH, KEY_MAX_WIDTH, KEY_MIN_SEPARATION, KEY_SPLAY, KEY_BATTER_CUT, KEY_BATTER_FILL, KEY_BATTER_ANY)

#: canonical units that are not in the conversion table (``app.jurisdiction.units``): a requirement row must carry exactly this unit
OK_STRICT_UNITS = frozenset({"deg", "kN/m3", "L/person/day", "L/m2/day", "days"})

#: units a batter requirement may be stated in, and how each converts to H per V (horizontal metres per vertical metre)
_HV_UNITS = {None, "", "h:v", "h_per_v", "h per v", "hv", "ratio", "1 in n", "1_in_n", "1:n"}


@dataclass(frozen=True)
class Rule:
    """One resolved (or unresolved) requirement. ``value`` is in the unit the engine uses for that key (see ``unit``)."""
    key: str
    value: Any                      # a number, a bool (kind bool) or a list of numbers (kind list); None when UNRESOLVED
    unit: str
    basis: str                      # LGA RULE, STATE RULE, PLATFORM DEFAULT, USER or UNRESOLVED
    ref: str                        # citation text, or why it is unresolved
    stamp: str | None = None        # the stamp text of a platform default

    @property
    def resolved(self) -> bool:
        return self.value is not None

    def public(self) -> dict[str, Any]:
        d = {"key": self.key, "value": self.value, "unit": self.unit, "basis": self.basis, "ref": self.ref}
        if self.stamp:
            d["stamp"] = self.stamp
        return d


def _unresolved(key: str, unit: str, why: str) -> Rule:
    return Rule(key, None, unit, UNRESOLVED, why)


def hv_from(value: float, unit: str | None) -> float | None:
    """A batter slope as H per V from a requirement value: a ratio as given, a percentage (rise over run, so H per V = 100 / pct) or an angle."""
    u = (unit or "").strip().lower()
    if not math.isfinite(value) or value <= 0:
        return None
    if u in _HV_UNITS:
        return value
    if u in ("%", "percent"):
        return 100.0 / value
    if u in ("deg", "degree", "degrees", "°"):
        return 1.0 / math.tan(math.radians(value)) if 0 < value < 90 else None
    return None


class SiteRules:
    """The requirements of one project's LGA. ``requirements`` None means the lot or its LGA is not known: every key is UNRESOLVED."""

    def __init__(self, requirements: RequirementSet | None, lga: str | None = None, jurisdiction: str | None = None, note: str = "") -> None:
        self.requirements, self.lga, self.jurisdiction, self.note = requirements, lga, jurisdiction, note
        self._cache: dict[str, Rule] = {}

    @property
    def selectors(self) -> dict[str, Any]:
        return {"jurisdiction": self.jurisdiction, "lga": self.lga}

    def label(self) -> str:
        return f"{self.lga} ({self.jurisdiction})" if self.lga and self.jurisdiction else (self.lga or "LGA NOT KNOWN")

    def get(self, key: str) -> Rule:
        """The rule for a key, as a number in the canonical unit of the key (bool and list keys are read with ``get_flag`` and ``get_list``)."""
        return self.get_for(key)

    def get_for(self, key: str, **sel: Any) -> Rule:
        """The rule for a key resolved with extra selectors (``service``, ``dia_mm`` and ``authority`` = the asset owner), on top of the project's LGA and
        jurisdiction. A selector given as None is left out. The answer is cached per key and selectors."""
        sel = {k: v for k, v in sel.items() if v is not None}
        ck = key if not sel else key + "|" + "|".join(f"{k}={sel[k]}" for k in sorted(sel))
        if ck in self._cache:
            return self._cache[ck]
        spec = OK.spec_for(key)          # a zone qualified key (rwt.max_height_m.rural) takes the unit and kind of its family, never a guess from the key ending
        unit = spec.unit if spec else "%" if key.endswith("_pct") else "m" if key.endswith("_m") else "H per V" if key.startswith("earthworks.batter") else ""
        if self.requirements is None:
            r = _unresolved(key, unit, self.note or "NO LOT OR LGA IS KNOWN FOR THIS PROJECT, SO NO REQUIREMENT CAN BE RESOLVED")
        else:
            try:
                req = self.requirements.get_requirement(key, **{**self.selectors, **sel})
            except UnresolvedRequirement as e:
                r = _unresolved(key, unit, e.prompt or "NO REQUIREMENT FOUND")
            else:
                r = self._from_spec(key, req, spec) if spec is not None and spec.kind != "number" else self._from_requirement(key, req, unit)
        self._cache[ck] = r
        return r

    def get_flag(self, key: str) -> Rule:
        """A true or false rule (kind bool). A number or text value is UNRESOLVED."""
        return self.get(key)

    def get_list(self, key: str) -> Rule:
        """A list rule (kind list): the value is a list of numbers, or None when UNRESOLVED."""
        return self.get(key)

    def keys_under(self, prefix: str) -> list[str]:
        """Keys with this prefix that hold a usable row in the requirement set (sorted). Used for zone qualified families such as ``rwt.max_height_m.*``."""
        if self.requirements is None:
            return []
        return sorted({r.key for r in self.requirements.requirements if r.key.startswith(prefix) and r.status in ("resolved", "user_confirmed") and r.value is not None})

    def all_keys_under(self, prefix: str) -> list[str]:
        """Every key with this prefix that has a row in the requirement set, whatever its status (sorted). The keys that do not resolve are named by the checks."""
        if self.requirements is None:
            return []
        return sorted({r.key for r in self.requirements.requirements if r.key.startswith(prefix)})

    def _from_spec(self, key: str, req: Any, spec: "OK.KeySpec") -> Rule:
        """Boolean, ratio, count and list keys. A value of the wrong kind or an unconvertible unit is UNRESOLVED (never coerced)."""
        v = req.value
        if spec.kind == "bool":
            if not isinstance(v, bool):
                return _unresolved(key, "", f"THE VALUE FOR {key} IS NOT TRUE OR FALSE")
            return self._wrap(key, req, v, "")
        if spec.kind == "list":
            if isinstance(v, (bool, type(None))):
                return _unresolved(key, "", f"THE VALUE FOR {key} IS NOT A LIST OF NUMBERS")
            try:
                items = [float(x) for x in ([v] if isinstance(v, (int, float)) else str(v).split(","))]
            except ValueError:
                return _unresolved(key, "", f"THE VALUE FOR {key} IS NOT A COMMA SEPARATED LIST OF NUMBERS")
            if not items or not all(math.isfinite(x) for x in items) or (spec.length is not None and len(items) != spec.length):
                return _unresolved(key, "", f"THE LIST FOR {key} " + (f"NEEDS EXACTLY {spec.length} NUMBERS" if spec.length else "IS EMPTY"))
            return self._wrap(key, req, items, "")
        # ratio and count: dimensionless; any other unit on the row is not guessed
        if isinstance(v, (bool, str)) or v is None or not math.isfinite(float(v)):
            return _unresolved(key, spec.unit, f"THE VALUE FOR {key} IS NOT A NUMBER")
        if (req.unit or "").strip().lower() not in OK.DIMENSIONLESS_UNITS:
            return _unresolved(key, spec.unit, f"THE UNIT {req.unit!r} OF {key} IS NOT DIMENSIONLESS")
        return self._wrap(key, req, float(v), spec.unit)

    def _wrap(self, key: str, req: Any, value: Any, unit: str) -> Rule:
        if req.is_platform_default:
            return Rule(key, value, unit, DEFAULT, req.citation(), req.stamp)
        basis = USER if req.status == "user_confirmed" else LGA if req.applies_to.lga else STATE
        return Rule(key, value, unit, basis, req.citation())

    def _from_requirement(self, key: str, req: Any, unit: str) -> Rule:
        if isinstance(req.value, (bool, str)) or req.value is None:
            return _unresolved(key, unit, f"THE VALUE FOR {key} IS NOT A NUMBER")
        v = float(req.value)
        if key.startswith("earthworks.batter"):
            hv = hv_from(v, req.unit)
            if hv is None:
                return _unresolved(key, unit, f"THE UNIT {req.unit!r} OF {key} IS NOT A BATTER SLOPE UNIT (H PER V, PERCENT OR DEGREES)")
            v = hv
        elif req.unit and req.unit != unit:
            if unit in OK_STRICT_UNITS:                      # a unit the conversion table does not know: only an exact match is accepted, never a guess
                return _unresolved(key, unit, f"THE UNIT {req.unit!r} OF {key} IS NOT {unit}")
            try:
                v = req.value_in(unit)
            except Exception:  # noqa: BLE001  (unit error: report it, never guess)
                return _unresolved(key, unit, f"THE UNIT {req.unit!r} OF {key} COULD NOT BE CONVERTED TO {unit}")
        if req.is_platform_default:
            return Rule(key, v, unit, DEFAULT, req.citation(), req.stamp)
        basis = LGA if req.applies_to.lga else STATE
        if req.status == "user_confirmed":
            basis = USER
        return Rule(key, v, unit, basis, req.citation())

    def batter(self, which: str) -> Rule:
        """The batter slope rule for ``cut`` or ``fill``: the specific key, else the general maximum slope key, else UNRESOLVED (naming both)."""
        first = self.get(KEY_BATTER_CUT if which == "cut" else KEY_BATTER_FILL)
        if first.resolved:
            return first
        general = self.get(KEY_BATTER_ANY)
        if general.resolved:
            return general
        key = KEY_BATTER_CUT if which == "cut" else KEY_BATTER_FILL
        return Rule(key, None, "H per V", UNRESOLVED, f"{first.ref} (ALSO NOT FOUND: {KEY_BATTER_ANY})")

    def all_public(self) -> dict[str, dict[str, Any]]:
        return {k: self.get(k).public() for k in KEYS}


def _knowledge_stamp(lga: str, jurisdiction: str | None) -> tuple:
    """(path, mtime_ns, size) of every knowledge file the requirement set of an LGA is read from: the platform default profile and the LGA folder
    candidates. It is part of the cache key, so editing, adding or removing a knowledge file makes the next request re-read them."""
    from app.report import knowledge as K
    folders = [K.KNOWLEDGE_DIR / K.PLATFORM_DEFAULT_DIR] + [K.KNOWLEDGE_DIR / c for c in K.lga_dir_candidates(lga, jurisdiction)]
    out = []
    for d in folders:
        for name in ("requirements.json", "unresolved.json"):
            try:
                st = (d / name).stat()
                out.append((str(d / name), st.st_mtime_ns, st.st_size))
            except OSError:
                out.append((str(d / name), None, None))
    return tuple(out)


@lru_cache(maxsize=32)
def _requirement_set_cached(lga: str | None, jurisdiction: str | None, stamp: tuple) -> RequirementSet:
    from app.report.knowledge import load_requirement_set
    return load_requirement_set(lga, state=jurisdiction)


def _requirement_set(lga: str | None, jurisdiction: str | None) -> RequirementSet:
    return _requirement_set_cached(lga, jurisdiction, _knowledge_stamp(lga, jurisdiction) if lga else ())


def rules_for(lga: str | None, jurisdiction: str | None) -> SiteRules:
    """Rules for an LGA from the platform knowledge folder (LGA rows, state rows and the platform default profile, in the resolver's order)."""
    if not lga:
        return SiteRules(None, None, jurisdiction, "THE PROJECT LOT HAS NO LGA, SO NO COUNCIL REQUIREMENT CAN BE RESOLVED")
    return SiteRules(_requirement_set(lga, jurisdiction), lga, jurisdiction)


def project_rules(conn: Any, project_id: Any) -> SiteRules:
    """Rules for a project: the LGA and jurisdiction of its primary lot. A project without a lot gets rules that are all UNRESOLVED."""
    row = conn.execute("SELECT l.lga_name, l.jurisdiction FROM core.projects p JOIN cadastre.lots l ON l.lot_id = p.primary_lot_id "
                       "WHERE p.project_id=%s", (project_id,)).fetchone()
    if row is None:
        return SiteRules(None, None, None, "THIS PROJECT HAS NO PRIMARY LOT, SO NO COUNCIL REQUIREMENT CAN BE RESOLVED")
    return rules_for(row["lga_name"], row["jurisdiction"])
