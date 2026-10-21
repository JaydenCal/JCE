"""Server side store of building imports, and the check that a saved building is an import and not an invention.

``POST .../import-building`` saves every payload it returns under ``<project dir>/imports/<import_id>.json``. A building in a saved site
design carries that ``import_id`` (``building.import_id``). On every PUT of the site design each building is compared with its stored
import: the levels, rings, roof outline, exits, datum, north angle, notes and the read only source facts (source, source_file, roof area
and its basis) must be exactly what the import gave, seen through the building's placement (``frame.origin`` and ``frame.yaw_deg``):

    MGA point = frame.origin + R_clockwise(frame.yaw_deg) . local point

What may differ is the placement itself (``frame.origin``, ``frame.yaw_deg``, which moves every position with it), the label, status and
the user set parameters (``building_use``, ``ffl_rl``, ``height_m``, ``glb_name``). Nothing in this module invents a value.
"""
from __future__ import annotations

import json
import math
import os
import re
import uuid
from pathlib import Path
from typing import Any

from app.design.site_design import SiteDesign, SiteObject

IMPORTS_DIR = "imports"
_ID = re.compile(r"^[0-9a-f]{32}$")
MAX_STORED_IMPORTS = 200            # per project; the oldest imports that no saved building uses are removed first
TOL_M = 1e-3                        # positions are compared to a millimetre
#: facts of the source that a user cannot edit (the frontend refuses to edit them as well)
READ_ONLY_PARAMS = ("source", "source_file", "roof_area_basis", "roof_plan_area_m2")


class ImportMismatch(Exception):
    """A saved building does not match its stored import. ``code`` is BUILDING_NOT_FROM_IMPORT or BUILDING_IMPORT_MISMATCH."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code, self.message = code, message


def new_import_id() -> str:
    return uuid.uuid4().hex


def _dir(project_dir: Path) -> Path:
    return project_dir / IMPORTS_DIR


def save_import(project_dir: Path, payload: dict) -> str:
    """Store ``payload`` under a new import id (also written into it) and return the id."""
    d = _dir(project_dir)
    d.mkdir(parents=True, exist_ok=True)
    iid = new_import_id()
    stored = {**payload, "import_id": iid}
    tmp = d / f"{iid}.json.tmp"
    tmp.write_text(json.dumps(stored, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, d / f"{iid}.json")
    return iid


def load_import(project_dir: Path, import_id: str) -> dict | None:
    if not _ID.match(import_id or ""):                  # no path traversal: only 32 hex characters name a file
        return None
    f = _dir(project_dir) / f"{import_id}.json"
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def prune(project_dir: Path, keep: set[str], limit: int = MAX_STORED_IMPORTS) -> None:
    """Keep at most ``limit`` stored imports: remove the oldest ones that are not in ``keep`` (the imports a saved building uses)."""
    d = _dir(project_dir)
    try:
        files = sorted((f for f in d.glob("*.json") if _ID.match(f.stem)), key=lambda f: f.stat().st_mtime)
    except OSError:
        return
    excess = len(files) - limit
    for f in files:
        if excess <= 0:
            break
        if f.stem in keep:
            continue
        try:
            f.unlink()
            excess -= 1
        except OSError:
            pass


def used_import_ids(doc: SiteDesign) -> set[str]:
    return {o.building.import_id for o in doc.objects if o.building is not None and o.building.import_id}


def _rot(p: list[float], yaw_deg: float) -> tuple[float, float]:
    a = math.radians(yaw_deg)
    c, s = math.cos(a), math.sin(a)
    return p[0] * c + p[1] * s, -p[0] * s + p[1] * c           # clockwise seen from above (x east, y north)


def _close(a: list[float], b: tuple[float, float]) -> bool:
    return abs(a[0] - b[0]) <= TOL_M and abs(a[1] - b[1]) <= TOL_M


def _rings_match(placed: list[list[list[float]]], local: list[list[list[float]]], f) -> bool:
    return len(placed) == len(local) and all(len(r) == len(l) and all(_close(p, f(q)) for p, q in zip(r, l)) for r, l in zip(placed, local))


def _dump(p: Any) -> Any:
    return None if p is None else p.model_dump(mode="json", exclude_none=True)


def check_building(o: SiteObject, load) -> None:
    """Raise ImportMismatch unless the building of ``o`` is the stored import it names (see the module docstring). ``load(import_id)`` gives the stored payload."""
    b = o.building
    if b is None:
        return
    name = o.id
    if not b.import_id:
        raise ImportMismatch("BUILDING_NOT_FROM_IMPORT", f"BUILDING {name} HAS NO IMPORT. A building can only be placed from an import; import the file or footprint again.")
    stored = load(b.import_id)
    if stored is None:
        raise ImportMismatch("BUILDING_NOT_FROM_IMPORT", f"BUILDING {name} NAMES AN IMPORT THAT IS NOT STORED FOR THIS PROJECT. Import the file or footprint again.")
    sb = stored.get("building") or {}

    def bad(what: str) -> ImportMismatch:
        return ImportMismatch("BUILDING_IMPORT_MISMATCH", f"BUILDING {name} DOES NOT MATCH ITS IMPORT ({what}). Only its placement, use, floor level and height can differ.")

    yaw, org = float(b.frame.yaw_deg), b.frame.origin
    def f(q: list[float]) -> tuple[float, float]:
        x, y = _rot(q, yaw)
        return org[0] + x, org[1] + y

    sl = sb.get("levels") or []
    if len(b.levels) != len(sl) or b.datum_index != int(sb.get("datum_index", 0)):
        raise bad("levels")
    for lv, s in zip(b.levels, sl):
        if lv.name != s.get("name") or lv.elevation_m != s.get("elevation_m"):
            raise bad(f"level {lv.name}")
        if not _rings_match(lv.rings, s.get("rings") or [], f):
            raise bad(f"outline of level {lv.name}")
    if (b.roof_outline is None) != (sb.get("roof_outline") is None) or (b.roof_outline is not None and not _rings_match(b.roof_outline, sb["roof_outline"], f)):
        raise bad("roof outline")
    sx = sb.get("exits") or {}
    for key in ("sewer", "water", "downpipes"):
        got, want = getattr(b.exits, key), sx.get(key) or []
        if len(got) != len(want) or not all(_close(p, f(q)) for p, q in zip(got, want)):
            raise bad(f"{key} exits")
    if b.frame.north_deg != sb.get("north_deg"):
        raise bad("north angle")
    if list(b.notes) != list(sb.get("notes") or []):
        raise bad("notes")
    ring = getattr(o.geometry, "ring", None)
    if ring is None or not _rings_match([ring], [b.levels[b.datum_index].rings[0]], lambda q: (q[0], q[1])):
        raise bad("footprint polygon")
    sp = sb.get("params") or {}
    for k in READ_ONLY_PARAMS:
        if _dump(o.params.get(k)) != sp.get(k):
            raise bad(f"{k}")


def check_design(doc: SiteDesign, project_dir: Path) -> None:
    """Every building of ``doc`` against its stored import. Raises ImportMismatch for the first one that fails."""
    cache: dict[str, dict | None] = {}

    def load(iid: str) -> dict | None:
        if iid not in cache:
            cache[iid] = load_import(project_dir, iid)
        return cache[iid]

    for o in doc.objects:
        check_building(o, load)
