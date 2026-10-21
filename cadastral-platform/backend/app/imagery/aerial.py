"""Aerial imagery chain for the 3D viewer (stage 3, owner decision D). INFORMATION ONLY: never survey.

Providers are existing ``ImageryProvider`` objects (``NswImageryProvider``: NSW_Imagery MapServer export, metadata confirmed 15/10/2026 with
maxImage 4096 x 4096, JPG/PNG, spatial reference 102100; ``QldImageryProvider``: QLD ImageServer exportImage; ``CachedImagery`` offline fixture).
The chain asks the providers that apply to the lot's state, in order, for the highest resolution image over the lot bbox plus a margin, and returns a
JPEG with its georeference (extent in the scene CRS), the capture date when the service exposes it, and licence / attribution text.  Network access
lives inside the providers (injectable ``requests`` session), so tests use fakes.
"""
from __future__ import annotations

import base64
import io
import math
from dataclasses import dataclass, field, replace

from PIL import Image
from shapely import wkt as _wkt

from app.imagery.provider import ImageryProvider

AERIAL_NOTE = "AERIAL IMAGERY FOR INFORMATION ONLY, TO BE CONFIRMED ON SITE"
CAPTURE_DATE_NOT_STATED = "CAPTURE DATE NOT STATED"
MAX_PX = 4096
MAX_EMBED_BYTES = 1_500_000        # JPEG bytes embedded in a scene bundle
QUALITY_STEPS = (85, 78, 70, 62, 55, 48)
MIN_EMBED_PX = 256


def capture_text(iso: str | None) -> str | None:
    """DD/MM/YYYY from an ISO date, or 'DD/MM/YYYY TO DD/MM/YYYY' from an ISO interval 'a/b'. None when absent or unreadable."""
    from datetime import datetime
    if not iso:
        return None
    try:
        parts = [datetime.fromisoformat(p.strip()[:10]).strftime("%d/%m/%Y") for p in str(iso).split("/")]
    except ValueError:
        return None
    return " TO ".join(parts)


@dataclass
class AerialImage:
    jpeg: bytes
    extent: tuple[float, float, float, float]          # (E min, N min, E max, N max) in `srid`, image is north up
    srid: int
    size_px: tuple[int, int]
    source: str
    licence: str
    attribution: str
    capture_date: str | None                           # DD/MM/YYYY (or an interval); None = CAPTURE DATE NOT STATED
    resolution_m: float | None
    request_urls: list[str] = field(default_factory=list)
    warped: bool = False

    @property
    def capture_label(self) -> str:
        return self.capture_date or CAPTURE_DATE_NOT_STATED

    @property
    def data_uri(self) -> str:
        return "data:image/jpeg;base64," + base64.b64encode(self.jpeg).decode()

    def capped(self, max_bytes: int = MAX_EMBED_BYTES) -> "AerialImage":
        """A copy whose JPEG is at most ``max_bytes`` (about 1.5 MB): JPEG quality is stepped down first, then the pixel size is reduced by 15 percent per
        step and the quality steps are tried again.  The returned ``size_px`` and ``resolution_m`` are those of the image actually embedded."""
        if len(self.jpeg) <= max_bytes:
            return self
        im = Image.open(io.BytesIO(self.jpeg)).convert("RGB")
        best: tuple[bytes, tuple[int, int]] | None = None
        while True:
            for q in QUALITY_STEPS:
                b = io.BytesIO()
                im.save(b, "JPEG", quality=q, optimize=True)
                best = (b.getvalue(), im.size)
                if len(best[0]) <= max_bytes:
                    break
            if len(best[0]) <= max_bytes or min(im.size) <= MIN_EMBED_PX:
                break
            im = im.resize((max(1, round(im.size[0] * 0.85)), max(1, round(im.size[1] * 0.85))), Image.LANCZOS)
        jpg, (w, h) = best
        return replace(self, jpeg=jpg, size_px=(w, h), resolution_m=(self.extent[2] - self.extent[0]) / w if w else None)

    def to_scene(self) -> dict:
        """kwargs for ``SceneRequest.aerial`` (AerialIn): the JPEG is capped at about 1.5 MB (``capped``) and the final pixel size and ground
        resolution of the embedded image are recorded."""
        a = self.capped()
        return {"path": a.data_uri, "extent": a.extent, "attribution": a.attribution, "capture_date": a.capture_date,
                "source": a.source, "licence": a.licence, "resolution_m": a.resolution_m, "size_px": a.size_px}


@dataclass
class AerialOutcome:
    image: AerialImage | None
    attempts: list[dict]


def aerial_bbox(boundary_wkt: str, margin_m: float) -> tuple[float, float, float, float]:
    x0, y0, x1, y1 = _wkt.loads(boundary_wkt).buffer(margin_m).bounds
    return (x0, y0, x1, y1)


def pixel_size(bbox, target_res_m: float, max_px: int = MAX_PX) -> tuple[int, int]:
    """Pixel dimensions for ``target_res_m`` per pixel, coarsened to fit ``max_px`` on the longer side."""
    w, h = (bbox[2] - bbox[0]) / target_res_m, (bbox[3] - bbox[1]) / target_res_m
    k = max(1.0, max(w, h) / max_px)
    return max(1, math.ceil(w / k)), max(1, math.ceil(h / k))


def _jpeg(png_or_jpeg: bytes, quality: int = 85) -> tuple[bytes, tuple[int, int]]:
    im = Image.open(io.BytesIO(png_or_jpeg)).convert("RGB")
    b = io.BytesIO()
    im.save(b, "JPEG", quality=quality, optimize=True)
    return b.getvalue(), im.size


def fetch_aerial(providers: list[tuple[str | None, ImageryProvider]], boundary_wkt: str, srid: int, state: str | None, margin_m: float = 30.0,
                 target_res_m: float = 0.10, max_px: int = MAX_PX) -> AerialOutcome:
    """First provider that applies to ``state`` (a spec state of None applies to every state) and returns an image wins. Every attempt is recorded."""
    bbox = aerial_bbox(boundary_wkt, margin_m)
    size = pixel_size(bbox, target_res_m, max_px)
    attempts: list[dict] = []
    for st, prov in providers:
        name = getattr(prov, "name", type(prov).__name__)
        if st is not None and state is not None and st.upper() != state.upper():
            attempts.append({"provider": name, "outcome": "SKIPPED", "note": f"covers {st} only"})
            continue
        try:
            res = prov.fetch(bbox, srid, size)
            jpg, (w, h) = _jpeg(res.data)
        except Exception as ex:  # noqa: BLE001 - recorded, the chain moves on
            attempts.append({"provider": name, "outcome": "ERROR", "note": f"{type(ex).__name__}: {ex}"})
            continue
        m = res.meta
        attempts.append({"provider": name, "outcome": "USED", "note": f"{w} x {h} px"})
        img = AerialImage(jpeg=jpg, extent=tuple(m.bbox), srid=m.srid, size_px=(w, h), source=m.source, licence=m.licence, attribution=m.attribution,
                          capture_date=capture_text(m.capture_date), resolution_m=(m.bbox[2] - m.bbox[0]) / w if w else None,
                          request_urls=list(m.request_urls), warped=m.warped)
        return AerialOutcome(img, attempts)
    return AerialOutcome(None, attempts)
