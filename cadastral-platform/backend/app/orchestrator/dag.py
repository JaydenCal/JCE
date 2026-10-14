"""The run DAG (docs/01-orchestration-topology.md section 4).

Pure data and graph algorithms: no database, no agents. A *node* is one orchestrated
step; several nodes can share an agent (ENV, the envelope builder, runs inside SA3).

Edge semantics
  deps   required: the node cannot run unless every dep succeeded.
  after  ordering only, and only when that node is in the plan (SA7 is optional because a
         run may have no uploaded architectural plan). ``tolerate_after_failure`` says
         whether the node may still run if an ``after`` node failed (SA3 and SA4 can work
         without a plan footprint; the exports must not silently drop the user's plan).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Mapping

from app.common.contracts import AgentCode


@dataclass(frozen=True)
class NodeSpec:
    node_id: str
    agent: AgentCode
    input_schema: str
    output_schema: str
    stage: str
    deps: tuple[str, ...] = ()
    after: tuple[str, ...] = ()
    tolerate_after_failure: bool = False
    export_gate: bool = False
    llm: bool = False
    description: str = ""

    @property
    def all_parents(self) -> tuple[str, ...]:
        return self.deps + self.after


RUN_REQUEST_SCHEMA = "run_request.v1"

_NODE_LIST: tuple[NodeSpec, ...] = (
    NodeSpec("SA1", AgentCode.SA1_CADASTRE, "run_request.v1", "lot_context.v1", "A",
             description="Lot, boundary segments, roads, easements, zones, overlays"),
    NodeSpec("SA7", AgentCode.SA7_PDF_ALIGN, "plan_upload.v1", "plan_overlay.v1", "A",
             deps=("SA1",), llm=True,
             description="Architectural PDF ingest and spatial alignment"),
    NodeSpec("SA2", AgentCode.SA2_DCP_RAG, "dcp_query.v1", "setback_ruleset.v1", "B",
             deps=("SA1",), llm=True, description="DCP RAG: setback rules with citations"),
    NodeSpec("ENV", AgentCode.SA3_GEOM_TIN, "envelope_request.v1", "building_envelope.v1", "C",
             deps=("SA1", "SA2"), description="Envelope builder (inside SA3)"),
    NodeSpec("SA3", AgentCode.SA3_GEOM_TIN, "terrain_request.v1", "earthworks_result.v1", "D",
             deps=("ENV",), after=("SA7",), tolerate_after_failure=True,
             description="TIN, cut/fill, walls, crossover"),
    NodeSpec("SA4", AgentCode.SA4_HYDRO, "services_request.v1", "services_result.v1", "E",
             deps=("SA1", "SA3"), after=("SA7",), tolerate_after_failure=True,
             description="DBYD parse, conflicts, RWT (single node; DBYD parsing is internal)"),
    NodeSpec("SA5", AgentCode.SA5_CAD_DXF, "cad_request.v1", "cad_result.v1", "F",
             deps=("SA1", "SA3", "SA4"), after=("SA7",), export_gate=True,
             description="DXF/PDF export (export ack gate)"),
    NodeSpec("SA6", AgentCode.SA6_SITE3D, "scene_request.v1", "scene_bundle.v1", "F",
             deps=("SA3", "SA4"), after=("SA7",), export_gate=True,
             description="3D scene bundle (export ack gate)"),
)

DAG: Mapping[str, NodeSpec] = {n.node_id: n for n in _NODE_LIST}


class DagError(ValueError):
    pass


def validate_dag(nodes: Mapping[str, NodeSpec] = DAG) -> None:
    """Raise DagError on unknown parents or cycles."""
    for n in nodes.values():
        for p in n.deps:
            if p not in nodes:
                raise DagError(f"{n.node_id}: required dep {p!r} is not in the graph")
    topological_order(nodes)


def subgraph(ids: Iterable[str], nodes: Mapping[str, NodeSpec] = DAG) -> dict[str, NodeSpec]:
    """Restrict to ``ids``. ``after`` parents outside the set are dropped; missing required
    deps are an error."""
    keep = set(ids)
    out: dict[str, NodeSpec] = {}
    for nid in keep:
        n = nodes[nid]
        missing = [d for d in n.deps if d not in keep]
        if missing:
            raise DagError(f"{nid} requires {missing}, which are not in the plan")
        out[nid] = NodeSpec(**{**n.__dict__, "after": tuple(a for a in n.after if a in keep)})
    return out


def ancestors(node_id: str, nodes: Mapping[str, NodeSpec] = DAG, *, include_after: bool = False) -> set[str]:
    seen: set[str] = set()
    stack = [node_id]
    while stack:
        n = nodes[stack.pop()]
        parents = n.all_parents if include_after else n.deps
        for p in parents:
            if p in nodes and p not in seen:
                seen.add(p)
                stack.append(p)
    return seen


def descendants(node_id: str, nodes: Mapping[str, NodeSpec] = DAG) -> set[str]:
    """Every node reachable downstream via ``deps`` or ``after`` edges."""
    children: dict[str, set[str]] = {k: set() for k in nodes}
    for n in nodes.values():
        for p in n.all_parents:
            if p in children:
                children[p].add(n.node_id)
    seen: set[str] = set()
    stack = [node_id]
    while stack:
        for c in children[stack.pop()]:
            if c not in seen:
                seen.add(c)
                stack.append(c)
    return seen


def build_plan(
    targets: Iterable[str] | None = None,
    *,
    with_plan_upload: bool = True,
    nodes: Mapping[str, NodeSpec] = DAG,
) -> dict[str, NodeSpec]:
    """Choose the nodes of a run.

    ``targets`` (default: everything) are expanded to their required ancestors.
    ``with_plan_upload=False`` drops SA7 (no PDF uploaded) from the plan.
    """
    if targets is None:
        ids = set(nodes)
    else:
        ids = set()
        for t in targets:
            if t not in nodes:
                raise DagError(f"unknown target node {t!r}")
            ids |= {t} | ancestors(t, nodes)
    if not with_plan_upload:
        if targets is not None and "SA7" in set(targets):
            raise DagError("SA7 requested but no plan upload supplied")
        ids.discard("SA7")
    return subgraph(ids, nodes)


def topological_order(nodes: Mapping[str, NodeSpec] = DAG) -> list[str]:
    """Deterministic Kahn ordering (ties broken by stage letter, then id)."""
    indeg = {k: 0 for k in nodes}
    children: dict[str, list[str]] = {k: [] for k in nodes}
    for n in nodes.values():
        for p in n.all_parents:
            if p in nodes:
                indeg[n.node_id] += 1
                children[p].append(n.node_id)
    key = lambda k: (nodes[k].stage, k)  # noqa: E731
    ready = sorted((k for k, d in indeg.items() if d == 0), key=key)
    order: list[str] = []
    while ready:
        k = ready.pop(0)
        order.append(k)
        for c in children[k]:
            indeg[c] -= 1
            if indeg[c] == 0:
                ready.append(c)
        ready.sort(key=key)
    if len(order) != len(nodes):
        raise DagError("cycle detected in DAG")
    return order


def parallel_groups(nodes: Mapping[str, NodeSpec] = DAG) -> list[list[str]]:
    """Level sets: every node in a group has all parents in earlier groups, so a group can
    run fully in parallel."""
    level: dict[str, int] = {}
    for k in topological_order(nodes):
        parents = [p for p in nodes[k].all_parents if p in nodes]
        level[k] = 1 + max((level[p] for p in parents), default=-1)
    groups: dict[int, list[str]] = {}
    for k, lv in level.items():
        groups.setdefault(lv, []).append(k)
    return [sorted(groups[i], key=lambda k: (nodes[k].stage, k)) for i in sorted(groups)]


def edges(nodes: Mapping[str, NodeSpec] = DAG) -> list[tuple[str, str, str]]:
    """(source, destination, payload schema carried) for every data edge. ``ORCH`` is the
    source of the initial run request."""
    out: list[tuple[str, str, str]] = []
    for k in topological_order(nodes):
        n = nodes[k]
        if not n.deps:
            out.append(("ORCH", k, RUN_REQUEST_SCHEMA))
        for p in n.deps + n.after:
            if p in nodes:
                out.append((p, k, nodes[p].output_schema))
    return out


def invalidated_nodes(
    changed: Iterable[str],
    nodes: Mapping[str, NodeSpec] = DAG,
    *,
    include_changed: bool = True,
) -> set[str]:
    """Nodes whose cached results can no longer be trusted when the input payload of each
    node in ``changed`` has changed: the node itself plus everything downstream."""
    out: set[str] = set()
    for c in changed:
        if c not in nodes:
            raise DagError(f"unknown node {c!r}")
        if include_changed:
            out.add(c)
        out |= descendants(c, nodes)
    return out


def changed_inputs(old_hashes: Mapping[str, str], new_hashes: Mapping[str, str]) -> set[str]:
    """Nodes whose input payload sha256 differs between two runs (or is new/removed)."""
    return {k for k in old_hashes.keys() | new_hashes.keys() if old_hashes.get(k) != new_hashes.get(k)}


def invalidated_by_hash_change(
    old_hashes: Mapping[str, str],
    new_hashes: Mapping[str, str],
    nodes: Mapping[str, NodeSpec] = DAG,
) -> set[str]:
    """Convenience: diff two {node: input_sha256} maps and return the invalidated set.

    The idempotency cache applies the same rule implicitly (a changed upstream output
    changes the downstream input hash). Early cutoff is automatic: if a recomputed
    upstream output is byte-identical, downstream inputs are unchanged and stay cached.
    """
    return invalidated_nodes((k for k in changed_inputs(old_hashes, new_hashes) if k in nodes), nodes)


def plan_to_json(nodes: Mapping[str, NodeSpec]) -> list[dict]:
    return [
        {
            "node": k,
            "agent": nodes[k].agent.value,
            "stage": nodes[k].stage,
            "deps": list(nodes[k].deps),
            "after": list(nodes[k].after),
            "input_schema": nodes[k].input_schema,
            "output_schema": nodes[k].output_schema,
            "export_gate": nodes[k].export_gate,
            "llm": nodes[k].llm,
        }
        for k in topological_order(nodes)
    ]


validate_dag()
