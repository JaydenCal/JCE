"""Basis-aware reading of an object parameter (stage 7 review fix).

A parameter on a site object carries a value AND a basis (``user``, ``lga_rule``, ``platform_default`` or ``unresolved``). A check, the wall screening and the
tank sizing read their engineering inputs ONLY through this module, and a value is accepted by its basis:

* ``user``: accepted. The value was entered by the user.
* ``lga_rule``: accepted ONLY when its reference (``ref``) names a requirement key that the server resolver actually resolves, for the project's LGA, to the
  SAME value (and, where the parameter has a registered key in ``object_keys.PARAM_RULE_KEYS``, the reference must be that key). Otherwise the parameter is read as
  UNRESOLVED and the reason is ``LGA RULE REFERENCE NOT VERIFIED``. The stored basis is a claim made by the client; the server never takes it on trust.
* ``platform_default``: refused for every stage 7 parameter, except a parameter of one of the two registered platform default keys
  (``object_keys.PLATFORM_DEFAULT_KEYS``) when the resolver gives that default for this project and the value is the same.
* ``unresolved`` or no value: not set.

The basis of what is read is the TRUE basis (the resolver's own basis for a verified rule, ``USER`` only for a user entry): it is never relabelled.

A numeric value beyond ``MAX_ABS`` is refused as out of range. That is a sanity limit that keeps the arithmetic of the checks finite, not an engineering value.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from . import object_keys as OK
from .site_design import SiteObject
from .site_rules import DEFAULT, UNRESOLVED, USER, SiteRules

LGA_NOT_VERIFIED = "LGA RULE REFERENCE NOT VERIFIED"
MAX_ABS = 1.0e9


@dataclass(frozen=True)
class Read:
    """What a parameter reads as. ``value`` is None when it is not set or was refused; ``why`` then names the refusal (empty when simply not set)."""
    value: Any = None
    basis: str = UNRESOLVED
    ref: str = ""
    stamp: str | None = None
    why: str = ""

    @property
    def ok(self) -> bool:
        return self.value is not None


def _same(a: Any, b: Any) -> bool:
    if isinstance(a, bool) or isinstance(b, bool) or isinstance(a, str) or isinstance(b, str):
        return a == b
    try:
        return math.isclose(float(a), float(b), rel_tol=1e-9, abs_tol=1e-9)
    except (TypeError, ValueError):
        return False


def read(o: SiteObject, key: str, rules: SiteRules | None = None) -> Read:
    """The value, true basis and reference of parameter ``key`` of ``o``, or an unset Read (with ``why`` when a value was refused)."""
    p = o.params.get(key)
    if p is None or p.basis == "unresolved" or p.value is None:
        return Read()
    name = key.upper()
    v = p.value
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if not math.isfinite(v):
            return Read(why=f"{name}: THE VALUE IS NOT A FINITE NUMBER")
        if abs(v) > MAX_ABS:
            return Read(why=f"{name}: THE VALUE IS OUT OF RANGE")
    if p.basis == "user":
        return Read(v, USER, (p.ref or "").strip() or f"ENTERED ON THE OBJECT ({key})")
    expected = OK.PARAM_RULE_KEYS.get((o.type, key))
    if p.basis == "lga_rule":
        ref = (p.ref or "").strip()
        why = f"{name}: {LGA_NOT_VERIFIED}"
        if not ref:
            return Read(why=f"{why} (NO REQUIREMENT KEY IS NAMED)")
        if rules is None:
            return Read(why=f"{why} (NO REQUIREMENTS ARE LOADED FOR THIS PROJECT)")
        if expected is not None and ref != expected:
            return Read(why=f"{why} (THE REFERENCE MUST BE {expected.upper()})")
        rule = rules.get(ref)
        if not rule.resolved:
            return Read(why=f"{why} ({ref.upper()} DOES NOT RESOLVE FOR THIS LGA)")
        if rule.basis in (DEFAULT, UNRESOLVED):
            return Read(why=f"{why} ({ref.upper()} RESOLVES ONLY TO A PLATFORM DEFAULT, NOT AN LGA RULE)")
        if not _same(v, rule.value):
            return Read(why=f"{why} (THE SERVER RESOLVES {ref.upper()} TO A DIFFERENT VALUE)")
        return Read(v, rule.basis, rule.ref or ref)
    if p.basis == "platform_default":
        if expected in OK.PLATFORM_DEFAULT_KEYS and rules is not None:
            rule = rules.get(expected)
            if rule.resolved and rule.basis == DEFAULT and _same(v, rule.value):
                return Read(v, DEFAULT, rule.ref, rule.stamp)
        return Read(why=f"{name}: A PLATFORM DEFAULT IS NOT ACCEPTED FOR THIS PARAMETER")
    return Read(why=f"{name}: THE BASIS IS NOT KNOWN")


class Reader:
    """Reads parameters with one set of rules and records every refusal (object id -> key -> reason) so a NOT EVALUATED check can name it."""

    def __init__(self, rules: SiteRules | None = None, refusals: dict[str, dict[str, str]] | None = None) -> None:
        self.rules = rules
        self.refusals = refusals

    def read(self, o: SiteObject, key: str) -> Read:
        r = read(o, key, self.rules)
        if r.why and self.refusals is not None:
            self.refusals.setdefault(o.id, {})[key] = r.why
        return r

    def num(self, o: SiteObject, key: str) -> float | None:
        """A numeric parameter that is set and accepted (any sign), else None."""
        v = self.read(o, key).value
        return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None

    def pos(self, o: SiteObject, key: str) -> float | None:
        """A numeric parameter that is set, accepted and above zero, else None."""
        v = self.num(o, key)
        return v if v is not None and v > 0 else None

    def flag(self, o: SiteObject, key: str) -> bool | None:
        v = self.read(o, key).value
        return v if isinstance(v, bool) else None

    def text(self, o: SiteObject, key: str) -> str | None:
        v = self.read(o, key).value
        return v if isinstance(v, str) and v.strip() else None


#: a reader with no requirements: only USER values are accepted (an LGA rule cannot be verified without them)
NO_RULES = Reader(None)
