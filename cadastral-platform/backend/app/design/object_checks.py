"""Rule based checks for the whole site design (stage 7). The server is authoritative: the browser shows what ``check_design`` returns.

EVERY value a check compares against comes from ``SiteRules`` (the user's entry, an LGA rule, a state rule, or the platform default where docs/14 section
7.3 defines one: ``stormwater.osd_required`` and ``stormwater.psd_l_s`` only) or from a value the user entered on the object. A requirement the resolver cannot give is
UNRESOLVED and the check that needs it is NOT EVALUATED and names its keys. Nothing is defaulted; the JCE drainage conventions are not used.

A check entry has these fields: ``id``, ``object_id`` (None for a check of the whole design), ``object_type``, ``object_label``, ``code``, ``title``, ``status``
(PASS, FAIL, NOT EVALUATED, NOT APPLICABLE, ACTION REQUIRED or INFO), ``severity`` (blocking, warning or info), ``message``, ``requirements`` (one entry per
requirement key the check uses: key, value, unit, basis, ref and the stamp of a platform default), ``basis`` (the weakest basis among the keys, or MODEL CHECK
when the check uses no requirement), ``value``, ``limit`` and ``unit``. Strings are upper case where they are shown as labels and contain no em or en dash.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.base import BaseGeometry

from . import engine_limits as EL
from . import object_geometry as G
from . import object_keys as OK
from .driveway_engine import chainage_on_kerb, kerb_geometry
from .param_basis import Reader
from .site_design import SiteDesign, SiteObject
from .site_rules import DEFAULT, UNRESOLVED, Rule, SiteRules
from .terrain_source import NO_TERRAIN, SiteTerrain
from .wall_screening import KEY_CERT, TYPE_MAX_KEYS, screen_wall

SCHEMA = "site_checks.v1"
PASS, FAIL, NOT_EVALUATED, NOT_APPLICABLE, ACTION, INFO = "PASS", "FAIL", "NOT EVALUATED", "NOT APPLICABLE", "ACTION REQUIRED", "INFO"
MODEL_CHECK = "MODEL CHECK"
POOL_BARRIER_LABEL = "POOL BARRIER REQUIREMENTS: SEE RULES"
#: a pipe end within this distance (m) of a pit centre is connected to it; a vertex within it of a pit is "at a pit". A drawing tolerance, not a requirement.
CONNECT_TOL_M = 0.05
#: pipe cover is sampled along the pipe every this many metres (a resolution, not a requirement)
COVER_STEP_M = EL.PIPE_STATION_STEP_M
#: a vertex whose heading change is below this many degrees is not a direction change (collinear vertices from the drawing tool)
BEND_TOL_DEG = 0.5
G_MS2 = 9.81                      # gravitational acceleration, a physical constant
MAX_ENCROACHMENTS = 200           # most tree zone encroachment entries one run returns
MAX_CHECK_OBJECTS = EL.MAX_CHECK_OBJECTS    # a design larger than this is refused (422) rather than checked (the caps are in ``engine_limits``)

_RANK = {UNRESOLVED: 3, DEFAULT: 2, "USER": 1, "LGA RULE": 0, "STATE RULE": 0}


class CheckLimitError(EL.EngineLimitError):
    """A design larger than the check accepts (see ``engine_limits.check_site_design``). The API answers 422 with ``code`` and ``message``."""

    def __init__(self, message: str) -> None:
        super().__init__(EL.CHECK_TOO_LARGE, message)


def _sev(status: str) -> str:
    return "blocking" if status == FAIL else "warning" if status in (NOT_EVALUATED, ACTION) else "info"


def _fmt(v: float, d: int = 2) -> str:
    return f"{v:.{d}f}"


@dataclass
class Site:
    """The 3D model context the checks need: terrain, lot, kerb and the objects by type."""
    terrain: SiteTerrain | None
    lot: Polygon | None
    kerb: dict[str, Any] | None
    objs: list[SiteObject]
    by_id: dict[str, SiteObject] = field(default_factory=dict)

    def of(self, *types: str) -> list[SiteObject]:
        return [o for o in self.objs if o.type in types]

    def ground_many(self, xs: np.ndarray, ys: np.ndarray) -> np.ndarray | None:
        """Terrain levels at many points in ONE vectorised call (NaN where the terrain has no level); None without terrain."""
        if self.terrain is None:
            return None
        z = np.asarray(self.terrain.surface.z_at(np.asarray(xs, float), np.asarray(ys, float)), float)
        return np.where(np.isfinite(z), z, np.nan)

    def ground(self, x: float, y: float) -> float | None:
        if self.terrain is None:
            return None
        z = float(self.terrain.surface.z_at(np.array([x]), np.array([y]))[0])
        return z if math.isfinite(z) else None


class Checker:
    def __init__(self, design: SiteDesign, rules: SiteRules, terrain: SiteTerrain | None) -> None:
        try:
            EL.check_site_design(design)
        except EL.EngineLimitError as e:
            raise CheckLimitError(e.message) from None
        self.design, self.rules = design, rules
        lot = terrain.lot if terrain is not None else None
        self.site = Site(terrain, lot, kerb_geometry(terrain) if terrain is not None else None, list(design.objects), {o.id: o for o in design.objects})
        self.checks: list[dict[str, Any]] = []
        self.values: dict[str, list[dict[str, Any]]] = {}
        self.notes: list[str] = []
        self.keys_used: set[str] = set()
        #: parameters that hold a value the checks refused (object id -> key -> reason); named on the NOT EVALUATED checks of that object
        self.refusals: dict[str, dict[str, str]] = {}
        self.rd = Reader(rules, self.refusals)

    # ---- building blocks
    def rule(self, key: str) -> Rule:
        self.keys_used.add(key)
        return self.rules.get(key)

    def add(self, o: SiteObject | None, code: str, title: str, status: str, message: str, *, rules: list[Rule] | None = None, value: Any = None, limit: Any = None,
            unit: str = "", severity: str | None = None, suffix: str = "", extra: dict[str, Any] | None = None) -> dict[str, Any]:
        reqs = [r.public() for r in (rules or [])]
        basis = MODEL_CHECK if not reqs else max((r["basis"] for r in reqs), key=lambda b: _RANK.get(b, 0))
        if status == NOT_EVALUATED and o is not None:
            for why in self.refusals.get(o.id, {}).values():
                if why not in message:
                    message += f". {why}"
        e = {"id": f"{o.id if o else '_design'}:{code}{suffix}", "object_id": o.id if o else None, "object_type": o.type if o else None, "object_label": (o.label or "") if o else "",
             "code": code, "title": title, "status": status, "severity": severity or _sev(status), "message": message, "requirements": reqs, "basis": basis,
             "value": value, "limit": limit, "unit": unit}
        if extra:
            e.update(extra)
        self.checks.append(e)
        return e

    def show(self, o: SiteObject, key: str, label: str, value: Any, unit: str = "", basis: str = "MODEL", ref: str = "", stamp: str | None = None) -> None:
        d: dict[str, Any] = {"key": key, "label": label, "value": value, "unit": unit, "basis": basis, "ref": ref}
        if stamp:
            d["stamp"] = stamp
        self.values.setdefault(o.id, []).append(d)

    def unresolved(self, o: SiteObject | None, code: str, title: str, rules: list[Rule], why: str = "", **kw: Any) -> dict[str, Any]:
        keys = ", ".join(r.key for r in rules if not r.resolved)
        msg = f"NOT EVALUATED: {why + '. ' if why else ''}UNRESOLVED REQUIREMENT{'S' if keys.count(',') else ''}: {keys}" if keys else f"NOT EVALUATED: {why}"
        return self.add(o, code, title, NOT_EVALUATED, msg, rules=rules, **kw)

    def lot_distance(self, geom: BaseGeometry) -> float | None:
        """Distance from a footprint to the lot boundary when it lies inside the lot, negative when it is not inside; None without a lot."""
        lot = self.site.lot
        if lot is None:
            return None
        d = G.distance_to_boundary(geom, lot)
        return d if lot.contains(geom) else -d

    # ---- run
    def run(self) -> dict[str, Any]:
        live = [o for o in self.site.objs if o.accepted != "rejected"]
        self.site.objs = live
        handlers = {"rwt": self.rwt, "retaining_wall": self.wall, "infiltration_trench": self.trench, "osd": self.osd, "osd_basin": self.osd, "stormwater_pit": self.pit,
                    "stormwater_pipe": self.pipe, "pool": self.pool, "pool_barrier": self.barrier, "footpath": self.footpath, "tree": self.tree,
                    "landscape_area": self.landscape, "overflow_route": self.overflow}
        for o in live:
            h = handlers.get(o.type)
            if h:
                h(o)
        if live:
            self.design_level(live)
        self.tree_encroachment(live)
        counts: dict[str, int] = {"blocking": 0, "warning": 0, "info": 0}
        by_status: dict[str, int] = {}
        for c in self.checks:
            counts[c["severity"]] += 1
            by_status[c["status"]] = by_status.get(c["status"], 0) + 1
        t = self.site.terrain
        return _finite({"schema": SCHEMA, "rules_for": self.rules.label(), "jurisdiction": self.rules.jurisdiction, "lga": self.rules.lga,
                "terrain": {"available": t is not None, "status": t.status if t is not None else NO_TERRAIN}, "lot_available": self.site.lot is not None,
                "kerb_available": self.site.kerb is not None, "checks": self.checks, "values": self.values,
                "summary": {**counts, "total": len(self.checks), "by_status": by_status}, "notes": self.notes})

    # ---- shared pieces
    def within_lot(self, o: SiteObject, code: str = "FOOTPRINT_WITHIN_LOT") -> None:
        fp = G.footprint(o, self.rd)
        title = "FOOTPRINT WITHIN THE LOT"
        if fp is None:
            self.add(o, code, title, NOT_EVALUATED, "NOT EVALUATED: A DIMENSION IS NOT SET, SO THE FOOTPRINT IS NOT KNOWN")
            return
        d = self.lot_distance(fp)
        if d is None:
            self.add(o, code, title, NOT_EVALUATED, "NOT EVALUATED: LOT BOUNDARY NOT AVAILABLE IN THE 3D MODEL")
        elif d < 0 or fp.intersects(self.site.lot.exterior):   # type: ignore[union-attr]
            self.add(o, code, title, FAIL, f"THE FOOTPRINT IS NOT INSIDE THE LOT BOUNDARY (WITHIN {_fmt(abs(d))} M OF IT)", value=round(d, 3), unit="m")
        else:
            self.add(o, code, title, PASS, f"THE FOOTPRINT IS INSIDE THE LOT, {_fmt(d)} M FROM THE BOUNDARY", value=round(d, 3), unit="m")

    def min_limit(self, o: SiteObject, code: str, title: str, key: str, value: float | None, what: str, unit: str, *, kind: str = "min", digits: int = 2,
                  missing_msg: str = "") -> None:
        """value must be at least (min) or at most (max) the limit of one rule key."""
        r = self.rule(key)
        if value is None:
            self.add(o, code, title, NOT_EVALUATED, f"NOT EVALUATED: {missing_msg or what + ' NOT SET'}", rules=[r], unit=unit)
            return
        if not r.resolved:
            self.unresolved(o, code, title, [r], value=value, unit=unit)
            return
        ok = value >= r.value - 1e-9 if kind == "min" else value <= r.value + 1e-9
        word = "AT LEAST" if kind == "min" else "AT MOST"
        self.add(o, code, title, PASS if ok else FAIL, f"{what} {_fmt(value, digits)} {unit} IS {'OK' if ok else 'NOT OK'}: THE RULE REQUIRES {word} {_fmt(r.value, digits)} {unit}",
                 rules=[r], value=round(value, 4), limit=r.value, unit=unit)

    def min_offset(self, o: SiteObject, code: str, title: str, key: str, geom: BaseGeometry | None, targets: list[BaseGeometry], none_msg: str, target_word: str) -> None:
        r = self.rule(key)
        if geom is None:
            self.add(o, code, title, NOT_EVALUATED, "NOT EVALUATED: A DIMENSION IS NOT SET, SO THE FOOTPRINT IS NOT KNOWN", rules=[r])
        elif not targets:
            self.add(o, code, title, NOT_EVALUATED, f"NOT EVALUATED: {none_msg}", rules=[r])
        elif not r.resolved:
            self.unresolved(o, code, title, [r])
        else:
            d = min(float(geom.distance(t)) for t in targets)
            ok = d >= r.value - 1e-9
            self.add(o, code, title, PASS if ok else FAIL, f"{_fmt(d)} M FROM {target_word}; THE RULE REQUIRES AT LEAST {_fmt(r.value)} M", rules=[r], value=round(d, 3), limit=r.value, unit="m")

    def services(self) -> list[BaseGeometry]:
        return [g for g in (G.footprint(s, self.rd) for s in self.site.of("service_trace") if s.status != "to_be_removed") if g is not None]

    def buildings(self) -> list[SiteObject]:
        return [b for b in self.site.of("building") if b.status != "to_be_removed"]

    # ---- rainwater tank
    def rwt(self, o: SiteObject) -> None:
        shape, dims = G.rwt_dims(o, self.rd)
        fp = G.footprint(o, self.rd)
        title_h = "TANK HEIGHT AGAINST THE RULE"
        h = G.pos(o, "height_m", self.rd)
        # maximum height: the general key and every zone qualified key found under rwt.max_height_m. (any status); a zone key that does not resolve is named
        if shape == "underground":
            self.add(o, "RWT_MAX_HEIGHT", title_h, NOT_APPLICABLE, "NOT APPLICABLE: THE TANK IS BELOW GROUND", rules=[self.rule("rwt.max_height_m")])
        else:
            keys = ["rwt.max_height_m"] + self.rules.all_keys_under("rwt.max_height_m.")
            rs = [self.rule(k) for k in dict.fromkeys(keys)]
            zone_bad = [r.key for r in rs if r.key != "rwt.max_height_m" and not r.resolved]
            zmsg = f" ZONE QUALIFIED KEY(S) NOT RESOLVED AND NOT CHECKED: {', '.join(zone_bad)}." if zone_bad else ""
            if not any(r.resolved for r in rs):
                self.add(o, "RWT_MAX_HEIGHT", title_h, NOT_EVALUATED, "NOT EVALUATED: UNRESOLVED REQUIREMENT: rwt.max_height_m (NO ZONE QUALIFIED KEY RESOLVED EITHER)." + zmsg, rules=rs)
            elif h is None:
                self.add(o, "RWT_MAX_HEIGHT", title_h, NOT_EVALUATED, "NOT EVALUATED: TANK HEIGHT NOT SET." + zmsg, rules=[r for r in rs if r.resolved])
            else:
                for r in (x for x in rs if x.resolved):
                    zone = "" if r.key == "rwt.max_height_m" else f" THE RULE APPLIES TO {r.key.rsplit('.', 1)[1].replace('_', ' ').upper()}; THE ZONE OF THE LOT IS NOT CHECKED."
                    ok = h <= r.value + 1e-9
                    self.add(o, "RWT_MAX_HEIGHT", title_h, PASS if ok else FAIL, f"TANK HEIGHT {_fmt(h)} M, THE RULE ALLOWS AT MOST {_fmt(r.value)} M.{zone}{zmsg}".rstrip("."),
                             rules=[r], value=h, limit=r.value, unit="m", suffix=":" + r.key)
        self.rwt_setback(o, shape, fp)
        # underground clearance from services in the model
        rc = self.rule("rwt.underground_tank_min_clearance_m")
        if shape is None:
            self.add(o, "RWT_UNDERGROUND_CLEARANCE", "UNDERGROUND TANK CLEARANCE", NOT_EVALUATED, "NOT EVALUATED: TANK SHAPE NOT SET", rules=[rc])
        elif shape != "underground":
            self.add(o, "RWT_UNDERGROUND_CLEARANCE", "UNDERGROUND TANK CLEARANCE", NOT_APPLICABLE, "NOT APPLICABLE: THE TANK IS NOT UNDERGROUND", rules=[rc])
        else:
            self.min_offset(o, "RWT_UNDERGROUND_CLEARANCE", "UNDERGROUND TANK CLEARANCE", "rwt.underground_tank_min_clearance_m", fp, self.services(),
                            "NO SERVICE TRACE IN THE MODEL TO MEASURE FROM (DBYD SERVICES ARE LOADED IN STAGE 8)", "THE NEAREST SERVICE TRACE IN THE MODEL")
        # boundary distance
        rb = self.rule("rwt.min_boundary_distance_m")
        lot = self.site.lot
        if fp is None or lot is None:
            self.add(o, "RWT_BOUNDARY_DISTANCE", "TANK DISTANCE TO THE BOUNDARY", NOT_EVALUATED,
                     "NOT EVALUATED: " + ("A DIMENSION IS NOT SET, SO THE FOOTPRINT IS NOT KNOWN" if fp is None else "LOT BOUNDARY NOT AVAILABLE IN THE 3D MODEL"), rules=[rb])
        else:
            self.min_offset(o, "RWT_BOUNDARY_DISTANCE", "TANK DISTANCE TO THE BOUNDARY", "rwt.min_boundary_distance_m", fp, [lot.exterior], "", "THE LOT BOUNDARY")
        # volume and connected roof
        vol = G.pos(o, "capacity_l", self.rd)
        if vol is not None:
            self.show(o, "capacity_l", "TANK VOLUME", vol, "L", self.rd.read(o, "capacity_l").basis)
        self.rwt_roof(o, vol)
        if fp is not None:
            self.within_lot(o)
        self.rwt_levels(o)
        if dims is not None:
            # round: pi x D^2 / 4 x H; slimline and underground: L x W x H (the browser computes the same, tests/fixtures/stage7_parity.json)
            vol_l = math.pi * dims[0] * dims[0] / 4 * dims[1] * 1000 if shape == "round" else dims[0] * dims[1] * dims[2] * 1000
            self.show(o, "geometric_volume_l", "VOLUME FROM THE DIMENSIONS", round(vol_l, 0), "L")

    def rwt_levels(self, o: SiteObject) -> None:
        """Inlet above overflow above outlet, and every level inside the tank body (base RL up to base RL plus height)."""
        lv = {"INLET": self.rd.num(o, "inlet_rl"), "OVERFLOW": self.rd.num(o, "overflow_rl"), "OUTLET": self.rd.num(o, "outlet_rl")}
        miss = [n for n, v in lv.items() if v is None]
        t = "TANK LEVELS: INLET ABOVE OVERFLOW ABOVE OUTLET"
        bad = [f"{a} {_fmt(lv[a], 3)} IS NOT ABOVE {b} {_fmt(lv[b], 3)}" for a, b in (("INLET", "OVERFLOW"), ("OVERFLOW", "OUTLET"), ("INLET", "OUTLET"))
               if lv[a] is not None and lv[b] is not None and not lv[a] > lv[b]]
        if bad:
            self.add(o, "RWT_LEVEL_ORDER", t, FAIL, "; ".join(bad) + ". THE INLET MUST BE ABOVE THE OVERFLOW AND THE OVERFLOW ABOVE THE OUTLET")
        elif miss:
            self.add(o, "RWT_LEVEL_ORDER", t, NOT_EVALUATED, "NOT EVALUATED: NOT SET: " + ", ".join(f"{n} RL" for n in miss))
        else:
            self.add(o, "RWT_LEVEL_ORDER", t, PASS, f"INLET {_fmt(lv['INLET'], 3)} RL IS ABOVE OVERFLOW {_fmt(lv['OVERFLOW'], 3)} RL, WHICH IS ABOVE OUTLET {_fmt(lv['OUTLET'], 3)} RL")
        base, height = self.rd.num(o, "base_rl"), G.pos(o, "height_m", self.rd)
        tb = "TANK LEVELS WITHIN THE TANK BODY"
        if base is None or height is None:
            gone = [n for n, v in (("TANK BASE RL", base), ("TANK HEIGHT", height)) if v is None] + [f"{n} RL" for n in miss]
            self.add(o, "RWT_LEVELS_IN_BODY", tb, NOT_EVALUATED, "NOT EVALUATED: NOT SET: " + ", ".join(gone))
            return
        top = base + height
        out = [f"{n} {_fmt(v, 3)} RL" for n, v in lv.items() if v is not None and not base - 1e-9 <= v <= top + 1e-9]
        if out:
            self.add(o, "RWT_LEVELS_IN_BODY", tb, FAIL, f"{', '.join(out)} OUTSIDE THE TANK BODY ({_fmt(base, 3)} RL TO {_fmt(top, 3)} RL)")
        elif miss:
            self.add(o, "RWT_LEVELS_IN_BODY", tb, NOT_EVALUATED, "NOT EVALUATED: NOT SET: " + ", ".join(f"{n} RL" for n in miss))
        else:
            self.add(o, "RWT_LEVELS_IN_BODY", tb, PASS, f"INLET, OVERFLOW AND OUTLET ARE INSIDE THE TANK BODY ({_fmt(base, 3)} RL TO {_fmt(top, 3)} RL)")

    def rwt_roof(self, o: SiteObject, vol: float | None) -> None:
        link = G.text(o, "roof_building_id", self.rd)
        conn = G.pos(o, "connected_roof_area_m2", self.rd)
        title = "CONNECTED ROOF AREA"
        b = self.site.by_id.get(link) if link else None
        if link and (b is None or b.type != "building"):
            self.add(o, "RWT_ROOF_LINK", title, FAIL, f"THE LINKED BUILDING {link.upper()} IS NOT IN THE DESIGN", severity="blocking")
            return
        roof = G.pos(b, "roof_plan_area_m2", self.rd) if b is not None else None
        basis = G.text(b, "roof_area_basis", self.rd) if b is not None else None
        if b is not None:
            self.show(o, "roof_plan_area_m2", "ROOF PLAN AREA OF THE LINKED BUILDING", roof, "m2", "MODEL", basis or "BASIS NOT SET")
        if b is None or roof is None or conn is None:
            why = "NO BUILDING IS LINKED" if b is None else "THE LINKED BUILDING HAS NO ROOF AREA" if roof is None else "CONNECTED ROOF AREA NOT SET"
            self.add(o, "RWT_ROOF_CONNECTION", title, NOT_EVALUATED, f"NOT EVALUATED: {why}")
            return
        approx = f" THE ROOF AREA BASIS IS {basis.upper()}." if basis else ""
        if conn > roof + 1e-9:
            self.add(o, "RWT_ROOF_CONNECTION", title, FAIL, f"THE CONNECTED ROOF AREA {_fmt(conn, 1)} M2 EXCEEDS THE ROOF AREA OF THE LINKED BUILDING {_fmt(roof, 1)} M2.{approx}",
                     value=conn, limit=roof, unit="m2", severity="blocking")
            return
        pct = 100.0 / roof * conn
        self.show(o, "connected_roof_pct", "SHARE OF THE LINKED ROOF CONNECTED", round(pct, 1), "%")
        self.add(o, "RWT_ROOF_CONNECTION", title, INFO, f"{_fmt(conn, 1)} M2 OF THE {_fmt(roof, 1)} M2 ROOF IS CONNECTED ({_fmt(pct, 1)} PERCENT).{approx}", value=round(pct, 2), unit="%")

    def reference_building(self, o: SiteObject) -> tuple[SiteObject | None, str]:
        link = G.text(o, "roof_building_id", self.rd)
        if link and link in self.site.by_id and self.site.by_id[link].type == "building":
            return self.site.by_id[link], ""
        houses = [b for b in self.buildings() if G.text(b, "building_use", self.rd) == "house"]
        if len(houses) == 1:
            return houses[0], ""
        if not houses and len(self.buildings()) == 1:
            return self.buildings()[0], ""
        return None, "NO DWELLING IS IDENTIFIED: LINK THE TANK TO A BUILDING OR SET THE BUILDING USE TO HOUSE"

    def rwt_setback(self, o: SiteObject, shape: str | None, fp: BaseGeometry | None) -> None:
        code, title = "RWT_STREET_SETBACK", "TANK BEHIND THE STREET SETBACK"
        r = self.rule("rwt.location_behind_street_setback")
        if not r.resolved:
            self.unresolved(o, code, title, [r])
            return
        if r.value is False:
            self.add(o, code, title, PASS, "THE RULE DOES NOT REQUIRE THE TANK TO BE BEHIND THE STREET SETBACK", rules=[r])
            return
        b, why = self.reference_building(o)
        k = self.site.kerb
        if fp is None:
            self.add(o, code, title, NOT_EVALUATED, "NOT EVALUATED: A DIMENSION IS NOT SET, SO THE FOOTPRINT IS NOT KNOWN", rules=[r])
        elif b is None:
            self.add(o, code, title, NOT_EVALUATED, f"NOT EVALUATED: {why}", rules=[r])
        elif k is None or not k["has_normal"]:
            self.add(o, code, title, NOT_EVALUATED, "NOT EVALUATED: ASSUMED KERB LINE OR LOT NOT AVAILABLE IN THE 3D MODEL, SO THE STREET SIDE IS NOT KNOWN", rules=[r])
        else:
            bg = G.footprint(b, self.rd)
            if bg is None:
                self.add(o, code, title, NOT_EVALUATED, "NOT EVALUATED: THE BUILDING FOOTPRINT IS NOT AVAILABLE", rules=[r])
                return
            nearest = lambda g: min(chainage_on_kerb(k, x, y)[1] for x, y in _coords(g))  # noqa: E731  (offset towards the lot, smallest = nearest the street)
            d_t, d_b = nearest(fp), nearest(bg)
            ok = d_t >= d_b - 1e-9
            msg = (f"THE NEAREST POINT OF THE TANK IS {_fmt(d_t)} M FROM THE ASSUMED KERB LINE; THE FRONT BUILDING LINE OF {b.id.upper()} IS {_fmt(d_b)} M. "
                   + ("THE TANK IS BEHIND IT" if ok else f"THE TANK IS {_fmt(d_b - d_t)} M IN FRONT OF IT"))
            if shape == "underground":
                self.add(o, code, title, INFO, msg + ". THE RULE TEXT MAY EXEMPT A TANK BELOW GROUND: CONFIRM AGAINST THE RULE", rules=[r], value=round(d_t - d_b, 3), limit=0.0, unit="m", severity="info" if ok else "warning")
            else:
                self.add(o, code, title, PASS if ok else FAIL, msg, rules=[r], value=round(d_t - d_b, 3), limit=0.0, unit="m")

    # ---- retaining wall
    def wall(self, o: SiteObject) -> None:
        res = screen_wall(o, self.rules, self.rd)
        rules_used = [Rule(**r) for r in res["used"] + res["missing"]]
        self.keys_used.update(r.key for r in rules_used)
        title = "RETAINING WALL SCREENING"
        if res["status"] == "NOT EVALUATED":
            self.add(o, "WALL_SCREENING", title, NOT_EVALUATED, f"{res['label']}. NOT EVALUATED: {res['reason']}", rules=[r for r in rules_used if not r.resolved] or rules_used[:1], extra={"screening": res})
        else:
            ok = res["all_ok"]
            worst = min((s for s in res["segments"] if s["screening_ok"] is not None), key=lambda s: min(s["fs_sliding"] / res["limits"]["min_fs_sliding"], s["fs_overturning"] / res["limits"]["min_fs_overturning"]))
            part = f" {res['unscreened_segments']} SEGMENT(S) HAVE NO HEIGHT AND WERE NOT SCREENED." if res["unscreened_segments"] else ""
            self.add(o, "WALL_SCREENING", title, PASS if ok else FAIL,
                     f"{res['label']}. GREATEST RETAINED HEIGHT {_fmt(res['max_height_m'])} M. WORST SEGMENT: FS SLIDING {_fmt(worst['fs_sliding'])} (MINIMUM {_fmt(res['limits']['min_fs_sliding'])}), "
                     f"FS OVERTURNING {_fmt(worst['fs_overturning'])} (MINIMUM {_fmt(res['limits']['min_fs_overturning'])}).{part}",
                     rules=rules_used, value=round(res["max_height_m"], 3), unit="m", severity="warning" if not ok else "info", extra={"screening": res})
        # certification
        rc = self.rule(KEY_CERT)
        hmax = res["max_height_m"]
        t = "CERTIFICATION HEIGHT"
        if hmax is None:
            self.add(o, "WALL_CERTIFICATION", t, NOT_EVALUATED, "NOT EVALUATED: RETAINED HEIGHT NOT SET", rules=[rc])
        elif not rc.resolved:
            self.unresolved(o, "WALL_CERTIFICATION", t, [rc], value=hmax, unit="m")
        elif hmax > rc.value + 1e-9:
            self.add(o, "WALL_CERTIFICATION", t, ACTION, f"RETAINED HEIGHT {_fmt(hmax)} M IS ABOVE {_fmt(rc.value)} M: ENGINEER CERTIFICATION OR APPROVAL IS REQUIRED", rules=[rc], value=hmax, limit=rc.value, unit="m")
        else:
            self.add(o, "WALL_CERTIFICATION", t, PASS, f"RETAINED HEIGHT {_fmt(hmax)} M IS NOT ABOVE THE {_fmt(rc.value)} M CERTIFICATION HEIGHT", rules=[rc], value=hmax, limit=rc.value, unit="m")
        # wall type against its height limit
        wt = G.text(o, "wall_type", self.rd)
        t = "WALL TYPE AGAINST ITS HEIGHT LIMIT"
        if wt is None:
            self.add(o, "WALL_TYPE_HEIGHT", t, NOT_EVALUATED, "NOT EVALUATED: WALL TYPE NOT SET")
        elif wt not in TYPE_MAX_KEYS:
            self.add(o, "WALL_TYPE_HEIGHT", t, NOT_EVALUATED, "NOT EVALUATED: NO HEIGHT LIMIT KEY IS REGISTERED FOR A WALL TYPE OF OTHER")
        else:
            self.min_limit(o, "WALL_TYPE_HEIGHT", t, TYPE_MAX_KEYS[wt], hmax, "RETAINED HEIGHT", "m", kind="max", missing_msg="RETAINED HEIGHT NOT SET")
        self.within_lot(o)

    # ---- infiltration trench
    def trench(self, o: SiteObject) -> None:
        ln = G.line_of(o)
        L = ln.length if ln is not None else None
        W, D = G.pos(o, "width_m", self.rd), G.pos(o, "depth_m", self.rd)
        n = G.num(o, "void_ratio", self.rd)
        t = "TRENCH STORAGE VOLUME"
        miss = [k for k, v in (("WIDTH", W), ("DEPTH", D)) if v is None] + (["VOID RATIO"] if n is None else ["VOID RATIO (MUST BE ABOVE 0 AND AT MOST 1)"] if not 0 < n <= 1 else [])
        if L is None or miss:
            self.add(o, "TRENCH_STORAGE", t, NOT_EVALUATED, f"NOT EVALUATED: {', '.join(miss or ['LENGTH'])} NOT SET")
        else:
            v = L * W * D * n
            calc = f"V = L x W x D x n = {_fmt(L)} x {_fmt(W)} x {_fmt(D)} x {_fmt(n)} = {_fmt(v, 3)} m3"
            self.add(o, "TRENCH_STORAGE", t, INFO, calc, value=round(v, 4), unit="m3")
            self.show(o, "storage_volume_m3", "STORAGE VOLUME", round(v, 4), "m3")
        rate, basis = G.pos(o, "infiltration_rate_mm_h", self.rd), G.text(o, "infiltration_basis", self.rd)
        tb = "INFILTRATION RATE AND ITS BASIS"
        if rate is None or basis is None:
            self.add(o, "TRENCH_RATE_BASIS", tb, NOT_EVALUATED, "NOT EVALUATED: INFILTRATION RATE OR ITS BASIS NOT SET")
        elif basis == "indicative":
            self.add(o, "TRENCH_RATE_BASIS", tb, INFO, f"RATE {_fmt(rate, 1)} MM/H IS INDICATIVE. SITE TESTING IS REQUIRED", value=rate, unit="mm/h")
        else:
            d = G.text(o, "test_date", self.rd)
            if d is None:
                self.add(o, "TRENCH_RATE_BASIS", tb, NOT_EVALUATED, "NOT EVALUATED: THE DATE OF THE SITE TEST IS NOT SET", value=rate, unit="mm/h")
            else:
                self.add(o, "TRENCH_RATE_BASIS", tb, PASS, f"RATE {_fmt(rate, 1)} MM/H FROM A SITE TEST DATED {d[8:10]}/{d[5:7]}/{d[0:4]}", value=rate, unit="mm/h")
        fp = G.footprint(o, self.rd)
        lot = self.site.lot
        if lot is None:
            self.add(o, "TRENCH_OFFSET_BOUNDARY", "TRENCH OFFSET FROM THE BOUNDARY", NOT_EVALUATED, "NOT EVALUATED: LOT BOUNDARY NOT AVAILABLE IN THE 3D MODEL", rules=[self.rule("infiltration.min_offset_boundary_m")])
        else:
            self.min_offset(o, "TRENCH_OFFSET_BOUNDARY", "TRENCH OFFSET FROM THE BOUNDARY", "infiltration.min_offset_boundary_m", fp, [lot.exterior], "", "THE LOT BOUNDARY")
        bg = [g for g in (G.footprint(b, self.rd) for b in self.buildings()) if g is not None]
        self.min_offset(o, "TRENCH_OFFSET_BUILDING", "TRENCH OFFSET FROM BUILDINGS", "infiltration.min_offset_building_m", fp, bg, "NO BUILDING IN THE MODEL TO MEASURE FROM", "THE NEAREST BUILDING")
        self.min_offset(o, "TRENCH_OFFSET_SERVICE", "TRENCH OFFSET FROM SERVICES", "infiltration.min_offset_service_m", fp, self.services(),
                        "NO SERVICE TRACE IN THE MODEL TO MEASURE FROM (DBYD SERVICES ARE LOADED IN STAGE 8)", "THE NEAREST SERVICE TRACE IN THE MODEL")
        self.within_lot(o)

    # ---- on site detention
    def entered(self, o: SiteObject, param: str, key: str, unit: str, hi: float | None = None) -> Rule | None:
        """The value of a parameter entered on the object as a Rule with its TRUE basis (USER, or the resolver's basis for a verified rule reference); None when
        the parameter is not set. A value that was refused (unverified LGA RULE, PLATFORM DEFAULT, out of range) gives an UNRESOLVED Rule that says why: the
        requirement key is NOT used in its place."""
        r = self.rd.read(o, param)
        if r.why:
            return Rule(key, None, unit, UNRESOLVED, r.why)
        if not r.ok:
            return None
        self.keys_used.add(key)
        v = r.value
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not v > 0 or (hi is not None and v > hi):
            why = f"{param.upper()}: MUST BE ABOVE ZERO" + (f" AND AT MOST {hi:g}" if hi is not None else "")
            self.refusals.setdefault(o.id, {})[param] = why
            return Rule(key, None, unit, UNRESOLVED, why)
        return Rule(key, float(v), unit, r.basis, r.ref, r.stamp)

    def psd(self, o: SiteObject) -> Rule:
        return self.entered(o, "psd_l_s", "stormwater.psd_l_s", "L/s") or self.rule("stormwater.psd_l_s")

    def osd(self, o: SiteObject) -> None:
        psd = self.psd(o)
        if psd.resolved:
            self.show(o, psd.key, "PERMISSIBLE SITE DISCHARGE", psd.value, "L/s", psd.basis, psd.ref, psd.stamp)
            self.add(o, "OSD_PSD", "PERMISSIBLE SITE DISCHARGE", INFO, f"PSD {_fmt(psd.value, 1)} L/S, {psd.basis}" + (f", {psd.stamp}" if psd.stamp else ""), rules=[psd], value=psd.value, unit="L/s")
        else:
            self.unresolved(o, "OSD_PSD", "PERMISSIBLE SITE DISCHARGE", [psd])
        d_mm, inv, twl = G.pos(o, "orifice_diameter_mm", self.rd), G.num(o, "orifice_invert_rl", self.rd), G.num(o, "top_water_level_rl", self.rd)
        cd = self.entered(o, "discharge_coefficient", "stormwater.orifice_discharge_coefficient", "", hi=1.0) or self.rule("stormwater.orifice_discharge_coefficient")
        t = "OUTLET ORIFICE DISCHARGE AT THE TOP WATER LEVEL"
        miss = [n for n, v in (("ORIFICE DIAMETER", d_mm), ("ORIFICE INVERT RL", inv), ("TOP WATER LEVEL", twl)) if v is None]
        if miss:
            self.add(o, "OSD_ORIFICE", t, NOT_EVALUATED, f"NOT EVALUATED: {', '.join(miss)} NOT SET", rules=[cd])
        elif not cd.resolved:
            head = twl - (inv + d_mm / 2000.0)
            self.add(o, "OSD_ORIFICE", t, NOT_EVALUATED, f"NOT EVALUATED: THE DISCHARGE COEFFICIENT IS UNRESOLVED ({cd.key}); THE ORIFICE EQUATION IS NOT SHOWN. HEAD {_fmt(head, 3)} M", rules=[cd], value=None)
        else:
            head = twl - (inv + d_mm / 2000.0)
            if head <= 0:
                self.add(o, "OSD_ORIFICE", t, FAIL, f"THE TOP WATER LEVEL {_fmt(twl)} IS NOT ABOVE THE ORIFICE CENTRE {_fmt(inv + d_mm / 2000.0, 3)}", rules=[cd], value=round(head, 3), unit="m")
            else:
                area = math.pi * (d_mm / 1000.0) ** 2 / 4
                q = cd.value * area * math.sqrt(2 * G_MS2 * head) * 1000.0
                calc = f"Q = Cd x A x SQRT(2 x g x h) = {_fmt(cd.value, 3)} x {area:.5f} x SQRT(2 x {G_MS2} x {_fmt(head, 3)}) = {_fmt(q, 2)} L/s"
                self.show(o, "orifice_q_l_s", "ORIFICE DISCHARGE AT THE TOP WATER LEVEL", round(q, 3), "L/s")
                if psd.resolved:
                    ok = q <= psd.value + 1e-9
                    self.add(o, "OSD_ORIFICE", t, PASS if ok else FAIL, f"{calc}; THE PSD IS {_fmt(psd.value, 1)} L/S", rules=[cd, psd], value=round(q, 3), limit=psd.value, unit="L/s")
                else:
                    self.add(o, "OSD_ORIFICE", t, NOT_EVALUATED, f"{calc}. NOT EVALUATED AGAINST THE PSD: UNRESOLVED REQUIREMENT: {psd.key}", rules=[cd, psd], value=round(q, 3), unit="L/s")
        self.min_limit(o, "OSD_MIN_ORIFICE", "ORIFICE DIAMETER AGAINST THE RULE", "stormwater.osd_min_orifice_diameter_mm", d_mm, "ORIFICE DIAMETER", "mm", digits=0, missing_msg="ORIFICE DIAMETER NOT SET")
        routes = [r for r in self.site.of("overflow_route") if G.text(r, "osd_id", self.rd) == o.id]
        if routes:
            self.add(o, "OSD_OVERFLOW_ROUTE", "OVERFLOW ROUTE", PASS, f"{len(routes)} OVERFLOW ROUTE(S) DRAWN FOR THIS OSD")
        else:
            self.add(o, "OSD_OVERFLOW_ROUTE", "OVERFLOW ROUTE", FAIL, "NO OVERFLOW ROUTE IS DRAWN AND LINKED TO THIS OSD", severity="warning")
        if o.type == "osd":
            w, l, h = G.pos(o, "width_m", self.rd), G.pos(o, "length_m", self.rd), G.pos(o, "height_m", self.rd)
            if w and l and h:
                self.show(o, "box_volume_m3", "VOLUME FROM THE DIMENSIONS", round(w * l * h, 3), "m3")
        if G.footprint(o, self.rd) is not None:
            self.within_lot(o)

    # ---- pits and pipes
    def pit(self, o: SiteObject) -> None:
        z = self.site.ground(o.geometry.p[0], o.geometry.p[1])
        inv = G.num(o, "invert_rl", self.rd)
        t = "PIT DEPTH"
        if z is None:
            self.add(o, "PIT_DEPTH", t, NOT_EVALUATED, f"NOT EVALUATED: {NO_TERRAIN} AT THE PIT")
        else:
            self.show(o, "surface_rl", "SURFACE LEVEL (TERRAIN)", round(z, 3), "m RL")
            if inv is None:
                self.add(o, "PIT_DEPTH", t, NOT_EVALUATED, f"NOT EVALUATED: INVERT LEVEL NOT SET. SURFACE LEVEL {_fmt(z, 3)} RL")
            elif z - inv <= 0:
                self.add(o, "PIT_DEPTH", t, FAIL, f"THE INVERT {_fmt(inv, 3)} RL IS NOT BELOW THE SURFACE {_fmt(z, 3)} RL", value=round(z - inv, 3), unit="m")
            else:
                self.show(o, "depth_m", "DEPTH TO INVERT", round(z - inv, 3), "m")
                self.add(o, "PIT_DEPTH", t, INFO, f"DEPTH TO INVERT {_fmt(z - inv, 3)} M (SURFACE {_fmt(z, 3)} RL, INVERT {_fmt(inv, 3)} RL)", value=round(z - inv, 3), unit="m")
        if G.footprint(o, self.rd) is not None:
            self.within_lot(o)

    def pipe_stations(self, o: SiteObject) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """(chainages, x, y) every COVER_STEP_M along the pipe plus the ends and every vertex, as arrays (the count is capped by ``engine_limits``)."""
        P = np.array([(q[0], q[1]) for q in o.geometry.pts], float)
        cum = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(P, axis=0).T))])
        L = float(cum[-1])
        steps = np.arange(1, int(L / COVER_STEP_M) + 1) * COVER_STEP_M
        ts = np.unique(np.concatenate([[0.0, L], cum, steps[steps < L]]))
        return ts, np.interp(ts, cum, P[:, 0]), np.interp(ts, cum, P[:, 1])

    def pipe(self, o: SiteObject) -> None:
        pts = [(q[0], q[1]) for q in o.geometry.pts]
        L = LineString(pts).length
        zero = not L > 0
        up, down = G.num(o, "upstream_invert_rl", self.rd), G.num(o, "downstream_invert_rl", self.rd)
        dia = G.pos(o, "diameter_mm", self.rd)
        pits = [p for p in self.site.of("stormwater_pit") if p.status != "to_be_removed"]
        ends = [G.pit_at(pts[0], pits, CONNECT_TOL_M), G.pit_at(pts[-1], pits, CONNECT_TOL_M)]
        t = "PIPE CONNECTS PIT TO PIT"
        if all(ends):
            self.add(o, "PIPE_END_PITS", t, PASS, f"UPSTREAM END AT {ends[0].id.upper()}, DOWNSTREAM END AT {ends[1].id.upper()}")
        else:
            which = [n for n, e in (("UPSTREAM", ends[0]), ("DOWNSTREAM", ends[1])) if e is None]
            self.add(o, "PIPE_END_PITS", t, FAIL, f"THE {' AND '.join(which)} END IS NOT AT A STORMWATER PIT (WITHIN {CONNECT_TOL_M:g} M)", severity="warning")
        # grade
        tg = "PIPE GRADE"
        rg = self.rule("stormwater.min_pipe_grade_pct")
        grade = None
        if zero:
            self.add(o, "PIPE_GRADE", tg, NOT_EVALUATED, "NOT EVALUATED: PIPE LENGTH ZERO (ALL VERTICES ARE AT THE SAME POINT), SO THE GRADE CANNOT BE COMPUTED", rules=[rg])
        elif up is None or down is None:
            self.add(o, "PIPE_GRADE", tg, NOT_EVALUATED, "NOT EVALUATED: UPSTREAM OR DOWNSTREAM INVERT NOT SET", rules=[rg])
        else:
            grade = (up - down) / L * 100.0
            self.show(o, "grade_pct", "GRADE (FALL OVER PLAN LENGTH)", round(grade, 3), "%")
            if grade < 0:
                self.add(o, "PIPE_GRADE", tg, FAIL, f"THE UPSTREAM INVERT {_fmt(up, 3)} IS BELOW THE DOWNSTREAM INVERT {_fmt(down, 3)}: THE PIPE FALLS THE WRONG WAY ({_fmt(grade, 2)} PERCENT)", rules=[rg], value=round(grade, 3), unit="%")
            elif not rg.resolved:
                self.add(o, "PIPE_GRADE", tg, NOT_EVALUATED, f"NOT EVALUATED: UNRESOLVED REQUIREMENT: {rg.key}. GRADE {_fmt(grade, 2)} PERCENT", rules=[rg], value=round(grade, 3), unit="%")
            else:
                ok = grade >= rg.value - 1e-9
                self.add(o, "PIPE_GRADE", tg, PASS if ok else FAIL, f"GRADE {_fmt(grade, 2)} PERCENT; THE RULE REQUIRES AT LEAST {_fmt(rg.value, 2)} PERCENT", rules=[rg], value=round(grade, 3), limit=rg.value, unit="%")
        # cover
        tc, rc = "PIPE COVER", self.rule("stormwater.min_cover_m")
        if zero:
            self.add(o, "PIPE_COVER", tc, NOT_EVALUATED, "NOT EVALUATED: PIPE LENGTH ZERO (ALL VERTICES ARE AT THE SAME POINT), SO THE COVER CANNOT BE COMPUTED", rules=[rc])
        elif up is None or down is None or dia is None:
            self.add(o, "PIPE_COVER", tc, NOT_EVALUATED, "NOT EVALUATED: " + ("PIPE DIAMETER NOT SET" if dia is None else "UPSTREAM OR DOWNSTREAM INVERT NOT SET"), rules=[rc])
        elif self.site.terrain is None:
            self.add(o, "PIPE_COVER", tc, NOT_EVALUATED, f"NOT EVALUATED: {NO_TERRAIN}", rules=[rc])
        else:
            ts, xs, ys = self.pipe_stations(o)
            z = self.site.ground_many(xs, ys)                       # one vectorised sample for every station
            have = np.isfinite(z)
            missing = int((~have).sum())
            cov = (z - ((up + (down - up) * ts / L) + dia / 1000.0))[have]
            if not cov.size:
                self.add(o, "PIPE_COVER", tc, NOT_EVALUATED, f"NOT EVALUATED: {NO_TERRAIN} ALONG THE PIPE", rules=[rc])
            else:
                mc = float(cov.min())
                part = f" TERRAIN DATA NOT AVAILABLE AT {missing} STATION(S)." if missing else ""
                basis = "COVER IS TO THE PIPE CROWN FROM THE NOMINAL DIAMETER (WALL THICKNESS IS NOT MODELLED)"
                self.show(o, "min_cover_m", "MINIMUM COVER TO THE CROWN", round(mc, 3), "m")
                if not rc.resolved:
                    self.add(o, "PIPE_COVER", tc, NOT_EVALUATED, f"NOT EVALUATED: UNRESOLVED REQUIREMENT: {rc.key}. MINIMUM COVER {_fmt(mc, 2)} M. {basis}.{part}", rules=[rc], value=round(mc, 3), unit="m")
                else:
                    ok = mc >= rc.value - 1e-9
                    self.add(o, "PIPE_COVER", tc, PASS if ok else FAIL, f"MINIMUM COVER {_fmt(mc, 2)} M; THE RULE REQUIRES AT LEAST {_fmt(rc.value, 2)} M. {basis}.{part}", rules=[rc], value=round(mc, 3), limit=rc.value, unit="m")
        self.min_limit(o, "PIPE_MIN_DIAMETER", "PIPE DIAMETER AGAINST THE RULE", "stormwater.min_pipe_diameter_mm", dia, "PIPE DIAMETER", "mm", digits=0, missing_msg="PIPE DIAMETER NOT SET")
        # direction changes
        rb = self.rule("stormwater.pipe_bends_at_pits_only")
        tb = "DIRECTION CHANGES ONLY AT PITS"
        bends = [i for i in range(1, len(pts) - 1) if G.heading_change_deg(pts[i - 1], pts[i], pts[i + 1]) > BEND_TOL_DEG]
        away = [i for i in bends if G.pit_at(pts[i], pits, CONNECT_TOL_M) is None]
        if not away:
            self.add(o, "PIPE_BENDS", tb, PASS, "THE PIPE HAS NO DIRECTION CHANGE AWAY FROM A PIT", rules=[rb])
        elif not rb.resolved:
            self.unresolved(o, "PIPE_BENDS", tb, [rb], why=f"{len(away)} DIRECTION CHANGE(S) AWAY FROM A PIT")
        elif rb.value is True:
            self.add(o, "PIPE_BENDS", tb, FAIL, f"{len(away)} DIRECTION CHANGE(S) AWAY FROM A PIT; THE RULE ALLOWS A CHANGE ONLY AT A PIT", rules=[rb], value=len(away))
        else:
            self.add(o, "PIPE_BENDS", tb, PASS, f"{len(away)} DIRECTION CHANGE(S) AWAY FROM A PIT; THE RULE DOES NOT RESTRICT THEM", rules=[rb], value=len(away))

    # ---- pool and barrier
    def pool(self, o: SiteObject) -> None:
        # a barrier satisfies a pool ONLY when its pool_id names that pool: an unlinked barrier belongs to no pool
        live = [b for b in self.site.of("pool_barrier") if b.status != "to_be_removed"]
        barriers = [b for b in live if G.text(b, "pool_id", self.rd) == o.id]
        unlinked = [b for b in live if G.text(b, "pool_id", self.rd) is None]
        t = POOL_BARRIER_LABEL
        rs = [self.rule("pool.barrier_min_height_m"), self.rule("pool.barrier_min_setback_m")]
        if not barriers:
            extra = f" {len(unlinked)} BARRIER(S) ARE NOT LINKED TO ANY POOL: LINK ONE TO THIS POOL." if unlinked else ""
            self.add(o, "POOL_BARRIER", t, FAIL, "NO LINKED BARRIER: NO POOL BARRIER IS LINKED TO THIS POOL." + extra + ("" if all(r.resolved for r in rs) else " THE BARRIER REQUIREMENTS ARE UNRESOLVED: SEE RULES"),
                     rules=rs, severity="warning")
        else:
            self.add(o, "POOL_BARRIER", t, INFO, f"{len(barriers)} POOL BARRIER OBJECT(S) LINKED TO THIS POOL" + ("" if all(r.resolved for r in rs) else "; THE BARRIER REQUIREMENTS ARE UNRESOLVED: SEE RULES"), rules=rs)
        if o.geometry.kind == "polygon" and G.ring_polygon(o) is not None:
            self.within_lot(o)
        a = G.ring_polygon(o)
        if a is not None:
            self.show(o, "area_m2", "WATER SURFACE AREA", round(a.area, 2), "m2")

    def barrier(self, o: SiteObject) -> None:
        rh, rs = self.rule("pool.barrier_min_height_m"), self.rule("pool.barrier_min_setback_m")
        h = G.pos(o, "height_m", self.rd)
        t = "POOL BARRIER HEIGHT"
        if h is None:
            self.add(o, "BARRIER_HEIGHT", t, NOT_EVALUATED, f"NOT EVALUATED: BARRIER HEIGHT NOT SET. {POOL_BARRIER_LABEL}", rules=[rh])
        elif not rh.resolved:
            self.add(o, "BARRIER_HEIGHT", t, NOT_EVALUATED, f"NOT EVALUATED: UNRESOLVED REQUIREMENT: {rh.key}. {POOL_BARRIER_LABEL}", rules=[rh], value=h, unit="m")
        else:
            ok = h >= rh.value - 1e-9
            self.add(o, "BARRIER_HEIGHT", t, PASS if ok else FAIL, f"BARRIER HEIGHT {_fmt(h)} M; THE RULE REQUIRES AT LEAST {_fmt(rh.value)} M", rules=[rh], value=h, limit=rh.value, unit="m")
        ln = G.line_of(o)
        lot = self.site.lot
        t = "POOL BARRIER SETBACK"
        if ln is None or lot is None:
            self.add(o, "BARRIER_SETBACK", t, NOT_EVALUATED, "NOT EVALUATED: LOT BOUNDARY NOT AVAILABLE IN THE 3D MODEL", rules=[rs])
        elif not rs.resolved:
            d = float(ln.distance(lot.exterior))
            self.add(o, "BARRIER_SETBACK", t, NOT_EVALUATED, f"NOT EVALUATED: UNRESOLVED REQUIREMENT: {rs.key}. {POOL_BARRIER_LABEL}. {_fmt(d)} M FROM THE LOT BOUNDARY", rules=[rs], value=round(d, 3), unit="m")
        else:
            d = float(ln.distance(lot.exterior))
            ok = d >= rs.value - 1e-9
            self.add(o, "BARRIER_SETBACK", t, PASS if ok else FAIL, f"{_fmt(d)} M FROM THE LOT BOUNDARY; THE RULE REQUIRES AT LEAST {_fmt(rs.value)} M", rules=[rs], value=round(d, 3), limit=rs.value, unit="m")
        pid = G.text(o, "pool_id", self.rd)
        if pid is None:
            self.add(o, "BARRIER_POOL_LINK", "BARRIER LINK", FAIL, "THE BARRIER IS NOT LINKED TO A POOL: IT DOES NOT SATISFY THE BARRIER REQUIREMENT OF ANY POOL", severity="warning")
        elif pid not in self.site.by_id or self.site.by_id[pid].type != "pool":
            self.add(o, "BARRIER_POOL_LINK", "BARRIER LINK", FAIL, f"THE LINKED POOL {pid.upper()} IS NOT IN THE DESIGN", severity="blocking")

    # ---- footpath
    def footpath(self, o: SiteObject) -> None:
        if o.geometry.kind == "polyline":
            self.min_limit(o, "FOOTPATH_WIDTH", "FOOTPATH WIDTH AGAINST THE RULE", "footpath.min_width_m", G.pos(o, "width_m", self.rd), "FOOTPATH WIDTH", "m", missing_msg="WIDTH NOT SET")
        cf = G.num(o, "crossfall_pct", self.rd)
        t = "FOOTPATH CROSSFALL"
        rmin, rmax = self.rule("footpath.min_crossfall_pct"), self.rule("footpath.max_crossfall_pct")
        if cf is None:
            self.add(o, "FOOTPATH_CROSSFALL", t, NOT_EVALUATED, "NOT EVALUATED: CROSSFALL NOT SET (ENTER A VALUE; THE RULE LIMITS ARE SHOWN WHEN RESOLVED)", rules=[rmin, rmax])
        elif not (rmin.resolved or rmax.resolved):
            self.unresolved(o, "FOOTPATH_CROSSFALL", t, [rmin, rmax], value=cf, unit="%")
        else:
            bad = (rmin.resolved and cf < rmin.value - 1e-9) or (rmax.resolved and cf > rmax.value + 1e-9)
            lim = " AND ".join(x for x in (f"AT LEAST {_fmt(rmin.value)}" if rmin.resolved else "", f"AT MOST {_fmt(rmax.value)}" if rmax.resolved else "") if x)
            part = "" if rmin.resolved and rmax.resolved else " (" + ", ".join(r.key for r in (rmin, rmax) if not r.resolved) + " UNRESOLVED)"
            self.add(o, "FOOTPATH_CROSSFALL", t, FAIL if bad else PASS, f"CROSSFALL {_fmt(cf)} PERCENT; THE RULE REQUIRES {lim} PERCENT{part}", rules=[rmin, rmax], value=cf, unit="%")
        if G.flag(o, "impervious", self.rd) is None:
            self.add(o, "FOOTPATH_SURFACE_FLAG", "FOOTPATH IMPERVIOUS FLAG", NOT_EVALUATED, "NOT EVALUATED: IMPERVIOUS OR PERMEABLE IS NOT SET, SO THE STORMWATER HELPER CANNOT USE THIS SURFACE", severity="info")
        if G.footprint(o, self.rd) is not None:
            self.within_lot(o)

    # ---- trees
    def tree_zones(self, o: SiteObject) -> tuple[float | None, float | None, list[Rule]]:
        """(TPZ radius, SRZ radius, the rules read). TPZ = multiplier x DBH, limited by the optional radius limits. SRZ = c x D^e (D = DBH in metres) from the
        cited coefficient c and exponent e, not less than the cited minimum radius: computed ONLY when all three resolve."""
        dbh = G.pos(o, "trunk_diameter_mm", self.rd)
        rm, rlo, rhi = self.rule("tree.tpz_dbh_multiplier"), self.rule("tree.tpz_min_radius_m"), self.rule("tree.tpz_max_radius_m")
        sc, se, sm = self.rule("tree.srz_coefficient"), self.rule("tree.srz_exponent"), self.rule("tree.srz_min_radius_m")
        tpz = srz = None
        if dbh is not None and rm.resolved:
            tpz = rm.value * dbh / 1000.0
            if rlo.resolved:
                tpz = max(tpz, rlo.value)
            if rhi.resolved:
                tpz = min(tpz, rhi.value)
        if dbh is not None and sc.resolved and se.resolved and sm.resolved:
            try:
                srz = max(sc.value * (dbh / 1000.0) ** se.value, sm.value)
            except (OverflowError, ValueError, ZeroDivisionError):
                srz = None
            if srz is not None and not math.isfinite(srz):
                srz = None
        return tpz, srz, [rm, rlo, rhi, sc, se, sm]

    def tree(self, o: SiteObject) -> None:
        t = "TREE PROTECTION ZONES"
        if o.status == "proposed":
            self.add(o, "TREE_ZONES", t, NOT_APPLICABLE, "NOT APPLICABLE: A PROPOSED TREE HAS NO EXISTING ROOT ZONE")
            return
        tpz, srz, rs = self.tree_zones(o)
        dbh = G.pos(o, "trunk_diameter_mm", self.rd)
        rm, rlo, rhi, sc, se, sm = rs
        if dbh is None:
            self.add(o, "TREE_ZONES", t, NOT_EVALUATED, "NOT EVALUATED: TRUNK DIAMETER NOT SET", rules=[rm, sc, se, sm])
            return
        srz_missing = [r.key for r in (sc, se, sm) if not r.resolved]
        if tpz is None:
            self.unresolved(o, "TREE_ZONES", t, [rm])
        else:
            part = "" if rlo.resolved and rhi.resolved else " THE MINIMUM OR MAXIMUM RADIUS IS UNRESOLVED (" + ", ".join(r.key for r in (rlo, rhi) if not r.resolved) + ") AND IS NOT APPLIED."
            self.show(o, "tpz_radius_m", "TREE PROTECTION ZONE RADIUS", round(tpz, 3), "m", rm.basis, rm.ref)
            msg = f"TPZ RADIUS {_fmt(tpz)} M = {_fmt(rm.value, 1)} x TRUNK DIAMETER {_fmt(dbh / 1000.0, 3)} M.{part}"
            if srz is None:
                msg += " SRZ NOT COMPUTED, UNRESOLVED (" + ", ".join(srz_missing) + ")." if srz_missing else " SRZ NOT COMPUTED."
            else:
                msg += f" SRZ RADIUS {_fmt(srz)} M = MAX(c x D^e, MINIMUM) = MAX({_fmt(sc.value, 3)} x {_fmt(dbh / 1000.0, 3)}^{_fmt(se.value, 3)}, {_fmt(sm.value)})."
            self.add(o, "TREE_ZONES", t, INFO, msg, rules=rs, value=round(tpz, 3), unit="m")
        if srz is not None:
            weakest = max((sc, se, sm), key=lambda r: _RANK.get(r.basis, 0))
            self.show(o, "srz_radius_m", "STRUCTURAL ROOT ZONE RADIUS", round(srz, 3), "m", weakest.basis, weakest.ref)

    def tree_encroachment(self, live: list[SiteObject]) -> None:
        trees = [o for o in live if o.type == "tree" and o.status == "existing"]
        if not trees:
            return
        others = [o for o in live if o.type not in ("tree", "landscape_area", "service_trace", "overflow_route") and o.status != "to_be_removed"]
        n = 0
        for tr in trees:
            tpz, srz, _ = self.tree_zones(tr)
            if tpz is None:
                continue
            p = Point(tr.geometry.p[0], tr.geometry.p[1])
            for o in others:
                fp = G.footprint(o, self.rd) or (G.line_of(o) if o.geometry.kind == "polyline" else None)
                if fp is None:
                    continue
                d = float(p.distance(fp))
                if d < tpz - 1e-9 and n < MAX_ENCROACHMENTS:
                    n += 1
                    inside_srz = srz is not None and d < srz - 1e-9
                    self.add(o, "TREE_ENCROACHMENT", "ENCROACHES A TREE PROTECTION ZONE", FAIL,
                             f"{o.type.replace('_', ' ').upper()} IS {_fmt(d)} M FROM EXISTING TREE {tr.id.upper()}: INSIDE ITS TPZ (RADIUS {_fmt(tpz)} M)" + (f" AND INSIDE ITS SRZ (RADIUS {_fmt(srz)} M)" if inside_srz else ""),
                             rules=[self.rule("tree.tpz_dbh_multiplier")], value=round(d, 3), limit=round(tpz, 3), unit="m", severity="blocking" if inside_srz else "warning", suffix=":" + tr.id)
        if n >= MAX_ENCROACHMENTS:
            self.notes.append(f"TREE ZONE ENCROACHMENTS ARE LISTED UP TO {MAX_ENCROACHMENTS}; THE LIST IS INCOMPLETE")

    # ---- landscape and routes
    def landscape(self, o: SiteObject) -> None:
        kind = G.text(o, "surface_kind", self.rd)
        a = G.ring_polygon(o)
        if a is not None:
            self.show(o, "area_m2", "AREA", round(a.area, 2), "m2")
        t = "SURFACE RUNOFF BEHAVIOUR"
        if kind is None:
            self.add(o, "LANDSCAPE_RUNOFF", t, NOT_EVALUATED, "NOT EVALUATED: SURFACE KIND NOT SET", severity="info")
            return
        r = self.rule(OK.landscape_key(kind))
        if r.resolved:
            self.show(o, r.key, "RUNOFF COEFFICIENT", r.value, "", r.basis, r.ref, r.stamp)
            self.add(o, "LANDSCAPE_RUNOFF", t, INFO, f"RUNOFF COEFFICIENT OF {kind.replace('_', ' ').upper()} IS {_fmt(r.value, 2)}, {r.basis}", rules=[r], value=r.value)
        else:
            self.add(o, "LANDSCAPE_RUNOFF", t, NOT_EVALUATED, f"NOT EVALUATED: RUNOFF BEHAVIOUR OF {kind.replace('_', ' ').upper()} IS UNRESOLVED ({r.key})", rules=[r], severity="info")

    def overflow(self, o: SiteObject) -> None:
        link = G.text(o, "osd_id", self.rd)
        if link is None:
            self.add(o, "OVERFLOW_LINK", "OVERFLOW ROUTE LINK", FAIL, "THE ROUTE IS NOT LINKED TO AN OSD", severity="warning")
        elif link not in self.site.by_id or self.site.by_id[link].type not in ("osd", "osd_basin"):
            self.add(o, "OVERFLOW_LINK", "OVERFLOW ROUTE LINK", FAIL, f"THE LINKED OSD {link.upper()} IS NOT IN THE DESIGN", severity="blocking")

    # ---- the design as a whole
    def design_level(self, live: list[SiteObject]) -> None:
        osds = [o for o in live if o.type in ("osd", "osd_basin") and o.status != "to_be_removed"]
        r = self.rule("stormwater.osd_required")
        t = "ON SITE DETENTION REQUIRED"
        if not r.resolved:
            self.unresolved(None, "OSD_REQUIRED", t, [r])
        elif r.value is True and not osds:
            self.add(None, "OSD_REQUIRED", t, FAIL, "OSD IS REQUIRED (" + r.basis + (", " + r.stamp if r.stamp else "") + ") BUT THE DESIGN HAS NO OSD", rules=[r], severity="warning")
        else:
            self.add(None, "OSD_REQUIRED", t, PASS, ("OSD IS NOT REQUIRED" if r.value is False else f"OSD IS REQUIRED ({r.basis}) AND THE DESIGN HAS {len(osds)}") + (f", {r.stamp}" if r.stamp else ""), rules=[r])
        rs = self.rule("stormwater.ssr_m3")
        t = "OSD STORAGE AGAINST THE SITE STORAGE REQUIREMENT"
        if not osds:
            self.add(None, "OSD_STORAGE", t, NOT_EVALUATED, "NOT EVALUATED: NO OSD IN THE DESIGN", rules=[rs])
            return
        vols = [G.pos(o, "storage_volume_m3", self.rd) for o in osds]
        if any(v is None for v in vols):
            self.add(None, "OSD_STORAGE", t, NOT_EVALUATED, "NOT EVALUATED: THE STORAGE VOLUME OF AN OSD IS NOT SET", rules=[rs])
        elif not rs.resolved:
            self.add(None, "OSD_STORAGE", t, NOT_EVALUATED, f"NOT EVALUATED: UNRESOLVED REQUIREMENT: {rs.key}. TOTAL OSD STORAGE {_fmt(sum(vols), 2)} M3", rules=[rs], value=round(sum(vols), 3), unit="m3")
        else:
            tot = sum(vols)
            ok = tot >= rs.value - 1e-9
            self.add(None, "OSD_STORAGE", t, PASS if ok else FAIL, f"TOTAL OSD STORAGE {_fmt(tot)} M3; THE SITE STORAGE REQUIREMENT IS {_fmt(rs.value)} M3", rules=[rs], value=round(tot, 3), limit=rs.value, unit="m3")


def _finite(x: Any) -> Any:
    """The answer with every non finite number (NaN, infinity) replaced by None, so the response is always valid JSON (a safety net: the inputs are range checked)."""
    if isinstance(x, float):
        return x if math.isfinite(x) else None
    if isinstance(x, dict):
        return {k: _finite(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_finite(v) for v in x]
    return x


def _coords(g: BaseGeometry) -> list[tuple[float, float]]:
    if g.geom_type == "Polygon":
        return [(x, y) for x, y in g.exterior.coords]
    if g.geom_type in ("LineString", "Point"):
        return [(x, y) for x, y in g.coords]
    return [(x, y) for part in g.geoms for x, y in _coords(part)]


def check_design(design: SiteDesign, rules: SiteRules, terrain: SiteTerrain | None) -> dict[str, Any]:
    """All rule based checks of a design. ``terrain`` None means the project has no usable terrain (checks that need it are NOT EVALUATED)."""
    return Checker(design, rules, terrain).run()
