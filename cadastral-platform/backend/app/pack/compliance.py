"""Compliance table for the chosen pathway.

Columns: control | requirement (+ citation: document, page, exact quote) | proposed value | status | variation note.
PASS/FAIL come only from a numeric comparison of a cited requirement value with a typed proposed value; booleans,
text-only requirements and missing data give UNRESOLVED (never an auto-pass).  Requirement values come from the
Requirement models (RequirementSet) or the SA11 rule set; the proposed values come from typed inputs (SA3/SA6/SA8 results,
SA9 constraints, flood check) supplied in `ProposalFacts`.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.agents.requirements.models import Requirement, RequirementSet, Selectors, Source, UnresolvedRequirement
from app.agents.sa11_pathway.models import PathwayResult, Status

BACKEND = Path(__file__).resolve().parents[2]
GUNNEDAH = BACKEND / "knowledge" / "gunnedah"
VARIATION_TBC = "TO BE COMPLETED: variation justification by the designer"


class M(BaseModel):
    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)


class ProposalFacts(M):
    """Typed proposed values. None = not supplied (=> UNRESOLVED). `provenance` names the producing step (SA3/SA6/SA8/user)."""
    dev_type: Literal["dwelling_house", "secondary_dwelling", "shed"]
    zone: str | None = None
    lga: str | None = None
    lot_area_m2: float | None = None
    lot_width_m: float | None = None
    storeys: float | None = None
    building_height_m: float | None = None
    gfa_m2: float | None = None
    floor_area_m2: float | None = None              # this building (secondary dwelling or shed)
    principal_floor_area_m2: float | None = None
    outbuilding_cumulative_area_m2: float | None = None
    footprint_m2: float | None = None
    setbacks_m: dict[str, float] = Field(default_factory=dict)       # front, side, rear, secondary (achieved, from layout)
    neighbour_avg_front_m: float | None = None
    primary_road_sealed: bool | None = None
    site_cover_pct: float | None = None
    parking_spaces: float | None = None
    crossover_width_m: float | None = None
    crossover_corner_separation_m: float | None = None
    driveway_max_grade_pct: float | None = None
    stormwater_strategy: str | None = None
    osd_provided: bool | None = None
    landscaped_area_m2: float | None = None
    private_open_space_m2: float | None = None
    private_open_space_depth_m: float | None = None
    floor_level_rl: float | None = None
    flood: Any = None                               # app.flood.levels.FloodCheck | None
    flood_affected: bool | None = None
    bushfire_prone: bool | None = None
    bal: str | None = None
    basix_certificate_ref: str | None = None
    farm_building: bool | None = None
    constraints: dict | None = None                 # SA9 constraints_report.json (for the LEP FSR map layer)
    provenance: dict[str, str] = Field(default_factory=dict)


class ComplianceRow(M):
    control: str
    category: str
    requirement_text: str = ""
    requirement_key: str | None = None
    citation: Source | None = None
    required_value: float | None = None
    unit: str | None = None
    proposed_value: Any = None
    proposed_source: str | None = None
    status: Status
    variation_note: str = ""
    prompt: str | None = None

    def cite(self) -> str:
        return self.citation.cite() if self.citation else ""


class ComplianceTable(M):
    pathway: Literal["da", "cdc", "exempt"]
    dev_type: str
    zone: str | None
    lga: str | None
    rows: list[ComplianceRow]
    notes: list[str] = Field(default_factory=list)

    def counts(self) -> dict[str, int]:
        out = {s.value: 0 for s in Status}
        for r in self.rows:
            out[r.status.value] += 1
        return out

    def row(self, control: str) -> ComplianceRow:
        return next(r for r in self.rows if r.control == control)


def load_requirements(path: str | Path | None = None) -> RequirementSet:
    d = json.loads(Path(path or GUNNEDAH / "requirements.json").read_text())
    return RequirementSet(requirements=[Requirement(**r) for r in d["requirements"]])


_UNRES: list[dict] | None = None


def _unresolved_reason(hint: str) -> str | None:
    global _UNRES
    if _UNRES is None:
        _UNRES = json.loads((GUNNEDAH / "unresolved.json").read_text())
        _UNRES = _UNRES if isinstance(_UNRES, list) else _UNRES.get("unresolved", [])
    for u in _UNRES:
        if hint in u.get("key", ""):
            return u["reason"]
    return None


def _cmp(kind: str, proposed: float | None, req: float) -> Status | None:
    if proposed is None:
        return None
    if kind == "min":
        return Status.PASS if proposed >= req - 1e-9 else Status.FAIL
    if kind == "max":
        return Status.PASS if proposed <= req + 1e-9 else Status.FAIL
    raise ValueError(kind)


class _Builder:
    def __init__(self, facts: ProposalFacts, reqs: RequirementSet) -> None:
        self.f, self.reqs, self.rows = facts, reqs, []
        self.sel = {k: v for k, v in dict(zone=facts.zone, lga=facts.lga).items() if v}
        self.dt = {"dwelling_house": "dwelling_house", "secondary_dwelling": "secondary_dwelling", "shed": "outbuilding"}[facts.dev_type]

    def add(self, **kw: Any) -> ComplianceRow:
        r = ComplianceRow(**kw); self.rows.append(r); return r

    def req(self, key: str) -> Requirement | UnresolvedRequirement:
        try:
            return self.reqs.get_requirement(key, **self.sel)
        except UnresolvedRequirement as e:
            return e

    def numeric(self, control: str, category: str, key: str, kind: str, proposed: float | None, unit: str, *, hint: str | None = None,
                psrc: str | None = None, req_override: float | None = None, extra_note: str = "") -> ComplianceRow:
        r = self.req(key)
        src = psrc or self.f.provenance.get(control)
        if isinstance(r, UnresolvedRequirement):
            why = (_unresolved_reason(hint) if hint else None) or r.prompt
            return self.add(control=control, category=category, requirement_key=key, requirement_text="not found in the obtained documents",
                            unit=unit, proposed_value=proposed, proposed_source=src, status=Status.UNRESOLVED, prompt=why,
                            variation_note="")
        val = float(r.value) if req_override is None else req_override
        st = _cmp(kind, proposed, val)
        txt = f"{'at least' if kind == 'min' else 'at most'} {val:g} {unit}".strip() + (f" ({extra_note})" if extra_note else "")
        if r.source and r.source.quote:
            pass
        row = self.add(control=control, category=category, requirement_key=key, requirement_text=txt, citation=r.source, required_value=val, unit=unit,
                       proposed_value=proposed, proposed_source=src, status=st or Status.UNRESOLVED,
                       prompt=None if st else f"Supply the proposed value ({control}) from the layout/design.",
                       variation_note=VARIATION_TBC if st == Status.FAIL else "")
        return row

    def boolean(self, control: str, category: str, key: str, proposed: Any, *, text: str, prompt: str) -> ComplianceRow:
        """Boolean / text requirement: never auto-pass (no numeric comparison) -> UNRESOLVED until a person confirms."""
        r = self.req(key)
        if isinstance(r, UnresolvedRequirement):
            return self.add(control=control, category=category, requirement_key=key, requirement_text="not found", proposed_value=proposed,
                            status=Status.UNRESOLVED, prompt=r.prompt)
        return self.add(control=control, category=category, requirement_key=key, requirement_text=text or str(r.value), citation=r.source,
                        proposed_value=proposed, status=Status.UNRESOLVED, prompt=prompt)

    def unresolved(self, control: str, category: str, why: str, proposed: Any = None, text: str = "no citable control obtained") -> ComplianceRow:
        return self.add(control=control, category=category, requirement_text=text, proposed_value=proposed, status=Status.UNRESOLVED, prompt=why)


def _fsr_requirement(constraints: dict | None) -> tuple[float | None, Source | None, str | None]:
    if not constraints:
        return None, None, "SA9 constraints report not supplied"
    l = next((x for x in constraints.get("layers", []) if x["key"] == "nsw_fsr_map"), None)
    if not l or l["status"] != "affected":
        return None, None, "No floor space ratio is mapped for the lot in the LEP FSR map layer (or the layer was not checked); the LEP text was not obtained."
    vals = {x.get("FSR") for x in l["attributes"] if x.get("FSR") is not None}
    if len(vals) != 1:
        return None, None, f"FSR map returned several values {sorted(vals)}: confirm which applies."
    attrs = [x for x in l["attributes"]]
    src = Source(document_title="LEP Floor Space Ratio Map (NSW ePlanning EPI_Primary_Planning_Layers, via SA9)", authority=attrs[0].get("EPI_NAME", "NSW Planning"),
                 page=1, section_ref="FSR map layer", quote=json.dumps(attrs[0], sort_keys=True), sha256=l.get("snapshot_sha256", ""),
                 source_url=None, version=l.get("data_currency"))
    return float(next(iter(vals))), src, None


def build_compliance_table(facts: ProposalFacts, pathway: Literal["da", "cdc", "exempt"] = "da", *, requirements: RequirementSet | None = None,
                           pathway_result: PathwayResult | None = None) -> ComplianceTable:
    reqs = requirements or load_requirements()
    b = _Builder(facts, reqs)
    f = facts
    notes: list[str] = []
    if pathway == "da":
        _da_rows(b, f)
        notes.append("Controls are from the council DCP / engineering standards held in the Requirements knowledge base (Gunnedah). LEP development standards were not obtained.")
    else:
        if pathway_result is None:
            notes.append("No SA11 pathway result supplied: code standards not evaluated.")
        else:
            card = pathway_result.card(pathway)
            for c in card.criteria:
                if c.category == "standard" or (c.category == "applicability" and c.required_value is not None):
                    b.add(control=c.label, category="code standard", requirement_key=c.rule_id, requirement_text=c.required_text or "", citation=c.citation,
                          required_value=c.required_value, unit=c.unit, proposed_value=c.proposed_value, proposed_source=f.provenance.get(c.field or ""),
                          status=c.status, prompt=c.prompt, variation_note=(VARIATION_TBC if c.status == Status.FAIL else ""))
            notes.append("Standards are from the Department of Planning summary tables cited on each row (dated 2018 for the Inland/Housing Codes); a certifier assesses against the Codes SEPP itself.")
        _common_rows(b, f, with_basix=True)
    return ComplianceTable(pathway=pathway, dev_type=f.dev_type, zone=f.zone, lga=f.lga, rows=b.rows, notes=notes)


def _common_rows(b: _Builder, f: ProposalFacts, with_basix: bool) -> None:
    # flood
    fc = f.flood
    if fc is not None:
        st = Status(fc.result) if fc.result in ("PASS", "FAIL") else Status.UNRESOLVED
        r = b.req("flood.habitable_floor_at_or_above_fpl")
        b.add(control="Flood: habitable floor level", category="flood", requirement_key="flood.habitable_floor_at_or_above_fpl",
              requirement_text=(f"floor at or above the flood planning level = {fc.event or '1% AEP'} level + freeboard"
                                + (f" ({fc.freeboard_m:g} m)" if fc.freeboard_m is not None else "") + (f"; minimum {fc.min_ffl:g} m AHD" if fc.min_ffl is not None else "")),
              citation=None if isinstance(r, UnresolvedRequirement) else r.source, required_value=fc.min_ffl, unit="m AHD", proposed_value=fc.proposed_ffl,
              proposed_source="flood check", status=st, prompt=fc.prompt, variation_note=VARIATION_TBC if st == Status.FAIL else "")
    elif f.flood_affected is False:
        b.add(control="Flood: habitable floor level", category="flood", requirement_text="not applicable: SA9 flood layer reports the lot not affected (map layer only)",
              status=Status.NOT_APPLICABLE, proposed_source="SA9 nsw_flood")
    else:
        b.boolean("Flood: habitable floor level", "flood", "flood.habitable_floor_at_or_above_fpl", None, text="floor at or above the flood planning level (1% AEP + 0.5 m freeboard)",
                  prompt="Flood level and proposed floor level required: supply a council flood level and design floor RL.")
    # bushfire
    if f.bushfire_prone is False:
        b.add(control="Bushfire", category="bushfire", requirement_text="not applicable: SA9 reports the lot is not mapped bushfire prone", status=Status.NOT_APPLICABLE, proposed_source="SA9 nsw_bushfire")
    else:
        b.add(control="Bushfire", category="bushfire", requirement_text="BAL assessment (AS 3959) and Planning for Bush Fire Protection: documents not obtained, no citable numeric requirement",
              proposed_value=f.bal if f.bal else ("bushfire prone land (vegetation category / buffer)" if f.bushfire_prone else None), status=Status.UNRESOLVED,
              prompt="Commission a BAL assessment by an accredited practitioner and obtain the s10.7 certificate; confirm whether a bush fire safety authority / RFS referral is needed.")
    if with_basix:
        _basix(b, f)


def _basix(b: _Builder, f: ProposalFacts) -> None:
    if f.dev_type == "shed":
        r = b.req("basix.renovation_threshold_aud")
        b.add(control="BASIX", category="sustainability", requirement_key="basix.renovation_threshold_aud", requirement_text="BASIX applies to dwellings/alterations of $50,000 or more and pools of 40,000 L or more; a shed is outside these",
              citation=None if isinstance(r, UnresolvedRequirement) else r.source, status=Status.NOT_APPLICABLE, variation_note="Confirm with the council.")
        return
    r = b.req("basix.certificate_required_new_dwelling")
    b.add(control="BASIX certificate", category="sustainability", requirement_key="basix.certificate_required_new_dwelling", requirement_text="BASIX certificate required for a new dwelling",
          citation=None if isinstance(r, UnresolvedRequirement) else r.source, proposed_value=f.basix_certificate_ref or "TO BE OBTAINED", status=Status.UNRESOLVED,
          prompt=("Certificate reference supplied; content not verified by this tool: confirm with the BASIX assessor." if f.basix_certificate_ref else
                  "Obtain a BASIX certificate (basix.nsw.gov.au) and supply its number."))


def _da_rows(b: _Builder, f: ProposalFacts) -> None:
    dt, zone = b.dt, (f.zone or "")
    sb = f.setbacks_m
    # setbacks
    front_key = f"setback.{dt}.front_m"
    if f.primary_road_sealed is False and not isinstance(b.req(front_key + ".unsealed_road"), UnresolvedRequirement):
        front_key += ".unsealed_road"
    r = b.req(front_key)
    override = None
    if not isinstance(r, UnresolvedRequirement) and zone.upper() == "R2" and f.dev_type != "shed" and f.neighbour_avg_front_m is not None:
        override = min(float(r.value), f.neighbour_avg_front_m)
    fr = b.numeric("Setback: front (primary frontage)", "setbacks", front_key, "min", sb.get("front"), "m", psrc="layout (SA8)",
              req_override=override, extra_note=("or the average of the adjoining dwellings if less; average supplied" if override is not None else
                                                 "R2 dwellings: or the average of the adjoining dwellings whichever is less" if zone.upper() == "R2" and f.dev_type != "shed" else ""))
    if fr.status == Status.FAIL and zone.upper() == "R2" and f.dev_type != "shed" and override is None:
        fr.status, fr.variation_note = Status.UNRESOLVED, ""
        fr.prompt = "Proposed front setback is below 6.5 m: the control allows the average of the adjoining dwellings if less; supply neighbour_avg_front_m."
    if f.dev_type == "shed" and zone.upper() == "R2":
        b.numeric("Setback: side", "setbacks", "setback.outbuilding.side_m", "min", sb.get("side"), "m", hint="setback.outbuilding.side_m", psrc="layout (SA8)")
        b.numeric("Setback: rear", "setbacks", "setback.outbuilding.rear_m", "min", sb.get("rear"), "m", hint="setback.outbuilding.side_m", psrc="layout (SA8)")
    else:
        b.numeric("Setback: side", "setbacks", f"setback.{dt}.side_m", "min", sb.get("side"), "m", psrc="layout (SA8)",
                  extra_note="0.9 m or compliance with the BCA" if zone.upper() == "R2" else "")
        b.numeric("Setback: rear", "setbacks", f"setback.{dt}.rear_m", "min", sb.get("rear"), "m", psrc="layout (SA8)")
    if "secondary" in sb:
        b.numeric("Setback: secondary frontage", "setbacks", f"setback.{dt}.secondary_frontage_m", "min", sb.get("secondary"), "m", psrc="layout (SA8)")
    # height
    if f.dev_type == "shed":
        key = "outbuilding.max_height_m.lot_gt_900m2" if (zone.upper() == "R2" and (f.lot_area_m2 or 0) > 900) else "outbuilding.max_height_m"
        if zone.upper() == "R2":
            b.numeric("Building height", "height", key, "max", f.building_height_m, "m", psrc="design")
        elif f.farm_building and f.lot_area_m2 is not None and f.lot_area_m2 < 100000:
            b.numeric("Building height", "height", "farm_building.max_height_m.site_lt_10ha", "max", f.building_height_m, "m", psrc="design")
        else:
            b.numeric("Building height", "height", "outbuilding.max_height_m", "max", f.building_height_m, "m", hint="outbuilding.max_cumulative_area_m2 / max_height_m", psrc="design")
        keya = "outbuilding.max_cumulative_area_m2.lot_gt_900m2" if (zone.upper() == "R2" and (f.lot_area_m2 or 0) > 900) else "outbuilding.max_cumulative_area_m2"
        b.numeric("Outbuilding cumulative area", "site", keya, "max", f.outbuilding_cumulative_area_m2, "m2", hint="outbuilding.max_cumulative_area_m2 / max_height_m", psrc="design")
    else:
        b.unresolved("Building height", "height", _unresolved_reason("building.max_height_m") or "LEP height control not obtained",
                     proposed=f.building_height_m, text="LEP cl 4.3 / Height of Buildings Map: not obtained")
    # FSR / site coverage / landscaping
    if f.dev_type != "shed":
        fsr, src, why = _fsr_requirement(f.constraints)
        ratio = (f.gfa_m2 / f.lot_area_m2) if (f.gfa_m2 is not None and f.lot_area_m2) else None
        if fsr is not None:
            st = _cmp("max", ratio, fsr)
            b.add(control="Floor space ratio", category="site", requirement_key="lep.fsr_max", requirement_text=f"at most {fsr:g}:1 (LEP FSR map layer)", citation=src, required_value=fsr, unit=":1",
                  proposed_value=None if ratio is None else round(ratio, 3), proposed_source="design GFA / lot area", status=st or Status.UNRESOLVED,
                  prompt=None if st else "Supply gross floor area (LEP definition) for the proposal.", variation_note=VARIATION_TBC if st == Status.FAIL else "")
        else:
            b.unresolved("Floor space ratio", "site", why or "", proposed=None if ratio is None else round(ratio, 3), text="LEP FSR: no citable value")
        b.unresolved("Site coverage", "site", _unresolved_reason("site_coverage") or "no control obtained", proposed=f.site_cover_pct, text="no site coverage control in the DCP obtained")
        b.unresolved("Landscaped area", "site", _unresolved_reason("site_coverage") or "no control obtained", proposed=f.landscaped_area_m2, text="no landscaped area control in the DCP obtained")
    if f.dev_type == "secondary_dwelling":
        r60, rpc = b.req("secondary_dwelling.max_floor_area_m2"), b.req("secondary_dwelling.max_floor_area_pct_of_principal")
        if isinstance(r60, UnresolvedRequirement) or isinstance(rpc, UnresolvedRequirement):
            b.unresolved("Secondary dwelling floor area", "site", "requirement not found", proposed=f.floor_area_m2)
        else:
            lim = max(float(r60.value), float(rpc.value) / 100 * f.principal_floor_area_m2) if f.principal_floor_area_m2 is not None else float(r60.value)
            st = _cmp("max", f.floor_area_m2, lim)
            if st == Status.FAIL and f.principal_floor_area_m2 is None and f.floor_area_m2 is not None:
                st = Status.UNRESOLVED     # may be allowed by 25% of the principal dwelling: principal floor area needed
            b.add(control="Secondary dwelling floor area", category="site", requirement_key="secondary_dwelling.max_floor_area_m2",
                  requirement_text=f"at most {lim:g} m2 (60 m2 or 25% of the principal dwelling, whichever is greater; DCP summary of LEP cl 5.4: secondary citation)",
                  citation=r60.source, required_value=lim, unit="m2", proposed_value=f.floor_area_m2, proposed_source="design", status=st or Status.UNRESOLVED,
                  prompt=None if st == st and st in (Status.PASS, Status.FAIL) else "Supply the principal dwelling floor area and the secondary dwelling floor area.",
                  variation_note=VARIATION_TBC if st == Status.FAIL else "")
        b.numeric("Private open space", "amenity", "secondary_dwelling.private_open_space_min_m2", "min", f.private_open_space_m2, "m2")
        b.numeric("Private open space minimum depth", "amenity", "secondary_dwelling.private_open_space_min_depth_m", "min", f.private_open_space_depth_m, "m")
    # parking
    if f.dev_type == "dwelling_house":
        b.numeric("Car parking", "parking", "parking.dwelling_house.spaces", "min", f.parking_spaces, "spaces", psrc="design")
    elif f.dev_type == "secondary_dwelling":
        b.boolean("Car parking (principal dwelling retained)", "parking", "parking.secondary_dwelling.no_loss_of_principal_parking", f.parking_spaces,
                  text="no additional parking is required for the secondary dwelling, but the principal dwelling must keep its required spaces",
                  prompt="Confirm on the site plan that the principal dwelling keeps its required spaces.")
    # driveway / crossover
    if f.dev_type != "shed" or f.crossover_width_m is not None:
        rmin, rmax = b.req("driveway.min_width_m"), b.req("driveway.max_width_m")
        if isinstance(rmin, UnresolvedRequirement) or isinstance(rmax, UnresolvedRequirement):
            b.unresolved("Driveway / crossover width", "access", "requirement not found", proposed=f.crossover_width_m)
        else:
            w = f.crossover_width_m
            st = None if w is None else (Status.PASS if float(rmin.value) - 1e-9 <= w <= float(rmax.value) + 1e-9 else Status.FAIL)
            b.add(control="Driveway / crossover width", category="access", requirement_key="driveway.min_width_m / driveway.max_width_m",
                  requirement_text=f"between {rmin.value:g} m and {rmax.value:g} m", citation=rmin.source, unit="m", proposed_value=w, proposed_source="SA3 driveway design",
                  status=st or Status.UNRESOLVED, prompt=None if st else "Supply the crossover width (SA3 DrivewayDesign).", variation_note=VARIATION_TBC if st == Status.FAIL else "")
        b.numeric("Crossover separation from corner/intersection", "access", "driveway.min_separation_m", "min", f.crossover_corner_separation_m, "m", psrc="SA3 driveway design")
        b.numeric("Driveway maximum grade", "access", "driveway.max_grade_pct", "max", f.driveway_max_grade_pct, "%", hint="driveway.max_grade_pct", psrc="SA3 driveway design")
    # stormwater
    b.boolean("Stormwater / on-site detention", "stormwater", "stormwater.designed_per_eng_standards", f.stormwater_strategy or ("OSD provided" if f.osd_provided else None),
              text="stormwater designed per the council Engineering Design Minimum Standards; OSD where post-development flow exceeds existing",
              prompt="Provide a stormwater concept/design plan for assessment against the Engineering Standards (no numeric comparison possible here).")
    _common_rows(b, f, with_basix=True)
