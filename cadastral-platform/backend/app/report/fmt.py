"""Formatting helpers: dates, distances, areas, attribute tables. Nothing here prints a raw Python dict."""
from __future__ import annotations

import re
from datetime import date, datetime
from xml.sax.saxutils import escape

_SUB = {"≥": "at least ", "≤": "at most ", "→": "to", "−": "-", "‑": "-", " ": " ", " ": " ", " ": " ", "’": "'", "‘": "'"}


def clean(s) -> str:
    s = "" if s is None else str(s)
    for k, v in _SUB.items():
        s = s.replace(k, v)
    return s


def esc(s) -> str:
    return escape(clean(s))


def parse_date(s) -> date | None:
    if isinstance(s, datetime):
        return s.date()
    if isinstance(s, date):
        return s
    if not s:
        return None
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", str(s))
    if m:
        try:
            return date(int(m[1]), int(m[2]), int(m[3]))
        except ValueError:
            return None
    return None


def hdate(s, default: str = "date not stated") -> str:
    d = parse_date(s)
    return f"{d.day} {d:%b %Y}" if d else default


def hdate_long(s) -> str:
    d = parse_date(s)
    return f"{d.day} {d:%B %Y}" if d else ""


def parse_currency(text: str | None) -> dict:
    """SA9 data_currency string -> {'source': date|None, 'fetched': date|None, 'copyright': str|None, 'raw': str}."""
    out = {"source": None, "fetched": None, "copyright": None, "raw": text or ""}
    if not text:
        return out
    m = re.search(r"source currency (\d{4}-\d{2}-\d{2})", text)
    out["source"] = parse_date(m[1]) if m else None
    m = re.search(r"fetched (\d{4}-\d{2}-\d{2})", text)
    out["fetched"] = parse_date(m[1]) if m else None
    parts = [p.strip() for p in text.split("; ")]
    rest = [p for p in parts if not (p.startswith("source currency") or p.startswith("fetched") or p.startswith("currency field"))]
    out["copyright"] = "; ".join(rest) or None
    return out


def currency_phrase(text: str | None) -> str:
    c = parse_currency(text)
    if not text:
        return "Currency unknown (layer not queried)"
    if c["source"]:
        s = f"Mapping current to {hdate(c['source'])}"
    else:
        s = "Mapping date not published by the service"
    if c["fetched"]:
        s += f"; retrieved {hdate(c['fetched'])}"
    return s


def metres(v: float | None, dp: int = 0) -> str:
    if v is None:
        return "-"
    return f"{v:,.{dp}f} m" if v >= 10 or dp else f"{v:,.1f} m"


def area(v: float | None) -> str:
    if v is None:
        return "-"
    if v >= 10000:
        return f"{v / 10000:,.2f} ha ({v:,.0f} m²)"
    return f"{v:,.0f} m²"


def lot_label(lotplan: str) -> str:
    """'2//DP227508' -> 'Lot 2 DP 227508'."""
    m = re.match(r"^\s*(\w+)\s*/(\w*)/\s*([A-Za-z]+)\s*(\d+)\s*$", lotplan or "")
    if m:
        sec = f" Sec {m[2]}" if m[2] else ""
        return f"Lot {m[1]}{sec} {m[3].upper()} {m[4]}"
    return lotplan or "Lot not stated"


_ATTR_LABEL = {"EPI_NAME": "Planning instrument", "LAY_CLASS": "Map class", "LOT_SIZE": "Lot size value", "FSR": "Floor space ratio",
               "MAX_B_H": "Maximum building height (m)", "Category": "Category code", "d_Category": "Vegetation category",
               "SEPP_NAME": "Policy", "VEG_CAT": "Vegetation category", "ITEM_NAME": "Item", "SIGNIFICANCE": "Significance",
               "HCA_NAME": "Conservation area", "CLASS": "Class", "ASS_CLASS": "Acid sulfate class", "HAZARD": "Hazard",
               "FPL_M_AHD": "Flood planning level (m AHD)", "FLOOD_CATEGORY": "Flood category", "UNITS": "Units"}
_SKIP = {"UNITS", "OBJECTID", "Shape", "SHAPE", "Shape_Area", "Shape_Length"}


def attr_label(k: str) -> str:
    return _ATTR_LABEL.get(k) or re.sub(r"\s+", " ", k.replace("_", " ")).strip().capitalize()


def attr_value(k: str, v, attrs: dict | None = None) -> str:
    if v is None or v == "":
        return "-"
    if k == "LOT_SIZE" and attrs is not None:
        u = attrs.get("UNITS") or ""
        return f"{v:g} {u}".strip()
    if isinstance(v, float):
        return f"{v:g}"
    return clean(v)


def attr_rows(attrs: dict) -> list[tuple[str, str]]:
    rows = []
    for k, v in attrs.items():
        if k in _SKIP or v is None or v == "":
            continue
        rows.append((attr_label(k), attr_value(k, v, attrs)))
    return rows
