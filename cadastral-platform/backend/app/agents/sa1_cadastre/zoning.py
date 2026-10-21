from __future__ import annotations

import json
from dataclasses import dataclass, field

from shapely.geometry import MultiPolygon, shape
from shapely.ops import unary_union

from .clients import ArcGISClient, LayerConfig
from .geometry import as_multi, to_mga
from .models import Overlay, ZonePolygon, ZoneShare

NSW_RESIDENTIAL = {"R1", "R2", "R3", "R4", "R5", "RU5"}  # E-series (E1-E5) are business/employment: not residential
QLD_RESIDENTIAL = {"LDR", "LMR", "MDR", "HDR", "CR", "RR", "RRR", "EMR", "LMDR", "CHDR"}
# EMR = emerging community? kept out of reality-check: only treat listed codes as residential.
QLD_RESIDENTIAL.discard("EMR")


def is_residential(code: str, jurisdiction: str) -> bool:
    c = (code or "").upper().strip()
    return c in (NSW_RESIDENTIAL if jurisdiction == "NSW" else QLD_RESIDENTIAL)


@dataclass
class OverlayLayer:
    overlay_type: str  # flood|bushfire|heritage|...
    layer: LayerConfig
    label_field: str = "NAME"


@dataclass
class ZoningConfig:
    layer: LayerConfig | None = None          # ArcGIS zoning layer
    geojson_path: str | None = None           # local fallback
    code_field: str = "SYM_CODE"
    name_field: str = "LAY_CLASS"
    instrument_field: str = "EPI_NAME"
    overlays: list[OverlayLayer] = field(default_factory=list)
    context_m: float = 250.0                  # zoning polygons are also fetched this far around the lot, for the land zoning map (not used for the zone shares)


def _deg(m: float) -> float:
    return m / 111_000.0                       # metres to degrees of latitude (a query window only, not a measurement)


def load_zone_features(cfg: ZoningConfig, client: ArcGISClient, lot_gda, snapshots: list, context_m: float = 0.0) -> list:
    """Zoning features that meet the lot (``context_m`` = 0) or the lot plus ``context_m`` metres (zones beside the lot, for the zoning map)."""
    area = lot_gda.buffer(_deg(context_m)) if context_m else lot_gda
    if cfg.geojson_path:
        with open(cfg.geojson_path) as f:
            feats = json.load(f).get("features", [])
        return [x for x in feats if x.get("geometry") and shape(x["geometry"]).intersects(area)]
    if cfg.layer is None:
        return []
    minx, miny, maxx, maxy = area.bounds
    r = client.query(cfg.layer, geometry={"xmin": minx, "ymin": miny, "xmax": maxx, "ymax": maxy,
                                          "spatialReference": {"wkid": 7844}}, geometry_type="esriGeometryEnvelope")
    snapshots.append(r.snapshot)
    return r.features


def compute_zones(lot_gda, features, srid: int, jurisdiction: str, cfg: ZoningConfig, min_frac=0.001):
    lot = to_mga(lot_gda, srid)
    total = lot.area
    acc: dict = {}
    for f in features:
        try:
            g = to_mga(shape(f["geometry"]), srid)
            if not g.is_valid:
                # Third-party zoning polygons are often self-intersecting at map-sheet edges.
                # Repair for the overlap calculation only (the lot boundary is never repaired).
                from shapely.validation import make_valid
                g = make_valid(g)
            ov = lot.intersection(g)
        except Exception:  # noqa: BLE001
            continue
        if ov.is_empty or ov.area <= 0:
            continue
        p = f.get("properties") or {}
        code = str(p.get(cfg.code_field) or "").strip()
        key = (code, str(p.get(cfg.instrument_field) or ""))
        a = acc.setdefault(key, [0.0, str(p.get(cfg.name_field) or code), []])
        a[0] += ov.area
        a[2].append(shape(f["geometry"]))
    out = []
    for (code, inst), (area, name, parts) in acc.items():
        frac = area / total
        if frac < min_frac:
            continue
        gz = unary_union(parts)
        gz = gz if isinstance(gz, MultiPolygon) else MultiPolygon([gz]) if gz.geom_type == "Polygon" else MultiPolygon()
        out.append(ZoneShare(zone_code=code, zone_name=name, instrument=inst,
                             is_residential=is_residential(code, jurisdiction),
                             overlap_area_m2=round(area, 3), overlap_fraction=round(min(frac, 1.0), 5),
                             is_dominant=False, geom_wkt_gda2020=gz.wkt))
    out.sort(key=lambda z: -z.overlap_area_m2)
    if out:
        out[0] = out[0].model_copy(update={"is_dominant": True})
    return out


def zone_polygons(lot_gda, features, srid: int, cfg: ZoningConfig, window_m: float) -> list[ZonePolygon]:
    """The zoning polygons that meet a window of ``window_m`` metres around the lot, clipped to it, in MGA metres. Used only to draw the zoning map;
    the zone shares come from ``compute_zones``.  Geometry the service returned invalid is repaired for the clip only; nothing is invented."""
    from shapely.geometry import box
    from shapely.validation import make_valid
    lot = to_mga(lot_gda, srid)
    x0, y0, x1, y1 = lot.bounds
    win = box(x0 - window_m, y0 - window_m, x1 + window_m, y1 + window_m)
    out: list[ZonePolygon] = []
    for f in features:
        try:
            g = to_mga(shape(f["geometry"]), srid)
            if not g.is_valid:
                g = make_valid(g)
            if not g.intersects(win):
                continue
            c = g.intersection(win)
            on = lot.intersection(g).area > 0
        except Exception:  # noqa: BLE001
            continue
        if c.is_empty:
            continue
        p = f.get("properties") or {}
        code = str(p.get(cfg.code_field) or "").strip()
        out.append(ZonePolygon(zone_code=code, zone_name=str(p.get(cfg.name_field) or code), instrument=str(p.get(cfg.instrument_field) or ""),
                               geom_wkt_mga=c.wkt, on_lot=bool(on)))
    return out


def fetch_overlays(cfg: ZoningConfig, client: ArcGISClient, lot_gda, snapshots: list) -> list[Overlay]:
    res = []
    minx, miny, maxx, maxy = lot_gda.bounds
    env = {"xmin": minx, "ymin": miny, "xmax": maxx, "ymax": maxy, "spatialReference": {"wkid": 7844}}
    for ol in cfg.overlays:
        r = client.query(ol.layer, geometry=env, geometry_type="esriGeometryEnvelope")
        snapshots.append(r.snapshot)
        for f in r.features:
            if f.get("geometry") and shape(f["geometry"]).intersects(lot_gda):
                p = f.get("properties") or {}
                res.append(Overlay(overlay_type=ol.overlay_type, overlay_label=str(p.get(ol.label_field) or ol.overlay_type),
                                   attributes=p))
    return res
