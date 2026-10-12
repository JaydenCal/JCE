"""Trigger engine: rules are DATA (rules_nsw_qld.json). Values come from a resolver or stay to_be_confirmed."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Callable, Optional

from pydantic import BaseModel

from app.agents.sa9_constraints.intersect import LayerResult

RULES_PATH = Path(__file__).with_name("rules_nsw_qld.json")
# resolver(rule_id, item, layer_key, attributes) -> {'value':..., 'citation':...} | None
Resolver = Callable[[str, str, str, list], Optional[dict]]


class Consequence(BaseModel):
    item: str
    status: str = "to_be_confirmed"        # resolved | to_be_confirmed
    value: str | None = None
    citation: str | None = None
    instruction: str | None = None


class TriggerResult(BaseModel):
    rule_id: str
    layer_key: str
    layer_label: str
    title: str
    attributes: list[dict] = []
    consequences: list[Consequence]
    next_steps: list[str]
    development_pathway_hint: str
    source: str
    unresolved: bool


def load_rules(path: Path = RULES_PATH) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def find_rule(rules: dict, layer_key: str, development_type: str | None = None) -> dict:
    generic = None
    for r in rules["rules"]:
        dts = r.get("development_types")
        if dts is not None and development_type not in dts:
            continue
        if layer_key in r["layers"]:
            return r
        if "*" in r["layers"]:
            generic = r
    return generic


def evaluate(results: list[LayerResult], jurisdiction: str, resolver: Resolver | None = None,
             rules: dict | None = None, development_type: str | None = None) -> list[TriggerResult]:
    rules = rules or load_rules()
    instr = rules["instruction"][jurisdiction]
    out = []
    for lr in results:
        if lr.status != "affected":
            continue
        out.append(_trigger(find_rule(rules, lr.key, development_type), lr.key, lr.label, lr.attributes, instr, resolver))
    for r in rules["rules"]:        # rules driven by the development type alone (no mapped layer)
        if not r["layers"] and development_type in (r.get("development_types") or []):
            out.append(_trigger(r, "development_type", development_type, [], instr, resolver))
    return out


def _trigger(r: dict, layer_key: str, label: str, attrs: list, instr: str, resolver: Resolver | None) -> TriggerResult:
    cons = []
    for item in r["consequences"]:
        res = resolver(r["id"], item, layer_key, attrs) if resolver else None
        if res and res.get("citation") and res.get("value") is not None:
            cons.append(Consequence(item=item, status="resolved", value=str(res["value"]), citation=res["citation"]))
        else:  # decision 8: no citation, no value
            cons.append(Consequence(item=item, instruction=instr))
    return TriggerResult(rule_id=r["id"], layer_key=layer_key, layer_label=label, title=r["title"], attributes=attrs,
                         consequences=cons,
                         next_steps=r["next_steps"] + ([instr] if not cons or any(c.status != "resolved" for c in cons) else []),
                         development_pathway_hint=r["development_pathway_hint"], source=r["source"],
                         unresolved=any(c.status != "resolved" for c in cons) or not cons)
