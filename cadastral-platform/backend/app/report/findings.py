"""Turn SA9 LayerResults + TriggerResults into reader-facing findings (plain English, labelled facts)."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from shapely import wkt
from shapely.geometry.base import BaseGeometry

from app.agents.sa9_constraints.intersect import LayerResult
from app.agents.sa9_constraints.layers import REGISTRY, get_layer
from app.agents.sa9_constraints.triggers import TriggerResult
from app.report import catalogue as C
from app.report import fmt
from app.report.explain import LOAD_MARGIN_M

ENDPOINTS = Path(__file__).parents[1] / "agents" / "sa9_constraints" / "endpoints_nsw.json"
_EP: dict | None = None


def endpoint_host() -> str:
    endpoint_meta("")                     # loads the file
    return str(_META.get("host", "")).replace("https://", "").split("/")[0]


_META: dict = {}


def endpoint_meta(key: str) -> dict:
    global _EP
    if _EP is None:
        try:
            _all = json.loads(ENDPOINTS.read_text(encoding="utf-8"))
            _EP = _all.get("layers", {})
            _META.update(_all.get("_meta", {}))
        except (OSError, ValueError):
            _EP = {}
    return _EP.get(key, {})


@dataclass
class FeatureRow:
    name: str
    details: str
    distance_m: float
    overlap_m2: float
    pct_of_lot: float
    geom: BaseGeometry
    attrs: dict


@dataclass
class Finding:
    key: str
    label: str
    short: str
    status: str                       # affected | nearby | clear | unchecked | mapped | notmapped
    chip: str
    headline: str
    rank: int
    rows: list[FeatureRow] = field(default_factory=list)
    distance_text: str = "-"
    overlap_text: str = "-"
    source_name: str = ""
    source_url: str = ""
    currency: str = ""
    currency_raw: str | None = None
    copyright: str | None = None
    caveat: str = ""
    what: str = ""
    trigger: TriggerResult | None = None
    why_unchecked: str = ""
    action: str = ""
    buffer_m: float = 0.0
    has_page: bool = False
    result: LayerResult | None = None
    meta: dict = field(default_factory=dict)          # the layer's own endpoint metadata (service, layer name, copyright)
    host: str = ""

    @property
    def active(self) -> bool:
        return self.status in ("affected", "nearby")


def _name(key: str, a: dict) -> tuple[str, str]:
    if key == "nsw_bushfire" or key == "qld_bushfire":
        n = a.get("d_Category") or (f"Category {a['Category']}" if a.get("Category") is not None else "Mapped vegetation")
        used = {"d_Category", "Category"}
    else:
        n = ""
        used = set()
        for k in ("ITEM_NAME", "HCA_NAME", "EPI_NAME", "SEPP_NAME"):
            if a.get(k):
                n, used = fmt.clean(a[k]), {k}
                break
        if not n:
            for k in ("LAY_CLASS", "ASS_CLASS", "CLASS", "HAZARD"):
                if a.get(k) not in (None, ""):
                    n, used = fmt.clean(a[k]), {k}
                    break
        n = n or "Mapped area"
    det = "; ".join(f"{l}: {v}" for l, v in fmt.attr_rows({k: v for k, v in a.items() if k not in used}))
    return n, det


def _rows(key: str, lot: BaseGeometry, r: LayerResult) -> list[FeatureRow]:
    out = []
    for i, w in enumerate(r.geometries_wkt):
        g = wkt.loads(w)
        a = r.attributes[i] if i < len(r.attributes) else {}
        n, det = _name(key, a)
        ov = g.intersection(lot).area if g.intersects(lot) else 0.0
        out.append(FeatureRow(n, det, round(lot.distance(g), 1), round(ov, 1), round(100 * ov / lot.area, 1) if lot.area else 0.0, g, a))
    return out


def nearest_classes(rows: list[FeatureRow]) -> list[tuple[str, float]]:
    """Each mapped class (feature name) with the distance of its nearest feature from the lot, nearest first.  Taken from the data; no class is preferred."""
    best: dict[str, float] = {}
    for x in rows:
        best[x.name] = min(x.distance_m, best.get(x.name, x.distance_m))
    return sorted(best.items(), key=lambda kv: (kv[1], kv[0]))


def _dedupe(rows: list[FeatureRow]) -> list[FeatureRow]:
    seen, out = set(), []
    for r in sorted(rows, key=lambda x: (x.distance_m, -x.overlap_m2)):
        k = (r.name, r.details, round(r.distance_m), round(r.overlap_m2))
        if k not in seen:
            seen.add(k)
            out.append(r)
    return out


def _headline(key: str, status: str, short: str, rows: list[FeatureRow], r: LayerResult, buffer_m: float, lot: BaseGeometry) -> str:
    low = short[0].lower() + short[1:]
    if status == "affected":
        ov = [x for x in rows if x.overlap_m2 > 0]
        if key == "nsw_bushfire" and ov:
            cats = ", ".join(sorted({x.name for x in ov if x.name != "Vegetation Buffer"} | ({"vegetation buffer"} if any(x.name == "Vegetation Buffer" for x in ov) else set())))
            return f"The lot is mapped as bush fire prone land ({cats}); {r.pct_of_lot:.0f}% of the lot is covered."
        if r.pct_of_lot >= 99.5:
            return f"The whole lot is within mapped {low}."
        return f"{r.pct_of_lot:.0f}% of the lot ({fmt.area(r.overlap_area_m2)}) is within mapped {low}."
    if status == "nearby":
        grp = nearest_classes(rows)                       # (class name, nearest distance) for every mapped class in range, nearest first (any class counts)
        d = grp[0][1] if grp else (r.nearest_distance_m or 0)
        what = {"nsw_bushfire": "mapped bush fire prone land"}.get(key, f"mapped {low}")
        nm = f" ({grp[0][0]})" if grp and grp[0][0] != "Mapped area" else ""
        more = ""
        if len(grp) > 1:
            more = " Next nearest: " + "; ".join(f"{n}, {x:.0f} m" for n, x in grp[1:]) + "."
        return (f"The lot is {d:.0f} m from the nearest {what}{nm}.{more} No mapped area overlaps the lot, but the nearest feature is within the "
                f"{buffer_m:.0f} m screening distance (a platform screening setting), so the result is WITHIN BUFFER.")
    if status == "clear":
        if r.nearest_distance_m is None:
            return (f"NOT INTERSECTED BY THE DATA LOADED: no {low} feature was found on the lot or within about {LOAD_MARGIN_M} m of it in the data loaded. "
                    "This describes the data only.")
        return (f"NOT INTERSECTED BY THE DATA LOADED: no {low} feature overlaps the lot"
                + (f" or lies inside the {buffer_m:.0f} m screening distance" if buffer_m else "")
                + f". The nearest feature in the data loaded is {r.nearest_distance_m:.0f} m away.")
    return ""


def build_findings(results: list[LayerResult], triggers: list[TriggerResult], lot: BaseGeometry, dev_type: str | None) -> list[Finding]:
    by_layer = {t.layer_key: t for t in triggers}
    out: list[Finding] = []
    for r in results:
        cat = C.LAYERS.get(r.key, {})
        lt = get_layer(r.key) if r.key in REGISTRY else None
        short = cat.get("short") or r.label
        buffer_m = lt.buffer_m if lt else 0.0
        em = endpoint_meta(r.key)
        cur = fmt.parse_currency(r.data_currency)
        is_info = r.key in C.INFO_KEYS
        rows = _dedupe(_rows(r.key, lot, r)) if r.status == "affected" else []
        if r.status == "not_checked":
            status, chip = "unchecked", "Not checked"
        elif r.status == "affected":
            if is_info:
                status, chip = "mapped", "Mapped"
            elif r.overlap_area_m2 > 0:
                status, chip = "affected", "Intersects"
            else:
                status, chip = "nearby", "Within buffer"
        else:
            status, chip = ("notmapped", "Not intersected") if r.key in C.CONTROL_KEYS else ("clear", "Not intersected")
        why = ""
        if status == "unchecked":
            e = r.error or ""
            if "no endpoint" in e:
                why = "No public data service for this layer is connected to the platform yet."
            elif re.search(r"ProxyError|ConnectionError|HTTPSConnectionPool|Max retries|timed out|Timeout|getaddrinfo|Name or service", e, re.I):
                why = "The data service could not be reached from this run (network error). The layer was not queried."
            else:
                why = "The data service could not be queried (" + fmt.shorten_quote(e, 120).rstrip(".") + ")."
        f = Finding(key=r.key, label=r.label, short=short, status=status, chip=chip,
                    headline=_headline(r.key, status, short, rows, r, buffer_m, lot), rank=cat.get("rank", 8), rows=rows,
                    source_name=(f"{em['service']} / {em['layer_name']}" if em.get("service") else "Source not recorded"),
                    meta=em, host=endpoint_host(),
                    source_url=em.get("endpoint", ""), currency=fmt.currency_phrase(r.data_currency), currency_raw=r.data_currency,
                    copyright=cur["copyright"] or em.get("copyright"), caveat=cat.get("caveat", ""), what=cat.get("what", ""),
                    trigger=by_layer.get(r.key), why_unchecked=why, action=cat.get("nc_action", "") or "Check with council.", buffer_m=buffer_m, result=r)
        if status in ("affected", "nearby"):
            f.has_page = not is_info and bool(lt.significant if lt else True)
        if status == "notmapped":
            f.headline = f"NOT INTERSECTED BY THE DATA LOADED: no {short.lower()} control is mapped on the lot in the map layer loaded."
        if status == "mapped" and r.key in C.CONTROL_KEYS:
            f.headline = control_text(r.key, f)
        if status == "mapped" and r.key == "nsw_sepp_area":
            names = sorted({x.name for x in rows})
            f.headline = "The lot is inside the land application area of: " + "; ".join(names) + "."
        if status == "clear" and r.key == "nsw_flood":
            f.headline += " " + cat.get("clear_note", "")
        out.append(f)
    return out


def control_text(key: str, f: Finding) -> str:
    """Plain statement of a mapped LEP control, with multiple classes shown by share of lot."""
    parts = []
    for x in f.rows:
        a = x.attrs
        if key == "nsw_lot_size_map":
            v = f"{a.get('LOT_SIZE'):g} {a.get('UNITS', '')}".strip() if a.get("LOT_SIZE") is not None else x.name
            if str(a.get("UNITS", "")).lower() == "ha" and a.get("LAY_CLASS"):
                v = f"{a['LAY_CLASS']} ha class"
        elif key == "nsw_fsr_map":
            v = f"{a['FSR']:g}:1" if a.get("FSR") is not None else x.name
        else:
            v = f"{a['MAX_B_H']:g} m" if a.get("MAX_B_H") is not None else x.name
        parts.append((v, x.pct_of_lot, x.overlap_m2))
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0][0]
    return "; ".join(f"{v} ({p:.0f}% of the lot)" for v, p, _ in parts)


def control_value(findings: list[Finding], key: str) -> str | None:
    f = next((x for x in findings if x.key == key), None)
    if f is None or f.status == "unchecked":
        return None
    return control_text(key, f) if f.status == "mapped" else "not mapped"
