"""CSV and JSON schedules: the objects with their parameters and bases, the list of checks, and the stormwater summary.

Each file carries the status labels of the viewer: the terrain status and the notes (UNVERIFIED services, pending AI proposals) as columns in the CSV and as ``status`` in the JSON. A cell that
has no value is empty and the ``value`` of an UNRESOLVED parameter says NOT SET in the CSV and in the JSON (the ``basis`` beside it says ``unresolved``); nothing is filled in. A text cell
of a CSV that a spreadsheet would run as a formula (it starts with = + - @ tab or carriage return) gets a leading apostrophe.
"""
from __future__ import annotations

import csv
import io
import json
import math
from typing import Any

from shapely.geometry import LineString, Polygon

from app.design.site_design import SiteObject

from .common import NOT_AVAILABLE, ExportContext

SCHEMA = "site_schedule.v1"
NOT_SET = "NOT SET"


def object_note(ctx: ExportContext, o: SiteObject) -> str:
    notes = []
    if o.type == "service_existing":
        notes.append("VERIFIED BY THE USER, INDICATIVE" if o.verified else "UNVERIFIED, INDICATIVE ONLY")
    if o.origin == "ai_proposal":
        notes.append(f"AI PROPOSAL, {(o.accepted or 'pending').upper()}")
    if o.status == "to_be_removed":
        notes.append("TO BE REMOVED")
    return "; ".join(notes)


def geometry_figures(o: SiteObject) -> dict[str, Any]:
    g = o.geometry
    if g.kind == "point":
        return {"centroid_e": g.p[0], "centroid_n": g.p[1], "length_m": None, "area_m2": None, "vertices": 1}
    if g.kind == "polyline":
        ln = LineString([(p[0], p[1]) for p in g.pts])
        c = ln.centroid
        return {"centroid_e": c.x, "centroid_n": c.y, "length_m": ln.length, "area_m2": None, "vertices": len(g.pts)}
    pg = Polygon([(p[0], p[1]) for p in g.ring])
    c = pg.centroid
    return {"centroid_e": c.x, "centroid_n": c.y, "length_m": pg.length, "area_m2": abs(pg.area), "vertices": len(g.ring)}


def _r(v: Any, nd: int = 3) -> Any:
    return round(v, nd) if isinstance(v, float) and math.isfinite(v) else v


def objects_json(ctx: ExportContext) -> dict[str, Any]:
    rows = []
    for o in ctx.design.objects:
        f = geometry_figures(o)
        rows.append({"id": o.id, "type": o.type, "status": o.status, "origin": o.origin, "accepted": o.accepted, "verified": o.verified, "verified_on": o.verified_on, "label": o.label,
                     "geometry": o.geometry.kind, **{k: _r(v) for k, v in f.items()}, "note": object_note(ctx, o),
                     "params": {k: {"value": NOT_SET if p.basis == "unresolved" else p.value, "basis": p.basis, "ref": p.ref} for k, p in sorted(o.params.items())},
                     "issues": [i.model_dump() for i in o.issues]})
    return {"schema": SCHEMA, "kind": "objects", "project_id": ctx.project_id, "title": ctx.title, "generated": ctx.date_text(), "coordinates": ctx.coordinate_text(),
            "terrain_status": ctx.terrain_status, "status": ctx.status_lines(), "count": len(rows), "objects": rows}


FORMULA_LEADERS = ("=", "+", "-", "@", "\t", "\r")


def safe_cell(v: Any) -> Any:
    """A spreadsheet runs a text cell that starts with = + - @ tab or carriage return as a formula (CSV injection, e.g. a label ``=HYPERLINK(...)``). Such a string gets a leading
    apostrophe, which a spreadsheet shows as text. Numbers and other non-strings are left as they are; None is an empty cell."""
    if v is None:
        return ""
    if isinstance(v, str) and v.startswith(FORMULA_LEADERS):
        return "'" + v
    return v


def _csv(header: list[str], rows: list[list[Any]]) -> bytes:
    s = io.StringIO(newline="")
    w = csv.writer(s, lineterminator="\r\n")
    w.writerow([safe_cell(h) for h in header])
    for r in rows:
        w.writerow([safe_cell(v) for v in r])
    return ("﻿" + s.getvalue()).encode("utf-8")           # a BOM so a spreadsheet opens it as UTF-8


def objects_csv(ctx: ExportContext) -> bytes:
    """One row per object parameter (an object with no parameters has one row with empty parameter columns)."""
    header = ["object_id", "type", "status", "origin", "accepted", "verified", "label", "geometry", "centroid_e_mga", "centroid_n_mga", "length_m", "area_m2", "parameter", "value", "basis", "ref",
              "object_note", "terrain_status"]
    rows: list[list[Any]] = []
    for o in ctx.design.objects:
        f = geometry_figures(o)
        base = [o.id, o.type, o.status, o.origin, o.accepted, "yes" if o.verified else "no", o.label, o.geometry.kind, _r(f["centroid_e"]), _r(f["centroid_n"]), _r(f["length_m"]), _r(f["area_m2"])]
        tail = [object_note(ctx, o), ctx.terrain_status]
        if not o.params:
            rows.append(base + [None, None, None, None] + tail)
        for k, p in sorted(o.params.items()):
            rows.append(base + [k, NOT_SET if p.basis == "unresolved" else p.value, p.basis, p.ref] + tail)
    return _csv(header, rows)


def checks_json(ctx: ExportContext, result: dict[str, Any] | None) -> dict[str, Any]:
    if result is None:
        return {"schema": SCHEMA, "kind": "checks", "project_id": ctx.project_id, "title": ctx.title, "generated": ctx.date_text(), "terrain_status": ctx.terrain_status, "status": ctx.status_lines(),
                "available": False, "message": f"{NOT_AVAILABLE}: THE CHECKS COULD NOT BE RUN", "checks": [], "summary": None}
    return {"schema": SCHEMA, "kind": "checks", "project_id": ctx.project_id, "title": ctx.title, "generated": ctx.date_text(), "terrain_status": ctx.terrain_status, "status": ctx.status_lines(),
            "available": True, "rules_for": result.get("rules_for"), "summary": result.get("summary"), "notes": result.get("notes") or [], "checks": result.get("checks") or []}


def checks_csv(ctx: ExportContext, result: dict[str, Any] | None) -> bytes:
    header = ["object_id", "object_type", "code", "title", "status", "severity", "message", "basis", "value", "limit", "unit", "requirements", "terrain_status"]
    rows = []
    for c in (result or {}).get("checks") or []:
        rq = c.get("requirements") or []
        rows.append([c.get("object_id"), c.get("object_type"), c.get("code"), c.get("title"), c.get("status"), c.get("severity"), c.get("message"), c.get("basis"), c.get("value"), c.get("limit"),
                     c.get("unit"), "; ".join(str(x.get("key", x)) if isinstance(x, dict) else str(x) for x in rq), ctx.terrain_status])
    if result is None:
        rows.append([None, None, "NO_CHECKS", NOT_AVAILABLE, "NOT EVALUATED", "warning", f"{NOT_AVAILABLE}: THE CHECKS COULD NOT BE RUN", None, None, None, None, None, ctx.terrain_status])
    return _csv(header, rows)


def _flat(prefix: str, v: Any, out: list[tuple[str, Any]], depth: int = 0) -> None:
    if depth > 4:
        out.append((prefix, json.dumps(v, separators=(",", ":"))[:300]))
    elif isinstance(v, dict):
        for k, x in v.items():
            if k in ("rows", "table", "grid", "cells", "raster"):
                continue
            _flat(f"{prefix}.{k}" if prefix else str(k), x, out, depth + 1)
    elif isinstance(v, list):
        if all(not isinstance(x, (dict, list)) for x in v):
            out.append((prefix, "; ".join(str(x) for x in v)))
        else:
            for i, x in enumerate(v[:60]):
                _flat(f"{prefix}[{i}]", x, out, depth + 1)
    else:
        out.append((prefix, v))


def stormwater_json(ctx: ExportContext, result: dict[str, Any] | None) -> dict[str, Any]:
    head = {"schema": SCHEMA, "kind": "stormwater", "project_id": ctx.project_id, "title": ctx.title, "generated": ctx.date_text(), "terrain_status": ctx.terrain_status, "status": ctx.status_lines()}
    if result is None:
        return {**head, "available": False, "message": f"{NOT_AVAILABLE}: THE STORMWATER ANALYSIS COULD NOT BE RUN", "summary": None}
    keep = {k: result.get(k) for k in ("terrain_status", "lot_area_m2", "rainfall", "peak_flows", "osd", "infiltration", "missing", "notes")}
    if isinstance(keep.get("osd"), dict):
        keep["osd"] = {k: v for k, v in keep["osd"].items() if k not in ("rows", "table", "series")}
    return {**head, "available": True, "indicative": "INDICATIVE ONLY, THE LGA AND THE RESPONSIBLE ENGINEER GOVERN", "summary": keep}


def stormwater_csv(ctx: ExportContext, result: dict[str, Any] | None) -> bytes:
    """The summary as rows of path and value (section, item, value) so a spreadsheet can filter it."""
    if result is None:
        return _csv(["item", "value", "terrain_status"], [["analysis", f"{NOT_AVAILABLE}: THE STORMWATER ANALYSIS COULD NOT BE RUN", ctx.terrain_status]])
    flat: list[tuple[str, Any]] = []
    _flat("", stormwater_json(ctx, result)["summary"], flat)
    rows = [[p, v, ctx.terrain_status] for p, v in flat if v not in (None, "", [])]
    rows.insert(0, ["status", "; ".join(ctx.status_lines()), ctx.terrain_status])
    return _csv(["item", "value", "terrain_status"], rows)


def to_json_bytes(d: dict[str, Any]) -> bytes:
    return json.dumps(d, indent=1, ensure_ascii=False, default=str).encode("utf-8")
