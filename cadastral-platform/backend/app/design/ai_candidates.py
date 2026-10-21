"""Candidate generators for AI first design (stage 10). Deterministic: NO language model is used in this module.

A generator reads the design the client has already built (placed buildings, terrain, verified services, rules) and builds a SET of candidates for one decision (a driveway, a
rainwater tank position, a sewer route, a water route, stormwater links, retaining walls, landscape areas). A candidate is a ready batch of operations of the frontend registry
(``add_object``, ``set_param``), a short machine summary and its check results. Every number in a candidate comes from an engine or from an existing resolved input of the
design: a position from the geometry (kerb line, building footprint, downpipe, exit point), a route from ``service_route`` and ``sewer_engine``, a check from ``object_checks`` and
``driveway_engine``. A dimension, a level, a diameter, a width or a height is NEVER chosen here: it stays NOT SET and is listed in ``required_inputs`` for the user to enter.

Buildings are never created or moved. A user object is never changed except by a link parameter (stormwater links), and every such edit carries the value it replaces so the
checklist can undo it.

Candidates with a blocking failure are kept, flagged ``blocked`` and ranked last. Time is bounded by ``engine_limits.MAX_AI_GENERATE_SECONDS`` and the candidate count by
``MAX_AI_CANDIDATES_PER_SET``.
"""
from __future__ import annotations

import math
import re
import time
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import shapely
from shapely import wkt as shw
from shapely.geometry import LineString, MultiLineString, MultiPolygon, Point, Polygon, box
from shapely.geometry.base import BaseGeometry
from shapely.ops import linemerge, nearest_points, unary_union

from . import driveway_engine as DE
from . import engine_limits as EL
from . import grading_engine as GE
from . import object_geometry as G
from . import service_model as SM
from . import service_route as SR
from .object_checks import check_design
from .param_basis import Reader
from .site_design import ENGINE_DERIVED_PARAMS, ENGINE_REF_PREFIX, GEOMETRY_OF, SiteDesign, SiteObject
from .site_rules import SiteRules
from .terrain_source import SiteTerrain

STAMP = ENGINE_REF_PREFIX
LETTERS = "ABCDEFGH"
#: geometry noise filters (sanity values of this tool, not engineering values)
SLIVER_M2 = 0.5
MIN_PIECE_M = 0.1
DEDUPE_M = 0.5
BATTER_EXCEED_M = 0.1                  # a batter or platform counts as going past the lot boundary only when some part of it is at least this far outside the lot
WALL_MIN_LENGTH_M = 0.5                # a boundary retaining wall segment shorter than this is not proposed
EARTHWORK_PART_MIN_M2 = 0.05          # a polygon of the engine earthworks smaller than this is numerical noise and is ignored
#: CANDIDATE SAMPLING CHOICES of the driveway generator. They decide which alignments are offered to the model or the rules to choose from. They are NOT requirements of any
#: standard, council or authority, and no check or rule reads them. The crossovers are tried at these fractions of the chainage range along the assumed kerb line that the lot
#: frontage spans, plus the chainage nearest the building centroid; a crossover that would be closer than ``DRIVEWAY_MIN_LENGTH_M`` to the building is not offered.
DRIVEWAY_SAMPLE_FRACTIONS = (0.2, 0.5, 0.8)
DRIVEWAY_MIN_LENGTH_M = 0.5
FRONTAGE_BAND_M = 0.5                  # boundary within this distance (towards the lot) of the frontage depth is the street frontage
NOT_SET_PARAM = {"value": None, "basis": "unresolved"}


class GenerateError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code, self.message = code, message


# ---------------------------------------------------------------------------------------------------------------------------------- structures
@dataclass
class Candidate:
    """One option of a set. ``objects`` are new site objects (wire form, origin ai_proposal, accepted pending); ``edits`` are link parameters set on existing objects."""
    set_id: str
    kind: str
    summary: str
    objects: list[dict[str, Any]] = field(default_factory=list)
    edits: list[dict[str, Any]] = field(default_factory=list)            # {id, key, param, prev}
    checks: list[dict[str, Any]] = field(default_factory=list)           # compact check records
    flags: list[str] = field(default_factory=list)
    required_inputs: list[str] = field(default_factory=list)
    metric: float = 0.0                                                   # tie break: smaller is better (a length in metres)
    order: int = 0
    cid: str = ""
    template: str = ""                    # the summary with object markers (see ``ref``): the prompt shows aliases, the user sees the labels

    def say(self, ctx: "Ctx", template: str) -> None:
        """Set the summary from a template whose object references are markers: ``summary`` shows the user's labels, ``template`` is what the model prompt renders with aliases."""
        self.template = template
        self.summary = render(template, ctx.name_of)

    @property
    def blocking(self) -> int:
        return sum(1 for c in self.checks if c["severity"] == "blocking")

    @property
    def fails(self) -> int:
        return sum(1 for c in self.checks if c["status"] == "FAIL")

    @property
    def not_evaluated(self) -> int:
        return sum(1 for c in self.checks if c["status"] == "NOT EVALUATED")

    @property
    def warnings(self) -> int:
        return sum(1 for c in self.checks if c["severity"] == "warning")

    @property
    def warn_rate(self) -> float:
        """Warnings per object, so a candidate with more objects is not ranked lower only because it has more checks."""
        return self.warnings / max(1, len(self.objects) + len({e["id"] for e in self.edits}))

    @property
    def blocked(self) -> bool:
        return self.blocking > 0

    @property
    def passing(self) -> bool:
        """No blocking failure. A candidate with checks that could not be evaluated still passes: they are listed as required inputs."""
        return not self.blocked

    def steps(self) -> list[dict[str, Any]]:
        out = [add_step(o) for o in self.objects]
        for e in self.edits:
            out.append(set_param_step(e["id"], e["key"], e["param"]))
        return out

    def revert_steps(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for e in self.edits:
            prev = e.get("prev")
            out.append({"op": "remove_param", "args": {"id": e["id"], "key": e["key"]}} if prev is None else set_param_step(e["id"], e["key"], prev))
        return out

    def object_ids(self) -> list[str]:
        return [o["id"] for o in self.objects]

    def touched_ids(self) -> list[str]:
        return [*self.object_ids(), *dict.fromkeys(e["id"] for e in self.edits)]

    def public(self) -> dict[str, Any]:
        return {"id": self.cid, "set_id": self.set_id, "kind": self.kind, "summary": self.summary, "blocked": self.blocked, "flags": list(self.flags),
                "counts": {"blocking": self.blocking, "fail": self.fails, "not_evaluated": self.not_evaluated, "total": len(self.checks)},
                "checks": self.checks, "object_ids": self.object_ids(), "edited_ids": list(dict.fromkeys(e["id"] for e in self.edits)),
                "required_inputs": list(self.required_inputs)}


@dataclass
class CandidateSet:
    id: str
    kind: str
    title: str
    candidates: list[Candidate] = field(default_factory=list)
    required_inputs: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    skipped: str | None = None                                           # why no candidate was built

    def ranked(self) -> "CandidateSet":
        """Sort (candidates with a blocking failure last), keep the best ``MAX_AI_CANDIDATES_PER_SET`` and give them the ids A, B, C, D."""
        self.candidates.sort(key=lambda c: (c.blocked, c.blocking, c.fails, round(c.warn_rate, 6), round(c.metric, 6), c.order))
        self.candidates = self.candidates[:EL.MAX_AI_CANDIDATES_PER_SET]
        for i, c in enumerate(self.candidates):
            c.cid = LETTERS[i]
            c.set_id = self.id
        if not self.candidates and self.skipped is None:
            self.skipped = "NO CANDIDATE COULD BE BUILT"
        return self

    def get(self, cid: str) -> Candidate | None:
        return next((c for c in self.candidates if c.cid == cid), None)

    def public(self) -> dict[str, Any]:
        return {"id": self.id, "kind": self.kind, "title": self.title, "skipped": self.skipped, "notes": list(self.notes), "required_inputs": list(self.required_inputs),
                "candidates": [c.public() for c in self.candidates]}


# ---------------------------------------------------------------------------------------------------------------------------------- object markers
_OPEN, _CLOSE = "\u27e6", "\u27e7"
MARK = re.compile(_OPEN + r"([^" + _OPEN + _CLOSE + r"]*)" + _CLOSE)


def ref(object_id: str) -> str:
    """A marker for an object inside a summary template. The id is placed in the marker, never the label, and the marker characters are removed from it."""
    return _OPEN + str(object_id).replace(_OPEN, "").replace(_CLOSE, "") + _CLOSE


def render(template: str, name_of) -> str:
    """The template with each marker replaced by ``name_of(object_id)``. Only the markers are replaced: nothing else in the text is touched."""
    return MARK.sub(lambda m: name_of(m.group(1)), template)


# ---------------------------------------------------------------------------------------------------------------------------------- operations
def _pts_of(g: dict[str, Any]) -> list[list[float]]:
    return [g["p"]] if g["kind"] == "point" else g["pts"] if g["kind"] == "polyline" else g["ring"]


def add_step(o: dict[str, Any]) -> dict[str, Any]:
    """The ``add_object`` step of the frontend registry for a wire object. The origin is ai_proposal (the registry then starts it as pending)."""
    g = o["geometry"]
    args: dict[str, Any] = {"type": o["type"], "id": o["id"], "origin": "ai_proposal", "status": o.get("status", "proposed"),
                            "points": [{"e": p[0], "n": p[1], **({"z": p[2]} if len(p) == 3 else {})} for p in _pts_of(g)], "params": o.get("params", {})}
    if o.get("label"):
        args["label"] = o["label"]
    if g["kind"] == "point" and g.get("yaw_deg") is not None:
        args["yaw_deg"] = g["yaw_deg"]
    return {"op": "add_object", "args": args}


def set_param_step(oid: str, key: str, p: dict[str, Any]) -> dict[str, Any]:
    args: dict[str, Any] = {"id": oid, "key": key, "value": p.get("value"), "basis": p.get("basis", "user")}
    if p.get("ref"):
        args["ref"] = p["ref"]
    return {"op": "set_param", "args": args}


def apply_steps(design: SiteDesign, steps: list[dict[str, Any]]) -> SiteDesign:
    """Apply ``add_object``, ``set_param`` and ``remove_param`` steps to a copy of a design (the same effect as the frontend registry, for the checks). The result is validated by the
    Pydantic model, so a batch that does not fit the model is refused here (``ValueError``)."""
    doc = design.dump()
    by = {o["id"]: o for o in doc["objects"]}
    for s in steps:
        op, a = s["op"], s.get("args", {})
        if op == "add_object":
            t = a["type"]
            kind = a.get("shape") or GEOMETRY_OF[t]
            pts = [[p["e"], p["n"], *([p["z"]] if "z" in p else [])] for p in a["points"]]
            geom = ({"kind": "point", "p": pts[0], **({"yaw_deg": a["yaw_deg"]} if a.get("yaw_deg") is not None else {})} if kind == "point"
                    else {"kind": "polyline", "pts": pts} if kind == "polyline" else {"kind": "polygon", "ring": pts})
            o = {"id": a["id"], "type": t, "status": a.get("status", "proposed"), "origin": a.get("origin", "user"), "verified": False, "geometry": geom,
                 "params": {k: dict(v) for k, v in (a.get("params") or {}).items()}, "issues": []}
            if o["origin"] == "ai_proposal":
                o["accepted"] = "pending"
            if a.get("label"):
                o["label"] = a["label"]
            if o["id"] in by:
                raise ValueError(f"id {o['id']} is already in use")
            doc["objects"].append(o)
            by[o["id"]] = o
        elif op == "set_param":
            o = by.get(a["id"])
            if o is None:
                raise ValueError(f"no object {a['id']}")
            v = a.get("value")
            o["params"][a["key"]] = ({"value": None, "basis": "unresolved"} if v is None else {"value": v, "basis": a.get("basis", "user"), **({"ref": a["ref"]} if a.get("ref") else {})})
        elif op == "remove_param":
            o = by.get(a["id"])
            if o is None:
                raise ValueError(f"no object {a['id']}")
            o["params"].pop(a["key"], None)
        else:
            raise ValueError(f"operation {op} is not part of an AI batch")
    return SiteDesign.model_validate(doc)


# ---------------------------------------------------------------------------------------------------------------------------------- context
@dataclass
class Ctx:
    design: SiteDesign
    rules: SiteRules
    terrain: SiteTerrain | None
    today: date | None
    deadline: float
    notes: list[str] = field(default_factory=list)
    truncated: bool = False
    _baseline: dict[str, str] | None = None
    _taken: set[str] | None = None
    _names: dict[str, str] | None = None

    @property
    def rd(self) -> Reader:
        return Reader(self.rules)

    def expired(self) -> bool:
        if time.monotonic() > self.deadline:
            self.truncated = True
            return True
        return False

    def live(self, *types: str) -> list[SiteObject]:
        return [o for o in self.design.objects if o.accepted != "rejected" and o.status != "to_be_removed" and (not types or o.type in types)]

    def taken(self) -> set[str]:
        """The ONE set of object ids in use, shared by every set and every candidate of this context (a new id is added to it when it is made), so two sets can never make the same id."""
        if self._taken is None:
            self._taken = {o.id for o in self.design.objects}
        return self._taken

    def name_of(self, object_id: str) -> str:
        """The label the user sees for an object id (services by their service name)."""
        if self._names is None:
            self._names = {o.id: _label(o) for o in self.design.objects}
            for sv in SM.services_of(self.design.objects, self.rd):
                self._names[sv.id] = sv.name
        return self._names.get(object_id, object_id.upper())

    def lot(self) -> Polygon | None:
        return self.terrain.lot if self.terrain is not None else None

    def baseline(self) -> dict[str, str]:
        """check id -> status of the design as it is, so a candidate is not blamed for what was already there."""
        if self._baseline is None:
            full = check_design(self.design, self.rules, self.terrain, self.today)
            self._baseline = {e["id"]: e["status"] for e in full["checks"]}
        return self._baseline

    def with_steps(self, steps: list[dict[str, Any]]) -> SiteDesign:
        return apply_steps(self.design, steps)


def make_ctx(design: SiteDesign, rules: SiteRules, terrain: SiteTerrain | None, today: date | None = None, *, deadline_s: float | None = None) -> Ctx:
    EL.check_site_design(design)
    if len(design.objects) > EL.MAX_AI_DESIGN_OBJECTS:
        raise EL.EngineLimitError(EL.AI_TOO_LARGE, f"THE DESIGN HAS {len(design.objects)} OBJECTS; AT MOST {EL.MAX_AI_DESIGN_OBJECTS} ARE ACCEPTED FOR AI FIRST DESIGN")
    return Ctx(design, rules, terrain, today, time.monotonic() + (EL.MAX_AI_GENERATE_SECONDS if deadline_s is None else deadline_s))


def fresh(taken: set[str], prefix: str) -> str:
    i = 1
    while f"{prefix}_{i}" in taken:
        i += 1
    taken.add(f"{prefix}_{i}")
    return f"{prefix}_{i}"


def unique(taken: set[str], base: str) -> str:
    """``base``, or ``base`` with a counter when the id is in use; the id is added to ``taken``."""
    cand, i = base, 1
    while cand in taken:
        i += 1
        cand = f"{base}_{i}"
    taken.add(cand)
    return cand


def r3(v: float) -> float:
    return round(float(v), 3)


def _param(value: Any, ref: str) -> dict[str, Any]:
    """A parameter a generator computed from objects and geometry: basis DERIVED, with a ref that names the engine and its inputs. It is never USER: nobody typed it."""
    return {"value": value, "basis": "derived", "ref": f"{STAMP}: {ref}"[:200]}


def derived(value: Any, engine: str, inputs: str) -> dict[str, Any]:
    return _param(value, f"{engine} FROM {inputs}")


def _obj(oid: str, type_: str, geometry: dict[str, Any], label: str, params: dict[str, Any]) -> dict[str, Any]:
    return {"id": oid, "type": type_, "status": "proposed", "origin": "ai_proposal", "accepted": "pending", "verified": False, "label": label[:120], "geometry": geometry,
            "params": params, "issues": []}


def _compact(e: dict[str, Any]) -> dict[str, Any]:
    return {"id": str(e.get("id", ""))[:120], "object_id": e.get("object_id"), "code": str(e.get("code", ""))[:64], "status": e["status"], "severity": e["severity"],
            "message": " ".join(str(e.get("message", "")).split())[:200]}


def _sev(status: str) -> str:
    return "blocking" if status == "FAIL" else "warning" if status in ("NOT EVALUATED", "ACTION REQUIRED") else "info"


def own_check(oid: str | None, code: str, status: str, message: str) -> dict[str, Any]:
    """A check of this module (a geometric test of the generator), shaped like an engine check."""
    return {"id": f"{oid or '_set'}:{code}", "object_id": oid, "code": code, "status": status, "severity": _sev(status), "message": message[:200]}


def engine_checks(ctx: Ctx, steps: list[dict[str, Any]], touched: list[str], new_ids: set[str]) -> list[dict[str, Any]]:
    """The design checks that concern a candidate: those of its new objects (and pair checks naming them) and, for an edited existing object, only the checks that are new or
    changed against the design as it is."""
    full = check_design(ctx.with_steps(steps), ctx.rules, ctx.terrain, ctx.today)
    base = ctx.baseline()
    out = []
    for e in full["checks"]:
        parts = str(e["id"]).split(":")
        is_new = e["object_id"] in new_ids or (len(parts) >= 3 and parts[2] in new_ids)
        is_touched = e["object_id"] in touched or (len(parts) >= 3 and parts[2] in touched)
        if is_new or (is_touched and base.get(e["id"]) != e["status"]):
            out.append(_compact(e))
    return out


def primary_buildings(ctx: Ctx) -> list[SiteObject]:
    """Placed buildings that can be designed for: a house first, then by footprint area (largest first). Never created, moved or edited."""
    bs = [o for o in ctx.live("building") if o.building is not None and G.ring_polygon(o) is not None]
    return sorted(bs, key=lambda o: (G.text(o, "building_use", ctx.rd) != "house", -G.ring_polygon(o).area, o.id))      # type: ignore[union-attr]


def _label(o: SiteObject) -> str:
    return (o.label or o.id).upper()


def _set_id(kind: str, i: int) -> str:
    return kind if i == 0 else f"{kind}_{i + 1}"


# ---------------------------------------------------------------------------------------------------------------------------------- driveway
def gen_driveway(ctx: Ctx) -> CandidateSet:
    cs = CandidateSet("driveway", "driveway", "DRIVEWAY", required_inputs=["DRIVEWAY WIDTH", "DRIVEWAY SURFACE"])
    bs = primary_buildings(ctx)
    t, lot = ctx.terrain, ctx.lot()
    if not bs:
        cs.skipped = "NO BUILDING IS PLACED"
        return cs
    if ctx.live("driveway"):
        cs.skipped = "A DRIVEWAY IS ALREADY IN THE DESIGN"
        return cs
    kerb = DE.kerb_geometry(t) if t is not None else None
    if kerb is None or lot is None:
        cs.skipped = "THE ASSUMED KERB LINE OR THE LOT BOUNDARY IS NOT AVAILABLE IN THE 3D MODEL"
        cs.required_inputs.append("KERB LINE AND LOT BOUNDARY IN THE 3D MODEL")
        return cs
    b = bs[0]
    fp = G.ring_polygon(b)
    assert fp is not None
    if G.pos(b, "ffl_rl", ctx.rd) is None:
        cs.required_inputs.append(f"FINISHED FLOOR LEVEL OF {_label(b)}")
    cs.notes.append("THE BUILDING SOURCE HAS NO GARAGE DATA, SO EACH DRIVEWAY ENDS AT THE POINT OF THE FOOTPRINT OF " + _label(b) + " NEAREST TO ITS CROSSOVER. MOVE THE END TO THE GARAGE")
    cs.required_inputs.append("GARAGE POSITION")
    xs = [DE.chainage_on_kerb(kerb, *q)[0] for q in lot.exterior.coords]
    lo, hi = max(0.0, min(xs)), min(kerb["length"], max(xs))
    cands = [lo + f * (hi - lo) for f in DRIVEWAY_SAMPLE_FRACTIONS] if hi > lo else [kerb["length"] / 2]
    cx = DE.chainage_on_kerb(kerb, fp.centroid.x, fp.centroid.y)[0]
    cands.append(min(max(cx, 0.0), kerb["length"]))
    ch: list[float] = []
    for c in sorted(cands):
        if all(abs(c - k) > DEDUPE_M for k in ch):
            ch.append(c)
    others = [(_label(o), q) for o in ctx.live("building", "pool") if o.id != b.id and (q := G.ring_polygon(o)) is not None]
    for i, c in enumerate(ch):
        if ctx.expired():
            cs.notes.append("THE TIME LIMIT WAS REACHED: NOT ALL ALIGNMENTS WERE BUILT")
            break
        s = DE.point_on_kerb(kerb, c)
        target = nearest_points(fp.exterior, Point(*s))[0]
        end = (float(target.x), float(target.y))
        line = LineString([s, end])
        if line.length < DRIVEWAY_MIN_LENGTH_M:
            continue
        inside_own = line.intersection(fp.buffer(-1e-6)).length
        hits = [name for name, x in others if line.intersects(x)]
        if inside_own > 1e-6:
            cs.notes.append(f"THE ALIGNMENT AT CHAINAGE {c:.1f} M WAS DROPPED: IT CROSSES THE BUILDING BEFORE ITS END")
            continue
        oid = unique(ctx.taken(), f"ai_drive_{i + 1}")
        geom = {"kind": "polyline", "pts": [[r3(s[0]), r3(s[1])], [r3(end[0]), r3(end[1])]]}
        params = {"end_building_id": derived(b.id, "DRIVEWAY GENERATOR", "THE FOOTPRINT OF THE BUILDING (END SNAPPED TO ITS NEAREST POINT; END LEVEL IS ITS FFL)"),
                  "crossover_chainage_m": derived(r3(c), "DRIVEWAY GENERATOR", "THE ASSUMED KERB LINE OF THE 3D MODEL (CHAINAGE FROM ITS FIRST POINT) AND THE LOT BOUNDARY"),
                  "width_m": dict(NOT_SET_PARAM), "surface_kind": dict(NOT_SET_PARAM)}
        o = _obj(oid, "driveway", geom, "DRIVEWAY (PROPOSED ALIGNMENT)", params)
        cand = Candidate("driveway", "driveway", "", objects=[o], metric=line.length, order=i, required_inputs=list(cs.required_inputs))
        steps = cand.steps()
        try:
            work = ctx.with_steps(steps)
            prof = DE.driveway_profile(work.objects[-1], ctx.terrain, ctx.rules, detail="profile", saved_design=work)       # type: ignore[arg-type]
            for k in prof["checks"]:
                msg = f"{k['title']}: " + (k["note"] or (f"VALUE {k['value']:g} {k['unit']}" + (f", LIMIT {k['limit']:g}" if k["limit"] is not None else "") if k["value"] is not None else "")).strip()
                cand.checks.append({"id": f"{oid}:{k['id']}", "object_id": oid, "code": str(k["id"])[:64], "status": k["status"], "severity": _sev(k["status"]), "message": msg[:200]})
            cand.checks += engine_checks(ctx, steps, [], {oid})
        except EL.EngineLimitError as e:
            cand.checks.append(own_check(oid, "AI_DRIVEWAY_ENGINE", "NOT EVALUATED", e.message))
        except ValueError as e:
            cand.checks.append(own_check(oid, "AI_DRIVEWAY_INVALID", "FAIL", str(e)))
        if hits:
            cand.checks.append(own_check(oid, "AI_DRIVEWAY_CLEAR", "FAIL", "THE ALIGNMENT CROSSES " + ", ".join(sorted(set(hits))[:3])))
        else:
            cand.checks.append(own_check(oid, "AI_DRIVEWAY_CLEAR", "PASS", "THE ALIGNMENT CROSSES NO OTHER BUILDING OR POOL"))
        cand.say(ctx, f"DRIVEWAY FROM THE KERB AT CHAINAGE {c:.1f} M TO THE NEAREST POINT OF {ref(b.id)}, {line.length:.1f} M LONG, WIDTH AND SURFACE NOT SET. "
                      f"CHECKS: {cand.fails} FAIL, {cand.not_evaluated} NOT EVALUATED, {sum(1 for k in cand.checks if k['status'] == 'PASS')} PASS")
        cs.candidates.append(cand)
    if not cs.candidates and cs.skipped is None:
        cs.skipped = "NO ALIGNMENT FROM THE KERB TO THE BUILDING WAS POSSIBLE"
    return cs.ranked()


# ---------------------------------------------------------------------------------------------------------------------------------- rainwater tank
def _exclusions(ctx: Ctx, own: str) -> list[tuple[str, BaseGeometry]]:
    """Areas a tank centre must stay out of: other buildings, pools, the known footprints of other objects, and the exclusion buffer of every existing service whose clearance
    resolves. A service whose clearance does not resolve gives no area (the checks say so)."""
    out: list[tuple[str, BaseGeometry]] = []
    for o in ctx.live():
        if o.id == own or o.type in ("rwt", "tree", "service_existing", "landscape_area", "grading_area", "discharge_point"):
            continue
        if o.type in ("building", "pool", "osd", "osd_basin", "stormwater_pit", "footpath", "driveway", "retaining_wall", "infiltration_trench"):
            g = G.footprint(o, ctx.rd)
            if g is not None:
                out.append((_label(o), g))
    for s in SM.services_of(ctx.design.objects, ctx.rd):
        if s.geom is None or s.obj.status == "to_be_removed":
            continue
        _rule, buf, _why = SM.exclusion_buffer(s, ctx.rules)
        if buf is not None:
            out.append((s.name, s.geom.buffer(buf)))
    return out


def gen_tank(ctx: Ctx, b: SiteObject, set_id: str) -> CandidateSet:
    cs = CandidateSet(set_id, "tank", f"RAINWATER TANK POSITION FOR {_label(b)}",
                      required_inputs=["TANK SHAPE AND SIZE", "TANK VOLUME", "CONNECTED ROOF AREA", "TANK LEVELS (INLET, OVERFLOW, OUTLET)"])
    if any(G.text(o, "roof_building_id", ctx.rd) == b.id for o in ctx.live("rwt")):
        cs.skipped = f"A TANK IS ALREADY LINKED TO {_label(b)}"
        return cs
    dps = b.building.exits.downpipes if b.building is not None else []
    if not dps:
        cs.skipped = f"{_label(b)} HAS NO DOWNPIPE POINT IN ITS SOURCE, SO THERE IS NOTHING TO PLACE A TANK BESIDE"
        cs.required_inputs.append("DOWNPIPE POSITIONS")
        return cs
    cs.notes.append("A TANK SIZE IS NOT SET, SO EACH POSITION MARKS A DOWNPIPE: THE DISTANCE TO THE BOUNDARY IS MEASURED FROM THAT POINT AND THE TANK MUST BE MOVED CLEAR OF THE WALL ONCE ITS SIZE IS SET")
    lot = ctx.lot()
    rb = ctx.rules.get("rwt.min_boundary_distance_m")
    excl = _exclusions(ctx, b.id)
    pts: list[tuple[float, float]] = []
    for q in dps:
        p = (float(q[0]), float(q[1]))
        if all(math.hypot(p[0] - k[0], p[1] - k[1]) > DEDUPE_M for k in pts):
            pts.append(p)
    taken = ctx.taken()
    for i, p in enumerate(pts[:EL.MAX_AI_CANDIDATES_PER_SET + 2]):
        if ctx.expired():
            cs.notes.append("THE TIME LIMIT WAS REACHED: NOT ALL POSITIONS WERE BUILT")
            break
        oid = f"ai_{set_id}_{i + 1}"
        oid = unique(taken, oid)
        o = _obj(oid, "rwt", {"kind": "point", "p": [r3(p[0]), r3(p[1])]}, "RAINWATER TANK (PROPOSED POSITION)", {"roof_building_id": derived(b.id, "TANK GENERATOR", "THE DOWNPIPE POINTS OF THE BUILDING")})
        cand = Candidate(set_id, "tank", "", objects=[o], order=i, required_inputs=list(cs.required_inputs))
        steps = cand.steps()
        pt = Point(*p)
        clearance = float(pt.distance(lot.exterior)) if lot is not None else None
        cand.metric = -(clearance or 0.0)
        if lot is None:
            cand.checks.append(own_check(oid, "AI_TANK_LOT", "NOT EVALUATED", "THE LOT BOUNDARY IS NOT AVAILABLE IN THE 3D MODEL"))
        elif not lot.buffer(1e-6).contains(pt):
            cand.checks.append(own_check(oid, "AI_TANK_LOT", "FAIL", "THE DOWNPIPE POINT IS OUTSIDE THE LOT BOUNDARY"))
        elif rb.resolved:
            ok = clearance >= float(rb.value) - 1e-9                                     # type: ignore[operator]
            cand.checks.append(own_check(oid, "AI_TANK_SETBACK", "PASS" if ok else "FAIL",
                                         f"THE POINT IS {clearance:.2f} M FROM THE BOUNDARY; THE RULE {rb.key} IS {float(rb.value):g} M ({rb.basis})"))     # type: ignore[arg-type]
        else:
            cand.checks.append(own_check(oid, "AI_TANK_SETBACK", "NOT EVALUATED", f"THE BOUNDARY DISTANCE RULE IS UNRESOLVED ({rb.key})"))
        bad = [name for name, g in excl if g.buffer(-1e-6).contains(pt)]
        cand.checks.append(own_check(oid, "AI_TANK_CLEAR", "FAIL" if bad else "PASS",
                                     ("THE POINT IS INSIDE " + ", ".join(sorted(set(bad))[:3])) if bad else "THE POINT IS CLEAR OF OTHER OBJECTS AND OF SERVICE CLEARANCES THAT RESOLVE"))
        try:
            cand.checks += engine_checks(ctx, steps, [], {oid})
        except ValueError as e:
            cand.checks.append(own_check(oid, "AI_TANK_INVALID", "FAIL", str(e)))
        cand.say(ctx, f"TANK AT DOWNPIPE {i + 1} OF {ref(b.id)}, " + (f"{clearance:.1f} M FROM THE BOUNDARY" if clearance is not None else "BOUNDARY DISTANCE NOT KNOWN") +
                      f", SIZE NOT SET. CHECKS: {cand.fails} FAIL, {cand.not_evaluated} NOT EVALUATED, {sum(1 for k in cand.checks if k['status'] == 'PASS')} PASS")
        cs.candidates.append(cand)
    return cs.ranked()


# ---------------------------------------------------------------------------------------------------------------------------------- sewer and water
_ROUTE_REFS = {
    ("sewer_drain", "building_id"): ("SEWER ROUTE ENGINE", "THE BUILDING WHOSE SEWER EXIT STARTS THE ROUTE"),
    ("service_node", "main_id"): ("ROUTE ENGINE", "THE NEAREST POINT OF THE VERIFIED MAIN"),
    ("water_service", "main_id"): ("WATER ROUTE ENGINE", "THE NEAREST POINT OF THE VERIFIED MAIN"),
    ("service_node", "invert_rl"): ("SEWER ROUTE ENGINE", "THE TERRAIN GROUND LEVEL AT THE CONNECTION MINUS THE VERIFIED DEPTH OF THE MAIN"),
    ("service_node", "node_kind"): ("ROUTE ENGINE", "THE ROLE OF THE NODE ON THE ROUTE"),
}


def _rename(objs: list[dict[str, Any]], taken: set[str]) -> list[dict[str, Any]]:
    """The objects of a route proposal as AI proposals. Ids come from the ONE ``taken`` set of the context (shared by all sets, so two buildings cannot make the same id), and the
    links and the connection invert that the route engine computed are DERIVED with a ref that names the engine and its inputs, not USER."""
    out = []
    for o in objs:
        n = dict(o)
        n["id"] = unique(taken, f"ai_{o['id']}"[:60])
        n["origin"], n["accepted"] = "ai_proposal", "pending"
        params = {}
        for k, p in (o.get("params") or {}).items():
            engine = _ROUTE_REFS.get((o["type"], k))
            params[k] = derived(p["value"], *engine) if engine is not None and p.get("basis") == "user" and p.get("value") is not None else p
        n["params"] = params
        out.append(n)
    return out


def _connections(ctx: Ctx, kind: str, node_kind: str, near: tuple[float, float]) -> list[tuple[str, dict[str, Any], str]]:
    """(description, connection argument for the route engine, label) for each verified main of this kind and each connection point the user placed, nearest first."""
    rd = ctx.rd
    out: list[tuple[float, str, dict[str, Any], str]] = []
    for s in SM.services_of(ctx.design.objects, rd):
        if s.kind != kind or s.geom is None or s.geom.geom_type != "LineString" or s.obj.status == "to_be_removed":
            continue
        if not s.verified:
            ctx.notes.append(f"{s.name} IS NOT VERIFIED, SO NO {kind.upper()} ROUTE WAS PROPOSED TO IT. VERIFY THE MAIN FIRST")
            continue
        out.append((float(s.geom.distance(Point(*near))), f"VERIFIED MAIN {ref(s.id)}", {"main_id": s.id}, "VERIFIED"))
    for o in ctx.live("service_node"):
        if G.text(o, "node_kind", rd) != node_kind or o.geometry.kind != "point" or o.origin == "ai_proposal":
            continue
        p = o.geometry.p
        out.append((math.hypot(p[0] - near[0], p[1] - near[1]), f"CONNECTION POINT {ref(o.id)} ENTERED BY THE USER", {"p": [float(p[0]), float(p[1])]}, "NOT VERIFIED"))
    out.sort(key=lambda t: t[0])
    return [(d, c, lab) for _x, d, c, lab in out]


def _route_set(ctx: Ctx, b: SiteObject, set_id: str, kind: str) -> CandidateSet:
    water = kind == "water"
    cs = CandidateSet(set_id, kind, f"{kind.upper()} ROUTE FOR {_label(b)}")
    cs.required_inputs = (["WATER SERVICE DIAMETER", "WATER SERVICE COVER", "WATER METER POSITION ACCEPTED BY THE AUTHORITY"] if water else
                          ["SEWER START INVERT", "SEWER DIAMETER", "SEWER CONNECTION INVERT WHEN THE DEPTH OF THE MAIN IS NOT VERIFIED"])
    exits = (b.building.exits.water if water else b.building.exits.sewer) if b.building is not None else []
    if any(o.type == ("water_service" if water else "sewer_drain") and G.text(o, "building_id", ctx.rd) == b.id for o in ctx.live()) and not water:
        cs.skipped = f"A SEWER DRAIN FROM {_label(b)} IS ALREADY IN THE DESIGN"
        return cs
    if water and ctx.live("water_service"):
        cs.skipped = "A WATER SERVICE IS ALREADY IN THE DESIGN"
        return cs
    if not exits:
        cs.skipped = f"{_label(b)} HAS NO {kind.upper()} EXIT POINT IN ITS SOURCE, SO THE ROUTE HAS NO START"
        cs.required_inputs.append(f"{kind.upper()} EXIT POINT OF THE BUILDING")
        return cs
    start = (float(exits[0][0]), float(exits[0][1]))
    conns = _connections(ctx, kind, "water_connection" if water else "sewer_connection", start)
    cs.notes += [n for n in ctx.notes if kind.upper() in n]
    if not conns:
        cs.skipped = f"NO VERIFIED {kind.upper()} MAIN AND NO CONNECTION POINT ENTERED BY THE USER IS IN THE DESIGN, SO THE ROUTE HAS NO END"
        cs.required_inputs.append(f"A VERIFIED {kind.upper()} MAIN OR A CONNECTION POINT")
        return cs
    n = 0
    errors: list[str] = []
    taken = ctx.taken()                                                                   # shared by every set of this context
    for xi in range(min(2, len(exits))):
        for desc, conn, label in conns[:2]:
            if ctx.expired():
                cs.notes.append("THE TIME LIMIT WAS REACHED: NOT ALL ROUTES WERE BUILT")
                return cs.ranked()
            try:
                if water:
                    res = SR.propose_water(ctx.design, ctx.rules, ctx.terrain, building_id=b.id, exit_index=xi, meter_p=None, diameter_mm=None, cover_m=None, connection=conn, today=ctx.today)
                else:
                    res = SR.propose_sewer(ctx.design, ctx.rules, ctx.terrain, building_id=b.id, exit_index=xi, start_invert_rl=None, diameter_mm=None, connection=conn, today=ctx.today)
            except SR.RouteError as e:
                errors.append(f"{render(desc, ctx.name_of)}: {e.message}")
                continue
            objs = _rename(res["objects"], taken)
            idmap = {o["id"]: p["id"] for o, p in zip(res["objects"], objs)}
            cand = Candidate(set_id, kind, "", objects=objs, metric=float(res["route"]["length_m"]), order=n, required_inputs=list(cs.required_inputs))
            cand.flags += [f"{label} CONNECTION"] if label != "VERIFIED" else []
            # the engine checks were computed for the proposal objects under their own ids; map them to the AI ids
            for e in res["checks"]:
                m = dict(e)
                m["id"] = ":".join(idmap.get(x, x) for x in str(e["id"]).split(":"))
                m["object_id"] = idmap.get(e.get("object_id"), e.get("object_id"))
                cand.checks.append(_compact(m))
            for note in res["notes"][:4]:
                cand.checks.append(own_check(None, "AI_ROUTE_NOTE", "INFO", note))
            cand.say(ctx, f"{kind.upper()} ROUTE FROM EXIT {xi + 1} OF {ref(b.id)} TO {desc}, {res['route']['length_m']:.1f} M LONG, "
                          f"{'SIZE AND COVER' if water else 'INVERTS AND SIZE'} NOT SET. CHECKS: {cand.fails} FAIL, {cand.not_evaluated} NOT EVALUATED, "
                          f"{sum(1 for k in cand.checks if k['status'] == 'PASS')} PASS")
            cs.candidates.append(cand)
            n += 1
    if not cs.candidates:
        cs.skipped = "NO ROUTE COULD BE BUILT: " + "; ".join(errors[:2])[:300]
    return cs.ranked()


def gen_sewer(ctx: Ctx, b: SiteObject, set_id: str) -> CandidateSet:
    return _route_set(ctx, b, set_id, "sewer")


def gen_water(ctx: Ctx, b: SiteObject, set_id: str) -> CandidateSet:
    return _route_set(ctx, b, set_id, "water")


# ---------------------------------------------------------------------------------------------------------------------------------- stormwater links
def _edit(o: SiteObject, key: str, target: str, inputs: str) -> dict[str, Any]:
    p = o.params.get(key)
    prev = None if p is None else {"value": p.value, "basis": p.basis, **({"ref": p.ref} if p.ref else {})}
    return {"id": o.id, "key": key, "param": derived(target, "STORMWATER LINK GENERATOR", inputs), "prev": prev}


def _unset(o: SiteObject, key: str, rd: Reader) -> bool:
    return G.text(o, key, rd) is None


def gen_stormwater(ctx: Ctx) -> CandidateSet:
    """Links only: roof to tank, tank overflow to an OSD or trench (an overflow route object), storage and surfaces to a discharge point. A destination is always an object the user
    already placed; a discharge location is never invented."""
    cs = CandidateSet("stormwater", "stormwater", "STORMWATER LINKS", required_inputs=["TANK, OSD AND TRENCH SIZES", "PIPE SIZES AND LEVELS"])
    rd = ctx.rd
    storage = ctx.live("osd", "osd_basin", "infiltration_trench")
    dps = ctx.live("discharge_point")
    tanks = [o for o in ctx.live("rwt") if (bid := G.text(o, "roof_building_id", rd)) and any(x.id == bid for x in ctx.live("building"))]
    bldgs = [o for o in ctx.live("building") if not any(G.text(t, "roof_building_id", rd) == o.id for t in tanks)]
    if not storage and not dps:
        cs.skipped = "THERE IS NO DISCHARGE POINT, OSD OR TRENCH IN THE DESIGN, SO NOTHING CAN BE LINKED"
        cs.required_inputs.append("THE LEGAL POINT OF DISCHARGE (PLACE A DISCHARGE POINT)")
        return cs
    if not tanks and not bldgs:
        cs.skipped = "THERE IS NO ROOF OR TANK TO LINK"
        return cs
    c0 = shapely.centroid(unary_union([G.footprint(o, rd) or Point(*G.centre(o)) for o in [*tanks, *bldgs]]))
    dests = sorted([*storage, *dps], key=lambda o: Point(*G.centre(o)).distance(c0))[:3]
    taken = ctx.taken()
    osd_req = ctx.rules.get_flag("stormwater.osd_required")
    for i, d in enumerate(dests):
        if ctx.expired():
            cs.notes.append("THE TIME LIMIT WAS REACHED: NOT ALL LINK OPTIONS WERE BUILT")
            break
        is_store = d.type in ("osd", "osd_basin", "infiltration_trench")
        objs: list[dict[str, Any]] = []
        edits: list[dict[str, Any]] = []
        what: list[str] = []
        for t in tanks[:4]:
            if is_store:
                if any(x.type == "overflow_route" and G.text(x, "rwt_id", rd) == t.id for x in ctx.live("overflow_route")) or not _unset(t, "drains_to_id", rd):
                    continue
                start, end = G.centre(t), G.centre(d)
                try:
                    route = SR._route(ctx.design, ctx.rules, None, start, end, [])
                except (SR.RouteError, EL.EngineLimitError):
                    route = [start, end]
                rid = fresh(taken, "ai_overflow")
                key = "trench_id" if d.type == "infiltration_trench" else "osd_id"
                objs.append(_obj(rid, "overflow_route", {"kind": "polyline", "pts": [[r3(x), r3(y)] for x, y in route]}, "TANK OVERFLOW ROUTE (PROPOSED)",
                                 {"rwt_id": derived(t.id, "STORMWATER LINK GENERATOR", "THE TANK THAT OVERFLOWS"),
                                  key: derived(d.id, "STORMWATER LINK GENERATOR", f"THE NEAREST {d.type.replace('_', ' ').upper()} PLACED BY THE USER")}))
                what.append(f"OVERFLOW OF {ref(t.id)} TO {ref(d.id)}")
            elif _unset(t, "drains_to_id", rd):
                edits.append(_edit(t, "drains_to_id", d.id, f"THE TANK POSITION AND {d.type.replace('_', ' ').upper()} PLACED BY THE USER"))
                what.append(f"{ref(t.id)} DRAINS TO {ref(d.id)}")
        for b in bldgs[:3]:
            if _unset(b, "drains_to_id", rd):
                edits.append(_edit(b, "drains_to_id", d.id, f"THE BUILDING FOOTPRINT AND {d.type.replace('_', ' ').upper()} PLACED BY THE USER"))
                what.append(f"ROOF OF {ref(b.id)} DRAINS TO {ref(d.id)}")
        if is_store and dps and _unset(d, "drains_to_id", rd):
            near = min(dps, key=lambda x: Point(*G.centre(x)).distance(Point(*G.centre(d))))
            edits.append(_edit(d, "drains_to_id", near.id, "THE NEAREST DISCHARGE POINT PLACED BY THE USER"))
            what.append(f"{ref(d.id)} DRAINS TO {ref(near.id)}")
        elif is_store and not dps and _unset(d, "drains_to_id", rd) and "PLACE THE LEGAL POINT OF DISCHARGE (DISCHARGE POINT)" not in cs.required_inputs:
            cs.required_inputs.append("PLACE THE LEGAL POINT OF DISCHARGE (DISCHARGE POINT)")
        if not objs and not edits:
            continue
        cand = Candidate("stormwater", "stormwater", "", objects=objs, edits=edits, order=i, required_inputs=list(cs.required_inputs))
        steps = cand.steps()
        if not is_store and osd_req.resolved and osd_req.value is True and storage:
            cand.checks.append(own_check(None, "AI_OSD_BYPASSED", "ACTION REQUIRED", f"THE RULE {osd_req.key} IS TRUE ({osd_req.basis}) AND THIS OPTION DOES NOT PASS THROUGH THE OSD IN THE DESIGN"))
        try:
            cand.checks += engine_checks(ctx, steps, cand.touched_ids(), set(cand.object_ids()))
        except ValueError as e:
            cand.checks.append(own_check(None, "AI_STORMWATER_INVALID", "FAIL", str(e)))
        cand.say(ctx, f"LINKS TO {ref(d.id)}: " + "; ".join(what[:6]) + f". CHECKS: {cand.fails} FAIL, {cand.not_evaluated} NOT EVALUATED")
        cs.candidates.append(cand)
    if not cs.candidates:
        cs.skipped = "EVERY ROOF AND TANK IN THE DESIGN IS ALREADY LINKED, OR THERE IS NOTHING TO LINK TO"
    return cs.ranked()


# ---------------------------------------------------------------------------------------------------------------------------------- retaining walls
def _engine_earthworks(ctx: Ctx) -> tuple[list[tuple[str, Polygon]], list[str]]:
    """(source object id, polygon) for the batters and the platform of each driveway and grading area that has them computed, and the reasons the others have none."""
    out: list[tuple[str, Polygon]] = []
    why: list[str] = []
    if ctx.terrain is None:
        return out, ["THERE IS NO TERRAIN, SO NO BATTER IS COMPUTED"]
    for o in ctx.live("driveway", "grading_area"):
        try:
            if o.type == "driveway":
                r = DE.driveway_profile(o, ctx.terrain, ctx.rules, detail="full", saved_design=ctx.design)
                ew = r.get("earthworks")
            else:
                ew = GE.grading(o, ctx.terrain, ctx.rules).get("earthworks")
        except (EL.EngineLimitError, ValueError) as e:
            why.append(f"{_label(o)}: {str(e)[:120]}")
            continue
        if not ew:
            why.append(f"{_label(o)}: NO BATTERS OR EARTHWORKS ARE COMPUTED (A WIDTH, LEVEL OR BATTER SLOPE IS NOT SET)")
            continue
        for key in (("batters", "cut_wkt"), ("batters", "fill_wkt"), ("platform_wkt",)):
            w = ew[key[0]].get(key[1]) if len(key) == 2 else ew.get(key[0])
            if w:
                g = shw.loads(w)
                for part in getattr(g, "geoms", [g]):
                    if part.geom_type == "Polygon" and part.area > EARTHWORK_PART_MIN_M2:
                        out.append((o.id, part))
    return out, why


CROSSING_EPS_M = 1e-6
OVERLAP_TOL_M2 = 0.01                  # overlap between a proposed area and an existing object that is rounding, not overlap


def _overshoot_m(p: BaseGeometry, lot: Polygon) -> float:
    """How far the part of ``p`` outside the lot reaches beyond the lot (the largest distance of its outline from the lot), in metres. Zero when nothing is outside."""
    out = p.difference(lot)
    if out.is_empty:
        return 0.0
    pts = [Point(c) for g in getattr(out, "geoms", [out]) if g.geom_type == "Polygon" for c in g.exterior.coords]
    return max((lot.distance(q) for q in pts), default=0.0)


def gen_walls(ctx: Ctx) -> CandidateSet:
    cs = CandidateSet("walls", "walls", "RETAINING WALLS AT THE BOUNDARY", required_inputs=["WALL TYPE", "WALL HEIGHT AND THICKNESS", "TOP AND BOTTOM LEVELS"])
    lot = ctx.lot()
    if lot is None:
        cs.skipped = "THE LOT BOUNDARY IS NOT AVAILABLE IN THE 3D MODEL"
        return cs
    polys, why = _engine_earthworks(ctx)
    cs.notes += why[:4]
    segs: list[tuple[list[str], LineString]] = []
    over = [(src, p) for src, p in polys if _overshoot_m(p, lot) >= BATTER_EXCEED_M]
    kerb = DE.kerb_geometry(ctx.terrain) if ctx.terrain is not None else None
    # the street frontage is left out: a driveway has to cross it, so earthworks past it (on the verge) are not a boundary retaining wall
    front = min(DE.chainage_on_kerb(kerb, *q)[1] for q in lot.exterior.coords) if kerb is not None and kerb["has_normal"] else None
    if front is None and over:
        cs.notes.append("THE KERB LINE IS NOT AVAILABLE, SO THE STREET FRONTAGE CANNOT BE TOLD FROM THE OTHER BOUNDARIES: NO WALL IS PROPOSED")
        over = []
    if over:
        u = unary_union([p for _s, p in over])
        cc = list(lot.exterior.coords)
        edges = [LineString([a, b]) for a, b in zip(cc[:-1], cc[1:]) if Point(a).distance(Point(b)) > 1e-9]
        side = [e for e in edges if DE.chainage_on_kerb(kerb, *e.interpolate(0.5, normalized=True).coords[0])[1] > front + FRONTAGE_BAND_M]
        # a PROPER crossing: the part of the boundary that lies in the INTERIOR of the earthworks. A batter that only touches the boundary along an edge (collinear, from either
        # side) has no interior on the boundary and gives no wall. The interior is taken as the earthworks shrunk by a micrometre.
        hit = unary_union(side).intersection(u.buffer(-CROSSING_EPS_M)) if side else LineString()
        parts = [g for g in getattr(hit, "geoms", [hit]) if g.geom_type == "LineString" and g.length > MIN_PIECE_M]
        merged = linemerge(MultiLineString(parts)) if len(parts) > 1 else (parts[0] if parts else None)
        for g in getattr(merged, "geoms", [merged]) if merged is not None else []:
            if g.length >= WALL_MIN_LENGTH_M:
                segs.append((sorted({s_ for s_, p in over if p.buffer(CROSSING_EPS_M).intersects(g)}), g))
    if not segs:
        cs.skipped = "NO BATTER OR PLATFORM COMPUTED BY THE ENGINES GOES PAST THE LOT BOUNDARY" if polys else "NO BATTER IS COMPUTED, SO NO WALL IS PROPOSED"
        return cs
    segs.sort(key=lambda t: -t[1].length)
    taken = ctx.taken()
    objs = []
    for src, g in segs[:3]:
        oid = fresh(taken, "ai_wall")
        objs.append(_obj(oid, "retaining_wall", {"kind": "polyline", "pts": [[r3(x), r3(y)] for x, y, *_ in g.coords]}, "RETAINING WALL AT THE BOUNDARY",
                         {"wall_type": dict(NOT_SET_PARAM), "height_m": dict(NOT_SET_PARAM)}))
    cand = Candidate("walls", "walls", "", objects=objs, metric=sum(g.length for _s, g in segs[:3]), required_inputs=list(cs.required_inputs))
    try:
        cand.checks += engine_checks(ctx, cand.steps(), [], set(cand.object_ids()))
    except ValueError as e:
        cand.checks.append(own_check(None, "AI_WALL_INVALID", "FAIL", str(e)))
    srcs = sorted({n for s_, _g in segs[:3] for n in s_})
    cand.say(ctx, f"{len(objs)} RETAINING WALL(S) ALONG THE LOT BOUNDARY WHERE THE BATTER OR PLATFORM OF {', '.join(ref(n) for n in srcs)} GOES PAST IT, "
                  f"{cand.metric:.1f} M IN TOTAL, HEIGHT AND TYPE NOT SET. CHECKS: {cand.fails} FAIL, {cand.not_evaluated} NOT EVALUATED")
    cs.candidates.append(cand)
    return cs.ranked()


# ---------------------------------------------------------------------------------------------------------------------------------- landscape areas
def decompose(p: Polygon, expired=lambda: False) -> list[Polygon]:
    """Cut a polygon with holes into polygons WITHOUT holes (a landscape area is a ring only), conserving the area exactly and never dropping a hole.

    1. Horizontal cuts: the polygon is intersected with the bands between consecutive y levels of the vertices of its holes. A hole spans at least two bands, so no band piece
       can contain a hole, and the pieces cover the polygon exactly (the area of the pieces is the area of the polygon, to floating point precision).
    2. Merge: neighbouring pieces that share an edge are joined while the join is still one valid polygon without holes, which gives the fewest pieces this greedy order can reach.
       A join that would close a hole (or pinch the outline) is refused. When ``expired()`` is true the merge stops and the pieces so far are returned (still exact).
    """
    if p.is_empty:
        return []
    if not p.interiors:
        return [Polygon(p.exterior)]
    ys = sorted({round(c[1], 9) for ring in p.interiors for c in ring.coords})
    x0, y0, x1, y1 = p.bounds
    levels = [y0 - 1.0, *[y for y in ys if y0 - 1.0 < y < y1 + 1.0], y1 + 1.0]
    pieces: list[Polygon] = []
    for lo, hi in zip(levels[:-1], levels[1:]):
        if hi - lo <= 0:
            continue
        for g in getattr(band := p.intersection(box(x0 - 1.0, lo, x1 + 1.0, hi)), "geoms", [band]):
            if g.geom_type == "Polygon" and g.area > 1e-12:
                pieces.append(g)
    changed = True
    while changed and len(pieces) > 1 and not expired():
        changed = False
        tree = shapely.STRtree(pieces)
        used: set[int] = set()
        nxt: list[Polygon] = []
        for i, a_ in enumerate(pieces):
            if i in used:
                continue
            cur = a_
            for j in sorted(int(k) for k in tree.query(a_.buffer(1e-9))):
                if j <= i or j in used:
                    continue
                shared = cur.intersection(pieces[j])
                if shared.is_empty or shared.length <= 1e-9:
                    continue
                u = shapely.simplify(cur.union(pieces[j]), 1e-9)
                if u.geom_type == "Polygon" and not u.interiors and u.is_valid and abs(u.area - cur.area - pieces[j].area) < 1e-7:
                    cur = u
                    used.add(j)
                    changed = True
            nxt.append(cur)
        pieces = nxt
    return pieces


def gen_landscape(ctx: Ctx) -> CandidateSet:
    cs = CandidateSet("landscape", "landscape", "LANDSCAPE AREAS", required_inputs=["SURFACE OF EACH LANDSCAPE AREA"])
    lot = ctx.lot()
    if lot is None:
        cs.skipped = "THE LOT BOUNDARY IS NOT AVAILABLE IN THE 3D MODEL"
        return cs
    built: list[BaseGeometry] = []
    unsized: list[SiteObject] = []
    for o in ctx.live("building", "pool", "driveway", "footpath", "rwt", "osd", "osd_basin", "stormwater_pit", "retaining_wall", "infiltration_trench", "landscape_area"):
        g = G.footprint(o, ctx.rd)
        if g is not None:
            built.append(g)
        elif o.geometry.kind == "polyline" and o.type in ("driveway", "footpath", "retaining_wall", "infiltration_trench"):
            unsized.append(o)
    occupied = unary_union(built) if built else None
    free = lot.difference(occupied) if occupied is not None else lot              # the remaining area: lot minus the union of the occupied footprints (holes kept)
    allp: list[Polygon] = []
    for g in getattr(free, "geoms", [free]):
        if g.geom_type == "Polygon":
            allp += decompose(g, ctx.expired)                                       # hole free parts; the area of the parts is the area of the remaining lot
    pieces = [q for q in allp if q.area >= SLIVER_M2 and q.is_valid]
    small = [q for q in allp if q.area < SLIVER_M2]
    if small:
        cs.notes.append(f"{len(small)} PIECE(S) UNDER {SLIVER_M2:g} M2, {sum(q.area for q in small):.2f} M2 IN TOTAL, ARE TOO SMALL TO PROPOSE AS A LANDSCAPE AREA")
    pieces.sort(key=lambda q: -q.area)
    if not pieces:
        cs.skipped = "THERE IS NO UNBUILT LOT AREA LEFT"
        return cs
    if unsized:
        cs.notes.append("THESE OBJECTS HAVE NO WIDTH OR SIZE SET, SO THEIR AREA IS NOT TAKEN OFF THE LANDSCAPE AREAS: " + ", ".join(_label(o) for o in unsized[:5]))
        cs.required_inputs.append("WIDTHS OF " + ", ".join(sorted({o.type.replace('_', ' ').upper() for o in unsized})))
    taken = ctx.taken()
    if len(pieces) > EL.MAX_AI_LANDSCAPE_AREAS:
        cs.notes.append(f"ONLY THE {EL.MAX_AI_LANDSCAPE_AREAS} LARGEST OF {len(pieces)} PIECES ARE PROPOSED IN THE FULL OPTION; THE REST, {sum(q.area for q in pieces[EL.MAX_AI_LANDSCAPE_AREAS:]):.1f} M2, ARE NOT")

    def ring_of(q: Polygon) -> list[list[float]]:
        for nd in (4, 6, 9):                                                         # the finest rounding that keeps the ring valid (a coarse one can pinch a thin piece)
            ring = [[round(x, nd), round(y, nd)] for x, y in list(q.exterior.coords)[:-1]]
            if len(ring) >= 3 and Polygon(ring).is_valid:
                return ring
        return [[x, y] for x, y in list(q.exterior.coords)[:-1]]

    def build(n: int, order: int) -> Candidate:
        chosen = pieces[:n]
        objs = []
        for q in chosen:
            oid = fresh(taken, "ai_landscape")
            objs.append(_obj(oid, "landscape_area", {"kind": "polygon", "ring": ring_of(q)}, "LANDSCAPE AREA (SURFACE NOT SET)", {"surface_kind": dict(NOT_SET_PARAM)}))
        cand = Candidate("landscape", "landscape", "", objects=objs, metric=-sum(q.area for q in chosen), order=order, required_inputs=list(cs.required_inputs))
        try:
            cand.checks += engine_checks(ctx, cand.steps(), [], set(cand.object_ids()))
        except ValueError as e:
            cand.checks.append(own_check(None, "AI_LANDSCAPE_INVALID", "FAIL", str(e)))
        shapes = [Polygon(o["geometry"]["ring"]) for o in objs]
        over = occupied.intersection(unary_union(shapes)).area if occupied is not None and shapes else 0.0
        cand.checks.append(own_check(objs[0]["id"] if objs else None, "AI_LANDSCAPE_CLEAR", "PASS" if over < OVERLAP_TOL_M2 else "FAIL",
                                     "THE PROPOSED AREAS OVERLAP NO BUILDING, SURFACE OR STRUCTURE IN THE DESIGN" if over < OVERLAP_TOL_M2 else f"THE PROPOSED AREAS OVERLAP OTHER OBJECTS BY {over:.2f} M2"))
        for o in unsized:
            ln = G.line_of(o)
            if ln is not None and any(ln.intersection(q).length > MIN_PIECE_M for q in chosen):
                cand.checks.append(own_check(objs[0]["id"], "AI_LANDSCAPE_UNSIZED_OVERLAP", "NOT EVALUATED", f"{_label(o)} HAS NO WIDTH SET AND PASSES THROUGH A PROPOSED AREA; SET ITS WIDTH AND CHECK AGAIN"))
        area = sum(q.area for q in shapes)
        cand.say(ctx, f"{len(chosen)} LANDSCAPE AREA(S) FROM THE UNBUILT LOT AREA, {area:.0f} M2 IN TOTAL, SURFACE NOT SET. "
                      f"CHECKS: {cand.fails} FAIL, {cand.not_evaluated} NOT EVALUATED")
        return cand
    cs.candidates.append(build(min(len(pieces), EL.MAX_AI_LANDSCAPE_AREAS), 0))
    if len(pieces) > 1:
        cs.candidates.append(build(1, 1))
    return cs.ranked()
