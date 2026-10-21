"""Existing services (``service_existing``) as the stage 8 checks read them.

Nothing here has a default: a depth, a size, an owner, a tolerance or a date that the object does not carry is NOT SET, and a value that is derived from a rule
(the exclusion buffer, the plan expiry from a validity period) is UNRESOLVED until the requirement key resolves. A depth is used only when its basis is stated
(plan indicated, potholed or surveyed) AND its reference (to the top of the asset or to the invert) is stated, so a vertical clearance is never computed from a
depth whose meaning is unknown.

Wording: upper case labels, no em or en dash, dates shown as DD/MM/YYYY (stored as ISO dates).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from shapely.geometry import LineString, Point
from shapely.geometry.base import BaseGeometry

from .param_basis import Reader
from .site_design import Issue, SiteDesign, SiteObject
from .site_rules import Rule, SiteRules

PLAN_EXPIRED = "PLAN EXPIRED"
UNVERIFIED_LABEL = "UNVERIFIED, INDICATIVE ONLY"
NOT_SET = "NOT SET"
DEPTH_NOT_AVAILABLE = "DEPTH DATA NOT AVAILABLE"
#: depth bases a depth may carry and still be used (``unknown`` means the depth cannot be relied on)
USABLE_DEPTH_BASES = ("plan_indicated", "potholed", "surveyed")


#: the time zone in which "today" is worked out for plan expiry. The project model has no time zone of its own (all projects are Australian lots), so the zone of the
#: service plans' issuing country is used, on the server and in the browser alike (``todayIso`` in frontend/src/lib/site/services.ts).
PLAN_TIME_ZONE = "Australia/Sydney"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def today_local(now: datetime | None = None) -> date:
    """The calendar date in ``PLAN_TIME_ZONE`` (``now`` is an aware instant, the current one when omitted). The server's own zone and the browser's zone are never used."""
    n = now if now is not None else _utcnow()
    if n.tzinfo is None:
        n = n.replace(tzinfo=timezone.utc)
    return n.astimezone(ZoneInfo(PLAN_TIME_ZONE)).date()


def iso_to_date(s: Any) -> date | None:
    """An ISO date string (YYYY-MM-DD) as a date, else None."""
    if not isinstance(s, str):
        return None
    try:
        return date.fromisoformat(s.strip())
    except ValueError:
        return None


def show_date(d: date | str | None) -> str:
    """DD/MM/YYYY, or NOT SET."""
    if isinstance(d, str):
        d = iso_to_date(d)
    return d.strftime("%d/%m/%Y") if d else NOT_SET


@dataclass
class Svc:
    """One existing service as read from its parameters (through the basis rules of ``param_basis``)."""
    obj: SiteObject
    kind: str | None
    owner: str | None
    dia_mm: float | None
    depth_m: float | None
    basis: str | None
    reference: str | None
    tol_m: float | None
    verified: bool
    plan_date: date | None
    expiry_param: date | None
    geom: BaseGeometry | None
    why: list[str] = field(default_factory=list)

    @property
    def id(self) -> str:
        return self.obj.id

    @property
    def name(self) -> str:
        k = (self.kind or "service").upper()
        return f"{k} {self.obj.label.upper()}" if self.obj.label else f"{k} {self.obj.id.upper()}"

    @property
    def depth_usable(self) -> bool:
        return self.depth_m is not None and self.basis in USABLE_DEPTH_BASES and self.reference in ("top", "invert")

    def depth_issue(self) -> str:
        """Why the depth cannot be used, or an empty string when it can."""
        if self.depth_m is None:
            return DEPTH_NOT_AVAILABLE
        if self.basis not in USABLE_DEPTH_BASES:
            return "DEPTH BASIS IS UNKNOWN OR NOT SET"
        if self.reference not in ("top", "invert"):
            return "DEPTH REFERENCE (TOP OF ASSET OR INVERT) IS NOT SET"
        return ""

    def top_depth(self) -> float | None:
        """Depth (m below ground) to the top of the asset, or None when it cannot be stated. From an invert depth the nominal diameter is taken off (needs the diameter)."""
        if not self.depth_usable:
            return None
        if self.reference == "top":
            return self.depth_m
        return None if self.dia_mm is None else self.depth_m - self.dia_mm / 1000.0       # type: ignore[operator]

    def invert_depth(self) -> float | None:
        """Depth (m below ground) to the invert (underside), or None when it cannot be stated. From a top depth the nominal diameter is added (needs the diameter)."""
        if not self.depth_usable:
            return None
        if self.reference == "invert":
            return self.depth_m
        return None if self.dia_mm is None else self.depth_m + self.dia_mm / 1000.0       # type: ignore[operator]


def read_service(o: SiteObject, rd: Reader) -> Svc:
    kind = rd.text(o, "service_kind")
    g = o.geometry
    geom: BaseGeometry | None = None
    if g.kind == "polyline":
        ln = LineString([(p[0], p[1]) for p in g.pts])
        geom = ln if ln.length > 0 else None
    elif g.kind == "point":
        geom = Point(g.p[0], g.p[1])
    dia = rd.pos(o, "diameter_mm")
    depth = rd.pos(o, "depth_m")
    tol = rd.num(o, "position_tolerance_m")
    return Svc(o, kind, rd.text(o, "asset_owner"), dia, depth, rd.text(o, "depth_basis"), rd.text(o, "depth_reference"),
               tol if tol is not None and tol >= 0 else None, bool(o.verified), iso_to_date(rd.text(o, "plan_date")), iso_to_date(rd.text(o, "plan_expiry_date")), geom)


def services_of(objs: list[SiteObject], rd: Reader) -> list[Svc]:
    """The existing services of a design that are still in the ground (a service set to be removed is kept: it is in the ground until removed)."""
    return [read_service(o, rd) for o in objs if o.type == "service_existing" and o.accepted != "rejected"]


def plan_expiry(s: Svc, rules: SiteRules) -> tuple[date | None, str, Rule | None]:
    """(expiry date, how it was found, the validity rule when one was needed). The expiry is the plan's own expiry date when the object carries one, else the plan date plus
    ``dbyd.plan_validity_days`` when that resolves, else NOT SET (None)."""
    if s.expiry_param is not None:
        return s.expiry_param, "PLAN EXPIRY DATE ENTERED ON THE OBJECT", None
    rule = rules.get("dbyd.plan_validity_days")
    if s.plan_date is not None and rule.resolved and isinstance(rule.value, (int, float)) and not isinstance(rule.value, bool) and math.isfinite(rule.value) and rule.value >= 0:
        return s.plan_date + timedelta(days=int(rule.value)), f"PLAN DATE PLUS {int(rule.value)} DAYS (dbyd.plan_validity_days)", rule
    return None, "", rule


def is_expired(s: Svc, rules: SiteRules, today: date) -> tuple[bool | None, date | None]:
    """(expired, expiry): expired is None when the expiry is NOT SET. A plan is valid up to and including its expiry date."""
    exp, _how, _rule = plan_expiry(s, rules)
    return (None if exp is None else today > exp), exp


def service_selector(kind: str | None) -> str | None:
    """The ``service`` selector used to resolve rules for a service kind (the kind name itself; a rule row's service selector must use the same names)."""
    return kind


def clearance_rule(s_kind: str | None, dia_mm: float | None, owner: str | None, rules: SiteRules) -> Rule:
    """``util.clearance_m`` for a service of this kind, diameter and owner. With no kind the rule is UNRESOLVED (nothing is guessed)."""
    if s_kind is None:
        return Rule("util.clearance_m", None, "m", "UNRESOLVED", "THE SERVICE KIND IS NOT SET")
    if owner is None:
        return Rule("util.clearance_m", None, "m", "UNRESOLVED", "THE ASSET OWNER IS NOT SET")
    return rules.get_for("util.clearance_m", service=service_selector(s_kind), dia_mm=None if dia_mm is None else int(round(dia_mm)), authority=owner)


def exclusion_buffer(s: Svc, rules: SiteRules) -> tuple[Rule, float | None, str]:
    """(clearance rule, total buffer in metres or None, why it is UNRESOLVED). Total = clearance (``util.clearance_m`` for the kind, diameter and owner) plus the
    stated positional tolerance. Either missing leaves the buffer UNRESOLVED."""
    r = clearance_rule(s.kind, s.dia_mm, s.owner, rules)
    if not r.resolved:
        return r, None, r.ref
    if s.tol_m is None:
        return r, None, "THE POSITIONAL TOLERANCE IS NOT SET"
    return r, float(r.value) + s.tol_m, ""


# ---------------------------------------------------------------------------------------------------------------------------------- verification
#: the parameters whose change invalidates a verification (with the geometry): the verification states that THESE were checked against a pothole, a survey or the plan
VERIFICATION_PARAMS = ("depth_m", "depth_reference", "asset_owner", "service_kind", "diameter_mm", "material")
VERIFICATION_CLEARED_CODE = "VERIFICATION_CLEARED_BY_EDIT"


class VerifiedByLocked(Exception):
    def __init__(self, object_id: str) -> None:
        super().__init__(object_id)
        self.object_id = object_id


def _val(o: SiteObject, key: str) -> Any:
    p = o.params.get(key)
    return None if p is None or p.basis == "unresolved" else p.value


def _same_geometry(a: SiteObject, b: SiteObject) -> bool:
    ga, gb = a.geometry.model_dump(mode="json"), b.geometry.model_dump(mode="json")
    if ga.get("kind") != gb.get("kind"):
        return False

    def flat(g: dict[str, Any]) -> list[float]:
        pts = g.get("p") if g["kind"] == "point" else g.get("pts") if g["kind"] == "polyline" else g.get("ring")
        return [float(x) for q in ([pts] if g["kind"] == "point" else pts) for x in q]
    fa, fb = flat(ga), flat(gb)
    yaw = abs(float(ga.get("yaw_deg") or 0.0) - float(gb.get("yaw_deg") or 0.0)) <= 1e-9          # a point's turn is part of its geometry
    return yaw and len(fa) == len(fb) and all(abs(x - y) <= 1e-9 for x, y in zip(fa, fb))


def verification_changes(new: SiteObject, old: SiteObject) -> list[str]:
    """What changed between two versions of one existing service that invalidates its verification (empty when nothing did)."""
    out = [] if _same_geometry(new, old) else ["GEOMETRY"]
    for k in VERIFICATION_PARAMS:
        a, b = _val(new, k), _val(old, k)
        same = (math.isclose(float(a), float(b), rel_tol=0, abs_tol=1e-9) if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool) and not isinstance(b, bool) else a == b)
        if not same:
            out.append(k.upper())
    return out


def clear_verification(o: SiteObject, changed: list[str]) -> SiteObject:
    """The object with its verification removed (verified, verified_on, verified_by) and the issue VERIFICATION CLEARED BY EDIT added."""
    params = {k: v for k, v in o.params.items() if k != "verified_by"}
    issues = [i for i in o.issues if i.code != VERIFICATION_CLEARED_CODE]
    issues.append(Issue(code=VERIFICATION_CLEARED_CODE, severity="warning", message=f"VERIFICATION CLEARED BY EDIT: {', '.join(changed)} CHANGED, SO THE SERVICE MUST BE VERIFIED AGAIN"[:500]))
    return o.model_copy(update={"verified": False, "verified_on": None, "params": params, "issues": issues})


def enforce_verification(new: SiteDesign, stored: SiteDesign) -> tuple[SiteDesign, list[str]]:
    """The server side of the verification rule, applied on a save against the STORED version (the browser's own rule is not trusted):

    * a service that was verified in the stored version and is still verified, with a change to its geometry, depth, depth reference, owner, kind, diameter or material, has
      its verification cleared (verified, verified_on, verified_by) and the issue VERIFICATION CLEARED BY EDIT added;
    * a service that was verified and stays verified cannot have its ``verified_by`` edited (``VerifiedByLocked``): remove the verification first.

    A service that is new, or was not verified before, may arrive verified (that is the verification itself). Returns the design and the ids that were cleared."""
    old = {o.id: o for o in stored.objects if o.type == "service_existing" and o.verified}
    if not old:
        return new, []
    cleared: list[str] = []
    objs = []
    for o in new.objects:
        prev = old.get(o.id)
        if prev is not None and o.type == "service_existing" and o.verified:
            if _val(o, "verified_by") != _val(prev, "verified_by"):
                raise VerifiedByLocked(o.id)
            ch = verification_changes(o, prev)
            if ch:
                o = clear_verification(o, ch)
                cleared.append(o.id)
        objs.append(o)
    return (new.model_copy(update={"objects": objs}) if cleared else new), cleared
