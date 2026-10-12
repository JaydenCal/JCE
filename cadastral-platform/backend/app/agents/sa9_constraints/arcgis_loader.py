"""ArcGisLayerLoader: SA9 LayerLoader over ArcGIS REST MapServer/FeatureServer layers.
Lot bbox (MGA metres) -> envelope in GDA2020 (7844) -> paged query -> esri rings -> shapely -> MGA metres.
The exact intersect against the lot is done by intersect.check_layer (shapely). Nothing is invented: any HTTP/JSON
error after retries raises, so the layer is reported 'not_checked'."""
from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Callable

import requests
from pyproj import Transformer
from shapely.geometry import Polygon
from shapely.ops import transform as shp_transform, unary_union

from app.agents.sa9_constraints.intersect import Feature, LayerData
from app.agents.sa9_constraints.layers import LayerType

Getter = Callable[[str, dict], dict]


def _http_get(url: str, params: dict, timeout: float = 40.0) -> dict:
    r = requests.get(url, params=params, timeout=timeout)
    r.raise_for_status()
    return r.json()


def esri_to_shapely(g: dict):
    """Esri polygon JSON (rings; clockwise = exterior) -> shapely geometry (holes subtracted)."""
    outer, holes = [], []
    for ring in g.get("rings", []):
        if len(ring) < 4:
            continue
        a = sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1])) / 2
        (outer if a < 0 else holes).append(Polygon(ring).buffer(0))
    if not outer:
        outer, holes = holes, []
    geom = unary_union(outer)
    return geom.difference(unary_union(holes)) if holes else geom


def _fmt_date(v) -> str | None:
    if isinstance(v, (int, float)) and v > 0:
        return datetime.fromtimestamp(v / 1000, timezone.utc).strftime("%Y-%m-%d")
    return str(v) if v else None


class ArcGisLayerLoader:
    def __init__(self, srid: int = 7856, getter: Getter | None = None, retries: int = 3, page_size: int = 1000,
                 max_pages: int = 20, sleep: Callable[[float], None] = time.sleep) -> None:
        self.srid, self.get, self.retries, self.page_size, self.max_pages, self.sleep = srid, getter or _http_get, retries, page_size, max_pages, sleep
        self._inv = Transformer.from_crs(srid, 7844, always_xy=True)
        self._fwd = Transformer.from_crs(7844, srid, always_xy=True)

    def _q(self, url: str, params: dict) -> dict:
        err: Exception | None = None
        for i in range(self.retries):
            try:
                d = self.get(url, params)
                if "error" in d:
                    raise RuntimeError(f"ArcGIS error {d['error'].get('code')}: {d['error'].get('message')}")
                return d
            except Exception as e:  # noqa: BLE001
                err = e
                if i + 1 < self.retries:
                    self.sleep(1.5 * (i + 1))
        raise RuntimeError(f"query failed after {self.retries} tries: {type(err).__name__}: {err}")

    def load(self, layer: LayerType, bbox: tuple[float, float, float, float]) -> LayerData:
        x0, y0 = self._inv.transform(bbox[0], bbox[1])
        x1, y1 = self._inv.transform(bbox[2], bbox[3])
        env = {"xmin": min(x0, x1), "ymin": min(y0, y1), "xmax": max(x0, x1), "ymax": max(y0, y1), "spatialReference": {"wkid": 7844}}
        params = {"f": "json", "where": getattr(layer, "where", None) or "1=1", "geometry": json.dumps(env), "geometryType": "esriGeometryEnvelope",
                  "inSR": 7844, "outSR": 7844, "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "returnGeometry": "true",
                  "resultRecordCount": self.page_size}
        url = layer.endpoint.rstrip("/") + "/query"
        feats: list[Feature] = []
        cur: list[str] = []
        for page in range(self.max_pages):
            d = self._q(url, {**params, "resultOffset": page * self.page_size})
            for f in d.get("features", []):
                if not f.get("geometry"):
                    continue
                g = shp_transform(self._fwd.transform, esri_to_shapely(f["geometry"]))
                at = f.get("attributes") or {}
                feats.append(Feature(geometry_wkt=g.wkt, attrs=at))
                for cf in getattr(layer, "currency_fields", ()):
                    if cf in at and _fmt_date(at[cf]):
                        cur.append(_fmt_date(at[cf]))
            if not d.get("exceededTransferLimit"):
                break
        else:
            raise RuntimeError(f"more than {self.max_pages} pages; refusing a truncated result")
        cp = getattr(layer, "copyright", None)
        cur_s = ("source currency " + max(cur) if cur else "currency field not returned") + f"; fetched {datetime.now(timezone.utc):%Y-%m-%d}"
        return LayerData(features=feats, currency=cur_s + (f"; {cp}" if cp else ""))
