"""DAG unit tests (no database)."""
import pytest

from app.orchestrator import dag


def test_topological_order_respects_deps():
    order = dag.topological_order(dag.DAG)
    pos = {n: i for i, n in enumerate(order)}
    for n in dag.DAG.values():
        for p in n.deps + n.after:
            assert pos[p] < pos[n.node_id]
    assert order[0] == "SA1" and set(order[-2:]) == {"SA5", "SA6"}


def test_parallel_groups():
    groups = dag.parallel_groups(dag.DAG)
    assert groups == [["SA1"], ["SA7", "SA2"], ["ENV"], ["SA3"], ["SA4"], ["SA5", "SA6"]]


def test_plan_without_upload_drops_sa7():
    plan = dag.build_plan(with_plan_upload=False)
    assert "SA7" not in plan and all("SA7" not in n.after for n in plan.values())
    assert dag.parallel_groups(plan)[1] == ["SA2"]


def test_plan_targets_pull_in_ancestors():
    assert set(dag.build_plan(["SA7"])) == {"SA1", "SA7"}
    assert set(dag.build_plan(["ENV"])) == {"SA1", "SA2", "ENV"}
    with pytest.raises(dag.DagError):
        dag.build_plan(["SA7"], with_plan_upload=False)
    with pytest.raises(dag.DagError):
        dag.build_plan(["NOPE"])


def test_invalidation_downstream():
    assert dag.invalidated_nodes(["SA7"]) == {"SA7", "SA3", "SA4", "SA5", "SA6"}
    assert dag.invalidated_nodes(["SA2"]) == {"SA2", "ENV", "SA3", "SA4", "SA5", "SA6"}
    assert dag.invalidated_nodes(["SA5"]) == {"SA5"}
    assert dag.invalidated_nodes(["SA5"], include_changed=False) == set()
    assert dag.invalidated_nodes(["SA1"]) == set(dag.DAG)


def test_invalidation_from_hash_diff():
    old = {"SA1": "a", "SA2": "b", "ENV": "c"}
    new = {"SA1": "a", "SA2": "B", "ENV": "c"}
    assert dag.changed_inputs(old, new) == {"SA2"}
    assert dag.invalidated_by_hash_change(old, new) == {"SA2", "ENV", "SA3", "SA4", "SA5", "SA6"}
    assert dag.invalidated_by_hash_change(old, old) == set()


def test_edges_carry_schemas():
    e = dag.edges()
    assert ("ORCH", "SA1", "run_request.v1") in e
    assert ("SA1", "SA2", "lot_context.v1") in e
    assert ("SA3", "SA4", "earthworks_result.v1") in e


def test_cycle_detected():
    from dataclasses import replace
    bad = dict(dag.DAG)
    bad["SA1"] = replace(bad["SA1"], deps=("SA6",))
    with pytest.raises(dag.DagError):
        dag.topological_order(bad)
