"""Structural checks of the committed Gunnedah knowledge base (works without the git-ignored raw/ files)."""
import json
from datetime import timezone

import pytest

from app.agents.requirements.models import Requirement, RequirementSet, UnresolvedRequirement
from app.agents.requirements.resolver import NUM
from scripts import fetch_docs as fd

G = fd.KNOWLEDGE / "gunnedah"
MAN = {s["id"]: s for s in fd.load_manifest()["sources"]}


@pytest.fixture(scope="module")
def reqs():
    return [Requirement.model_validate(r) for r in json.loads((G / "requirements.json").read_text())["requirements"]]


def test_every_requirement_is_cited_to_a_manifest_document(reqs):
    assert len(reqs) > 50
    for r in reqs:
        s = r.source
        assert r.status == "resolved" and r.extraction_method == "llm" and r.confidence <= 0.85, r.key
        assert s and s.quote.strip() and s.page and s.section_ref and s.sha256 and s.source_url, r.key
        doc = next(d for d in MAN.values() if d["title"] == s.document_title)
        assert doc["sha256"] == s.sha256 and doc["url"] == s.source_url and doc["status"] == "obtained", r.key
        assert s.retrieved_at.tzinfo is not None and s.retrieved_at.astimezone(timezone.utc)


def test_numeric_values_appear_in_their_quotes(reqs):
    for r in reqs:
        if isinstance(r.value, bool) or not isinstance(r.value, float):
            continue
        nums = [float(n.replace(",", "")) for n in NUM.findall(r.source.quote)]
        assert any(abs(n - r.value) < 1e-9 or abs(n / 1000 - r.value) < 1e-9 for n in nums), (r.key, r.source.quote)


def test_resolver_lookups_for_the_three_test_runs(reqs):
    rs = RequirementSet(requirements=reqs)
    assert rs.get("setback.dwelling_house.front_m", zone="R2") == 6.5
    assert rs.get("setback.dwelling_house.side_m", zone="R2") == 0.9
    assert rs.get("outbuilding.max_cumulative_area_m2.lot_gt_900m2", zone="R2") == 100
    assert rs.get("setback.outbuilding.side_m", zone="RU1") == 10
    assert rs.get("secondary_dwelling.max_floor_area_m2") == 60
    assert rs.get("water.unserviced_min_tank_storage_l") == 60000
    with pytest.raises(UnresolvedRequirement):          # not in the documents: must not be defaulted
        rs.get("setback.outbuilding.side_m", zone="R2")
    with pytest.raises(UnresolvedRequirement):
        rs.get("building.max_height_m", zone="R2")


def test_unresolved_entries_say_where_we_looked():
    items = json.loads((G / "unresolved.json").read_text())
    assert items and all(i["key"] and i["reason"] and i["looked"] for i in items)
