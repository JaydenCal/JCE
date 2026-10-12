"""Product import (fixture HTML, fake HTTP client; no live calls) and shopping list."""
import json
from datetime import datetime, timezone

import pytest

from app.design import shopping_list as sl
from app.design.product_import import HttpResponse, ImportError_, ProductImporter, parse_product_html

NOW = datetime(2026, 10, 12, 1, 0, tzinfo=timezone.utc)
URL = "https://www.bunnings.com.au/acme-chair_p123"

JSONLD = """<html><head><script type="application/ld+json">%s</script></head><body>
<model-viewer src="/models/chair.glb"></model-viewer></body></html>""" % json.dumps({
    "@context": "https://schema.org", "@graph": [{"@type": "Product", "name": "Acme Chair", "sku": "A1",
    "brand": {"@type": "Brand", "name": "Acme"}, "image": ["/img/c.jpg"], "category": "Chairs",
    "width": {"@type": "QuantitativeValue", "value": 55, "unitCode": "CMT"},
    "depth": {"value": 500, "unitText": "mm"}, "height": "0.9 m",
    "offers": {"@type": "Offer", "price": "129.50", "priceCurrency": "AUD"}}]})

OG = """<html><head><meta property="og:title" content="Oak Table"><meta property="og:image" content="https://x/t.jpg">
<meta property="product:price:amount" content="1,299.00"><meta property="product:price:currency" content="AUD">
</head><body><ul><li>Dimensions: 1800 x 900 x 750 mm</li></ul></body></html>"""

OG_NODIMS = OG.replace("Dimensions: 1800 x 900 x 750 mm", "Solid oak")


def test_jsonld_with_glb():
    r = parse_product_html(JSONLD, URL, NOW)
    it = r.item
    assert r.status == "ok" and it.title == "Acme Chair" and it.brand == "Acme" and it.sku == "A1"
    assert it.price_aud == 129.5 and it.price_captured_at == NOW
    assert (it.width_m, it.depth_m, it.height_m) == (0.55, 0.5, 0.9)
    assert it.model_kind == "real" and it.model_uri == "https://www.bunnings.com.au/models/chair.glb"
    assert it.image_uri == "https://www.bunnings.com.au/img/c.jpg" and it.retailer == "bunnings.com.au"


def test_opengraph_text_dimensions_proxy_box():
    r = parse_product_html(OG, URL, NOW)
    it = r.item
    assert r.status == "ok" and it.model_kind == "proxy_box" and it.price_aud == 1299.0
    assert (it.width_m, it.depth_m, it.height_m) == (1.8, 0.9, 0.75)


def test_dimensions_required():
    r = parse_product_html(OG_NODIMS, URL, NOW)
    assert r.status == "dimensions_required" and set(r.missing) == {"width_m", "depth_m", "height_m"}


def test_foreign_currency_price_dropped():
    r = parse_product_html(OG.replace('content="AUD"', 'content="USD"'), URL, NOW)
    assert r.item.price_aud is None and r.item.price_captured_at is None


class Fake:
    def __init__(self, pages, robots="User-agent: *\nDisallow: /private/\n"):
        self.pages, self.robots, self.calls = pages, robots, []

    def get(self, url):
        self.calls.append(url)
        if url.endswith("/robots.txt"):
            return HttpResponse(200, self.robots, url)
        return HttpResponse(200, self.pages.get(url, ""), url) if url in self.pages else HttpResponse(404, "", url)


def importer(pages, **kw):
    return ProductImporter(Fake(pages, **kw), allowlist=("bunnings.com.au",), now=lambda: NOW)


def test_importer_ok_and_override():
    imp = importer({URL: OG_NODIMS})
    assert imp.import_url(URL).status == "dimensions_required"
    r = imp.import_url(URL, 1.0, 0.5, 0.5)
    assert r.status == "ok" and r.item.height_m == 0.5


@pytest.mark.parametrize("url,code", [
    ("https://evil.example/p", "RETAILER_NOT_ALLOWED"), ("ftp://www.bunnings.com.au/p", "BAD_URL"),
    ("http://10.0.0.1/p", "BAD_URL"), ("https://www.bunnings.com.au/private/x", "ROBOTS_DISALLOWED"),
    ("https://www.bunnings.com.au/missing", "FETCH_FAILED")])
def test_importer_refusals(url, code):
    with pytest.raises(ImportError_) as e:
        importer({}).import_url(url)
    assert e.value.code == code


def test_robots_fetched_before_page():
    imp = importer({URL: OG})
    imp.import_url(URL)
    assert imp.client.calls[0].endswith("/robots.txt")


ROWS = [dict(catalogue_item_id="a", retailer="bunnings.com.au", brand="Acme", title="Chair", sku="A1",
             source_url=URL, price_aud=129.5, price_captured_at=NOW) for _ in range(2)] + [
    dict(catalogue_item_id="b", retailer="ikea.com", title="=EVIL()", source_url="https://ikea.com/x",
         price_aud=None, price_captured_at=None)]


def test_shopping_list():
    lines = sl.build_lines(ROWS)
    assert [l["qty"] for l in lines] == [2, 1] and lines[0]["line_total_aud"] == 259.0
    assert lines[0]["price_as_at"] == "2026-10-12"
    js = json.loads(sl.to_json(lines, NOW))
    assert js["total_priced_aud"] == 259.0 and js["unpriced_lines"] == 1 and "as at" in js["disclaimer"]
    csv_text = sl.to_csv(lines, NOW)
    assert csv_text.splitlines()[0].startswith("retailer,brand,title,sku,qty") and "'=EVIL()" in csv_text
    assert "2026-10-12" in csv_text and URL in csv_text
