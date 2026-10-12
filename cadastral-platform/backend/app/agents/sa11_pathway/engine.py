"""Evaluate the rule set for a lot + proposal -> PathwayResult (ELIGIBLE / NOT_ELIGIBLE / UNRESOLVED per pathway).

Rules: a FAIL needs a cited rule and a numeric/boolean comparison on supplied data; missing data or missing documents give
UNRESOLVED with a prompt; nothing is defaulted.  The recommendation text is always 'may apply: verify with council or a certifier'.
"""
from __future__ import annotations

import re
from typing import Any

from app.agents.requirements.models import Source

from .models import (RECOMMENDATION, CriterionResult, DevType, PathwayCard, PathwayInput, PathwayResult, PathwayStatus, Pill, Status)
from .rules import Rule, RuleSet

RES_ZONES = ["R1", "R2", "R3", "R4", "RU5"]
_RULESET: RuleSet | None = None


def default_ruleset() -> RuleSet:
    global _RULESET
    if _RULESET is None:
        _RULESET = RuleSet.load()
    return _RULESET


def _fmt(v: float | None, unit: str | None) -> str:
    if v is None:
        return ""
    return f"{v:g} {unit or ''}".strip()


def _in_band(b: dict, v: float) -> bool:
    lo, hi = b["lo"], b["hi"]
    ok_lo = v >= lo if b.get("lo_incl") else v > lo
    return ok_lo and (hi is None or v <= hi)


def _formula(expr: str, inp: PathwayInput) -> float | None:
    m = re.fullmatch(r"\s*(\w+)\s*-\s*([\d.]+)\s*", expr)
    if not m:
        return None
    v = getattr(inp, m.group(1), None)
    return None if v is None else float(v) - float(m.group(2))


class _Missing(Exception):
    def __init__(self, field: str, why: str = ""):
        self.field, self.why = field, why


def _required(rule: Rule, inp: PathwayInput) -> tuple[float | None, str]:
    """Required numeric value for a rule (or raises _Missing / returns (None, reason) for unresolved band cells)."""
    if rule.bands:
        bf = rule.band_field
        v = getattr(inp, bf, None) if bf else None
        if v is None:
            raise _Missing(bf)
        for b in rule.bands:
            if _in_band(b, float(v)):
                x = b["value"]
                if "num" in x or "abs" in x:
                    return float(x.get("num", x.get("abs"))), f"band {bf}={v:g}"
                if "pct" in x:
                    if inp.lot_area_m2 is None:
                        raise _Missing("lot_area_m2")
                    return x["pct"] / 100 * inp.lot_area_m2, f"{x['pct']}% of lot area"
                if "pct_plus" in x:
                    if inp.lot_area_m2 is None:
                        raise _Missing("lot_area_m2")
                    p, k = x["pct_plus"]
                    return p / 100 * inp.lot_area_m2 + k, f"{p}% of lot area + {k} m2"
                if "formula" in x:
                    r = _formula(x["formula"], inp)
                    if r is None:
                        raise _Missing(x["formula"].split()[0])
                    return r, x["formula"]
                if "formula_max" in x:
                    r = _formula(x["formula_max"][0], inp)
                    if r is None:
                        raise _Missing(x["formula_max"][0].split()[0])
                    return max(r, float(x["formula_max"][1])), "greater of " + " and ".join(map(str, x["formula_max"]))
                if "unresolved" in x:
                    return None, x["unresolved"]
        return None, f"no table column covers {bf}={v}"
    if rule.band_field and rule.band_field.startswith("@"):
        f = rule.band_field[1:]
        v = getattr(inp, f, None)
        if v is None:
            raise _Missing(f)
        return float(v), f
    val = rule.value
    if isinstance(val, str) and val.startswith("@"):
        f, _, dflt = val[1:].partition("|")
        v = getattr(inp, f, None)
        if v is not None:
            return float(v), f"{f} (LEP lot size map)"
        if inp.lep_min_lot_size_specified is False:
            return float(dflt), "LEP specifies no minimum lot size: 4,000 m2 default in the code"
        raise _Missing(f, "LEP minimum lot size (Lot Size Map) not supplied")
    return (None if val is None else float(val)), ""


def _cond(c: dict, inp: PathwayInput) -> bool | None:
    """True/False, or None when the data needed is unknown."""
    f, op = c["field"], c["op"]
    v = getattr(inp, f, None)
    if f == "lot_type" and v is None:
        v = "standard"                                  # global assumption, recorded on each criterion
    if op == "is_null":
        return v is None
    if op == "not_null":
        return v is not None
    if op == "ne":
        return v != c["value"]                          # unknown counts as 'not equal' (e.g. within_existing_dwelling)
    if op == "ne_notnull":
        return v is not None and v != c["value"]
    if v is None:
        return None
    if op == "eq":
        return v == c["value"]
    if op == "le":
        return float(v) <= c["value"]
    if op == "gt":
        return float(v) > c["value"]
    raise ValueError(op)


def _user_source(inp: PathwayInput, f: str, doc: str) -> Source:
    return Source(document_title=doc, authority="user", entered_by=inp.provenance.get(f, "user"), quote=f"{f} = {getattr(inp, f)}")


def _res(rule: Rule, status: Status, inp: PathwayInput, **kw: Any) -> CriterionResult:
    return CriterionResult(rule_id=rule.id, code=rule.code, category=rule.category if rule.category in ("applicability", "exclusion", "standard") else "data",
                           label=rule.label, status=status, field=rule.field, op=rule.op, unit=rule.unit, citation=rule.citation,
                           verify_current=rule.verify_current and rule.status == "resolved" and rule.code != "cdc_general", **kw)


def eval_rule(rule: Rule, inp: PathwayInput) -> CriterionResult | None:
    """None = rule does not apply to this development / zone (not shown)."""
    if inp.dev_type.value not in rule.dev_types:
        return None
    if rule.zones and (inp.zone is None or inp.zone.upper() not in rule.zones):
        if inp.zone is not None:
            return None
    assumptions: list[str] = []
    for c in rule.applies_if:
        r = _cond(c, inp)
        if r is None:
            return _res(rule, Status.UNRESOLVED, inp, prompt=f"Supply {c['field']} to decide whether this rule applies.", assumptions=assumptions,
                        note=rule.note or "")
        if not r:
            return None
    if "lot_type" in rule.assumes:
        if inp.lot_type is None:
            assumptions.append("assumes a standard lot (not corner, battle-axe or parallel road): confirm lot type")
        elif inp.lot_type != rule.assumes["lot_type"]:
            return _res(rule, Status.UNRESOLVED, inp, prompt=f"This value is for a {rule.assumes['lot_type']} lot; the lot is {inp.lot_type}: apply the matching Department summary table.",
                        assumptions=assumptions)
    if rule.zones and inp.zone is None:
        assumptions.append("zone not supplied")
    base = dict(assumptions=assumptions, note=rule.note or "")
    # ---- unresolved (no document) rules
    if rule.status == "unresolved":
        f = rule.field
        v = getattr(inp, f, None) if f else None
        if f == "lep_permissibility":
            if v == "prohibited":
                return _res(rule, Status.FAIL, inp, proposed_value=v, required_text="permissible with consent", **{**base, "note": "user-entered LEP land use table result"}).model_copy(
                    update={"citation": _user_source(inp, f, "LEP land use table (user-entered)")})
            if v is not None:
                return _res(rule, Status.PASS, inp, proposed_value=v, required_text="permissible with consent", **{**base, "note": "user-entered LEP land use table result; LEP not obtained"}).model_copy(
                    update={"citation": _user_source(inp, f, "LEP land use table (user-entered)")})
        if f and v is False:
            return _res(rule, Status.NOT_APPLICABLE, inp, proposed_value=v, **{**base, "note": f"{f} stated False (not independently verified)"})
        return _res(rule, Status.UNRESOLVED, inp, prompt=rule.prompt, proposed_value=v, **base)
    # ---- special rules
    if rule.op in ("na",):
        return _res(rule, Status.NOT_APPLICABLE, inp, **{**base, "note": rule.note or ""})
    if rule.op == "info":
        return _res(rule, Status.NOT_APPLICABLE, inp, **base)
    if rule.id == "sd.bushfire_flame_zone":
        if inp.bal == "BAL-FZ":
            return _res(rule, Status.FAIL, inp, proposed_value=inp.bal, required_text="not BAL-FZ", **base)
        if inp.bushfire_prone is False:
            return _res(rule, Status.PASS, inp, proposed_value="not bushfire prone", required_text="not BAL-FZ", **base)
        return _res(rule, Status.UNRESOLVED, inp, proposed_value=inp.bal, required_text="not BAL-FZ",
                    prompt="Obtain the s10.7 certificate and a BAL assessment (AS 3959): flame zone (BAL-FZ) excludes complying development for a secondary dwelling.", **base)
    f = rule.field
    v = getattr(inp, f, None) if f else None
    # ---- boolean / set rules
    if rule.op in ("is_false", "is_true"):
        want = rule.op == "is_true"
        if v is None:
            return _res(rule, Status.UNRESOLVED, inp, proposed_value=None, required_text=("must be true" if want else "must not apply"),
                        prompt=f"Supply {f} (data from SA9/s10.7/council or user).", **base)
        ok = (v is want)
        return _res(rule, Status.PASS if ok else Status.FAIL, inp, proposed_value=v, required_text=("must be true" if want else "must not apply"), **base)
    if rule.op in ("in", "not_in"):
        if v is None:
            return _res(rule, Status.UNRESOLVED, inp, prompt=f"Supply {f}.", **base)
        sv = str(v).upper() if f == "zone" else v
        inn = sv in rule.value
        ok = inn if rule.op == "in" else not inn
        if ok:
            return _res(rule, Status.PASS, inp, proposed_value=v, required_text=f"{rule.op.replace('_', ' ')} {rule.value}", **base)
        if rule.else_unresolved:
            return _res(rule, Status.UNRESOLVED, inp, proposed_value=v, required_text=f"in {rule.value}",
                        prompt="Outside the listed zones the development may still be permitted by the LEP: supply the LEP land use table result.", **base)
        return _res(rule, Status.FAIL, inp, proposed_value=v, required_text=f"{rule.op.replace('_', ' ')} {rule.value}", **base)
    # ---- numeric comparisons
    try:
        req, how = _required(rule, inp)
    except _Missing as m:
        return _res(rule, Status.UNRESOLVED, inp, prompt=f"Supply {m.field}" + (f" ({m.why})" if m.why else "") + " to evaluate this standard.", **base)
    if req is None:
        return _res(rule, Status.UNRESOLVED, inp, prompt=f"Table value not resolvable: {how}.", **base)
    rt = f"{'at least' if rule.op == '>=' else 'at most'} {_fmt(req, rule.unit)}" + (f" ({how})" if how else "")
    if v is None:
        return _res(rule, Status.UNRESOLVED, inp, required_value=req, required_text=rt, prompt=f"Supply the proposed {f} ({rule.unit or ''}).".replace(" ()", ""), **base)
    x = float(v)
    ok = x >= req - 1e-9 if rule.op == ">=" else x <= req + 1e-9
    return _res(rule, Status.PASS if ok else Status.FAIL, inp, required_value=req, required_text=rt, proposed_value=x, **base)


def _active_codes(inp: PathwayInput, rs: RuleSet, pathway: str) -> tuple[list[str], list[CriterionResult]]:
    extra: list[CriterionResult] = []
    zone = (inp.zone or "").upper()
    d = inp.dev_type
    if pathway == "cdc":
        codes = ["cdc_general"]
        if d == DevType.DWELLING_HOUSE:
            inland = rs.is_inland(inp.lga)
            if inland is None:
                extra.append(CriterionResult(rule_id="code.selection", code="cdc_general", category="applicability", label="Which complying development code applies to the LGA",
                                             status=Status.UNRESOLVED, prompt="Supply the LGA: the Inland Code applies only in the 69 LGAs on the Department's map.", citation=rs.inland_citation))
            elif inland:
                codes.append("inland_code")
                extra.append(CriterionResult(rule_id="code.selection", code="inland_code", category="applicability", label=f"Inland Code applies in {inp.lga} LGA",
                                             status=Status.PASS, required_text="LGA on the Inland Code map", proposed_value=inp.lga, citation=rs.inland_citation,
                                             note="Inland Code summary tables are dated October 2018 and the code may have been amended."))
            else:
                codes.append("housing_code" if zone in RES_ZONES else "rural_housing_code")
        elif d == DevType.SECONDARY_DWELLING:
            codes.append("housing_sepp_secondary")
        else:
            codes += ["inland_farm_cdc", "cdc_outbuilding"]
    elif pathway == "exempt":
        codes = ["exempt_general", "exempt_farm", "exempt_shed"] if d == DevType.SHED else ["exempt_general"]
    else:
        codes = ["da"] + (["housing_sepp_secondary"] if d == DevType.SECONDARY_DWELLING else [])
    return codes, extra


def _verdict(crits: list[CriterionResult]) -> tuple[PathwayStatus, CriterionResult | None]:
    live = [c for c in crits if c.status != Status.NOT_APPLICABLE]
    fails = [c for c in live if c.status == Status.FAIL]
    if fails:
        order = {"applicability": 0, "exclusion": 1, "standard": 2, "data": 3}
        return PathwayStatus.NOT_ELIGIBLE, sorted(fails, key=lambda c: order.get(c.category, 9))[0]
    if any(c.status == Status.UNRESOLVED for c in live) or not live:
        return PathwayStatus.UNRESOLVED, None
    return PathwayStatus.ELIGIBLE, None


def _card(pathway: str, title: str, inp: PathwayInput, rs: RuleSet) -> PathwayCard:
    codes, crits = _active_codes(inp, rs, pathway)
    seen_na = False
    for r in rs.rules:
        if r.pathway != pathway or r.code not in codes:
            continue
        if r.id == "cdc.lep_permissibility" and pathway == "cdc":
            pass
        c = eval_rule(r, inp)
        if c is not None:
            crits.append(c)
    if pathway == "exempt" and inp.dev_type != DevType.SHED:
        na = next((c for c in crits if c.rule_id == "exempt.dwelling.na"), None)
        pill, st = Pill.NOT_APPLICABLE, PathwayStatus.NOT_APPLICABLE
        head = "Exempt development does not cover a new dwelling (inferred from the Portal's exempt list; verify)."
        return PathwayCard(pathway=pathway, title=title, status=st, pill=pill, headline=head, recommendation=RECOMMENDATION, codes=codes, criteria=crits)
    status, fail = _verdict(crits)
    unres = [c for c in crits if c.status == Status.UNRESOLVED]
    if status == PathwayStatus.ELIGIBLE:
        pill, head = Pill.POSSIBLE, f"{title} may apply on the data supplied; every evaluated criterion passed."
    elif status == PathwayStatus.NOT_ELIGIBLE:
        pill = Pill.NOT_APPLICABLE
        head = f"Not eligible: {fail.label} ({fail.required_text or 'cited rule'}; proposed {fail.proposed_value})."
    else:
        pill, head = Pill.UNRESOLVED, f"Cannot be determined: {len(unres)} criteria are unresolved (missing data or documents not obtained)."
    return PathwayCard(pathway=pathway, title=title, status=status, pill=pill, headline=head, recommendation=RECOMMENDATION, codes=codes,
                       criteria=crits, failing=fail, unresolved=unres)


def assess_pathway(inp: PathwayInput, ruleset: RuleSet | None = None) -> PathwayResult:
    rs = ruleset or default_ruleset()
    if inp.landholding_area_m2 is None and inp.lot_area_m2 is not None:
        inp = inp.model_copy(update={"landholding_area_m2": inp.lot_area_m2})
    exempt = _card("exempt", "Exempt development", inp, rs)
    cdc = _card("cdc", "Complying development (CDC)", inp, rs)
    # DA card
    perm = next((c for c in cdc.criteria if c.rule_id == "cdc.lep_permissibility"), None)
    da_crits = [c for c in (eval_rule(r, inp) for r in rs.rules if r.pathway == "da" and r.code in ("da", "housing_sepp_secondary")) if c is not None]
    if perm:
        da_crits.insert(0, perm)
    da_status, da_fail = _verdict([c for c in da_crits if c.rule_id not in ("da.local_dev",)])
    if da_fail is not None:
        pill, head = Pill.NOT_APPLICABLE, "Prohibited development cannot be approved by a DA (user-entered LEP result)."
    elif exempt.status == PathwayStatus.ELIGIBLE:
        pill, head = Pill.NOT_APPLICABLE, "Not required if the development is exempt; a DA can still be lodged."
    elif cdc.status == PathwayStatus.ELIGIBLE:
        pill, head = Pill.POSSIBLE, "Alternative to a CDC: a DA with the council as consent authority."
    elif all(c.status in (PathwayStatus.NOT_ELIGIBLE, PathwayStatus.NOT_APPLICABLE) for c in (exempt, cdc)):
        pill, head = Pill.REQUIRED, "A development application is required (exempt and complying development do not apply on the data supplied)."
    else:
        pill, head = Pill.POSSIBLE, "Fallback: required if exempt and complying development turn out not to apply."
    unres_da = [c for c in da_crits if c.status == Status.UNRESOLVED]
    da = PathwayCard(pathway="da", title="Development application (DA)", status=(PathwayStatus.NOT_ELIGIBLE if da_fail else da_status), pill=pill, headline=head,
                     recommendation=RECOMMENDATION, codes=["da"], criteria=da_crits, failing=da_fail, unresolved=unres_da)
    cards = [da, cdc, exempt]
    sug = "exempt" if exempt.status == PathwayStatus.ELIGIBLE else "cdc" if cdc.status == PathwayStatus.ELIGIBLE else \
        ("da" if da.pill == Pill.REQUIRED else None)
    gaps = sorted({(c.field or c.rule_id) for card in cards for c in card.unresolved if c.field})
    summ = "; ".join(f"{c.title}: {c.pill.value}" for c in cards) + ". " + RECOMMENDATION
    return PathwayResult(dev_type=inp.dev_type, lga=inp.lga, zone=inp.zone, cards=cards, suggested_pathway=sug, summary=summ, data_gaps=gaps,
                         blocked_documents=[b["title"] for b in rs.blocked], rule_set_built_at=rs.built_at, currency_warning=rs.currency_warning)
