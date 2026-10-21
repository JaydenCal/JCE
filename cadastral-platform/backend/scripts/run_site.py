#!/usr/bin/env python3
"""REAL test run for one NSW location (needs network access to the NSW spatial services).

Drives the production agents in DAG order (SA1 -> SA2 -> ENV -> SA4 -> SA5, then SA6 and SA9) through
``default_registry`` and the orchestrator's own input builders, WITHOUT the Postgres run ledger.
Every step that cannot run is reported as such; nothing is invented. Endpoints come from the SA1/SA9
environment overrides (see app.orchestrator.adapters.config and SA9_ENDPOINT_<KEY>).

    python scripts/run_site.py --check-network
    python scripts/run_site.py --lga Gunnedah --address "756 Quia Road, Gunnedah" --development-type shed --acknowledge
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
import urllib.error
import urllib.parse
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from uuid import NAMESPACE_URL, uuid5

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from pyproj import Transformer  # noqa: E402
from shapely.geometry import shape  # noqa: E402

from app.agents.base import AgentError  # noqa: E402
from app.agents.sa1_cadastre import clients as C  # noqa: E402
from app.agents.sa1_cadastre.geometry import to_mga  # noqa: E402
from app.agents.sa6_site3d import Sa6Site3d, SceneRequest, dumps  # noqa: E402
from app.agents.sa6_site3d.presets import DEFAULTS_NOTE, building_preset, preset_footprint  # noqa: E402
from app.agents.sa9_constraints import Sa9Constraints, Sa9Input  # noqa: E402
from app.agents.sa9_constraints import layers as L9  # noqa: E402
from app.agents.sa9_constraints.intersect import Feature, LayerData  # noqa: E402
from app.agents.sa9_constraints.arcgis_loader import ArcGisLayerLoader as Sa9ArcGisLoader  # noqa: E402
from app.common.contracts import AckKind, AgentCode, DevelopmentType  # noqa: E402
from app.report.maps import zone_map_from_sa1  # noqa: E402
from app.orchestrator.adapters.config import sa1_config_from_env  # noqa: E402
from app.orchestrator.adapters.nodes import lot_with_envelope  # noqa: E402
from app.orchestrator.inputs import BuildContext, InputError, RunRequest, build_input  # noqa: E402
from app.orchestrator.registry import StubAgent, default_registry  # noqa: E402
from app.agents.sa3_terrain.chain import Nsw5mProvider, SurveyProvider, TerrainRequest, mark_offline_outcome, resolve_terrain, terrain_note  # noqa: E402
from app.agents.sa3_terrain.provenance import TerrainProvenance, scene_provenance
from app.common.labels import upper_label  # noqa: E402
from app.agents.sa3_terrain.qld_lidar import QldLidarProvider, default_export, default_query  # noqa: E402
from app.agents.sa3_terrain.tile_library import TileLibraryProvider, store_from_env  # noqa: E402
from app.imagery.aerial import fetch_aerial  # noqa: E402

OK, UNRESOLVED, SKIPPED, BLOCKED, FAILED = "OK", "UNRESOLVED", "SKIPPED", "BLOCKED", "FAILED"
Fetcher = Callable[[str, dict], "tuple[bytes, str | None]"]


@dataclass
class Step:
    name: str
    status: str
    detail: str = ""
    files: list[str] = field(default_factory=list)


class Report:
    def __init__(self, echo: Callable[[str], None] = print) -> None:
        self.steps: list[Step] = []
        self.facts: dict[str, Any] = {}
        self.echo = echo

    def add(self, name: str, status: str, detail: str = "", files: list[str] | None = None) -> Step:
        s = Step(name, status, detail, files or [])
        self.steps.append(s)
        self.echo(f"[{len(self.steps):02d}] {name:<26} {status:<10} {detail}")
        for f in s.files:
            self.echo(f"     wrote {f}")
        return s


# --------------------------------------------------------------------------- network probe
def endpoint_inventory(env: dict[str, str] | None = None, buildings_url: str | None = None) -> list[tuple[str, str]]:
    """(purpose, url) for every configured remote endpoint."""
    e = os.environ if env is None else env
    cfg = sa1_config_from_env(e)
    out: list[tuple[str, str]] = [(f"SA1 cadastre {j}", lc.url) for j, lc in cfg.lot_layers.items()]
    for j, z in cfg.zoning.items():
        if z.layer:
            out.append((f"SA1 zoning {j}", z.layer.url))
        out += [(f"SA1 overlay {ov.overlay_type} {j}", ov.layer.url) for ov in z.overlays]
    out += [(f"SA1 geocoder {j}", g) for j, g in cfg.geocoders.items() if g]
    out += [(f"SA1 roads {j}", r.layer.url) for j, r in cfg.roads.items() if r.layer]
    out += [(f"SA9 {lt.key}", lt.endpoint) for lt in L9.layers_for("NSW") if lt.endpoint]
    bu = buildings_url or e.get("RUN_SITE_BUILDINGS_URL")
    if bu:
        out.append(("buildings layer", bu))
    return out


def probe(url: str, fetcher: Fetcher) -> tuple[bool, str]:
    """Reachable = the host answered (an HTTP error status still proves the host is reachable)."""
    try:
        fetcher(url, {"f": "json"})
        return True, "answered"
    except urllib.error.HTTPError as ex:
        return True, f"HTTP {ex.code}"
    except Exception as ex:  # noqa: BLE001
        return False, f"{type(ex).__name__}: {ex}"


def check_network(env: dict[str, str] | None, fetcher: Fetcher, buildings_url: str | None = None,
                  echo: Callable[[str], None] = print) -> dict[str, tuple[bool, str]]:
    by_host: dict[str, list[tuple[str, str]]] = {}
    for purpose, url in endpoint_inventory(env, buildings_url):
        by_host.setdefault(urllib.parse.urlparse(url).netloc, []).append((purpose, url))
    res: dict[str, tuple[bool, str]] = {}
    for host, items in sorted(by_host.items()):
        ok, why = probe(items[0][1], fetcher)
        res[host] = (ok, why)
        echo(f"{'REACHABLE  ' if ok else 'UNREACHABLE'} {host:<48} {why}")
        for purpose, _ in items:
            echo(f"             - {purpose}")
    if not by_host:
        echo("no endpoints configured")
    return res


# --------------------------------------------------------------------------- location resolution
def _esri_polygon(geom) -> dict:
    g = geom if geom.geom_type == "Polygon" else max(geom.geoms, key=lambda p: p.area)
    return {"rings": [list(map(list, g.exterior.coords))], "spatialReference": {"wkid": 7844}}


def _bbox_geom(lon: float, lat: float, radius_m: float) -> dict:
    dlat = radius_m / 111_320.0
    dlon = radius_m / (111_320.0 * math.cos(math.radians(lat)))
    return {"xmin": lon - dlon, "ymin": lat - dlat, "xmax": lon + dlon, "ymax": lat + dlat, "spatialReference": {"wkid": 7844}}


def pick_random_lot(client: C.ArcGISClient, layer: C.LayerConfig, centre: tuple[float, float], radius_m: float,
                    lga: str | None, seed: int | None, buildings_url: str | None, min_area: float, max_area: float,
                    tries: int = 25) -> dict:
    """Random lot near ``centre``. 'Vacant' is only claimed when a buildings layer reports no footprint on it."""
    lc = replace(layer, page_size=500, max_pages=1)
    fl = layer.fields
    where = f"UPPER({fl['lga']}) = '{lga.upper().replace(chr(39), '')}'" if lga and fl.get("lga") else "1=1"
    res = client.query(lc, where=where, geometry=_bbox_geom(*centre, radius_m), geometry_type="esriGeometryEnvelope")
    cands = []
    for f in res.features:
        p = f.get("properties") or {}
        a = p.get(fl.get("area"))
        if a not in (None, "") and not (min_area <= float(a) <= max_area):
            continue
        if lga and str(p.get(fl.get("lga")) or "").upper() != lga.upper():
            continue
        cands.append(f)
    random.Random(seed).shuffle(cands)
    notes = ["land-use / valuation attributes are not exposed by the cadastre layer"]
    bl = C.LayerConfig(buildings_url, "buildings", "buildings", "configured buildings layer", "NSW", max_pages=1) if buildings_url else None
    if bl is None:
        notes.append("'vacant' cannot be determined from the cadastre alone and no buildings layer is configured "
                     "(--buildings-url / RUN_SITE_BUILDINGS_URL): the lot is random, vacancy is UNVERIFIED")
    checked = 0
    for f in cands[:tries]:
        if bl is None:
            return {"feature": f, "vacancy": "UNVERIFIED", "candidates": len(cands), "checked": 0, "notes": notes}
        checked += 1
        b = client.query(bl, geometry=_esri_polygon(shape(f["geometry"])), geometry_type="esriGeometryPolygon")
        if not b.features:
            notes.append("no building footprint intersects the lot in the configured buildings layer")
            return {"feature": f, "vacancy": "no_building_footprint", "candidates": len(cands), "checked": checked, "notes": notes}
    raise AgentError("NO_VACANT_LOT", f"{len(cands)} candidate lots; none passed the building-footprint test in {checked} checks")


# --------------------------------------------------------------------------- SA9 loader
class ArcGisLayerLoader:
    """SA9 LayerLoader over ArcGIS REST (bbox in MGA -> query in GDA2020 -> features back in MGA)."""

    def __init__(self, client: C.ArcGISClient, srid: int) -> None:
        self.client, self.srid = client, srid
        self._inv = Transformer.from_crs(srid, 7844, always_xy=True)

    def load(self, layer, bbox):
        x0, y0 = self._inv.transform(bbox[0], bbox[1])
        x1, y1 = self._inv.transform(bbox[2], bbox[3])
        lc = C.LayerConfig(layer.endpoint, "SA9", layer.key, layer.label, layer.jurisdiction, max_pages=3)
        env = {"xmin": min(x0, x1), "ymin": min(y0, y1), "xmax": max(x0, x1), "ymax": max(y0, y1), "spatialReference": {"wkid": 7844}}
        res = self.client.query(lc, geometry=env, geometry_type="esriGeometryEnvelope")
        feats = [Feature(geometry_wkt=to_mga(shape(f["geometry"]), self.srid).wkt, attrs=f.get("properties") or {})
                 for f in res.features if f.get("geometry")]
        return LayerData(features=feats, currency=f"fetched {res.snapshot.fetched_at:%Y-%m-%d}")


# --------------------------------------------------------------------------- terrain chain and aerial imagery (stage 3)
from app.agents.sa6_site3d.site_data import aerial_providers, terrain_providers, _no_network  # noqa: E402,F401  (shared with the orchestrator adapter Sa6Adapter)


def _levels_provenance_fact(prov: TerrainProvenance) -> dict:
    """Shape used by _civil_summary and the report (source, points, copyright, accuracy)."""
    return {"source": prov.source_name, "url": prov.url, "points": prov.points, "copyright": prov.licence, "vertical_accuracy_m": prov.accuracy_m,
            "vertical_accuracy_source": "stated" if prov.accuracy_m is not None else "unknown (placeholder)", "status": prov.status, "tier": prov.tier}


# --------------------------------------------------------------------------- the run
def _user_rules_sa2(raw, zone: str | None, dwelling_type: str):
    """--rules-json: [{"element": "front", "value_numeric": 6.0, "unit": "m", ["dwelling_type"], ["lot_condition"], ["is_performance_outcome"]}, ...]
    (or {"rules": [...]}). Values are USER ENTERED (tagged in source_chunk_id/quote); nothing is defaulted."""
    from app.agents.sa2_dcp_rag.models import Sa2Output, SetbackRule, SetbackRuleset
    if not zone:
        raise AgentError("ZONE_UNKNOWN", "zone unknown: pass --zone-code")
    items = raw.get("rules", []) if isinstance(raw, dict) else raw
    rules = [SetbackRule(zone_code=zone, dwelling_type=r.get("dwelling_type", dwelling_type), element=r["element"], lot_condition=r.get("lot_condition", {}),
                         value_numeric=float(r["value_numeric"]), unit=r["unit"], is_performance_outcome=bool(r.get("is_performance_outcome", False)),
                         extraction_confidence=float(r.get("confidence") or 1.0), source_chunk_id=r.get("requirement_key") or f"user_entered:{r['element']}",
                         source_page=int(r.get("source_page") or 0), quote=r.get("quote") or "user_entered", method="table")
             for r in items]
    have = {r.element for r in rules}
    return Sa2Output(setback_ruleset=SetbackRuleset(rules=rules, unresolved=[x for x in ("front", "side", "rear", "garage_front", "site_cover_max") if x not in have],
                                                    warnings=[("rules loaded via --rules-json from the cited knowledge base (source document, page and quote retained; not re-extracted this run)" if all(r.get("quote") for r in items) else "rules are user_entered via --rules-json; not extracted from a council DCP")]))


def _json(m) -> dict:
    return m.model_dump(mode="json")


def _default_title(args) -> str:
    """Project name when --title is not given: the address or "LOT n DPnnnnnn" followed by SITE WORKS (never a raw "Test run: 2//DP..." label)."""
    import re as _re
    if getattr(args, "address", None):
        return f"{args.address} site works"
    m = _re.match(r"^\s*(\w+)\s*(?://|/)\s*(\S+)\s*$", getattr(args, "lotplan", None) or "")
    return f"Lot {m.group(1)} {m.group(2)} site works" if m else "Site works"


def _err(ex: Exception) -> str:
    return f"{getattr(ex, 'error_code', type(ex).__name__)}: {getattr(ex, 'detail', ex)}"


def _centre(s: str | None) -> tuple[float, float] | None:
    if not s:
        return None
    lon, lat = (float(x) for x in s.split(","))
    return lon, lat


def explicit_lga(value: str | None) -> str | None:
    """The council name typed with --lga, or None for 'auto' / unset."""
    v = (value or "").strip()
    return None if not v or v.lower() == "auto" else v


STORMWATER_KEYS = ("stormwater.osd_required", "stormwater.psd_l_s", "stormwater.osd_method", "stormwater.ssr_m3")


def lookup_site_lga(args: argparse.Namespace, lot, client: C.ArcGISClient, rep: "Report", offline: bool = False, custom: bool = False):
    """Resolve the LGA for the lot: typed name, else point query on the lot centroid, offline boundary files, lot attribute."""
    from app.jurisdiction import lga as G
    if custom:
        rep.add("LGA lookup", SKIPPED, "custom profile: no NSW/QLD LGA lookup")
        return None
    state = lot.jurisdiction if lot.jurisdiction in ("NSW", "QLD") else None
    typed = explicit_lga(getattr(args, "lga", None))
    try:
        if typed:
            res = G.from_user_entry(typed, state)
        else:
            lon, lat = G.centroid_lonlat(lot.boundary_wkt, lot.mga_srid)
            res = G.lookup_lga(lon, lat, client=G.PointQueryClient(getattr(client, "fetcher", None)), lot_lga_name=lot.lga_name,
                               state_hint=state, network=not offline)
            rep.facts["lga_point"] = [round(lon, 6), round(lat, 6)]
    except Exception as ex:  # noqa: BLE001 - the lookup must never stop a run
        res = G.LgaResult(method="not_found", notes=[_err(ex)])
    rep.facts["lga_lookup"] = res.model_dump()
    rep.facts["lga_code"] = res.lga_code
    rep.add("LGA lookup", OK if res.found and res.boundary_tested and not res.ambiguous else UNRESOLVED, res.summary())
    return res


def apply_requirements_context(res, lot, rep: "Report") -> None:
    """Build the requirements context with the LGA code and resolve the stormwater keys (LGA rule, else the stamped platform default)."""
    from app.agents.requirements import LotRequirementContext
    from app.agents.requirements.models import UnresolvedRequirement
    from app.report.knowledge import load_requirement_set
    if res is None:
        return
    state = res.state or (lot.jurisdiction if lot.jurisdiction in ("NSW", "QLD") else None)
    ctxt = LotRequirementContext(jurisdiction=state or lot.jurisdiction, lga=res.lga_code or "", zone=lot.zone_code)
    rep.facts["requirements_context"] = ctxt.model_dump()
    rs = load_requirement_set(res.lga_name or lot.lga_name, state=state)
    shown: dict[str, str] = {}
    defaults, unresolved = [], []
    for k in STORMWATER_KEYS:
        try:
            r = rs.get_requirement(k, jurisdiction=state, lga=res.lga_code)
            shown[k] = r.describe() + ("" if r.is_platform_default else f" ({r.citation()[:120]})")
            if r.is_platform_default:
                defaults.append(k)
        except UnresolvedRequirement:
            shown[k] = "UNRESOLVED (no LGA rule loaded and no platform default)"
            unresolved.append(k)
    rep.facts["stormwater_requirements"] = shown
    rep.facts["platform_defaults"] = defaults
    rep.add("Stormwater requirements", UNRESOLVED if (defaults or unresolved) else OK,
            "; ".join(f"{k} = {v}" for k, v in shown.items()))


def run_site(args: argparse.Namespace, env: dict[str, str] | None = None, fetcher: Fetcher | None = None,
             echo: Callable[[str], None] = print) -> Report:
    e = dict(os.environ if env is None else env)
    rep = Report(echo)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    dev = DevelopmentType(args.development_type)
    client = C.ArcGISClient(fetcher=fetcher, retries=int(e.get("SA1_HTTP_RETRIES", "2")), timeout=float(e.get("SA1_HTTP_TIMEOUT", "30")),
                            sleep=(lambda s: None) if fetcher else time.sleep)
    reg = default_registry(env=e, sa1_client=client)
    cfg = sa1_config_from_env(e)
    rep.facts.update(development_type=dev.value, started=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                     args=dict(vars(args)))
    if dev is DevelopmentType.dual_occupancy:
        rep.add("development type", UNRESOLVED, "dual_occupancy is a STUB: no preset or rules; downstream results are unresolved")
    profile = None
    custom_req = None
    if getattr(args, "profile", None):
        from app.jurisdiction.profile import JurisdictionProfile
        profile = JurisdictionProfile.model_validate_json(Path(args.profile).read_text())
        if profile.cadastre_source.kind == "custom":
            from app.jurisdiction.parcel import CustomParcelRequest
            if not getattr(args, "parcel", None):
                rep.add("locate lot", FAILED, "custom profile: give --parcel (CustomParcelRequest JSON); no NSW/QLD service is used")
                return _finish(rep, out)
            custom_req = CustomParcelRequest.model_validate_json(Path(args.parcel).read_text())
        rep.facts["profile"] = profile.name
    params: dict[str, Any] = {} if custom_req is not None else {"jurisdiction": "NSW"}
    if args.params_json:
        params.update(json.loads(Path(args.params_json).read_text()))
    if args.zone_code:
        params["zone_code"] = args.zone_code

    lga_arg = explicit_lga(getattr(args, "lga", None))      # None when --lga is 'auto' (the default): the LGA is looked up from the lot
    # ---- locate the lot
    try:
        if custom_req is not None:
            rep.add("locate lot", OK, f"user-supplied parcel ({custom_req.format}) for profile '{profile.name}'")
        elif args.lotplan:
            params["lot_identifier"] = args.lotplan
            rep.add("locate lot", OK, f"lot identifier {args.lotplan}")
        elif args.random_vacant:
            centre = _centre(args.centre)
            if centre is None:
                gc, q = cfg.geocoders.get("NSW"), args.address or (f"{lga_arg}, NSW" if lga_arg else None)
                if not (gc and q):
                    raise AgentError("NO_CENTRE", "give --centre lon,lat (or --lga / --address the geocoder can resolve)")
                centre = client.geocode(gc, q)
            pick = pick_random_lot(client, cfg.lot_layers["NSW"], centre, args.radius_m, lga_arg, args.seed,
                                   args.buildings_url or e.get("RUN_SITE_BUILDINGS_URL"), args.min_area, args.max_area)
            g = shape(pick["feature"]["geometry"]).representative_point()
            params["point"] = [g.x, g.y]
            rep.facts["vacancy"] = pick["vacancy"]
            rep.add("locate lot (random)", OK if pick["vacancy"] != "UNVERIFIED" else UNRESOLVED,
                    f"{pick['candidates']} candidates near {centre[0]:.5f},{centre[1]:.5f}; vacancy {pick['vacancy']}; " + "; ".join(pick["notes"]))
        elif args.address:
            params["address"] = args.address
            rep.add("locate lot", OK, f"address '{args.address}' (geocoded by SA1)")
        else:
            raise AgentError("NO_LOCATION", "give --address, --lotplan or --random-vacant")
    except Exception as ex:  # noqa: BLE001
        rep.add("locate lot", FAILED, _err(ex))
        return _finish(rep, out)

    rr = RunRequest(project_id=uuid5(NAMESPACE_URL, "run_site:" + json.dumps(params, sort_keys=True)), params=params,
                    development_type=dev, project_title=args.title or _default_title(args))
    ctx = BuildContext(run_id=rr.project_id, project_id=rr.project_id, user_id=rr.project_id, request=rr, conn=None,  # type: ignore[arg-type]
                       export_dir=str(out))
    R: dict[str, Any] = {}

    def call(step: str, code: AgentCode, payload: dict, key: str):
        agent = reg.get(code)
        if isinstance(agent, StubAgent):
            rep.add(step, SKIPPED, f"agent {code.value} unavailable/stub: {reg.load_errors.get(code, 'stub')}")
            return None
        try:
            R[key] = agent.run(agent.input_model.model_validate(payload))
        except Exception as ex:  # noqa: BLE001 - report, never crash the run
            gate = getattr(ex, "error_code", "") == "EXPORT_GATE_BLOCKED"
            rep.add(step, BLOCKED if gate else FAILED, _err(ex) + (" (re-run with --acknowledge once you accept the nine acknowledgements)" if gate else ""))
            return None
        ctx.upstream[key] = _json(R[key])
        return R[key]

    # ---- SA1
    OFF = None
    if getattr(args, "offline", None):
        import app.offline.lot2 as OFF           # noqa: N812 - saved-run fixture; the NSW hosts are not reachable
        os.environ["IMAGERY_PROVIDER"] = "offline_lot2"
        rep.add("offline fixture", UNRESOLVED, OFF.provenance_note())
    if OFF is not None:
        R["SA1"] = sa1 = OFF.sa1_result()
        ctx.upstream["SA1"] = _json(sa1)
    elif custom_req is not None:
        from app.jurisdiction.parcel import Sa1CustomParcel
        try:
            R["SA1"] = sa1 = Sa1CustomParcel(profile).run(custom_req)
            ctx.upstream["SA1"] = _json(sa1)
        except Exception as ex:  # noqa: BLE001
            rep.add("SA1 cadastre/zoning", FAILED, _err(ex))
            sa1 = None
    else:
        sa1 = call("SA1 cadastre/zoning", AgentCode.SA1_CADASTRE,
                   {"project_id": str(rr.project_id), "project_jurisdiction": "NSW", "params": params}, "SA1")
    if sa1 is None:
        for n in ("SA2 DCP rules", "ENV setbacks/driveway", "SA3 terrain", "SA4 services/RWT", "SA5 DXF + PDF plan", "SA6 scene bundle", "SA9 constraints"):
            rep.add(n, SKIPPED, "upstream SA1 did not produce a lot")
        return _finish(rep, out)
    lot = sa1.lot
    rep.facts.update(lotplan=lot.lotplan, lga=lot.lga_name, zone=lot.zone_code, area_m2=lot.area_m2_calculated,
                     area_registered=lot.area_m2_registered, flags=sa1.flags, snapshots=[s.service_url for s in sa1.snapshots])
    rep.add("SA1 result", OK if lot.zone_code else UNRESOLVED,
            f"{lot.lotplan}, {lot.lga_name}, {lot.area_m2_calculated:.0f} m2, zone {lot.zone_code or 'UNRESOLVED (pass --zone-code)'}; flags {sa1.flags or 'none'}")

    # ---- LGA (looked up from the lot centroid, or typed with --lga <name>) and the requirements context
    lga_res = lookup_site_lga(args, sa1.lot, client, rep, offline=OFF is not None, custom=custom_req is not None)
    apply_requirements_context(lga_res, sa1.lot, rep)

    # ---- terrain chain (stage 3): survey, QLD LiDAR, hosted tile library, NSW 5 m DEM; first available wins and carries provenance.
    #      --levels nsw keeps the earlier behaviour (NSW 5 m DEM only); --levels none skips terrain.
    terrain_out = None
    lvl = getattr(args, "levels", None) or "auto"
    if lvl != "none":
        try:
            lot_state = lot.jurisdiction if lot.jurisdiction in ("NSW", "QLD") else None
            treq = TerrainRequest(boundary_wkt=lot.boundary_wkt, srid=lot.mga_srid, state=lot_state, buffer_m=float(getattr(args, "terrain_buffer_m", 30.0)),
                                  survey=(params.get("terrain") or {}).get("survey"), accuracy_m=getattr(args, "levels_accuracy_m", None))
            terrain_out = resolve_terrain(terrain_providers(lvl, fetcher, OFF, e), treq)
            if OFF is not None:
                mark_offline_outcome(terrain_out)        # source / URL read OFFLINE FIXTURE, NOT LIVE DATA; no retrieved date
            prov = terrain_out.provenance
            rep.facts["terrain_provenance"] = prov.to_dict()
            if terrain_out.result is not None:
                if prov.tier != 1:                       # a user supplied survey stays exactly as supplied
                    for tgt in (params, rr.params):
                        tgt.setdefault("terrain", {})["survey"] = terrain_out.result.survey
                rep.facts.update(levels_provenance=_levels_provenance_fact(prov), levels_warnings=terrain_out.result.warnings)
                rep.add("levels (NSW 5 m DEM)" if lvl == "nsw" else "terrain chain", UNRESOLVED if (terrain_out.result.warnings or prov.tier > 1) else OK,
                        f"{upper_label(prov.status)}; {prov.points} points; {prov.source_name}; resolution {prov.resolution_text}; capture {prov.capture_text}; "
                        f"vertical accuracy {prov.accuracy_text}; licence {prov.licence}; " + " | ".join(a["provider"] + ": " + a["outcome"] + " (" + a["note"] + ")" for a in terrain_out.attempts)
                        + ("; " + "; ".join(terrain_out.result.warnings) if terrain_out.result.warnings else ""))
            else:
                rep.add("levels (NSW 5 m DEM)" if lvl == "nsw" else "terrain chain", UNRESOLVED,
                        f"{prov.status}; " + " | ".join(a["provider"] + ": " + a["outcome"] + " (" + a["note"] + ")" for a in terrain_out.attempts))
        except Exception as ex:  # noqa: BLE001
            rep.add("levels (NSW 5 m DEM)" if lvl == "nsw" else "terrain chain", FAILED, _err(ex))

    # ---- aerial imagery (information only): NSW / QLD orthophoto over the lot plus a margin, highest resolution first (--aerial none to skip)
    aerial_img = None
    amode = getattr(args, "aerial", None) or "auto"
    aprov = aerial_providers(amode, fetcher, OFF)
    if aprov:
        try:
            ao = fetch_aerial(aprov, lot.boundary_wkt, lot.mga_srid, lot.jurisdiction, margin_m=float(getattr(args, "terrain_buffer_m", 30.0)))
            aerial_img = ao.image
            if aerial_img is not None:
                (out / "aerial.jpg").write_bytes(aerial_img.jpeg)
                emb = aerial_img.capped()
                rep.facts["aerial"] = {"source": aerial_img.source, "capture_date": aerial_img.capture_label, "extent": aerial_img.extent, "size_px": aerial_img.size_px,
                                       "embedded_size_px": emb.size_px, "embedded_jpeg_bytes": len(emb.jpeg), "embedded_resolution_m": emb.resolution_m,
                                       "licence": aerial_img.licence, "attempts": ao.attempts}
                rep.add("Aerial imagery", OK, f"{aerial_img.source}; capture {aerial_img.capture_label}; {aerial_img.size_px[0]} x {aerial_img.size_px[1]} px; "
                        f"extent {tuple(round(v, 1) for v in aerial_img.extent)}; FOR INFORMATION ONLY", [str(out / "aerial.jpg")])
            else:
                rep.add("Aerial imagery", UNRESOLVED, "no aerial provider returned an image: " + " | ".join(f"{a['provider']}: {a['outcome']} ({a['note']})" for a in ao.attempts))
        except Exception as ex:  # noqa: BLE001
            rep.add("Aerial imagery", FAILED, _err(ex))
    else:
        rep.add("Aerial imagery", SKIPPED, "disabled (--aerial none) or no aerial provider available in this run")

    # ---- SA2
    sa2 = None
    raw_rules = None
    if getattr(args, "rules_json", None):
        try:
            raw_rules = json.loads(Path(args.rules_json).read_text())
            if profile is not None:      # rules may be typed in the profile's units (ft, in, ...)
                from app.jurisdiction.adapter import normalize_sa2_rules
                raw_rules = normalize_sa2_rules(raw_rules, profile)
            sa2 = _user_rules_sa2(raw_rules, params.get("zone_code") or lot.zone_code, dev.rule_dwelling_type)
            R["SA2"] = sa2
            ctx.upstream["SA2"] = _json(sa2)
            rep.add("SA2 DCP rules", UNRESOLVED if sa2.setback_ruleset.unresolved else OK,
                    f"{len(sa2.setback_ruleset.rules)} rule(s) USER ENTERED from {args.rules_json} (not extracted from a DCP; unverified); "
                    f"not supplied: {', '.join(sa2.setback_ruleset.unresolved) or 'none'}")
        except Exception as ex:  # noqa: BLE001
            rep.add("SA2 DCP rules", FAILED, "--rules-json: " + _err(ex))
    else:
        try:
            sa2 = call("SA2 DCP rules", AgentCode.SA2_DCP_RAG, build_input("SA2", ctx), "SA2")
        except InputError as ex:
            rep.add("SA2 DCP rules", FAILED, _err(ex))
    if sa2 is not None and not getattr(args, "rules_json", None):
        rs = sa2.setback_ruleset
        rep.facts["sa2_unresolved"] = rs.unresolved
        rep.add("SA2 DCP rules", OK if not rs.unresolved else UNRESOLVED,
                f"{len(rs.rules)} cited rules for '{dev.rule_dwelling_type}'; unresolved: {', '.join(rs.unresolved) or 'none'}; "
                + "; ".join(rs.warnings[:2]) + ("" if rs.rules or e.get("SA2_DCP_DOCS") else " (set SA2_DCP_DOCS to ingest a council DCP PDF)"))

    # ---- building (stage 8): the Plan Studio typical house placed to the CITED setbacks; the garage door becomes the driveway target (SA3 moves the driveway to meet it)
    placement = None
    if getattr(args, "building", None):
        try:
            from app.design.building_place import cited_setbacks, edges_from_lot_context, load_house, place_house
            if dev.value != "dwelling_house":
                rep.add("building placement", SKIPPED, f"the typical house is a dwelling house; development type {dev.value} has no building placed (no footprint invented)")
            else:
                house = load_house(args.building)
                lot_poly, lot_edges = edges_from_lot_context(lot)
                council_b = getattr(args, "council", None) or lga_arg or lot.lga_name or ""
                zone_b = params.get("zone_code") or lot.zone_code
                cited_b = cited_setbacks(council_b, zone_b, dev.value)
                from app.design.building_place import cited_requirement
                placement = place_house(house, lot_poly, lot_edges, cited_b, freeboard=cited_requirement(council_b, zone_b, "flood.freeboard_m"),
                                        flood_level_m=getattr(args, "flood_level_ahd", None))
                rep.facts["building"] = placement.to_dict()
                rep.facts["building"]["house_provenance"] = house.provenance
                if placement.placed:
                    rep.facts["building"]["footprint_area_m2"] = round(placement.footprint.area, 1)
                    rep.facts["building"]["roof_area_m2"] = round(placement.roof.area, 1) if getattr(placement, "roof", None) is not None else None
                if placement.placed:
                    if placement.garage_door_xy is not None:
                        for tgt in (params, rr.params):
                            tgt.setdefault("driveway", {})["garage_xy"] = [float(placement.garage_door_xy[0]), float(placement.garage_door_xy[1])]
                    rep.add("building placement", OK if placement.all_met and not placement.flags else UNRESOLVED,
                            f"{placement.source}: {house.summary()}; " + (f"{len(placement.flags)} flag(s): " + " | ".join(placement.flags) if placement.flags else "every cited setback met")
                            + "; FFL " + (f"{placement.ffl_m:g} m AHD" if placement.ffl_m is not None else "TBC"))
                else:
                    rep.add("building placement", UNRESOLVED, placement.reason)
        except Exception as ex:  # noqa: BLE001
            rep.add("building placement", FAILED, _err(ex))
            placement = None

    # ---- ENV (envelope + driveway)
    env_out = None
    if sa2 is not None:
        try:
            env_out = call("ENV setbacks/driveway", AgentCode.SA3_GEOM_TIN, build_input("ENV", ctx), "ENV")
        except InputError as ex:
            rep.add("ENV setbacks/driveway", FAILED, _err(ex))
    else:
        rep.add("ENV setbacks/driveway", SKIPPED, "needs SA2 output")
    if env_out is not None:
        ev = env_out.envelope
        rep.facts["env_unresolved"] = ev.unresolved_elements
        rep.add("ENV result", OK if not ev.unresolved_elements else UNRESOLVED,
                f"envelope {ev.area_m2:.0f} m2; unresolved rules: {', '.join(ev.unresolved_elements) or 'none'}; "
                f"{len(env_out.unresolved)} unresolved driveway requirement(s)")

    # ---- FFL (flood): min FFL = flood level + freeboard (freeboard from the cited requirement for the LGA unless overridden)
    from app.flood import FloodLevelInput, compute_min_ffl, ffl_label, freeboard_from_knowledge
    fb = freeboard_from_knowledge(lot.lga_name)
    ffl_lab = flood_text = None
    ffl_value = args.base_rl
    fchk = compute_min_ffl(FloodLevelInput(level_ahd=getattr(args, "flood_level_ahd", None), event=getattr(args, "flood_event", None) or "1% AEP",
                                           source="user_entered", source_ref="run_site --flood-level-ahd"),
                           fb, proposed_ffl=None, freeboard_override_m=getattr(args, "freeboard_m", None))
    if fchk.min_ffl is not None:
        ffl_value = max(args.base_rl, fchk.min_ffl)
        ffl_lab = flood_text = ffl_label(ffl_value, fchk)
        rep.facts["min_ffl"] = fchk.min_ffl
        rep.add("FFL (flood)", OK, f"min FFL RL {fchk.min_ffl:.2f} = {fchk.event} flood level RL {fchk.flood_level_ahd:.2f} + {fchk.freeboard_m:.2f} m freeboard "
                f"({fchk.freeboard_source}{': ' + fchk.freeboard_citation if fchk.freeboard_citation else ''}); {ffl_lab}; " + "; ".join(fchk.warnings))
    else:
        rep.add("FFL (flood)", UNRESOLVED, f"{fchk.prompt}; dwelling FFL not set from flood. Freeboard: "
                + (f"{fchk.freeboard_m:g} m ({fchk.freeboard_source})" if fchk.freeboard_m is not None else "UNRESOLVED"))

    # ---- SA3 terrain
    if params.get("terrain", {}).get("survey") and env_out is not None:
        if call("SA3 terrain/earthworks", AgentCode.SA3_GEOM_TIN, build_input("SA3", ctx), "SA3") is not None:
            rep.add("SA3 terrain/earthworks", OK, "TIN built from the supplied survey")
    else:
        rep.add("SA3 terrain", SKIPPED, "no terrain levels from the chain or a user survey (see the terrain chain step; --params-json terrain.survey is also accepted); no levels invented")

    # ---- SA4 (the orchestrator's builder also demands SA3 output; without a survey it is built here without that dependency)
    sa4 = None
    if env_out is not None:
        sa4 = call("SA4 services/RWT", AgentCode.SA4_HYDRO,
                   {"sa1": ctx.upstream["SA1"], "env": ctx.upstream["ENV"], "overlay": None,
                    "params": {**params, "development_type": dev.value}}, "SA4")
        if sa4 is not None:
            rep.facts["sa4_unresolved"] = [i.key for i in sa4.unresolved]
            rep.add("SA4 result", OK if not sa4.unresolved else UNRESOLVED,
                    f"{len(sa4.assets)} service assets, {len(sa4.connections)} connections; {len(sa4.unresolved)} unresolved requirement(s); "
                    + ("no DBYD/RWT inputs supplied; " if not sa4.assets and not sa4.rwt else "") + "; ".join(sa4.warnings[:2]))
    else:
        rep.add("SA4 services/RWT", SKIPPED, "needs ENV output")

    # ---- SA5
    if env_out is not None and sa4 is not None:
        payload = {"project_id": str(rr.project_id), "drawing_scale_denominator": args.scale, "sa1": ctx.upstream["SA1"],
                   "sa2": ctx.upstream.get("SA2"), "env": ctx.upstream["ENV"], "sa4": ctx.upstream["SA4"], "overlay": None,
                   "export_formats": ["dxf", "pdf"], "acknowledgements_present": [k.value for k in AckKind] if args.acknowledge else [],
                   "project_title": rr.project_title, "drawn_by": "run_site.py", "output_path": str(out / "plan"),
                   "development_type": dev.value, "ffl_label": ffl_lab}
        from app.jurisdiction.display import DisplaySpec, use_display
        with use_display(DisplaySpec.from_profile(profile) if profile is not None else None):
            cad = call("SA5 DXF + PDF plan", AgentCode.SA5_CAD_DXF, payload, "SA5")
        if cad is not None:
            rep.add("SA5 result", OK, f"{cad.annotation_count} annotations", [p for p in (cad.dxf_path, cad.pdf_path) if p])
    else:
        rep.add("SA5 DXF + PDF plan", SKIPPED, "needs ENV and SA4 outputs")

    # ---- multi-sheet civil plan set (PDF + DXF)
    ps_civil: dict | None = None                          # driveway earthworks and steepest profile grade from the plan set (None when no plan set was built in this run)
    if getattr(args, "planset", False):
        if env_out is not None and sa4 is not None and args.acknowledge:
            try:
                from app.agents.sa5_cad_dxf.planset import PlansetInput, build_planset
                from app.imagery.provider import provider_from_env
                dem = None
                if getattr(args, "levels", None) == "nsw":
                    from app.agents.sa3_terrain.live_levels import fetch_levels
                    dem = lambda poly: fetch_levels(poly.wkt, lot.mga_srid, buffer_m=5.0, max_points=3000, accuracy_m=getattr(args, "levels_accuracy_m", None), **({"export": OFF.export_tiff} if OFF else {})).survey  # noqa: E731
                lot_pl = lot_with_envelope(sa1, env_out)
                if OFF is not None:
                    cad_fetch = OFF.cadastre_window                                  # the saved-run fixture only holds the 3 adjoining lots
                else:
                    from shapely import wkt as _swkt
                    from app.agents.sa1_cadastre.agent import Sa1Cadastre
                    from app.agents.sa5_cad_dxf.planset.data import CadastreWindow
                    _sa1a, _lot_mga = Sa1Cadastre(cfg, client), _swkt.loads(lot.boundary_wkt)

                    def cad_fetch(window):                                           # viewport window -> every lot and road reserve in it (SA1 query)
                        lots_, ok_, note_ = _sa1a.window_lots(lot.jurisdiction, lot.mga_srid, _lot_mga, window)
                        return CadastreWindow(lots_, ok_, note_)
                council = getattr(args, "council", None) or lga_arg or lot.lga_name or ""
                if not council and getattr(args, "rules_json", None):
                    council = "Gunnedah" if "Gunnedah" in Path(args.rules_json).read_text() else ""
                pts = [tuple(p) for p in params.get("terrain", {}).get("survey", {}).get("points", [])]
                esc_run = None
                try:
                    import importlib
                    m = importlib.import_module("app.agents.sa10_esc")
                    if hasattr(m, "Sa10Esc"):
                        from app.agents.sa10_esc.models import Sa10EscInput
                        def esc_run(site):  # noqa: E306
                            tpts = [tuple(float(c) for c in q) for q in (site.spots or (site.tin.vertices.tolist() if site.tin is not None else []))]       # the DEM points the plans use: SA10 fits the fall direction to them
                            return m.Sa10Esc().run(Sa10EscInput(lot=lot_pl, development_type=dev, footprint_wkt=site.footprint.wkt if (site.footprint is not None and (getattr(site.inp, "show_dwelling", False) or getattr(site, "placement", None) is not None)) else None,        # the preset footprint is illustrative and is not drawn: the ESC layout must not depend on it
                                                                 driveway=env_out.driveway, services=sa4.to_cad_services(), terrain_points=tpts, output_dir=str(out)))
                except Exception:  # noqa: BLE001
                    esc_run = None
                pin = PlansetInput(lot=lot_pl, development_type=dev, project_title=rr.project_title, drawn_by="JCESITE", council_name=council, driveway=env_out.driveway,
                                   driveway_checks=list(env_out.checks), services=sa4.to_cad_services(), rwt=sa4.to_cad_rwt(), terrain=R.get("SA3"), survey_points=pts, dem_fetch=dem,
                                   levels_accuracy_m=getattr(args, "levels_accuracy_m", None), ffl_value=ffl_value if ffl_lab else None, ffl_label=ffl_lab,
                                   imagery=provider_from_env("NSW"), esc_runner=esc_run, unresolved=list(env_out.envelope.unresolved_elements),
                                   address=args.address or "", cadastre_fetch=cad_fetch, building=placement,
                                   rules=list((raw_rules.get("rules", []) if isinstance(raw_rules, dict) else raw_rules) or []))
                res = build_planset(pin, out, "planset", style=getattr(args, "planset_style", "legacy"),
                                    only=[x for x in (getattr(args, "planset_sheets", None) or "").split(",") if x.strip()] or None)
                rep.add("SA5 plan set", OK, f"{len(res['sheets'])} sheets; font {res['font']}; DXF audit errors {res['dxf_stats'].get('audit_errors')}", [res["pdf"], res["dxf"]])
                ps_civil = _planset_civil()            # the same driveway earthworks and profile grade the plan set sheets and the SoEE use
            except Exception as ex:  # noqa: BLE001
                import traceback
                traceback.print_exc()
                rep.add("SA5 plan set", FAILED, _err(ex))
        else:
            rep.add("SA5 plan set", SKIPPED, "needs ENV and SA4 outputs and --acknowledge")
        if getattr(args, "planset_only", False):
            return _finish(rep, out)

    # ---- SA6 (the registry's SA6 is a stub; the real generator is called directly)
    footprint_wkt = None
    if placement is not None and placement.placed:                       # the placed typical house is the footprint of the site report maps (stage 8)
        footprint_wkt = placement.footprint.wkt
    if env_out is not None and sa4 is not None:
        try:
            blds, note = [], ""
            if dev in (DevelopmentType.shed, DevelopmentType.secondary_dwelling):
                footprint_wkt = preset_footprint(dev, env_out.envelope.envelope_wkt)
                if footprint_wkt is None:
                    note = "preset building does not fit the envelope (not shrunk); no building drawn. "
                else:
                    blds = [building_preset(dev, footprint_wkt, args.base_rl)]
                    note = (f"{blds[0].name} preset at placeholder RL {args.base_rl:g} (NO survey, not AHD). {DEFAULTS_NOTE} "
                            + ("Setbacks UNRESOLVED: placement illustrative only. " if env_out.envelope.unresolved_elements else ""))
            tkw: dict[str, Any] = {}
            if terrain_out is not None:
                tkw["terrain_provenance"] = scene_provenance(terrain_out.provenance)
                if terrain_out.result is not None:
                    tkw.update(survey_points=terrain_out.result.points, terrain_note=terrain_note(terrain_out.provenance))
            if aerial_img is not None:
                tkw["aerial"] = aerial_img.to_scene()
            if OFF is not None:
                tkw["data_status"] = OFF.provenance_note()
            scene = Sa6Site3d().run(SceneRequest(
                project_title=rr.project_title, subtitle=f"{dev.label} (unverified)", lot=lot_with_envelope(sa1, env_out),
                driveway=env_out.driveway, services=sa4.to_cad_services(), rwt=sa4.to_cad_rwt(), buildings=blds,
                development_type=dev, ffl=ffl_value if (blds or ffl_lab) else None, ffl_label=ffl_lab, **tkw))
            p = out / "scene_bundle.json"
            p.write_text(dumps(scene))
            rep.add("SA6 scene bundle", OK if not env_out.envelope.unresolved_elements else UNRESOLVED,
                    note + f"{len(scene.parts)} parts; terrain: " + (terrain_out.provenance.status if terrain_out is not None else "chain not run"), [str(p)])
        except Exception as ex:  # noqa: BLE001
            rep.add("SA6 scene bundle", FAILED, _err(ex))
    else:
        rep.add("SA6 scene bundle", SKIPPED, "needs ENV and SA4 outputs")

    # ---- SA9
    if profile is not None and profile.cadastre_source.kind == "custom":
        rep.add("SA9 constraints report", SKIPPED, "custom municipality: no built-in constraint layers (NSW/QLD only); check overlays with the local authority")
        return _finish(rep, out)
    try:
        L9.set_endpoints(json.loads(Path(args.sa9_endpoints).read_text()) if args.sa9_endpoints else {})
        configured = [lt.key for lt in L9.layers_for("NSW") if lt.endpoint]
        if getattr(args, "report", False):
            os.environ.setdefault("IMAGERY_PROVIDER", "nsw")
        in9 = Sa9Input(
            lot=lot_with_envelope(sa1, env_out) if env_out is not None else lot, footprint_wkt=footprint_wkt,
            output_dir=str(out), development_type=dev, flood_ffl_text=flood_text,
            project_title=rr.project_title, flags=list(sa1.flags or []), civil=_civil_summary(R, rep.facts, fchk, env_out, sa4, ps_civil, bool(getattr(args, 'planset', False)), building=(rep.facts.get('building') if (rep.facts.get('building') or {}).get('placed') else None)),
            zone_map=zone_map_from_sa1(sa1))     # zone polygons for the land zoning map (none in the offline fixture: the map says so)
        if getattr(args, "report", False):       # reproducible re-render input: re-run SA9 on this file to rebuild the report
            (out / "sa9_input.json").write_text(in9.model_dump_json(indent=1))
        r9 = Sa9Constraints(Sa9ArcGisLoader(lot.mga_srid, getter=(lambda u, p: json.loads(fetcher(u, p)[0])) if fetcher else None, sleep=(lambda s: None) if fetcher else time.sleep) if configured else None).run(in9)
        if getattr(args, "report", False):
            import shutil
            shutil.copyfile(r9.pdf_path, out / "site_report.pdf")
            shutil.copyfile(r9.json_path, out / "site_report.json")
            rep.add("Site report", OK, "Site Assessment and Planning Constraints Report", [str(out / "site_report.pdf"), str(out / "site_report.json")])
        n_aff = sum(1 for x in r9.layers if x.status == "affected")
        n_nc = sum(1 for x in r9.layers if x.status == "not_checked")
        unres = [t.rule_id for t in r9.triggers if t.unresolved]
        rep.facts.update(sa9_not_checked=n_nc, sa9_unresolved_rules=unres)
        rep.add("SA9 constraints report", UNRESOLVED if (n_nc or unres) else OK,
                f"{len(r9.layers)} layers: {n_aff} affected, {n_nc} NOT CHECKED (no endpoint in endpoints_nsw.json, SA9_ENDPOINT_<KEY> or --sa9-endpoints); "
                f"{len(r9.triggers)} trigger(s); rules with unresolved values: {', '.join(unres) or 'none'}",
                [r9.pdf_path, r9.json_path, r9.geojson_path])
    except Exception as ex:  # noqa: BLE001
        rep.add("SA9 constraints report", FAILED, _err(ex))
    return _finish(rep, out)


def _planset_civil() -> dict | None:
    """Driveway earthworks and the steepest driveway profile grade, read with the plan set helpers from the site the plan set just drew (so the report, the plan set and
    the SoEE state the same figures).  None if the helpers are not available or the plan set drew no driveway."""
    try:
        from app.agents.sa5_cad_dxf.planset import generate as G
        from app.agents.sa5_cad_dxf.planset import sheets_ref2 as S2
        site = G.LAST_SITE
        if site is None:
            return None
        out: dict[str, Any] = {}
        ew = S2.driveway_earthworks(site)
        if ew:
            out["driveway_cut_m3"], out["driveway_fill_m3"] = float(ew["cut"]), float(ew["fill"])
        p = S2.ref_profile(site)
        if p is not None:
            g = [c for c in p["checks"] if c.name == "max_grade" and c.value is not None]
            if g:
                out["driveway_max_grade_pct"] = float(g[0].value)
        return out or None
    except Exception:  # noqa: BLE001
        return None


def _accuracy_text(acc: float | None, source: str | None) -> str:
    """Vertical accuracy for the report.  A figure the service did not state is a placeholder: say so in words (never "5 m (unknown (placeholder))")."""
    if acc is None:
        return "UNKNOWN: not stated by the service"
    if not source or "placeholder" in str(source).lower() or "unknown" in str(source).lower():
        return f"UNKNOWN: not stated by the service. A {acc:g} m placeholder is used only so that uncertainty is not understated. It is not a stated figure"
    return f"{acc:g} m ({source})"


def _civil_summary(R: dict, facts: dict, fchk, env_out, sa4, ps: dict | None = None, planset_run: bool = False, building: dict | None = None) -> dict | None:
    """Plain dict for the report's civil page. Only what exists; nothing is invented."""
    cv: dict[str, Any] = {}
    t3 = R.get("SA3")
    prov = facts.get("levels_provenance") or {}
    if t3 is not None:
        tin = t3.tin
        cv["terrain"] = {"source": prov.get("source") or t3.source, "points": prov.get("points"), "min_z": tin.min_z, "max_z": tin.max_z,
                         "copyright": prov.get("copyright", ""), "dem_5m": prov.get("tier") == 4 or "5M" in str(prov.get("source", "")).upper(),
                         "accuracy_text": _accuracy_text(t3.vertical_accuracy_m, prov.get("vertical_accuracy_source"))}
        if t3.cut_fill is not None:
            cv["earthworks"] = t3.cut_fill.model_dump()
    cv["planset_built"] = planset_run
    if building:
        cv["building"] = {k: v for k, v in building.items() if k != "footprint_wkt"}
    if ps:
        cv["planset"] = ps
    if fchk is not None:
        cv["ffl"] = fchk.model_dump()
    if env_out is not None and getattr(env_out, "driveway", None) is not None:
        cv["driveway"] = env_out.driveway.model_dump()
    if sa4 is not None:
        cv["services"] = {"assets": len(sa4.assets), "connections": len(sa4.connections),
                          "rwt_text": (f"{sa4.rwt.tank_volume_l} L tank (unverified)" if getattr(sa4, "rwt", None) is not None and hasattr(sa4.rwt, "tank_volume_l") else None)}
    return cv or None


def _finish(rep: Report, out: Path) -> Report:
    f = rep.facts
    loc = {k: v for k, v in f.get("args", {}).items() if k in ("address", "lotplan", "random_vacant", "lga", "centre", "seed") and v}
    lines = [f"# Run summary: {f.get('lotplan', 'no lot resolved')}", "",
             f"- Generated: {f.get('started')} by `scripts/run_site.py`", f"- Development type: **{f.get('development_type')}**",
             f"- Location input: `{loc}`"]
    if f.get("vacancy"):
        lines.append(f"- Vacancy: **{f['vacancy']}**" + (" (cannot be determined from the cadastre alone)" if f["vacancy"] == "UNVERIFIED" else ""))
    if f.get("lotplan"):
        lines.append(f"- Lot: {f['lotplan']}, {f.get('lga')}, zone {f.get('zone') or 'UNRESOLVED'}, {f.get('area_m2', 0):.0f} m2 calculated "
                     f"(registered {f.get('area_registered') or 'n/a'}); SA1 flags {f.get('flags') or 'none'}")
    if f.get("lga_lookup"):
        from app.jurisdiction import lga as G
        lines.append(f"- LGA: {f['lga_lookup'].get('lga_name') or 'UNRESOLVED'}, code {f.get('lga_code') or 'UNRESOLVED'}, "
                     f"{f['lga_lookup'].get('method')} ({G.verification_text(bool(f['lga_lookup'].get('boundary_tested')), bool(f['lga_lookup'].get('source_verified')), bool(f['lga_lookup'].get('ambiguous')))})")
    lines += ["", "| # | Step | Status | Detail |", "|---|---|---|---|"]
    lines += [f"| {i} | {s.name} | {s.status} | {s.detail.replace('|', '/')} |" for i, s in enumerate(rep.steps, 1)]
    lines += ["", "## Files", *[f"- `{x}`" for s in rep.steps for x in s.files], "- `run_summary.md`, `run_steps.json`", "",
              "## Unresolved (nothing below was defaulted)"]
    for k, label in (("sa2_unresolved", "SA2 DCP elements"), ("env_unresolved", "Envelope rules"), ("sa4_unresolved", "SA4 requirements"),
                     ("sa9_unresolved_rules", "SA9 rules with unresolved values")):
        if f.get(k):
            lines.append(f"- {label}: {', '.join(map(str, f[k]))}")
    if f.get("platform_defaults"):
        lines += ["", "## Platform defaults in use (PLATFORM DEFAULT, LGA RULE NOT LOADED)"]
        lines += [f"- {k}: {f['stormwater_requirements'][k]}" for k in f["platform_defaults"]]
    lines += ["", "All outputs are indicative and unverified: the cadastre is not a survey and nothing here is a planning or building "
              "approval. Verify setbacks and requirements with the council / certifier."]
    (out / "run_summary.md").write_text("\n".join(lines) + "\n")
    (out / "run_steps.json").write_text(json.dumps({"facts": f, "steps": [s.__dict__ for s in rep.steps]}, indent=1, default=str))
    rep.echo(f"\nsummary: {out / 'run_summary.md'}")
    return rep


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--check-network", action="store_true", help="probe each configured host and exit")
    p.add_argument("--offline", choices=["lot2"], help="use the saved Lot 2 DP227508 fixture (app/offline/lot2.py) instead of the NSW services: SA1 lot, 5 m DEM and aerials come from the saved run; use with --lotplan 2//DP227508 (--levels auto or nsw)")
    p.add_argument("--lga", default="auto", help="'auto' (default): find the LGA (NSW or QLD) from the lot centroid and load its rules; or a council name "
                   "(typed LGA, also the random-lot filter / centre lookup), e.g. Gunnedah")
    p.add_argument("--address", help='e.g. "756 Quia Road, Gunnedah"')
    p.add_argument("--lotplan", help="NSW lot identifier, e.g. 12//DP345678")
    p.add_argument("--random-vacant", action="store_true", help="random lot near --centre/--address/--lga; vacancy needs --buildings-url")
    p.add_argument("--centre", help="lon,lat (GDA2020) centre for --random-vacant")
    p.add_argument("--radius-m", type=float, default=1500.0)
    p.add_argument("--min-area", type=float, default=300.0)
    p.add_argument("--max-area", type=float, default=2500.0)
    p.add_argument("--seed", type=int, default=None)
    p.add_argument("--buildings-url", help="ArcGIS building-footprint layer URL (or env RUN_SITE_BUILDINGS_URL)")
    p.add_argument("--development-type", choices=[d.value for d in DevelopmentType], default="dwelling_house")
    p.add_argument("--zone-code", help="override when SA1 cannot determine the zone")
    p.add_argument("--levels", choices=["auto", "nsw", "none"], default="auto",
                   help="terrain source. 'auto' (default): first available of user survey (params.terrain.survey), QLD LiDAR (QLD lots with LiDAR coverage), hosted LiDAR tile library "
                        "(JCESITE_LIDAR_TILE_DIR), NSW 5 m DEM; 'nsw': the NSW 5 m DEM only (accuracy not stated by the service); 'none': no terrain")
    p.add_argument("--aerial", choices=["auto", "none"], default="auto", help="draped aerial imagery for information only (NSW / QLD orthophoto, highest resolution); 'none' skips it")
    p.add_argument("--terrain-buffer-m", type=float, default=30.0, help="terrain and aerial margin beyond the lot, metres (road, adjoining lots)")
    p.add_argument("--levels-accuracy-m", type=float, help="user-entered vertical accuracy for --levels (otherwise flagged UNKNOWN)")
    p.add_argument("--rules-json", help="JSON list of USER-ENTERED setback rules [{element,value_numeric,unit,...}] used instead of SA2 DCP extraction")
    p.add_argument("--params-json", help="JSON file merged into run params (terrain.survey, dbyd.*, ...)")
    p.add_argument("--sa9-endpoints", help='JSON file {"nsw_flood": {"endpoint": "...", "verified": false}, ...}')
    p.add_argument("--acknowledge", action="store_true", help="operator confirms the nine export acknowledgements (needed for DXF/PDF)")
    p.add_argument("--profile", help="JurisdictionProfile JSON (custom municipality: units, CRS, locale, vehicles, cadastre source)")
    p.add_argument("--parcel", help="CustomParcelRequest JSON (GeoJSON/DXF/coordinates/traverse) used when the profile's cadastre_source is 'custom'")
    p.add_argument("--scale", type=int, default=200)
    p.add_argument("--planset", action="store_true", help="also write the multi-sheet civil plan set planset.pdf / planset.dxf")
    p.add_argument("--planset-only", action="store_true", help="with --planset: stop after the plan set (skip SA6 scene and SA9 constraints)")
    p.add_argument("--planset-style", choices=["legacy", "ref"], default="legacy", help="plan set style: legacy A3 (12 sheets) or ref (A1 reference style; stage 1 builds C101 only)")
    p.add_argument("--planset-sheets", help="comma list of sheet numbers to build, e.g. C101 (ref style default C101)")
    p.add_argument("--council", help="council name for cited-requirement lookup in the plan set (default --lga / SA1 / rules file)")
    p.add_argument("--base-rl", type=float, default=0.0, help="placeholder floor RL for the scene when no survey exists")
    p.add_argument("--flood-level-ahd", type=float, help="design flood level, RL m AHD (council certificate / flood study); FFL = level + freeboard")
    p.add_argument("--flood-event", default="1% AEP", help="flood planning event the level refers to (default 1%% AEP)")
    p.add_argument("--freeboard-m", type=float, help="freeboard override (user_entered); default = cited flood.freeboard_m for the LGA else UNRESOLVED")
    p.add_argument("--report", action="store_true", help="also write site_report.pdf/.json (Site Assessment and Planning Constraints Report; live NSW aerials unless IMAGERY_PROVIDER is set)")
    p.add_argument("--building", help="Plan Studio project file (.planstudio.json) of the house to place on the lot to the cited setbacks (stage 8); e.g. tests/fixtures/planstudio_house_single.planstudio.json")
    p.add_argument("--title")
    p.add_argument("--out", default="out/run_site")
    return p


def main(argv: list[str] | None = None) -> int:
    a = build_parser().parse_args(argv)
    if a.check_network:
        res = check_network(dict(os.environ), lambda u, p: C.default_fetcher(u, p, 10.0), a.buildings_url)
        return 0 if res and all(ok for ok, _ in res.values()) else 1
    rep = run_site(a)
    return 2 if any(s.status == FAILED and s.name.startswith(("locate", "SA1")) for s in rep.steps) else 0


if __name__ == "__main__":
    sys.exit(main())
