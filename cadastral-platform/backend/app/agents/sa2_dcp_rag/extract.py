from __future__ import annotations

import json
import re
from typing import Any, Protocol

from app.agents.sa2_dcp_rag.models import DWELLING_TYPES, ELEMENTS, SetbackRule, Chunk

try:  # orchestrator hook; absent/None outside an orchestrated run
    from app.orchestrator.context import current_invocation
except Exception:  # pragma: no cover
    def current_invocation():
        return None

RANGES = {"front": (0, 30), "secondary_frontage": (0, 20), "side": (0, 15), "rear": (0, 30), "side_upper": (0, 20),
          "rear_upper": (0, 30), "garage_front": (0, 30), "site_cover_max": (5, 100), "landscape_min": (0, 100),
          "private_open_space_min": (0, 300), "height_max": (2, 60), "storeys_max": (1, 12),
          "floor_space_ratio_max": (0.05, 5)}
UNIT_FOR = {**{e: "m" for e in ("front", "secondary_frontage", "side", "rear", "side_upper", "rear_upper",
                                "garage_front", "height_max")},
            "site_cover_max": "percent", "landscape_min": "percent", "private_open_space_min": "m2",
            "storeys_max": "count", "floor_space_ratio_max": "ratio"}

TERMINOLOGY = """Terminology (NSW/QLD): 'primary frontage' = front boundary; 'secondary frontage'/'secondary street' = second
street boundary of a corner lot; 'acceptable solution' (QLD) / 'development control' (NSW DCP) = numeric deemed-to-comply
value (is_performance_outcome=false); 'performance outcome'/'objective' = qualitative alternative (is_performance_outcome=true,
only if a number is stated). 'Building line'/'setback' = min distance from boundary to building. 'Site cover(age)' = max
% of site covered by buildings. 'Landscaped area' = min % of site. 'Dwelling house' = detached single dwelling. Zones: NSW
R1-R5, RU*, E1-E4, MU1, B1-B8; QLD LDR, LMR, MDR, HDR, etc. Units: m, mm (convert to m), %."""

SYSTEM = ("You extract setback and building-envelope rules from council planning text. Output ONLY JSON matching the "
          "schema. Never guess: omit any element not explicitly stated. Every rule must cite a supplied chunk_id and "
          "include 'quote', an exact verbatim substring of that chunk containing the value.\n" + TERMINOLOGY)

RULE_SCHEMA = {"type": "object", "required": ["rules"], "properties": {"rules": {"type": "array", "items": {
    "type": "object", "required": ["chunk_id", "quote", "zone_code", "element", "value_numeric", "unit"],
    "properties": {"chunk_id": {"type": "string"}, "quote": {"type": "string"}, "zone_code": {"type": "string"},
                   "dwelling_type": {"enum": list(DWELLING_TYPES)}, "element": {"enum": list(ELEMENTS)},
                   "lot_condition": {"type": "object"}, "value_numeric": {"type": "number"},
                   "unit": {"enum": ["m", "percent", "m2", "ratio", "count"]},
                   "is_performance_outcome": {"type": "boolean"}, "confidence": {"type": "number"}}}}}}


class LlmClient(Protocol):
    def complete(self, system: str, user: str, schema: dict) -> dict:
        """Return {'rules': [...], 'usage': {input_tokens, cache_creation_input_tokens, cache_read_input_tokens,
        output_tokens, model}}."""


def norm(s: str) -> str:
    s = s.lower().replace("\u2013", "-").replace("\u00a0", " ")
    return re.sub(r"[\s|*_`]+", " ", s).strip()


# ---------- deterministic table parser ----------
def _header_element(h: str) -> str | None:
    h = h.lower()
    if "secondary" in h or "side street" in h:
        return "secondary_frontage"
    if "garage" in h:
        return "garage_front"
    if "upper" in h:
        return "rear_upper" if "rear" in h else "side_upper"
    for key, el in (("front", "front"), ("side", "side"), ("rear", "rear"), ("cover", "site_cover_max"),
                    ("landscap", "landscape_min"), ("height", "height_max"), ("storey", "storeys_max"),
                    ("floor space", "floor_space_ratio_max"), ("fsr", "floor_space_ratio_max")):
        if key in h:
            return el
    return None


def parse_value(cell: str, element: str) -> tuple[float, str] | None:
    m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(mm|m2|m²|m|%)?\s*", cell.strip(), re.I)
    if not m:
        return None
    v, u = float(m.group(1)), (m.group(2) or "").lower()
    exp = UNIT_FOR[element]
    if u == "mm":
        v, u = v / 1000, "m"
    u = {"%": "percent", "m²": "m2", "": exp}.get(u, u)
    return (v, u) if u == exp else None


def _rows(content: str) -> list[list[str]]:
    rows = []
    for ln in content.splitlines():
        if ln.startswith("|") and not re.fullmatch(r"[|\s:\-]+", ln):
            rows.append([c.strip() for c in ln.strip().strip("|").split("|")])
    return rows


def parse_setback_table(chunk: Chunk, zone_code: str, dwelling_type: str = "dwelling_house") -> list[SetbackRule]:
    rows = _rows(chunk.content)
    if len(rows) < 2:
        return []
    hdr, out = rows[0], []
    if dwelling_type != "dwelling_house" and not any("dwelling" in h.lower() or "development" in h.lower() for h in hdr):
        return []          # table does not distinguish development types: do NOT label it as another type's rule
    zi = next((i for i, h in enumerate(hdr) if "zone" in h.lower()), None)
    di = next((i for i, h in enumerate(hdr) if "dwelling" in h.lower() or "development" in h.lower()), None)
    cols = {i: _header_element(h) for i, h in enumerate(hdr) if i != zi and i != di}
    for r in rows[1:]:
        if len(r) != len(hdr):
            continue
        if zi is not None and not re.search(rf"\b{re.escape(zone_code)}\b", r[zi], re.I):
            continue
        if di is not None and not any(k in r[di].lower() for k in dwelling_type.split("_")[:1]):
            continue
        quote_row = "| " + " | ".join(r) + " |"
        for i, el in cols.items():
            if el and (pv := parse_value(r[i], el)):
                out.append(SetbackRule(zone_code=zone_code, dwelling_type=dwelling_type, element=el, value_numeric=pv[0],
                                       unit=pv[1], extraction_confidence=0.95, source_chunk_id=chunk.chunk_id,
                                       source_page=chunk.page_from, quote=quote_row, method="table"))
    return out


# ---------- LLM path ----------
def build_prompt(chunks: list[Chunk], zone_code: str, lot: dict, elements: list[str]) -> tuple[str, str]:
    """Stable cacheable prefix first (system incl. schema), per-lot variable content last (user)."""
    system = SYSTEM + "\nJSON schema:\n" + json.dumps(RULE_SCHEMA, sort_keys=True)
    ctx = "\n\n".join(f"[chunk_id={c.chunk_id} pages={c.page_from}-{c.page_to} section={c.section_ref}]\n{c.content}"
                      for c in chunks)
    user = (f"Zone: {zone_code}\nLot: {json.dumps(lot, sort_keys=True)}\nExtract ONLY these elements: "
            f"{', '.join(elements)}\nInclude lot_condition (e.g. {{\"corner_lot\": true}}) when a rule applies to a "
            f"lot type.\n\nCHUNKS:\n{ctx}")
    return system, user


def validate_rule(raw: dict, by_id: dict[str, Chunk], zone_code: str, allowed: set[str]) -> tuple[SetbackRule | None, str]:
    try:
        cid, el, q = raw.get("chunk_id"), raw.get("element"), raw.get("quote") or ""
        if not cid or cid not in by_id:
            return None, f"rejected {el}: cites unsupplied chunk {cid!r}"
        if el not in allowed:
            return None, f"rejected {el}: element not requested/unknown"
        if str(raw.get("zone_code", "")).upper() != zone_code.upper():
            return None, f"rejected {el}: zone mismatch"
        ch = by_id[cid]
        if not q.strip() or norm(q) not in norm(ch.content):
            return None, f"rejected {el}: quote not found in cited chunk {cid}"
        v, unit = float(raw["value_numeric"]), raw.get("unit")
        if unit != UNIT_FOR[el]:
            return None, f"rejected {el}: unit {unit!r} inconsistent (expected {UNIT_FOR[el]})"
        lo, hi = RANGES[el]
        if not lo <= v <= hi:
            return None, f"rejected {el}: value {v} outside sane range {lo}-{hi}"
        if not any(abs(float(n) - v) < 1e-6 or abs(float(n) / 1000 - v) < 1e-6 for n in re.findall(r"\d+(?:\.\d+)?", q)):
            return None, f"rejected {el}: value {v} not present in quote"
        return SetbackRule(zone_code=zone_code, dwelling_type=raw.get("dwelling_type", "dwelling_house"), element=el,
                           lot_condition=raw.get("lot_condition") or {}, value_numeric=v, unit=unit,
                           is_performance_outcome=bool(raw.get("is_performance_outcome", False)),
                           extraction_confidence=min(float(raw.get("confidence", 0.7)), 0.85), source_chunk_id=cid,
                           source_page=ch.page_from, quote=q, method="llm"), ""
    except Exception as e:  # malformed model output never propagates
        return None, f"rejected rule: invalid ({type(e).__name__}: {e})"


def record_usage(usage: dict) -> None:
    ctx = current_invocation()
    if ctx:
        ctx.record_tokens(usage.get("model", "unknown"), fresh=usage.get("input_tokens", 0),
                          cache_write=usage.get("cache_creation_input_tokens", 0),
                          cache_read=usage.get("cache_read_input_tokens", 0), output=usage.get("output_tokens", 0))


def extract_rules(chunks: list[Chunk], zone_code: str, required: list[str], llm: LlmClient | None, lot: dict | None = None,
                  dwelling_type: str = "dwelling_house") -> tuple[list[SetbackRule], list[str], list[str], bool]:
    """Table parser first; LLM only for unresolved. Returns (rules, unresolved, warnings, used_llm)."""
    rules, warnings = [], []
    for c in chunks:
        if c.kind == "table":
            rules += parse_setback_table(c, zone_code, dwelling_type)
    # dedupe table rules per (element)
    seen, uniq = set(), []
    for r in rules:
        if r.element not in seen:
            seen.add(r.element), uniq.append(r)
    rules = uniq
    unresolved = [e for e in required if e not in {r.element for r in rules}]
    used = False
    if unresolved and llm is not None and chunks:
        ctx = current_invocation()
        if ctx:
            ctx.ensure_budget()
        system, user = build_prompt(chunks, zone_code, lot or {}, unresolved)
        resp = llm.complete(system, user, RULE_SCHEMA)
        used = True
        record_usage(resp.get("usage") or {})
        by_id = {c.chunk_id: c for c in chunks}
        for raw in resp.get("rules", []):
            r, why = validate_rule(raw, by_id, zone_code, set(unresolved))
            if r and r.dwelling_type != dwelling_type:
                warnings.append(f"rule for dwelling_type '{r.dwelling_type}' ignored (requested '{dwelling_type}')")
            elif r:
                rules.append(r)
            else:
                warnings.append(why)
        unresolved = [e for e in required if e not in {r.element for r in rules}]
    return rules, unresolved, warnings, used


class AnthropicLlmClient:  # optional, unused in tests
    def __init__(self, client: Any, model: str, max_tokens: int = 2000) -> None:
        self.client, self.model, self.max_tokens = client, model, max_tokens

    def complete(self, system: str, user: str, schema: dict) -> dict:
        r = self.client.messages.create(model=self.model, max_tokens=self.max_tokens, messages=[
            {"role": "user", "content": user}],
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}])
        text = "".join(b.text for b in r.content if getattr(b, "type", "") == "text")
        data = json.loads(text[text.find("{"): text.rfind("}") + 1])
        u = r.usage
        data["usage"] = {"model": self.model, "input_tokens": u.input_tokens, "output_tokens": u.output_tokens,
                         "cache_creation_input_tokens": getattr(u, "cache_creation_input_tokens", 0) or 0,
                         "cache_read_input_tokens": getattr(u, "cache_read_input_tokens", 0) or 0}
        return data
