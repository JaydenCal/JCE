"""Imagery providers: NSW export (verified), QLD stub (unverified), disk cache, tiling, MGA warp."""
from __future__ import annotations

import hashlib
import io
import json
import math
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Protocol, runtime_checkable

import requests
from PIL import Image

from app.imagery.licence import NSW_LICENCE, QLD_LICENCE, LicenceRecord

MAX_TILE_PX = 2048
NSW_BASE = "https://maps.six.nsw.gov.au/arcgis/rest/services/public"
MGA_SRIDS = {7854, 7855, 7856, 28354, 28355, 28356}
Bbox = tuple[float, float, float, float]


@dataclass
class ImageMeta:
    source: str
    srid: int
    bbox: Bbox
    size_px: tuple[int, int]
    capture_date: str | None = None
    licence: str = ""
    attribution: str = ""
    resolution_m_per_px: float = 0.0
    request_urls: list[str] = field(default_factory=list)
    sha256: str = ""
    warped: bool = False
    cached: bool = False


@dataclass
class ImageResult:
    data: bytes          # PNG/JPEG bytes, north-up in `srid`
    meta: ImageMeta


@runtime_checkable
class ImageryProvider(Protocol):
    name: str
    licence: LicenceRecord

    def fetch(self, bbox: Bbox, srid: int, size_px: tuple[int, int], dpi: int = 96) -> ImageResult: ...


def default_cache_dir() -> Path:
    return Path(os.environ.get("IMAGERY_CACHE_DIR", Path.home() / ".cache" / "cadastral_imagery"))


class _Cache:
    def __init__(self, root: Path | None):
        self.root = Path(root) if root else default_cache_dir()

    def key(self, provider: str, bbox: Bbox, srid: int, size: tuple[int, int]) -> str:
        s = json.dumps([provider, srid, [round(v, 2) for v in bbox], list(size)])
        return hashlib.sha256(s.encode()).hexdigest()[:32]

    def get(self, k: str) -> ImageResult | None:
        try:
            m = json.loads((self.root / f"{k}.json").read_text())
            m["bbox"] = tuple(m["bbox"]); m["size_px"] = tuple(m["size_px"])
            meta = ImageMeta(**m); meta.cached = True
            return ImageResult((self.root / f"{k}.img").read_bytes(), meta)
        except Exception:
            return None

    def put(self, k: str, r: ImageResult) -> None:
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            (self.root / f"{k}.img").write_bytes(r.data)
            (self.root / f"{k}.json").write_text(json.dumps(asdict(r.meta)))
        except OSError:
            pass


def _png(im: Image.Image) -> bytes:
    b = io.BytesIO(); im.convert("RGB").save(b, "PNG"); return b.getvalue()


def tile_grid(size: tuple[int, int], max_px: int = MAX_TILE_PX):
    """Yield (x0, y0, w, h) pixel tiles covering size."""
    for y in range(0, size[1], max_px):
        for x in range(0, size[0], max_px):
            yield x, y, min(max_px, size[0] - x), min(max_px, size[1] - y)


def warp_lonlat_to_mga(src: Image.Image, src_bbox: Bbox, bbox: Bbox, srid: int, size: tuple[int, int]) -> Image.Image:
    """Resample a lon/lat (EPSG:4326, equirectangular) image into a north-up MGA raster."""
    import numpy as np
    from pyproj import Transformer
    t = Transformer.from_crs(srid, 4326, always_xy=True)
    w, h = size
    xs = bbox[0] + (np.arange(w) + 0.5) * (bbox[2] - bbox[0]) / w
    ys = bbox[3] - (np.arange(h) + 0.5) * (bbox[3] - bbox[1]) / h
    gx, gy = np.meshgrid(xs, ys)
    lon, lat = t.transform(gx, gy)
    sw, sh = src.size
    px = ((lon - src_bbox[0]) / (src_bbox[2] - src_bbox[0]) * sw).astype(int).clip(0, sw - 1)
    py = ((src_bbox[3] - lat) / (src_bbox[3] - src_bbox[1]) * sh).astype(int).clip(0, sh - 1)
    return Image.fromarray(np.asarray(src.convert("RGB"))[py, px])


class NswImageryProvider:
    name = "nsw_imagery"
    licence = NSW_LICENCE

    def __init__(self, base_url: str = NSW_BASE, cache_dir: Path | None = None, timeout: float = 30.0,
                 retries: int = 3, session: requests.Session | None = None, max_tile_px: int = MAX_TILE_PX,
                 service: str = "NSW_Imagery"):
        self.base, self.timeout, self.retries, self.max_tile = base_url.rstrip("/"), timeout, retries, max_tile_px
        self.http = session or requests.Session()
        self.cache = _Cache(cache_dir)
        self.service = service
        self._mga_ok: bool | None = None

    # -- http ---------------------------------------------------------------
    def _get(self, url: str, params: dict) -> requests.Response:
        err: Exception | None = None
        for i in range(self.retries):
            try:
                r = self.http.get(url, params=params, timeout=self.timeout)
                if r.status_code == 200:
                    return r
                err = RuntimeError(f"HTTP {r.status_code}")
            except requests.RequestException as e:
                err = e
            time.sleep(min(0.2 * 2 ** i, 2.0) if self.retries > 1 else 0)
        raise RuntimeError(f"imagery request failed: {err}")

    def _export(self, bbox: Bbox, sr: int, size: tuple[int, int]) -> tuple[Image.Image, str]:
        url = f"{self.base}/{self.service}/MapServer/export"
        p = {"bbox": ",".join(f"{v:.6f}" for v in bbox), "bboxSR": sr, "imageSR": sr, "size": f"{size[0]},{size[1]}",
             "format": "jpg", "f": "image"}
        r = self._get(url, p)
        if not r.headers.get("content-type", "").startswith("image"):
            raise RuntimeError(f"non-image response: {r.text[:120]}")
        return Image.open(io.BytesIO(r.content)).convert("RGB"), requests.Request("GET", url, params=p).prepare().url

    # -- capture date -------------------------------------------------------
    def capture_date(self, bbox: Bbox, srid: int) -> str | None:
        """Start date of the best-imagery block at the bbox centre (NSW_Imagery_Dates). None if unavailable."""
        try:
            from pyproj import Transformer
            cx, cy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
            lon, lat = Transformer.from_crs(srid, 4326, always_xy=True).transform(cx, cy) if srid != 4326 else (cx, cy)
            r = self._get(f"{self.base}/NSW_Imagery_Dates/MapServer/0/query",
                          {"geometry": f"{lon},{lat}", "geometryType": "esriGeometryPoint", "inSR": 4326,
                           "outFields": "BlockName,BlockStartDate,Resolution_cm", "returnGeometry": "false",
                           "orderByFields": "BlockStartDate DESC", "f": "json"})
            f = r.json().get("features") or []
            ms = f[0]["attributes"].get("BlockStartDate") if f else None
            return time.strftime("%Y-%m-%d", time.gmtime(ms / 1000)) if ms else None
        except Exception:
            return None

    # -- main ---------------------------------------------------------------
    def fetch(self, bbox: Bbox, srid: int, size_px: tuple[int, int], dpi: int = 96) -> ImageResult:
        k = self.cache.key(self.name, bbox, srid, size_px)
        hit = self.cache.get(k)
        if hit:
            return hit
        urls: list[str] = []
        warped = False
        mosaic = Image.new("RGB", size_px, (255, 255, 255))
        w, h = size_px
        dx, dy = (bbox[2] - bbox[0]) / w, (bbox[3] - bbox[1]) / h
        use_mga = srid in MGA_SRIDS and self._mga_ok is not False
        if use_mga:
            try:
                for x, y, tw, th in tile_grid(size_px, self.max_tile):
                    tb = (bbox[0] + x * dx, bbox[3] - (y + th) * dy, bbox[0] + (x + tw) * dx, bbox[3] - y * dy)
                    im, u = self._export(tb, srid, (tw, th))
                    mosaic.paste(im, (x, y)); urls.append(u)
                self._mga_ok = True
            except Exception:
                if self._mga_ok:      # server previously worked in MGA: a real failure
                    raise
                self._mga_ok, use_mga, urls = False, False, []
        if not use_mga:
            from pyproj import Transformer
            if srid == 4326:
                lb = bbox
            else:
                t = Transformer.from_crs(srid, 4326, always_xy=True)
                pts = [t.transform(x, y) for x, y in ((bbox[0], bbox[1]), (bbox[2], bbox[1]), (bbox[0], bbox[3]), (bbox[2], bbox[3]))]
                lb = (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))
            sw = min(int(w * 1.3) + 8, self.max_tile)
            sh = min(int(sw * (lb[3] - lb[1]) / max(lb[2] - lb[0], 1e-12) * math.cos(math.radians((lb[1] + lb[3]) / 2))) + 8, self.max_tile)
            im, u = self._export(lb, 4326, (sw, sh)); urls.append(u)
            mosaic = im if srid == 4326 and im.size == size_px else (
                im.resize(size_px) if srid == 4326 else warp_lonlat_to_mga(im, lb, bbox, srid, size_px))
            warped = srid != 4326
        data = _png(mosaic)
        meta = ImageMeta(source=self.name, srid=srid, bbox=tuple(bbox), size_px=size_px,
                         capture_date=self.capture_date(bbox, srid), licence=self.licence.line(),
                         attribution=self.licence.attribution, resolution_m_per_px=abs(dx),
                         request_urls=urls, sha256=hashlib.sha256(data).hexdigest(), warped=warped)
        res = ImageResult(data, meta)
        self.cache.put(k, res)
        return res


class QldImageryProvider(NswImageryProvider):
    """UNVERIFIED stub: same ArcGIS export convention against a configurable URL (env QLD_IMAGERY_URL)."""
    name = "qld_imagery"
    licence = QLD_LICENCE

    def __init__(self, base_url: str | None = None, service: str = "", **kw):
        base = base_url or os.environ.get("QLD_IMAGERY_URL")
        if not base:
            raise RuntimeError("QLD imagery URL not configured (set QLD_IMAGERY_URL); endpoint unverified")
        super().__init__(base_url=base, service=service or "", **kw)

    def _export(self, bbox, sr, size):  # base is the full MapServer URL
        url = f"{self.base}/export"
        p = {"bbox": ",".join(f"{v:.6f}" for v in bbox), "bboxSR": sr, "imageSR": sr, "size": f"{size[0]},{size[1]}",
             "format": "jpg", "f": "image"}
        r = self._get(url, p)
        return Image.open(io.BytesIO(r.content)).convert("RGB"), requests.Request("GET", url, params=p).prepare().url

    def capture_date(self, bbox, srid):
        return None


def provider_from_env(jurisdiction: str = "NSW") -> ImageryProvider | None:
    """Opt-in default: IMAGERY_PROVIDER=nsw|auto enables aerials (off by default so offline runs never hit the network)."""
    mode = os.environ.get("IMAGERY_PROVIDER", "").lower()
    if mode in ("nsw", "auto") and jurisdiction.upper() == "NSW":
        return NswImageryProvider()
    if mode in ("qld", "auto") and jurisdiction.upper() == "QLD" and os.environ.get("QLD_IMAGERY_URL"):
        return QldImageryProvider()
    return None
