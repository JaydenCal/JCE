"""Planning map extracts: one map per zoning control and per mapped constraint, so each statement in the site report and the SoEE can be checked against a map.

What a map shows (JCESITE brand, indicative, AI generated draft):
  * the lot outline (bold), the adjoining lot lines, the layer polygons clipped to the figure extent with a category fill and a label (zone code and the like),
    a legend (with the share of the lot each class covers), a north point, a scale bar, and a source line (dataset or instrument, service and layer, data date,
    retrieval date, and the publisher or copyright statement only where the endpoint metadata records one; otherwise LICENCE NOT RECORDED, CONFIRM ATTRIBUTION);
  * an aerial base only if the run already has an imagery provider.

Honesty rules (all enforced here, none by caller discretion):
  * A layer that was NOT CHECKED gets a panel "MAP NOT AVAILABLE: LAYER NOT CHECKED (NOT CLEAR)", never a blank or clean looking map.
  * Zone geometry is drawn only if the run kept zone polygons. With only a zone attribute the figure says "ZONE POLYGONS NOT AVAILABLE IN THIS RUN; ZONE FROM
    ATTRIBUTE, SIMPLIFIED" and draws no zone boundary.  A multi zone lot is flagged on the figure.
  * A map with no mapped feature says NOT INTERSECTED BY THE DATA LOADED, and hatches any part of the figure that the loaded data does not cover.
  * An offline fixture run says the layer geometry is reconstructed and approximate.  A synthetic demo run is stamped SYNTHETIC DEMO DATA on every figure
    and carries no real provenance.
  * Nothing here holds a requirement value: labels and classes come from the layer attributes.

The same ``draw_block`` draws the block in the report (a flowable) and in the PNG written for the SoEE appendix.
"""
from __future__ import annotations

import io
import re
from dataclasses import dataclass, field, replace
from urllib.parse import urlparse

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import Flowable
from shapely import wkt as _wkt
from shapely.geometry import box
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from app.report import catalogue as CAT
from app.report import figures as FG
from app.report import fmt, theme as T
from app.report.explain import LOAD_MARGIN_M

NOT_CHECKED_PANEL = "MAP NOT AVAILABLE: LAYER NOT CHECKED (NOT CLEAR)"
ZONE_ATTR_BANNER = "ZONE POLYGONS NOT AVAILABLE IN THIS RUN; ZONE FROM ATTRIBUTE, SIMPLIFIED"
LICENCE_NOT_RECORDED = "LICENCE NOT RECORDED, CONFIRM ATTRIBUTION"
NO_FEATURE_BANNER = "NOT INTERSECTED BY THE DATA LOADED: NO MAPPED FEATURE IN THE AREA LOADED"
FIXTURE_BANNER = "OFFLINE FIXTURE: GEOMETRY RECONSTRUCTED, APPROXIMATE"
FIXTURE_RESULT_BANNER = "OFFLINE FIXTURE: RESULT FROM SAVED DATA, NOT LIVE"
DEMO = "SYNTHETIC DEMO DATA"
MAP_CONTEXT_M = 70.0            # metres of context around the lot on each side
MAP_ASPECT = 0.70               # map height as a fraction of the block width
LEGEND_SHARE_MIN = 0.5          # percent of the lot below which a class is described as "less than 1% of the lot"

# Display titles (names of maps, not values). A layer with no entry here is titled "<short name> Map".
MAP_TITLES = {
    "zoning": "Land Zoning Map", "nsw_lot_size_map": "Minimum Lot Size Map", "nsw_height_map": "Height of Buildings Map", "nsw_fsr_map": "Floor Space Ratio Map",
    "nsw_flood": "Flood Planning Map", "nsw_bushfire": "Bush Fire Prone Land Map", "nsw_heritage_item": "Heritage Item Map",
    "nsw_heritage_conservation": "Heritage Conservation Area Map", "nsw_acid_sulfate": "Acid Sulfate Soils Map", "nsw_biodiversity": "Biodiversity Values Map",
    "nsw_riparian": "Riparian Land and Watercourses Map", "nsw_coastal": "Coastal Wetlands Map", "nsw_land_reservation": "Land Reservation Acquisition Map",
    "nsw_airport": "Airport Noise Map", "nsw_mine_subsidence": "Mine Subsidence District Map", "nsw_contamination": "Contaminated Land Map",
    "nsw_transport_corridor": "Road and Rail Corridors Map", "nsw_sepp_area": "State Policy Land Application Map", "nsw_urban_release": "Urban Release Area Map",
}
ORDER = ["zoning", "nsw_lot_size_map", "nsw_height_map", "nsw_fsr_map", "nsw_flood", "nsw_bushfire", "nsw_heritage_item", "nsw_heritage_conservation", "nsw_acid_sulfate",
         "nsw_biodiversity", "nsw_riparian", "nsw_coastal", "nsw_land_reservation", "nsw_airport", "nsw_mine_subsidence", "nsw_contamination",
         "nsw_transport_corridor", "nsw_sepp_area", "nsw_urban_release"]
CONTROL_KEYS = ("nsw_lot_size_map", "nsw_height_map", "nsw_fsr_map")
# Attribute fields tried, in order, for the legend text of a layer (the first non-empty one wins).
LABEL_FIELDS = {
    "nsw_heritage_item": ("H_NAME", "LAY_CLASS"), "nsw_heritage_conservation": ("H_NAME", "LAY_CLASS"), "nsw_acid_sulfate": ("LAY_CLASS", "ASS_CLASS", "CLASS"),
    "nsw_biodiversity": ("BV_Category", "BV_CATEGORY", "Criteria", "LAY_CLASS"), "nsw_coastal": ("LABEL", "MAP_NAME", "LAY_CLASS"),
    "nsw_riparian": ("LAY_CLASS", "LAY_NAME"), "nsw_land_reservation": ("LRA_TYPE", "AUTHORITY", "LAY_CLASS"), "nsw_airport": ("ANEF_CODE", "LAY_NAME", "LAY_CLASS"),
    "nsw_mine_subsidence": ("DISTRICTNAME",), "nsw_urban_release": ("LABEL", "LAY_CLASS"), "nsw_flood": ("LAY_CLASS", "FLOOD_CATEGORY", "HAZARD"),
    "nsw_sepp_area": ("LAY_CLASS", "EPI_NAME"),
}
DEFAULT_LABEL_FIELDS = ("LAY_CLASS", "LAY_NAME", "LABEL", "CATEGORY", "CLASS", "HAZARD", "EPI_NAME", "SEPP_NAME")
LAYER_BASE = {"nsw_flood": "#2f6fb5", "nsw_bushfire": "#d9542c", "nsw_heritage_item": "#8a4fb0", "nsw_heritage_conservation": "#b0609f", "nsw_acid_sulfate": "#a9783c",
              "nsw_biodiversity": "#3f9a52", "nsw_riparian": "#2aa6b8", "nsw_coastal": "#2a8f8a", "nsw_land_reservation": "#c0392b", "nsw_airport": "#6b6fb8",
              "nsw_mine_subsidence": "#7a6a55", "nsw_contamination": "#8c8c2a", "nsw_transport_corridor": "#5d6d7e", "nsw_sepp_area": "#9b7b2f", "nsw_urban_release": "#cc7a29"}
OKABE = ["#e69f00", "#56b4e9", "#009e73", "#d55e00", "#0072b2", "#cc79a7", "#999999", "#f0e442"]
ZONE_BASE = {"R": "#e07b53", "RU": "#6fa75a", "B": "#4a7fc1", "IN": "#8e6bb5", "E": "#2f9c95", "SP": "#a08a6a", "RE": "#3fb36b", "C": "#2b6e4f", "W": "#4fb3d9",
             "MU": "#c9699a"}
RAMP = ["#fff0b3", "#ffd166", "#f4a259", "#e07b53", "#b5523b", "#7a2e2a"]   # light to dark, for ordered values (lot size, floor space ratio, height)
CHIP_KIND = {"affected": "affected", "nearby": "nearby", "clear": "clear", "notmapped": "clear", "mapped": "mapped", "unchecked": "unchecked"}


# ------------------------------------------------------------------------------------------------------------------ zone data plumbing
def zone_map_from_sa1(sa1) -> dict:
    """JSON safe zone data for the land zoning map, taken from an Sa1Result: polygons (MGA metres) and their source, or none.
    The zone polygons are kept by SA1 for every live run; the offline fixture keeps only a simplified zone attribute, which gives no polygons."""
    src = getattr(sa1, "zone_source", None)
    polys = [{"code": p.zone_code, "name": p.zone_name, "instrument": p.instrument, "wkt": p.geom_wkt_mga, "on_lot": p.on_lot} for p in getattr(sa1, "zone_polygons", []) or []]
    win = (getattr(sa1, "attributes", {}) or {}).get("zone_window_m")
    cov = None
    try:
        if win is not None:
            b = _wkt.loads(sa1.lot.boundary_wkt).bounds
            cov = [b[0] - win, b[1] - win, b[2] + win, b[3] + win]
    except Exception:  # noqa: BLE001
        cov = None
    return {
        "polygons": polys, "coverage": cov,
        "source": ({"provider": src.provider, "layer_name": src.layer_name, "service_url": src.service_url, "attribution": src.attribution,
                    "fetched_at": src.fetched_at.isoformat()} if src is not None else None),
        "zones_on_lot": [{"code": z.zone_code, "name": z.zone_name, "instrument": z.instrument, "pct": round(100 * z.overlap_fraction, 1)} for z in sa1.zones],
        "multi_zone": bool(getattr(sa1, "multi_zone", False)), "zone_code": sa1.lot.zone_code,
    }


# ------------------------------------------------------------------------------------------------------------------ colours and categories
def _mix(h: str, t: float, to: str = "#ffffff") -> str:
    a, b = colors.HexColor(h), colors.HexColor(to)
    return "#%02x%02x%02x" % tuple(int(round(255 * (x + (y - x) * t))) for x, y in ((a.red, b.red), (a.green, b.green), (a.blue, b.blue)))


def _stroke(fill: str) -> str:
    return _mix(fill, 0.45, "#000000")


def _num(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def category_of(key: str, a: dict) -> tuple[str, str, float]:
    """(legend text, short tag, sort value) for one feature of a layer, from its attributes only."""
    if key == "nsw_lot_size_map":
        v, u, lc = a.get("LOT_SIZE"), str(a.get("UNITS") or ""), a.get("LAY_CLASS")
        if v is None:
            t = fmt.clean(lc or "Mapped class")
            return t, t[:10], 0.0
        if u.lower() == "ha" and lc:
            return f"{fmt.clean(lc)} ha class", f"{fmt.clean(lc)} ha", (_num(v) or 0.0) * 10000.0
        t = f"{v:g} {u}".strip() if isinstance(v, (int, float)) else f"{v} {u}".strip()
        return t, t, (_num(v) or 0.0) * (10000.0 if u.lower() == "ha" else 1.0)
    if key == "nsw_fsr_map":
        v = a.get("FSR")
        t = f"{v:g}:1" if isinstance(v, (int, float)) else fmt.clean(a.get("LAY_CLASS") or "Mapped class")
        return t, t, _num(v) or 0.0
    if key == "nsw_height_map":
        v = a.get("MAX_B_H") if a.get("MAX_B_H") is not None else a.get("MAX_B_H_M")
        t = f"{v:g} m" if isinstance(v, (int, float)) else fmt.clean(a.get("LAY_CLASS") or "Mapped class")
        return t, t, _num(v) or 0.0
    if key in ("nsw_bushfire", "qld_bushfire"):
        t = a.get("d_Category") or (f"Category {a['Category']}" if a.get("Category") is not None else "Mapped vegetation")
        t = fmt.clean(t)
        short = "Buffer" if "buffer" in t.lower() else (re.sub(r"(?i)vegetation\s+category\s*", "Cat ", t) if re.search(r"(?i)category", t) else t[:10])
        return t, short, 0.0
    for fld in LABEL_FIELDS.get(key, DEFAULT_LABEL_FIELDS):
        if a.get(fld) not in (None, ""):
            t = fmt.clean(a[fld] if not isinstance(a[fld], float) else f"{a[fld]:g}")
            return t, (t if len(t) <= 26 else t[:25].rstrip() + "."), 0.0
    return "Mapped area", "", 0.0


def category_colours(key: str, cats: list[tuple[str, float]]) -> dict[str, str]:
    """Fill colour for each category label of a layer. Ordered values (lot size, FSR, height) take a light to dark ramp; bushfire takes fixed
    category colours; every other layer takes one base colour lightened for each further class."""
    labels = [c for c, _ in cats]
    out: dict[str, str] = {}
    if key in CONTROL_KEYS:
        srt = sorted(cats, key=lambda c: (c[1], c[0]))
        n = len(srt)
        for i, (lab, _) in enumerate(srt):
            out[lab] = RAMP[0] if n == 1 else RAMP[round(i * (len(RAMP) - 1) / (n - 1))]
        return out
    if key in ("nsw_bushfire", "qld_bushfire"):
        for lab in labels:
            low = lab.lower()
            out[lab] = ("#f6d7a8" if "buffer" in low else "#b3261e" if re.search(r"\b1\b", low) else "#e8742c" if re.search(r"\b2\b", low) else "#f2b933" if re.search(r"\b3\b", low)
                        else OKABE[len(out) % len(OKABE)])
        return out
    base = LAYER_BASE.get(key)
    for i, lab in enumerate(sorted(labels)):
        out[lab] = _mix(base, min(0.55, 0.22 * i)) if base else OKABE[i % len(OKABE)]
    return out


def zone_colours(codes: list[str]) -> dict[str, str]:
    out, seen = {}, {}
    for c in sorted(set(codes)):
        fam = (re.match(r"[A-Za-z]+", c or "") or [""])[0].upper()
        i = seen.get(fam, 0)
        seen[fam] = i + 1
        out[c] = _mix(ZONE_BASE.get(fam, "#8a8f98"), min(0.6, 0.2 * i))
    return out


# ------------------------------------------------------------------------------------------------------------------ model
@dataclass
class LegendItem:
    label: str
    fill: str | None = None
    stroke: str = "#1e2024"
    kind: str = "poly"              # poly | lot | adjoining | ring | hatch | none


@dataclass
class PlanMap:
    key: str
    title: str
    number: int
    state: str                      # map | no_features | not_checked | attribute_only | no_geometry
    chip: str                       # short result words shown in the header strip
    chip_kind: str
    fig: FG.MapFigure | None
    legend: list[LegendItem] = field(default_factory=list)
    banners: list[tuple[str, str]] = field(default_factory=list)       # (text, kind) kind: warn | info
    source: str = ""
    panel: list[str] = field(default_factory=list)                     # panel text lines (states without a map)
    on_lot: list[tuple[str, float]] = field(default_factory=list)      # (class label, percent of the lot) for classes that overlap the lot
    summary: str = ""                                                  # one sentence for the caption
    aerial: bool = False
    synthetic: bool = False

    @property
    def extent_text(self) -> str:
        return self.fig.extent_text if self.fig else ""

    def record(self, png: str | None) -> dict:
        return {"key": self.key, "figure": self.number, "title": self.title, "state": self.state, "result": self.chip, "summary": self.summary, "source": self.source,
                "banners": [b[0] for b in self.banners], "legend": [i.label for i in self.legend], "on_lot": [{"class": c, "pct_of_lot": p} for c, p in self.on_lot],
                "aerial": self.aerial, "synthetic": self.synthetic, "extent": self.extent_text, "png": png}


def map_title(key: str, short: str = "") -> str:
    return MAP_TITLES.get(key) or (f"{short} Map" if short else "Planning Map")


# ------------------------------------------------------------------------------------------------------------------ source lines
def _service_path(url: str) -> str:
    p = urlparse(url or "").path
    m = re.search(r"/rest/services/(.+)$", p)
    return m[1] if m else p.strip("/")


def _licence_text(copyright_: str | None, attribution: str | None) -> str:
    bits = []
    if copyright_ and copyright_.strip():
        bits.append("Copyright statement as recorded (shortened): " + fmt.shorten_quote(copyright_.strip(), 150))
    if attribution and attribution.strip():
        bits.append("Attribution as recorded: " + fmt.clean(attribution.strip()))
    if not (copyright_ and copyright_.strip()):
        bits.append(LICENCE_NOT_RECORDED)
    return ". ".join(b.rstrip(".\u2026") if not b.endswith("\u2026") else b for b in bits) + "."


def layer_source_line(f, instruments: list[str], demo: bool) -> str:
    """Dataset or instrument, service and layer, data date, retrieval date and licence text, all from the layer's own metadata and run data."""
    if demo:
        return "Source: SYNTHETIC DEMO DATA. Not from any real service. No real dataset, date or licence applies."
    m = f.meta or {}
    cur = fmt.parse_currency(f.currency_raw)
    ds = m.get("layer_name")
    svc = m.get("service")
    parts = []
    if ds or svc:
        parts.append(f"Dataset: {fmt.clean(ds or 'name not recorded')}" + (f" (instrument: {'; '.join(instruments)})" if instruments else ""))
        parts.append(f"service {fmt.clean(svc or 'not recorded')}" + (f", layer {m['layer_id']}" if m.get("layer_id") not in (None, "") else ""))
    else:
        parts.append("Dataset: no data service is recorded for this layer in the platform")
    if f.status == "unchecked":
        parts.append("NO DATA RETRIEVED (layer not checked)")
    else:
        parts.append(("data date " + fmt.hdate(cur["source"])) if cur["source"] else "data date not published by the service")
        parts.append(("retrieved " + fmt.hdate(cur["fetched"])) if cur["fetched"] else "RETRIEVAL DATE NOT RECORDED")
    return "Source: " + "; ".join(parts) + ". " + _licence_text(m.get("copyright"), None)


# ------------------------------------------------------------------------------------------------------------------ building the maps
def _geom(w: str) -> BaseGeometry | None:
    try:
        g = _wkt.loads(w)
        return None if g.is_empty else g
    except Exception:  # noqa: BLE001
        return None


def _valid(g: BaseGeometry) -> BaseGeometry:
    return g if g.is_valid else g.buffer(0)


def layer_features(r) -> tuple[list[tuple[BaseGeometry, dict]], bool]:
    """(features, partial). All features in the search window when the run kept them; otherwise only the ones that intersect the lot or lie inside the
    screening distance (older results), with ``partial`` True."""
    if r is None:
        return [], False
    out = []
    if getattr(r, "map_features", None):
        for mf in r.map_features:
            g = _geom(mf.geometry_wkt)
            if g is not None:
                out.append((g, dict(mf.attrs)))
        return out, False
    for i, w in enumerate(r.geometries_wkt or []):
        g = _geom(w)
        if g is not None:
            out.append((g, dict(r.attributes[i]) if i < len(r.attributes) else {}))
    return out, bool(out) or r.status == "affected"


def _share(geoms: list[BaseGeometry], lot: BaseGeometry) -> float:
    try:
        u = unary_union([_valid(g) for g in geoms])
        return 100.0 * u.intersection(lot).area / lot.area if lot.area else 0.0
    except Exception:  # noqa: BLE001
        return 0.0


def _share_text(pct: float) -> str:
    return "not on lot" if pct <= 0 else ("less than 1% of lot" if pct < LEGEND_SHARE_MIN else f"{pct:.0f}% of lot")


def _base_figure(inp, lot, imagery, width_pt: float, neighbours, extra=None, ctx_m: float = MAP_CONTEXT_M) -> FG.MapFigure:
    return FG.make_map(lot, ctx_m=ctx_m, width=width_pt, height=width_pt * MAP_ASPECT, srid=inp.srid, imagery=imagery, layers=[], neighbours=neighbours,
                       show_labels=False, compact=True, max_px=1100, extra_extent=extra)


def _aerial_line(base: FG.MapFigure) -> str:
    return (f"Aerial base: {fmt.clean(base.attribution) or 'attribution not recorded'}. Imagery date {fmt.hdate(base.capture_date, 'not published')}."
            if base.image else "No aerial base: this run has no imagery provider.")


def _fixture(inp) -> bool:
    return "offline_fixture" in (inp.meta.get("flags") or [])


def build_plan_maps(inp, findings, lot: BaseGeometry, imagery, *, demo: bool, base_no: int, width_pt: float) -> list[PlanMap]:
    """One PlanMap for the zoning and one for every layer finding, numbered from ``base_no`` in ORDER."""
    base = _base_figure(inp, lot, imagery, width_pt, inp.neighbours)
    aerial_line = _aerial_line(base)
    fixture = _fixture(inp)
    by_key = {f.key: f for f in findings}
    keys = ["zoning"] + [k for k in ORDER if k != "zoning" and k in by_key] + [f.key for f in findings if f.key not in ORDER]
    keys = [k for k in keys if k == "zoning" or by_key[k].status != "unchecked"] + [k for k in keys if k != "zoning" and by_key[k].status == "unchecked"]   # short panels last: they pair up and leave no half empty page
    maps: list[PlanMap] = []
    for i, key in enumerate(keys):
        n = base_no + i
        pm = _zoning_map(inp, lot, base, n, aerial_line, fixture, demo) if key == "zoning" else _layer_map(inp, by_key[key], lot, base, n, aerial_line, fixture, demo, imagery, width_pt)
        pm.synthetic = demo
        maps.append(pm)
    return maps


NO_FEATURE_FLAG = "NO FEATURE IN THE DATA LOADED: NOT A CLEARANCE"


def _figure(base: FG.MapFigure, layers, coverage, ring=None, lot_tag=None, flag=None) -> FG.MapFigure:
    return replace(base, layers=layers, coverage=coverage, buffer_ring=ring, legend=False, note="", lot_tag=lot_tag, compact=True, flag=flag)


def _legend_tail(base: FG.MapFigure, ring_label: str | None, hatch: bool) -> list[LegendItem]:
    out = [LegendItem("Lot boundary (subject lot)", None, FG.YELLOW if base.image else "#1e2024", "lot")]
    if base.neighbours:
        out.append(LegendItem("Adjoining lots", None, "#ffffff" if base.image else "#8d8a80", "adjoining"))
    if ring_label:
        out.append(LegendItem(ring_label, None, "#ffb347" if base.image else "#b4601a", "ring"))
    if hatch:
        out.append(LegendItem("No data loaded beyond this area", None, "#737373", "hatch"))
    return out


def _coverage_for(window, cov) -> tuple[float, float, float, float] | None:
    return tuple(cov) if cov else None


def _panel_map(key, title, n, state, chip, ck, lines, source, aerial_line, banners=()) -> PlanMap:
    return PlanMap(key, title, n, state, chip, ck, None, [], list(banners), source, lines, [], "", False)


def _zoning_map(inp, lot, base, n, aerial_line, fixture, demo) -> PlanMap:
    title = MAP_TITLES["zoning"]
    zm = inp.zone_map or {}
    polys = zm.get("polygons") or []
    zone_attr = inp.meta.get("zone_code") or zm.get("zone_code")
    flags = inp.meta.get("flags") or []
    src = zm.get("source") or {}
    if demo:
        source = "Source: SYNTHETIC DEMO DATA. Not from any real service. No real dataset, date or licence applies."
    elif src:
        insts = sorted({p.get("instrument") for p in polys if p.get("instrument")})
        fetched = fmt.hdate(src.get("fetched_at"), "RETRIEVAL DATE NOT RECORDED")
        source = (f"Source: Dataset: {fmt.clean(src.get('layer_name') or 'name not recorded')}" + (f" (instrument: {'; '.join(map(fmt.clean, insts))})" if insts else "")
                  + f"; service {fmt.clean(_service_path(src.get('service_url', '')) or 'not recorded')}; data date not published by the service; retrieved {fetched}. "
                  + _licence_text(None, src.get("attribution")))
    else:
        source = ("Source: zone attribute returned with the lot record in this run. No zoning service snapshot is recorded, so the dataset, service, data date and "
                  f"retrieval date are NOT RECORDED. {LICENCE_NOT_RECORDED}.")
    if polys:
        cats: dict[str, dict] = {}
        for p in polys:
            g = _geom(p["wkt"])
            if g is None:
                continue
            c = cats.setdefault(p["code"] or "?", {"name": p.get("name") or "", "geoms": []})
            c["geoms"].append(g)
        cols = zone_colours(list(cats))
        layers, legend, on_lot = [], [], []
        for code in sorted(cats):
            c = cats[code]
            pct = _share(c["geoms"], lot)
            name = c["name"] if c["name"] and not c["name"].upper().startswith(code.upper()) else ""
            text = fmt.clean(f"{code} {name}".strip())
            fill = cols[code]
            layers.append(FG.Layer(text, c["geoms"], _stroke(fill), fill, 0.5, tag=code))
            legend.append(LegendItem(f"{text} ({_share_text(pct)})", fill, _stroke(fill), "poly"))
            if pct > 0:
                on_lot.append((text, round(pct, 1)))
        cov = zm.get("coverage")
        fig = _figure(base, layers, _coverage_for(base.window, cov))
        banners = []
        multi = bool(zm.get("multi_zone")) or len(on_lot) > 1
        if multi:
            banners.append(("MULTI-ZONE LOT: the lot touches more than one zone (" + "; ".join(f"{t}, {p:.0f}%" for t, p in on_lot) + "). Confirm which controls apply.", "warn"))
        if not on_lot:
            banners.append(("NO ZONE POLYGON OVERLAPS THE LOT IN THE DATA RETURNED. The zone for the lot is UNRESOLVED on this map.", "warn"))
        if fixture:
            banners.append((FIXTURE_BANNER, "warn"))
        legend += _legend_tail(base, None, bool(fig.coverage and _outside(fig)))
        sent = ("On the lot: " + "; ".join(f"{t} ({p:.0f}% of the lot)" for t, p in on_lot) + ".") if on_lot else "No zone polygon overlaps the lot in the data returned."
        chip = "Multi-zone" if multi else ("Zone " + (on_lot[0][0].split(" ")[0] if on_lot else "unresolved"))
        return PlanMap("zoning", title, n, "map", chip, "affected" if multi else "mapped", fig, legend, banners, source + " " + aerial_line, [], on_lot, sent, bool(base.image))
    if zone_attr:
        fig = _figure(base, [], None, lot_tag=f"{zone_attr} (attribute)")
        banners = [(ZONE_ATTR_BANNER, "warn")]
        if "multi_zone_in_saved_live_run" in flags or zm.get("multi_zone"):
            banners.append(("MULTI-ZONE POSSIBLE: the saved live run flagged this lot as possibly multi-zone. This run holds one simplified zone attribute. Confirm the zones with the council.", "warn"))
        if fixture:
            banners.append((FIXTURE_RESULT_BANNER, "warn"))
        legend = [LegendItem(f"Zone attribute for the lot: {zone_attr} (no zone boundary drawn)", None, "#1e2024", "none")] + _legend_tail(base, None, False)
        return PlanMap("zoning", title, n, "attribute_only", "Zone from attribute", "unchecked", fig, legend, banners, source + " " + aerial_line, [], [],
                       f"Zone attribute {zone_attr} only (simplified). No zone boundary is drawn.", bool(base.image))
    lines = [NOT_CHECKED_PANEL, "No zoning data was returned for this lot in this run" + (" (flag: no zoning data)" if "no_zoning_data" in flags else "") + ".",
             "The zone of the lot is UNRESOLVED. Not checked is not clear. Confirm the zone with a section 10.7 planning certificate."]
    return PlanMap("zoning", title, n, "not_checked", "Not checked", "unchecked", None, [], [], "Source: no zoning data retrieved in this run. " + LICENCE_NOT_RECORDED + ".",
                   lines, [], f"{NOT_CHECKED_PANEL}.", False)


def _outside(fig: FG.MapFigure) -> bool:
    cx0, cy0, cx1, cy1 = fig.coverage
    x0, y0, x1, y1 = fig.window
    return not (cx0 <= x0 and cy0 <= y0 and cx1 >= x1 and cy1 >= y1)


def _layer_map(inp, f, lot, base, n, aerial_line, fixture, demo, imagery=None, width_pt: float = 0.0) -> PlanMap:
    title = map_title(f.key, f.short)
    chip, ck = f.chip, CHIP_KIND.get(f.status, "unchecked")
    if f.status == "unchecked":
        lines = [NOT_CHECKED_PANEL, f"{f.short}. {f.why_unchecked or 'The layer was not queried in this run.'}",
                 "The lot may be affected. Not checked is not clear. " + (f.action or "Check with the council.")]
        return PlanMap(f.key, title, n, "not_checked", chip, ck, None, [], [], layer_source_line(f, [], demo), lines, [],
                       f"{NOT_CHECKED_PANEL}. {f.why_unchecked}".strip(), False)
    feats, partial = layer_features(f.result)
    r = f.result
    cov = tuple(r.map_window) if (r is not None and r.map_window) else (lot.bounds[0] - LOAD_MARGIN_M, lot.bounds[1] - LOAD_MARGIN_M,
                                                                        lot.bounds[2] + LOAD_MARGIN_M, lot.bounds[3] + LOAD_MARGIN_M)
    ring = (lot.buffer(f.buffer_m), f"{f.buffer_m:g} m screening distance") if f.buffer_m else None
    ring_label = ring[1] if ring else None
    insts = sorted({str(a.get("EPI_NAME")) for _, a in feats if a.get("EPI_NAME")})
    source = layer_source_line(f, [fmt.clean(i) for i in insts], demo) + " " + aerial_line
    if not feats:
        if f.status in ("affected", "nearby", "mapped"):
            lines = ["MAP NOT AVAILABLE: GEOMETRY NOT KEPT FOR THIS RUN", f"The layer reports a mapped feature for the lot ({f.chip.upper()}) but no geometry was kept, so it cannot be drawn.",
                     "Re-run the constraint check to draw this map. The result stands as reported."]
            return PlanMap(f.key, title, n, "no_geometry", chip, ck, None, [], [], source, lines, [], "MAP NOT AVAILABLE: GEOMETRY NOT KEPT FOR THIS RUN.", False)
        fig = _figure(base, [], cov, ring, flag=NO_FEATURE_FLAG)
        banners = [(NO_FEATURE_BANNER, "info")] + ([(FIXTURE_RESULT_BANNER, "warn")] if fixture else []) + ([("Limit of this layer: " + fmt.clean(f.caveat), "limit")] if f.caveat else [])
        legend = [LegendItem("No mapped feature of this layer in the area loaded", None, "#737373", "none")] + _legend_tail(base, ring_label, _outside(fig))
        sent = "NOT INTERSECTED BY THE DATA LOADED: no mapped feature in the area loaded around the lot."
        return PlanMap(f.key, title, n, "no_features", chip, ck, fig, legend, banners, source, [], [], sent, bool(base.image))
    if feats and not any(g.intersects(box(*base.window)) for g, _ in feats) and width_pt:
        # every mapped feature lies beyond the standard extent: widen the extent to take in the nearest one (a map that hides its feature reads as clear)
        near = min((g for g, _ in feats), key=lambda g: lot.distance(g))
        part = near.intersection(box(*cov)) if near.intersects(box(*cov)) else near
        try:
            wide = _base_figure(inp, lot, imagery, width_pt, inp.neighbours, extra=[part if not part.is_empty else near], ctx_m=MAP_CONTEXT_M * 0.8)
            base = wide
            aerial_line = _aerial_line(wide)
            source = layer_source_line(f, [fmt.clean(i) for i in insts], demo) + " " + aerial_line
        except Exception:  # noqa: BLE001
            pass
    cats: dict[str, dict] = {}
    for g, a in feats:
        lab, tag, srt = category_of(f.key, a)
        c = cats.setdefault(lab, {"tag": tag, "sort": srt, "geoms": []})
        c["geoms"].append(g)
    cols = category_colours(f.key, [(k, v["sort"]) for k, v in cats.items()])
    order = sorted(cats, key=lambda k: (cats[k]["sort"], k)) if f.key in CONTROL_KEYS else sorted(cats)
    layers, legend, on_lot = [], [], []
    for lab in order:
        c = cats[lab]
        pct = _share(c["geoms"], lot)
        fill = cols[lab]
        layers.append(FG.Layer(lab, c["geoms"], _stroke(fill), fill, 0.5, tag=c["tag"] or None))
        legend.append(LegendItem(f"{lab} ({_share_text(pct)})", fill, _stroke(fill), "poly"))
        if pct > 0:
            on_lot.append((lab, round(pct, 1)))
    fig = _figure(base, layers, cov, ring)
    banners: list[tuple[str, str]] = []
    if f.key in CONTROL_KEYS and len(on_lot) > 1:
        banners.append(("MORE THAN ONE MAPPED CLASS ON THE LOT (" + "; ".join(f"{t}, {p:.0f}%" for t, p in on_lot) + "). Confirm which applies with the council.", "warn"))
    visible = [g for g, _ in feats if g.intersects(box(*base.window))]
    if not visible:
        banners.append(("MAPPED FEATURES LIE IN THE AREA LOADED BUT OUTSIDE THIS FIGURE EXTENT", "info"))
    if partial:
        banners.append(("ONLY FEATURES THAT INTERSECT THE LOT OR LIE INSIDE THE SCREENING DISTANCE WERE KEPT IN THIS RUN", "info"))
    if r is not None and getattr(r, "map_features_truncated", False):
        banners.append(("FEATURE LIST TRUNCATED: ONLY THE FIRST FEATURES ARE DRAWN", "warn"))
    if fixture:
        banners.append((FIXTURE_BANNER, "warn"))
    if f.caveat:
        banners.append(("Limit of this layer: " + fmt.clean(f.caveat), "limit"))
    legend += _legend_tail(base, ring_label, _outside(fig))
    if on_lot:
        sent = "On the lot: " + "; ".join(f"{t} ({p:.0f}% of the lot)" for t, p in on_lot) + "."
    elif f.status == "nearby":
        sent = "No mapped polygon overlaps the lot. The polygons shown lie inside the screening distance (WITHIN BUFFER)."
    else:
        sent = "No mapped polygon overlaps the lot."
    return PlanMap(f.key, title, n, "map", chip, ck, fig, legend, banners, source, [], on_lot, sent, bool(base.image))


# ------------------------------------------------------------------------------------------------------------------ drawing
PANEL_H = 30 * mm
HEAD_H = 15.0
F_SRC, F_LEG, F_BAN = 5.4, 5.8, 5.4
MONO, MONO_B, PLEX, JOST_B = "Mono", "Mono-Medium", "Plex", "Jost-Bold"


def _kind_cols(kind: str):
    return {"warn": ("#a63a2b", "#fbeeea"), "limit": ("#4a4d54", "#f4f3ef")}.get(kind, ("#2f2f33", "#ecebe6"))


def _layout(pm: PlanMap, W: float) -> dict:
    T.register_fonts()
    inner = W - 8
    lay: dict = {"map_h": (pm.fig.height if pm.fig else PANEL_H * 0.9 + (13 if pm.synthetic else 0))}
    ban = []
    for text, kind in pm.banners:
        font, size = (PLEX, F_BAN + 0.5) if kind == "limit" else (MONO_B, F_BAN)
        lines = simpleSplit(fmt.clean(text), font, size, inner - 6)
        ban.append((lines, kind, len(lines) * (size + 1.8) + 4))
    lay["banners"] = ban
    lay["ban_h"] = sum(b[2] for b in ban) + (2 if ban else 0)
    items = pm.legend
    wide = max((stringWidth(fmt.clean(i.label), PLEX, F_LEG) for i in items), default=0) + 24
    cols = 2 if (len(items) > 3 and wide < inner / 2 - 2) else 1
    lay["cols"], lay["rows"] = cols, -(-len(items) // cols) if items else 0
    lay["leg_h"] = (lay["rows"] * 8.2 + 5) if items else 0
    src = simpleSplit(fmt.clean(pm.source), PLEX, F_SRC, inner)
    lay["src"] = src
    lay["src_h"] = len(src) * (F_SRC + 1.5) + 6
    lay["h"] = HEAD_H + lay["map_h"] + lay["ban_h"] + lay["leg_h"] + lay["src_h"]
    return lay


def block_height(pm: PlanMap, W: float) -> float:
    return _layout(pm, W)["h"]


def draw_block(c, pm: PlanMap, ox: float, oy: float, W: float) -> None:
    lay = _layout(pm, W)
    Ht = lay["h"]
    top = oy + Ht
    c.saveState()
    # frame and header strip
    c.setFillColor(colors.white); c.rect(ox, oy, W, Ht, stroke=0, fill=1)
    c.setFillColor(T.INK); c.rect(ox, top - HEAD_H, W, HEAD_H, stroke=0, fill=1)
    title = fmt.clean(pm.title)
    c.setFillColor(T.PAPER); c.setFont(JOST_B, 7.6); c.drawString(ox + 5, top - 10.4, title)
    chip = fmt.clean(pm.chip).upper()
    fg, bg = T.STATUS_COL.get(pm.chip_kind, T.STATUS_COL["unchecked"])
    cw = stringWidth(chip, MONO_B, 5.2) + 8
    c.setFillColor(colors.HexColor(bg)); c.roundRect(ox + W - cw - 4, top - 12, cw, 9, 2, stroke=0, fill=1)
    c.setFillColor(colors.HexColor(fg)); c.setFont(MONO_B, 5.2); c.drawCentredString(ox + W - cw / 2 - 4, top - 9.2, chip)
    y = top - HEAD_H
    # map or panel
    mh = lay["map_h"]
    if pm.fig is not None:
        FG.draw_map(c, pm.fig, ox, y - mh)
    else:
        c.setFillColor(colors.HexColor("#eceef2")); c.rect(ox, y - mh, W, mh, stroke=0, fill=1)
        c.setStrokeColor(colors.HexColor("#4a5160")); c.setLineWidth(1.4); c.setDash(4, 2.5); c.rect(ox + 5, y - mh + 5, W - 10, mh - 10, stroke=1, fill=0); c.setDash()
        yy = y - 14
        if pm.synthetic:
            c.setFillColor(colors.Color(0.65, 0.23, 0.17, alpha=0.88)); c.rect(ox, y - 12, W, 12, stroke=0, fill=1)
            c.setFillColor(colors.white); c.setFont(MONO_B, 6.6); c.drawString(ox + 5, y - 8.6, DEMO)
            yy = y - 24
        first = True
        for line in pm.panel:
            font, size, col = (JOST_B, 8.4, "#a63a2b") if first else (PLEX, 6.8, "#1e2024")
            for ln in simpleSplit(fmt.clean(line), font, size, W - 24):
                c.setFillColor(colors.HexColor(col)); c.setFont(font, size); c.drawString(ox + 11, yy, ln); yy -= size + 2.6
            yy -= 2.5
            first = False
    y -= mh
    # banners
    if lay["banners"]:
        y -= 1
    for lines, kind, bh in lay["banners"]:
        tc, bgc = _kind_cols(kind)
        c.setFillColor(colors.HexColor(bgc)); c.rect(ox + 4, y - bh, W - 8, bh, stroke=0, fill=1)
        c.setStrokeColor(colors.HexColor(tc)); c.setLineWidth(0.5); c.rect(ox + 4, y - bh, W - 8, bh, stroke=1, fill=0)
        font, size = (PLEX, F_BAN + 0.5) if kind == "limit" else (MONO_B, F_BAN)
        c.setFillColor(colors.HexColor(tc)); c.setFont(font, size)
        ty = y - 2 - size
        for ln in lines:
            c.drawString(ox + 7, ty, ln); ty -= size + 1.8
        y -= bh
    if lay["banners"]:
        y -= 1
    # legend
    cols, rows = lay["cols"], lay["rows"]
    colw = (W - 8) / cols
    for i, it in enumerate(pm.legend):
        col, row = divmod(i, rows) if rows else (0, 0)
        x = ox + 4 + col * colw
        yy = y - 5 - (row + 1) * 8.2 + 5.6
        sw = (x + 1, yy - 0.2, 13, 5.6)
        if it.kind == "poly" and it.fill:
            c.setFillColor(colors.HexColor(it.fill)); c.setFillAlpha(0.6); c.rect(*sw, stroke=0, fill=1); c.setFillAlpha(1)
            c.setStrokeColor(colors.HexColor(it.stroke)); c.setLineWidth(0.7); c.rect(*sw, stroke=1, fill=0)
        elif it.kind == "lot":
            c.setStrokeColor(colors.HexColor("#1e2024")); c.setLineWidth(2.6); c.line(sw[0], yy + 2.8, sw[0] + 13, yy + 2.8)
            c.setStrokeColor(colors.HexColor(it.stroke)); c.setLineWidth(1.5); c.line(sw[0], yy + 2.8, sw[0] + 13, yy + 2.8)
        elif it.kind == "adjoining":
            c.setStrokeColor(colors.HexColor("#8d8a80")); c.setLineWidth(0.7); c.rect(*sw, stroke=1, fill=0)
        elif it.kind == "ring":
            c.setStrokeColor(colors.HexColor(it.stroke)); c.setLineWidth(1.0); c.setDash(2, 1.5); c.rect(*sw, stroke=1, fill=0); c.setDash()
        elif it.kind == "hatch":
            c.saveState(); hp = c.beginPath(); hp.rect(*sw); c.clipPath(hp, stroke=0, fill=0)
            c.setFillColor(colors.Color(0.93, 0.93, 0.92)); c.rect(*sw, stroke=0, fill=1)
            c.setStrokeColor(colors.Color(0.45, 0.45, 0.45)); c.setLineWidth(0.4)
            for k in range(-6, 14, 3):
                c.line(sw[0] + k, sw[1], sw[0] + k + 6, sw[1] + 6)
            c.restoreState()
            c.setStrokeColor(colors.Color(0.45, 0.45, 0.45)); c.setLineWidth(0.5); c.rect(*sw, stroke=1, fill=0)
        else:
            c.setStrokeColor(colors.HexColor("#737373")); c.setLineWidth(0.6); c.setDash(1.5, 1.5); c.rect(*sw, stroke=1, fill=0); c.setDash()
        lab = fmt.clean(it.label)
        maxw = colw - 20
        if stringWidth(lab, PLEX, F_LEG) > maxw:
            while lab and stringWidth(lab + "...", PLEX, F_LEG) > maxw:
                lab = lab[:-1]
            lab = lab.rstrip() + "..."
        c.setFillColor(T.INK); c.setFont(PLEX, F_LEG); c.drawString(x + 17, yy + 0.4, lab)
    y -= lay["leg_h"]
    # source
    c.setStrokeColor(T.RULE); c.setLineWidth(0.5); c.line(ox + 4, y - 1, ox + W - 4, y - 1)
    c.setFillColor(T.MUTED); c.setFont(PLEX, F_SRC)
    ty = y - 3 - F_SRC
    for ln in lay["src"]:
        c.drawString(ox + 4, ty, ln); ty -= F_SRC + 1.5
    c.setStrokeColor(T.INK); c.setLineWidth(0.8); c.rect(ox, oy, W, Ht, stroke=1, fill=0)
    c.restoreState()


class PlanMapBlock(Flowable):
    def __init__(self, pm: PlanMap, width: float):
        super().__init__()
        self.pm, self.width = pm, width
        self.height = block_height(pm, width)

    def wrap(self, aw, ah):
        return self.width, self.height

    def draw(self):
        draw_block(self.canv, self.pm, 0, 0, self.width)


def render_png(pm: PlanMap, width_pt: float, dpi: int = 220) -> bytes:
    """The block as a PNG (the SoEE appendix uses it). Drawn by the same code as the report figure."""
    import pymupdf
    h = block_height(pm, width_pt)
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=(width_pt, h))
    keep, FG.STAMP = FG.STAMP, (DEMO if pm.synthetic else None)      # the figure stamp follows the map, not the last report built
    try:
        draw_block(c, pm, 0, 0, width_pt)
    finally:
        FG.STAMP = keep
    c.showPage(); c.save()
    with pymupdf.open(stream=buf.getvalue(), filetype="pdf") as d:
        return d[0].get_pixmap(dpi=dpi).tobytes("png")


def caption_text(pm: PlanMap, lot_label: str) -> str:
    """Caption text (plain; the caller adds 'Figure n.')."""
    ext = f" Figure extent {pm.extent_text}." if pm.fig else ""
    return f"{pm.title} for {lot_label}. {pm.summary}{ext}"
