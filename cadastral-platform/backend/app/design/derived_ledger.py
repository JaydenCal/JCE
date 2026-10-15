"""The ledger of engine derived parameters (stage 11 closes the stage 10 loophole, and the review of stage 11 ties it to the inputs).

A parameter with the basis ``derived`` on a pair of ``site_design.ENGINE_DERIVED_PARAMS`` is a link or a position that the server side AI first design computed. Nobody typed it, so
nobody may save one: the browser refuses it in ``set_param`` and ``add_object`` unless the operation comes from a first design batch, and the SERVER does not take the browser on trust.

* The first design route computes from the SAVED design (read from storage; the design in the request must match it, see ``inputs_hash``), never from a design the client made up.
* ``record_batch`` writes one RECORD per first design batch the server returned to ``first_design_ledger.json``: the saved version it was computed from, a fingerprint of every object of that
  saved design (the inputs the engine read) and the derived values (object id, key, value).
* ``unbacked`` is called on PUT of the site design. An engine derived parameter that is not unchanged from the design already saved must be in a record whose version is not after the saved
  version AND whose inputs are all present in the design being saved, unchanged. So a design in which the services, the building or any other object the engine read were changed after the
  batch was computed (a fake depth of a main to get the engine to derive a level, then the real depth restored) cannot carry the derived values. It is refused with
  ``DERIVED_NOT_FROM_FIRST_DESIGN`` and the user runs the AI first design again.

The fingerprint of an object leaves out what a first design legitimately changes or the user legitimately decides afterwards: the engine derived parameters, the parameters the batch sets or
removes on that object, and the accepted state of a proposal. The ledger only grows (to ``MAX_RECORDS``, oldest dropped), so an accepted proposal can be saved again after a reload.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
from typing import Any, Iterable

from app.common.filestore import atomic_write_text, file_lock

from .site_design import DERIVED_PARAMS, ENGINE_DERIVED_PARAMS, ENGINE_REF_PREFIX, SiteDesign, SiteObject

LEDGER_FILE = "first_design_ledger.json"
SCHEMA = "first_design_ledger.v2"
MAX_RECORDS = 100
MAX_ENTRIES = 20000
CODE = "DERIVED_NOT_FROM_FIRST_DESIGN"


def _norm(v: Any) -> Any:
    return round(float(v), 9) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else v


def _key(object_id: str, key: str, value: Any) -> list[Any]:
    return [object_id, key, _norm(value)]


def _sha(x: Any) -> str:
    return hashlib.sha256(json.dumps(x, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")).hexdigest()[:32]


def object_fingerprint(o: SiteObject, ignore: Iterable[str] = ()) -> str:
    """A hash of what an object IS, without the engine derived parameters, the parameters named in ``ignore`` and the accepted state of a proposal."""
    d = o.model_dump(mode="json", by_alias=True, exclude_none=True)
    d.pop("accepted", None)
    skip = set(ignore)
    for k, p in o.params.items():
        if k in skip or (p.basis == "derived" and (o.type, k) in ENGINE_DERIVED_PARAMS):
            d["params"].pop(k, None)
    return _sha(d)


def inputs_hash(design: SiteDesign) -> str:
    """The hash of the server side inputs of a design: every object's fingerprint, whatever the order. The version, the time of saving and the engine derived values are not part of it."""
    return _sha(sorted([o.id, object_fingerprint(o)] for o in design.objects))


def touched(batch: list[dict[str, Any]]) -> dict[str, set[str]]:
    """The parameters a batch sets or removes on an object (by object id)."""
    out: dict[str, set[str]] = {}
    for s in batch or []:
        a = (s or {}).get("args") or {}
        if s.get("op") in ("set_param", "remove_param") and a.get("id") is not None and a.get("key") is not None:
            out.setdefault(str(a["id"]), set()).add(str(a["key"]))
    return out


def batch_entries(batch: list[dict[str, Any]]) -> list[list[Any]]:
    """The derived values written by the operations of a batch: (object id, key, value)."""
    out: list[list[Any]] = []
    for s in batch or []:
        a = (s or {}).get("args") or {}
        if s.get("op") == "add_object":
            for k, p in (a.get("params") or {}).items():
                if isinstance(p, dict) and p.get("basis") == "derived" and p.get("value") is not None:
                    out.append(_key(str(a.get("id")), str(k), p["value"]))
        elif s.get("op") == "set_param" and a.get("basis") == "derived" and a.get("value") is not None:
            out.append(_key(str(a.get("id")), str(a.get("key")), a["value"]))
    return out


def _read(folder: Path) -> list[dict[str, Any]]:
    try:
        raw = json.loads((folder / LEDGER_FILE).read_text(encoding="utf-8"))
        if raw.get("schema") != SCHEMA:
            return []
        return [r for r in raw.get("records", []) if isinstance(r, dict) and isinstance(r.get("version"), int) and isinstance(r.get("inputs"), dict) and isinstance(r.get("entries"), list)]
    except (OSError, ValueError, AttributeError):
        return []


def record_batch(folder: Path, design: SiteDesign, batch: list[dict[str, Any]]) -> int:
    """Remember a first design batch the server produced from ``design`` (the SAVED design): the version, the fingerprints of its objects and the derived values. Returns the number of
    derived values recorded."""
    new = batch_entries(batch)
    if not new:
        return 0
    tch = touched(batch)
    rec = {"version": design.version, "inputs": {o.id: [object_fingerprint(o, tch.get(o.id, ())), sorted(tch.get(o.id, ()))] for o in design.objects}, "entries": new}
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / LEDGER_FILE
    with file_lock(path):
        records = (_read(folder) + [rec])[-MAX_RECORDS:]
        while sum(len(r["entries"]) for r in records) > MAX_ENTRIES and len(records) > 1:
            records.pop(0)
        atomic_write_text(path, json.dumps({"schema": SCHEMA, "records": records}, separators=(",", ":")))
    return len(new)


def engine_derived(design: SiteDesign) -> list[tuple[str, str, Any, str]]:
    """The engine derived parameters of a design: (object id, key, value, ref). A pair that a requirement can also derive (a sewer invert) is engine derived only when its ref says so."""
    out = []
    for o in design.objects:
        for k, p in o.params.items():
            if p.basis != "derived" or p.value is None or (o.type, k) not in ENGINE_DERIVED_PARAMS:
                continue
            if (o.type, k) in DERIVED_PARAMS and not str(p.ref or "").startswith(ENGINE_REF_PREFIX):
                continue
            out.append((o.id, k, p.value, str(p.ref or "")))
    return out


def unbacked(design: SiteDesign, folder: Path, current: SiteDesign | None = None) -> list[str]:
    """Descriptions of the engine derived parameters that no first design result backs. Empty when the design may be saved.

    A parameter is backed when it is unchanged from the design already saved (``current``), or when a record holds its (object id, key, value), was computed from a saved version that is
    not after ``current``'s, and every object that record read is in ``design`` unchanged."""
    mine = engine_derived(design)
    if not mine:
        return []
    saved = {json.dumps(_key(i, k, v)) for i, k, v, _r in engine_derived(current)} if current is not None else set()
    need = [(i, k, v) for i, k, v, _r in mine if json.dumps(_key(i, k, v)) not in saved]
    if not need:
        return []
    wanted = {json.dumps(_key(i, k, v)) for i, k, v in need}
    by_id = {o.id: o for o in design.objects}
    memo: dict[tuple[str, tuple[str, ...]], str] = {}

    def fp(oid: str, ign: list[str]) -> str | None:
        o = by_id.get(oid)
        if o is None:
            return None
        k = (oid, tuple(ign))
        if k not in memo:
            memo[k] = object_fingerprint(o, ign)
        return memo[k]

    backed: set[str] = set()
    for r in reversed(_read(folder)):
        hits = {json.dumps(e) for e in r["entries"]} & wanted
        if not hits or hits <= backed:
            continue
        if current is not None and r["version"] > current.version:
            continue
        if all(isinstance(v, list) and len(v) == 2 and fp(oid, [str(x) for x in v[1]]) == v[0] for oid, v in r["inputs"].items()):
            backed |= hits
    return [f"{i}.{k}" for i, k, v in need if json.dumps(_key(i, k, v)) not in backed]
