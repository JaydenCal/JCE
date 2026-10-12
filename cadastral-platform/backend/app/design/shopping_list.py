"""Shopping-list export (CSV / JSON) with an 'as at' price date."""
from __future__ import annotations

import csv
import io
import json
from collections import OrderedDict
from datetime import datetime
from typing import Any, Iterable, Mapping

DISCLAIMER = ("Prices are indicative, in AUD, and as at the date shown; confirm price, stock and "
              "dimensions with the retailer before purchase. Not an endorsement of any product.")
COLUMNS = ["retailer", "brand", "title", "sku", "qty", "unit_price_aud", "line_total_aud",
           "price_as_at", "url"]


def _d(v: Any) -> str:
    return v.date().isoformat() if isinstance(v, datetime) else (str(v)[:10] if v else "")


def build_lines(rows: Iterable[Mapping[str, Any]]) -> list[dict]:
    """rows: one per placed item (joined to its catalogue item). Grouped by catalogue item."""
    grouped: "OrderedDict[Any, dict]" = OrderedDict()
    for r in rows:
        key = r.get("catalogue_item_id") or (r["retailer"], r["source_url"])
        g = grouped.get(key)
        if g is None:
            price = r.get("price_aud")
            price = float(price) if price is not None else None
            grouped[key] = g = {"retailer": r["retailer"], "brand": r.get("brand") or "", "title": r["title"],
                                "sku": r.get("sku") or "", "qty": 0, "unit_price_aud": price,
                                "price_as_at": _d(r.get("price_captured_at")), "url": r["source_url"]}
        g["qty"] += 1
    for g in grouped.values():
        g["line_total_aud"] = round(g["unit_price_aud"] * g["qty"], 2) if g["unit_price_aud"] is not None else None
    return sorted(grouped.values(), key=lambda g: (g["retailer"], g["title"]))


def total(lines: list[dict]) -> tuple[float, int]:
    """(sum of priced lines, number of lines with no price)."""
    return (round(sum(l["line_total_aud"] for l in lines if l["line_total_aud"] is not None), 2),
            sum(1 for l in lines if l["line_total_aud"] is None))


def to_json(lines: list[dict], generated_at: datetime) -> str:
    t, unpriced = total(lines)
    return json.dumps({"generated_at": generated_at.isoformat(), "currency": "AUD", "lines": lines,
                       "total_priced_aud": t, "unpriced_lines": unpriced, "disclaimer": DISCLAIMER}, indent=2)


def to_csv(lines: list[dict], generated_at: datetime) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(COLUMNS)
    for l in lines:
        w.writerow([_safe(l[c]) if l[c] is not None else "" for c in COLUMNS])
    t, unpriced = total(lines)
    w.writerow([])
    w.writerow(["TOTAL (priced lines)", "", "", "", sum(l["qty"] for l in lines), "", t, "", ""])
    w.writerow([f"Generated {generated_at.date().isoformat()}. {DISCLAIMER}"
                + (f" {unpriced} line(s) have no price." if unpriced else "")])
    return buf.getvalue()


def _safe(v: Any) -> Any:
    """Neutralise spreadsheet formula injection from scraped text."""
    return "'" + v if isinstance(v, str) and v[:1] in ("=", "+", "-", "@") else v
