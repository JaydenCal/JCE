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
from app.agents.sa6_glide3d import Sa6Glide3d, SceneRequest, dumps  # noqa: E402
from app.agents.sa6_glide3d.presets import DEFAULTS_NOTE, building_preset, preset_footprint  # noqa: E402
from app.agents.sa9_constraints import Sa9Constraints, Sa9Input  # noqa: E402
from app.agents.sa9_constraints import layers as L9  # noqa: E402
from app.agents.sa9_constraints.intersect import Feature, LayerData  # noqa: E402
from app.common.contracts import AckKind, AgentCode, DevelopmentType  # noqa: E402
from app.orchestrator.adapters.config import sa1_config_from_env  # noqa: E402
from app.orchestrator.adapters.nodes import lot_with_envelope  # noqa: E402
from app.orchestrator.inputs import BuildContext, InputError, RunRequest, build_input  # noqa: E402
from app.orchestrator.registry import StubAgent, default_registry  # noqa: E402

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


# --------------------------------------------------------------------------- the run
def _json(m) -> dict:
    return m.model_dump(mode="json")


def _err(ex: Exception) -> str:
    return f"{getattr(ex, 'error_code', type(ex).__name__)}: {getattr(ex, 'detail', ex)}"


def _centre(s: str | None) -> tuple[float, float] | None:
    if not s:
        return None
    lon, lat = (float(x) for x in s.split(","))
    return lon, lat


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
    params: dict[str, Any] = {"jurisdiction": "NSW"}
    if args.params_json:
        params.update(json.loads(Path(args.params_json).read_text()))
    if args.zone_code:
        params["zone_code"] = args.zone_code

    # ---- locate the lot
    try:
        if args.lotplan:
            params["lot_identifier"] = args.lotplan
            rep.add("locate lot", OK, f"lot identifier {args.lotplan}")
        elif args.random_vacant:
            centre = _centre(args.centre)
            if centre is None:
                gc, q = cfg.geocoders.get("NSW"), args.address or (f"{args.lga}, NSW" if args.lga else None)
                if not (gc and q):
                    raise AgentError("NO_CENTRE", "give --centre lon,lat (or --lga / --address the geocoder can resolve)")
                centre = client.geocode(gc, q)
            pick = pick_random_lot(client, cfg.lot_layers["NSW"], centre, args.radius_m, args.lga, args.seed,
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
                    development_type=dev, project_title=args.title or f"Test run: {args.address or args.lotplan or 'random lot'}")
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

    # ---- SA2
    sa2 = None
    try:
        sa2 = call("SA2 DCP rules", AgentCode.SA2_DCP_RAG, build_input("SA2", ctx), "SA2")
    except InputError as ex:
        rep.add("SA2 DCP rules", FAILED, _err(ex))
    if sa2 is not None:
        rs = sa2.setback_ruleset
        rep.facts["sa2_unresolved"] = rs.unresolved
        rep.add("SA2 DCP rules", OK if not rs.unresolved else UNRESOLVED,
                f"{len(rs.rules)} cited rules for '{dev.rule_dwelling_type}'; unresolved: {', '.join(rs.unresolved) or 'none'}; "
                + "; ".join(rs.warnings[:2]) + ("" if rs.rules or e.get("SA2_DCP_DOCS") else " (set SA2_DCP_DOCS to ingest a council DCP PDF)"))

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

    # ---- SA3 terrain
    if params.get("terrain", {}).get("survey") and env_out is not None:
        if call("SA3 terrain/earthworks", AgentCode.SA3_GEOM_TIN, build_input("SA3", ctx), "SA3") is not None:
            rep.add("SA3 terrain/earthworks", OK, "TIN built from the supplied survey")
    else:
        rep.add("SA3 terrain", SKIPPED, "no survey supplied (params.terrain.survey via --params-json); no levels invented")

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
                   "development_type": dev.value}
        cad = call("SA5 DXF + PDF plan", AgentCode.SA5_CAD_DXF, payload, "SA5")
        if cad is not None:
            rep.add("SA5 result", OK, f"{cad.annotation_count} annotations", [p for p in (cad.dxf_path, cad.pdf_path) if p])
    else:
        rep.add("SA5 DXF + PDF plan", SKIPPED, "needs ENV and SA4 outputs")

    # ---- SA6 (the registry's SA6 is a stub; the real generator is called directly)
    footprint_wkt = None
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
            scene = Sa6Glide3d().run(SceneRequest(
                project_title=rr.project_title, subtitle=f"{dev.label} (unverified)", lot=lot_with_envelope(sa1, env_out),
                driveway=env_out.driveway, services=sa4.to_cad_services(), rwt=sa4.to_cad_rwt(), buildings=blds,
                development_type=dev, ffl=args.base_rl if blds else None))
            p = out / "scene_bundle.json"
            p.write_text(dumps(scene))
            rep.add("SA6 scene bundle", OK if not env_out.envelope.unresolved_elements else UNRESOLVED,
                    note + f"{len(scene.parts)} parts; no terrain (no survey)", [str(p)])
        except Exception as ex:  # noqa: BLE001
            rep.add("SA6 scene bundle", FAILED, _err(ex))
    else:
        rep.add("SA6 scene bundle", SKIPPED, "needs ENV and SA4 outputs")

    # ---- SA9
    try:
        L9.set_endpoints(json.loads(Path(args.sa9_endpoints).read_text()) if args.sa9_endpoints else {})
        configured = [lt.key for lt in L9.layers_for("NSW") if lt.endpoint]
        r9 = Sa9Constraints(ArcGisLayerLoader(client, lot.mga_srid) if configured else None).run(Sa9Input(
            lot=lot_with_envelope(sa1, env_out) if env_out is not None else lot, footprint_wkt=footprint_wkt,
            output_dir=str(out), development_type=dev))
        n_aff = sum(1 for x in r9.layers if x.status == "affected")
        n_nc = sum(1 for x in r9.layers if x.status == "not_checked")
        unres = [t.rule_id for t in r9.triggers if t.unresolved]
        rep.facts.update(sa9_not_checked=n_nc, sa9_unresolved_rules=unres)
        rep.add("SA9 constraints report", UNRESOLVED if (n_nc or unres) else OK,
                f"{len(r9.layers)} layers: {n_aff} affected, {n_nc} NOT CHECKED (no endpoint: set SA9_ENDPOINT_<KEY> or --sa9-endpoints); "
                f"{len(r9.triggers)} trigger(s); rules with unresolved values: {', '.join(unres) or 'none'}",
                [r9.pdf_path, r9.json_path, r9.geojson_path])
    except Exception as ex:  # noqa: BLE001
        rep.add("SA9 constraints report", FAILED, _err(ex))
    return _finish(rep, out)


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
    lines += ["", "| # | Step | Status | Detail |", "|---|---|---|---|"]
    lines += [f"| {i} | {s.name} | {s.status} | {s.detail.replace('|', '/')} |" for i, s in enumerate(rep.steps, 1)]
    lines += ["", "## Files", *[f"- `{x}`" for s in rep.steps for x in s.files], "- `run_summary.md`, `run_steps.json`", "",
              "## Unresolved (nothing below was defaulted)"]
    for k, label in (("sa2_unresolved", "SA2 DCP elements"), ("env_unresolved", "Envelope rules"), ("sa4_unresolved", "SA4 requirements"),
                     ("sa9_unresolved_rules", "SA9 rules with unresolved values")):
        if f.get(k):
            lines.append(f"- {label}: {', '.join(map(str, f[k]))}")
    lines += ["", "All outputs are indicative and unverified: the cadastre is not a survey and nothing here is a planning or building "
              "approval. Verify setbacks and requirements with the council / certifier."]
    (out / "run_summary.md").write_text("\n".join(lines) + "\n")
    (out / "run_steps.json").write_text(json.dumps({"facts": f, "steps": [s.__dict__ for s in rep.steps]}, indent=1, default=str))
    rep.echo(f"\nsummary: {out / 'run_summary.md'}")
    return rep


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--check-network", action="store_true", help="probe each configured host and exit")
    p.add_argument("--lga", help="council name (random-lot filter / centre lookup), e.g. Gunnedah")
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
    p.add_argument("--params-json", help="JSON file merged into run params (terrain.survey, dbyd.*, ...)")
    p.add_argument("--sa9-endpoints", help='JSON file {"nsw_flood": {"endpoint": "...", "verified": false}, ...}')
    p.add_argument("--acknowledge", action="store_true", help="operator confirms the nine export acknowledgements (needed for DXF/PDF)")
    p.add_argument("--scale", type=int, default=200)
    p.add_argument("--base-rl", type=float, default=0.0, help="placeholder floor RL for the scene when no survey exists")
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
