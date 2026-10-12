from __future__ import annotations

import json
from dataclasses import dataclass, field

from shapely.geometry import MultiPolygon, shape

from .clients import ArcGISClient, LayerConfig
from .geometry import as_multi, to_mga
from .models import Overlay, ZoneShare

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


def load_zone_features(cfg: ZoningConfig, client: ArcGISClient, lot_gda, snapshots: list) -> list:
    if cfg.geojson_path:
        with open(cfg.geojson_path) as f:
            feats = json.load(f).get("features", [])
        return [x for x in feats if x.get("geometry") and shape(x["geometry"]).intersects(lot_gda)]
    if cfg.layer is None:
        return []
    minx, miny, maxx, maxy = lot_gda.bounds
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
                continue
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
        a[2].append(ov)
    out = []
    for (code, inst), (area, name, parts) in acc.items():
        frac = area / total
        if frac < min_frac:
            continue
        from shapely.ops import unary_union
        out.append(ZoneShare(zone_code=code, zone_name=name, instrument=inst,
                             is_residential=is_residential(code, jurisdiction),
                             overlap_area_m2=round(area, 3), overlap_fraction=round(min(frac, 1.0), 5),
                             is_dominant=False))
    out.sort(key=lambda z: -z.overlap_area_m2)
    if out:
        out[0] = out[0].model_copy(update={"is_dominant": True})
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
