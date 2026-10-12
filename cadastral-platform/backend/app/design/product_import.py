"""Import a retailer product page into a catalogue item.

Network access is behind the injectable ``HttpClient`` (tests pass a fake). Honours robots.txt and
a retailer allow-list. Parses schema.org JSON-LD Product first, OpenGraph second, spec text last.
No scraping beyond the single page the user supplied.
"""
from __future__ import annotations

import ipaddress
import json
import os
import re
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Any, Callable, Protocol
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

from app.design.models import CatalogueItemIn, ImportResult

USER_AGENT = "CadastralPlatformBot/0.1 (+product import on user request)"
DEFAULT_ALLOWLIST = ("bunnings.com.au", "ikea.com", "freedom.com.au", "harveynorman.com.au",
                     "kmart.com.au", "temple-webster.com.au", "fantasticfurniture.com.au")
MAX_BYTES = 3_000_000


class ImportError_(Exception):
    def __init__(self, code: str, message: str, status: int = 422) -> None:
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


@dataclass
class HttpResponse:
    status: int
    text: str
    url: str = ""


class HttpClient(Protocol):
    def get(self, url: str) -> HttpResponse: ...


class UrllibClient:
    def __init__(self, timeout: float = 10.0) -> None:
        self.timeout = timeout

    def get(self, url: str) -> HttpResponse:
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*;q=0.5"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:   # noqa: S310 (scheme checked by caller)
                return HttpResponse(r.status, r.read(MAX_BYTES).decode(r.headers.get_content_charset() or "utf-8",
                                                                       "replace"), r.geturl())
        except urllib.error.HTTPError as e:
            return HttpResponse(e.code, "", url)
        except OSError as e:
            raise ImportError_("FETCH_FAILED", f"could not fetch page: {e}", 502) from e


def allowlist_from_env() -> tuple[str, ...]:
    v = os.environ.get("DESIGN_RETAILER_ALLOWLIST")
    return tuple(h.strip().lower() for h in v.split(",") if h.strip()) if v else DEFAULT_ALLOWLIST


# --------------------------------------------------------------------------- HTML parsing

class _Page(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.jsonld: list[str] = []
        self.meta: dict[str, str] = {}
        self.text: list[str] = []
        self._ld = False
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "script":
            if (a.get("type") or "").lower() == "application/ld+json":
                self._ld = True
                self.jsonld.append("")
            else:
                self._skip += 1
        elif tag == "style":
            self._skip += 1
        elif tag == "meta":
            k = a.get("property") or a.get("name") or a.get("itemprop")
            if k and a.get("content") is not None:
                self.meta.setdefault(k.lower(), a["content"])

    def handle_endtag(self, tag):
        if tag == "script":
            if self._ld:
                self._ld = False
            elif self._skip:
                self._skip -= 1
        elif tag == "style" and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if self._ld:
            self.jsonld[-1] += data
        elif not self._skip and data.strip():
            self.text.append(data.strip())


def _walk(node: Any):
    if isinstance(node, list):
        for n in node:
            yield from _walk(n)
    elif isinstance(node, dict):
        yield node
        for k, v in node.items():
            if k != "@context":
                yield from _walk(v)


def _types(n: dict) -> list[str]:
    t = n.get("@type")
    return [t] if isinstance(t, str) else [x for x in t or [] if isinstance(x, str)]


def _num(v: Any) -> float | None:
    try:
        return float(str(v).replace(",", "").replace("$", "").strip())
    except (TypeError, ValueError):
        return None


_UNIT_M = {"mm": 0.001, "mmt": 0.001, "cm": 0.01, "cmt": 0.01, "m": 1.0, "mtr": 1.0, "in": 0.0254,
           "inh": 0.0254, '"': 0.0254}


def _to_m(value: Any, unit: str | None) -> float | None:
    """schema.org QuantitativeValue / 'width' -> metres. A bare number is assumed to be millimetres."""
    if isinstance(value, dict):
        return _to_m(value.get("value"), value.get("unitCode") or value.get("unitText") or unit)
    if isinstance(value, str) and unit is None:
        m = re.match(r"^\s*([\d.,]+)\s*([a-zA-Z\"]*)\s*$", value)
        if not m:
            return None
        value, unit = m.group(1), m.group(2) or None
    n = _num(value)
    if n is None or n <= 0:
        return None
    f = _UNIT_M.get((unit or "mm").strip().lower())
    return round(n * f, 4) if f else None


def _first(v: Any) -> Any:
    return v[0] if isinstance(v, list) and v else v


def _name(v: Any) -> str | None:
    v = _first(v)
    return (v.get("name") if isinstance(v, dict) else v) or None


def _image(v: Any) -> str | None:
    v = _first(v)
    return (v.get("url") or v.get("contentUrl")) if isinstance(v, dict) else v


def _price(offers: Any) -> tuple[float | None, str | None]:
    for o in _walk(offers):
        for key in ("price", "lowPrice"):
            p = _num(o.get(key))
            if p is not None:
                return p, o.get("priceCurrency")
        spec = o.get("priceSpecification")
        if isinstance(spec, dict) and _num(spec.get("price")) is not None:
            return _num(spec["price"]), spec.get("priceCurrency")
    return None, None


_NUM = r"(\d+(?:[.,]\d+)?)"
_LABELLED = {k: re.compile(rf"\b{k}\b\s*[:=(]?\s*{_NUM}\s*(mm|cm|m)\b", re.I)
             for k in ("width", "depth", "height", "length")}
_TRIPLE = re.compile(rf"{_NUM}\s*(mm|cm|m)?\s*[x×X]\s*{_NUM}\s*(mm|cm|m)?\s*[x×X]\s*{_NUM}\s*(mm|cm|m)\b")
_TRIPLE_LABEL = re.compile(r"\(?\b([WDHL])\b\s*[x×/]\s*\b([WDHL])\b\s*[x×/]\s*\b([WDHL])\b", re.I)


def dimensions_from_text(text: str) -> dict[str, float]:
    """Spec text -> {'width_m','depth_m','height_m'} (any subset)."""
    out: dict[str, float] = {}
    for key, rx in _LABELLED.items():
        m = rx.search(text)
        if m:
            out["depth_m" if key == "length" else f"{key}_m"] = round(
                float(m.group(1).replace(",", ".")) * _UNIT_M[m.group(2).lower()], 4)
    if len(out) < 3:
        m = _TRIPLE.search(text)
        if m:
            unit = m.group(6).lower()
            vals = [float(m.group(i).replace(",", ".")) * _UNIT_M[(m.group(i + 1) or unit).lower()]
                    for i in (1, 3, 5)]
            order = ["w", "d", "h"]
            lab = _TRIPLE_LABEL.search(text)
            if lab:
                order = [c.lower() for c in lab.groups()]
            for c, v in zip(order, vals):
                out.setdefault({"w": "width_m", "d": "depth_m", "h": "height_m", "l": "depth_m"}[c], round(v, 4))
    return out


_MODEL_RX = re.compile(r"""["'(=\s]([^"'()\s<>]+?\.(?:glb|gltf)(?:\?[^"'()\s<>]*)?)""", re.I)


def find_model_url(html: str, base: str, ld_nodes: list[dict]) -> str | None:
    for n in ld_nodes:
        if "3DModel" in _types(n):
            u = n.get("contentUrl") or n.get("url")
            if isinstance(u, str) and re.search(r"\.(glb|gltf)(\?|$)", u, re.I):
                return urljoin(base, u)
    m = _MODEL_RX.search(html)
    return urljoin(base, m.group(1).replace("\\/", "/")) if m else None


# --------------------------------------------------------------------------- parsing entry

def parse_product_html(html: str, url: str, now: datetime | None = None) -> ImportResult:
    now = now or datetime.now(timezone.utc)
    pg = _Page()
    pg.feed(html)
    nodes: list[dict] = []
    for blob in pg.jsonld:
        try:
            nodes.extend(_walk(json.loads(blob)))
        except ValueError:
            continue
    prod = next((n for n in nodes if "Product" in _types(n)), None) or {}
    meta, notes = pg.meta, []

    title = prod.get("name") or meta.get("og:title") or meta.get("twitter:title")
    if not title:
        raise ImportError_("NOT_A_PRODUCT", "no product title found on the page")
    price, cur = _price(prod.get("offers")) if prod else (None, None)
    if price is None:
        price, cur = _num(meta.get("product:price:amount") or meta.get("og:price:amount")), \
            meta.get("product:price:currency") or meta.get("og:price:currency")
    if price is not None and cur and cur.upper() != "AUD":
        notes.append(f"price in {cur} ignored (AUD only)")
        price = None
    dims = {"width_m": _to_m(prod.get("width"), None), "depth_m": _to_m(prod.get("depth"), None),
            "height_m": _to_m(prod.get("height"), None)}
    dims = {k: v for k, v in dims.items() if v}
    if len(dims) < 3:
        spec = " ".join(pg.text + [str(prod.get("description") or "")])
        for k, v in dimensions_from_text(spec).items():
            dims.setdefault(k, v)
        if dims:
            notes.append("dimensions read from page text; confirm against the retailer's specification")
    model = find_model_url(html, url, nodes)
    host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    item = CatalogueItemIn(
        retailer=host, source_url=url, sku=str(prod["sku"]) if prod.get("sku") else (
            str(prod["mpn"]) if prod.get("mpn") else None),
        title=str(title).strip()[:300], brand=_name(prod.get("brand")) or meta.get("product:brand")
        or meta.get("og:brand"), price_aud=price, price_captured_at=now if price is not None else None,
        category=(prod.get("category") if isinstance(prod.get("category"), str) else None),
        image_uri=urljoin(url, _image(prod.get("image")) or meta.get("og:image") or "") or None,
        model_uri=model, model_kind="real" if model else "proxy_box",
        licence_note=f"Title, price and image referenced from {host} (retailer/brand property); "
                     "3D model only if published by the retailer. Illustrative use only.", **dims)
    missing = [k for k in ("width_m", "depth_m", "height_m") if getattr(item, k) is None]
    if missing and not model:
        return ImportResult(status="dimensions_required", item=item, missing=missing, notes=notes)
    return ImportResult(status="ok", item=item, missing=missing if model else [], notes=notes)


# --------------------------------------------------------------------------- orchestration

class ProductImporter:
    def __init__(self, client: HttpClient | None = None, allowlist: tuple[str, ...] | None = None,
                 now: Callable[[], datetime] | None = None) -> None:
        self.client = client or UrllibClient()
        self.allowlist = tuple(a.lower() for a in (allowlist if allowlist is not None else allowlist_from_env()))
        self._now = now or (lambda: datetime.now(timezone.utc))

    def _check_host(self, url: str) -> str:
        u = urlparse(url)
        host = (u.hostname or "").lower()
        if u.scheme not in ("http", "https") or not host:
            raise ImportError_("BAD_URL", "a http(s) product URL is required")
        try:
            ipaddress.ip_address(host)
            raise ImportError_("BAD_URL", "IP-address URLs are not accepted")
        except ValueError:
            pass
        if not any(host == a or host.endswith("." + a) for a in self.allowlist):
            raise ImportError_("RETAILER_NOT_ALLOWED", f"{host} is not on the retailer allow-list", 403)
        return host

    def robots_allows(self, url: str) -> bool:
        u = urlparse(url)
        r = self.client.get(f"{u.scheme}://{u.netloc}/robots.txt")
        if r.status in (401, 403):
            return False
        if r.status >= 400 or not r.text.strip():
            return True                                  # no robots.txt = no restriction
        rp = RobotFileParser()
        rp.parse(r.text.splitlines())
        return rp.can_fetch(USER_AGENT, url)

    def import_url(self, url: str, width_m: float | None = None, depth_m: float | None = None,
                   height_m: float | None = None) -> ImportResult:
        self._check_host(url)
        if not self.robots_allows(url):
            raise ImportError_("ROBOTS_DISALLOWED", "the retailer's robots.txt does not allow automated access", 403)
        r = self.client.get(url)
        if r.status >= 400:
            raise ImportError_("FETCH_FAILED", f"retailer returned HTTP {r.status}", 502)
        if r.url:
            self._check_host(r.url)                       # redirects must stay on the allow-list
        res = parse_product_html(r.text, url, self._now())
        item = res.item
        assert item is not None
        override = {k: v for k, v in (("width_m", width_m), ("depth_m", depth_m), ("height_m", height_m)) if v}
        if override:
            item = item.model_copy(update=override)
            res.notes.append("dimensions supplied by user")
        missing = [k for k in ("width_m", "depth_m", "height_m") if getattr(item, k) is None]
        if missing and item.model_kind == "proxy_box":
            return ImportResult(status="dimensions_required", item=item, missing=missing, notes=res.notes)
        return ImportResult(status="ok", item=item, missing=[] if not missing else missing, notes=res.notes)
