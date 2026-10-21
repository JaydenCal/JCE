"""The safety guard on an AI first design batch, server side (stage 10). The browser runs the same rules (``firstDesign.ts`` ``assertAiBatch``) before it applies a batch; the server
runs them before it returns one, so a batch that would be refused never leaves the server. The lists here and the lists in the browser are the same and a test compares them.

A batch may contain only ``add_object``, ``set_param`` and ``remove_param``. A new object is never a building, has the origin ``ai_proposal``, the status ``proposed`` and an id
that is free. Every parameter of a new object is either NOT SET (no value) or a DERIVED value of a pair in ``site_design.ENGINE_DERIVED_PARAMS`` whose ref starts with
``AI FIRST DESIGN``: text (a link or a role) or, for the two pairs in ``AI_NUMERIC_PARAMS`` only, a finite number. A ``set_param`` or ``remove_param`` on an existing object may only touch
a link key (``AI_LINK_KEYS``); on an object the batch added it may only touch a key of ``AI_NEW_SET_KEYS``, and a ``set_param`` is always a DERIVED text value.
"""
from __future__ import annotations

import math
from typing import Any

from . import engine_limits as EL
from .site_design import ENGINE_DERIVED_PARAMS, ENGINE_REF_PREFIX, SiteDesign

AI_BATCH_OPS = ("add_object", "set_param", "remove_param")
AI_LINK_KEYS = ("drains_to_id",)
AI_NUMERIC_PARAMS = frozenset({("driveway", "crossover_chainage_m"), ("service_node", "invert_rl")})
AI_NEW_SET_KEYS = tuple(sorted({k for _t, k in ENGINE_DERIVED_PARAMS} - {k for _t, k in AI_NUMERIC_PARAMS} - {"node_kind"}))


class BatchRefused(ValueError):
    pass


def _derived_ok(type_: str, key: str, p: Any, at: str, *, numeric_ok: bool) -> None:
    if not isinstance(p, dict):
        raise BatchRefused(f"{at}: THE PARAMETER {key.upper()} IS NOT AN OBJECT")
    if p.get("value") is None:
        if p.get("basis") != "unresolved":
            raise BatchRefused(f"{at}: {key.upper()} HAS NO VALUE BUT IS NOT NOT SET")
        return
    if p.get("basis") != "derived" or (type_, key) not in ENGINE_DERIVED_PARAMS:
        raise BatchRefused(f"{at}: {key.upper()} OF A {type_.upper()} MAY NOT CARRY A VALUE IN AN AI BATCH")
    ref = p.get("ref")
    if not isinstance(ref, str) or not ref.startswith(ENGINE_REF_PREFIX):
        raise BatchRefused(f"{at}: {key.upper()} MUST NAME THE ENGINE THAT DERIVED IT")
    v = p.get("value")
    if isinstance(v, bool):
        raise BatchRefused(f"{at}: {key.upper()} MAY NOT BE TRUE OR FALSE")
    if isinstance(v, (int, float)):
        if not (numeric_ok and (type_, key) in AI_NUMERIC_PARAMS and math.isfinite(v)):
            raise BatchRefused(f"{at}: THE AI MAY NOT SET THE NUMBER {key.upper()} ON A {type_.upper()}")
    elif not isinstance(v, str):
        raise BatchRefused(f"{at}: {key.upper()} MUST BE TEXT")


def assert_ai_batch(steps: list[dict[str, Any]], design: SiteDesign) -> None:
    """Raise ``BatchRefused`` (a ``ValueError``) with the reason when the batch is not an AI first design batch."""
    if not isinstance(steps, list) or len(steps) > EL.MAX_AI_BATCH_STEPS:
        raise BatchRefused(f"THE BATCH HAS MORE THAN {EL.MAX_AI_BATCH_STEPS} OPERATIONS")
    existing = {o.id for o in design.objects}
    added: dict[str, str] = {}
    for n, s in enumerate(steps):
        op = s.get("op") if isinstance(s, dict) else None
        at = f"OPERATION {n + 1} ({op})"
        if op not in AI_BATCH_OPS:
            raise BatchRefused(f"{at} IS NOT ALLOWED IN AN AI BATCH")
        a = s.get("args") or {}
        if op == "add_object":
            if a.get("type") == "building":
                raise BatchRefused(f"{at}: THE AI NEVER CREATES A BUILDING")
            if a.get("origin") != "ai_proposal":
                raise BatchRefused(f"{at}: AN AI OBJECT MUST HAVE THE ORIGIN AI PROPOSAL")
            if a.get("status") != "proposed":
                raise BatchRefused(f"{at}: AN AI OBJECT MUST HAVE THE STATUS PROPOSED")
            oid = a.get("id")
            if not isinstance(oid, str) or oid in existing or oid in added:
                raise BatchRefused(f"{at}: THE OBJECT ID IS MISSING OR ALREADY IN USE")
            for k, p in (a.get("params") or {}).items():
                _derived_ok(str(a.get("type")), str(k), p, at, numeric_ok=True)
            added[oid] = str(a.get("type"))
        else:
            oid, key = str(a.get("id", "")), str(a.get("key", ""))
            if oid in added:
                if key not in AI_NEW_SET_KEYS:
                    raise BatchRefused(f"{at}: THE AI MAY NOT CHANGE {key.upper()} OF A NEW OBJECT")
            elif oid in existing:
                if key not in AI_LINK_KEYS:
                    raise BatchRefused(f"{at}: THE AI MAY ONLY SET A LINK ON AN EXISTING OBJECT, NOT {key.upper()}")
            else:
                raise BatchRefused(f"{at}: THERE IS NO OBJECT {oid}")
            if op == "set_param":
                t = added.get(oid) or next(o.type for o in design.objects if o.id == oid)
                if a.get("value") is None:
                    raise BatchRefused(f"{at}: A SET PARAMETER NEEDS A VALUE")
                _derived_ok(t, key, {"value": a.get("value"), "basis": a.get("basis"), "ref": a.get("ref")}, at, numeric_ok=False)
