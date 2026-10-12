"""fetch_docs: offline tests with a mock fetcher (no network)."""
import json
import re
from pathlib import Path

import pytest

from scripts import fetch_docs as fd

PDF = b"%PDF-1.7\n%fake\n"
HTML = b"<html><head><title>t</title></head><body><nav>menu</nav><main><h1>Secondary dwellings</h1><p>area of at least 450 m<sup>2</sup>.</p></main></body></html>"


def src(**kw):
    d = dict(id="a", title="A", format="pdf", url="https://example.test/a.pdf", filename="a.pdf", status="obtained",
             ingest=True)
    d.update(kw)
    return d


def fetcher_for(table):
    calls = []

    def f(url):
        calls.append(url)
        return table[url]
    f.calls = calls
    return f


def test_html_to_text_main_content_and_inline_tags():
    t = fd.html_to_text(HTML.decode())
    assert "menu" not in t
    assert "area of at least 450 m2." in t
    assert t.startswith("Secondary dwellings\n")


def test_fetch_source_writes_file_hash_and_text(tmp_path):
    s = src(id="h", format="html", url="https://example.test/h", filename="h.html", text_file="h.txt")
    upd = fd.fetch_source(s, tmp_path, fetcher_for({s["url"]: (200, "text/html; charset=UTF-8", HTML)}))
    assert (tmp_path / "h.html").read_bytes() == HTML
    assert "450 m2" in (tmp_path / "h.txt").read_text()
    assert upd["sha256"] == fd.sha256_bytes(HTML) and upd["bytes"] == len(HTML) and upd["changed"] is False
    assert re.match(r"\d{4}-\d\d-\d\dT", upd["retrieved_at"])


def test_changed_flag_when_hash_differs(tmp_path):
    s = src(sha256="0" * 64)
    upd = fd.fetch_source(s, tmp_path, fetcher_for({s["url"]: (200, "application/pdf", PDF)}))
    assert upd["changed"] is True


@pytest.mark.parametrize("status,ctype,body,msg", [
    (403, "text/html", b"<html>Just a moment...</html>", "HTTP 403"),
    (200, "text/html", b"<html><title>Just a moment...</title></html>", "bot-challenge"),
    (200, "text/html", b"<html>not a pdf</html>", "expected a PDF"),
])
def test_validate_body_rejects_bad_responses(status, ctype, body, msg):
    with pytest.raises(fd.FetchError, match=msg):
        fd.validate_body(src(), status, ctype, body)


def test_run_skips_blocked_records_failures_and_continues(tmp_path):
    man = {"sources": [
        src(id="ok", url="https://example.test/ok.pdf", filename="ok.pdf"),
        src(id="bad", url="https://example.test/bad.pdf", filename="bad.pdf"),
        src(id="blk", url="https://example.test/blk.pdf", filename="blk.pdf", status="blocked", blocked_reason="CF"),
    ]}
    f = fetcher_for({"https://example.test/ok.pdf": (200, "application/pdf", PDF),
                     "https://example.test/bad.pdf": (500, "text/html", b"err")})
    res = fd.run(man, tmp_path, f, log=lambda m: None)
    assert res["ok"] == "ok" and res["bad"].startswith("failed") and res["blk"].startswith("skipped")
    assert "https://example.test/blk.pdf" not in f.calls
    assert man["sources"][0]["sha256"] == fd.sha256_bytes(PDF)
    assert "sha256" not in man["sources"][1] and not (tmp_path / "bad.pdf").exists()


def test_try_blocked_promotes_source_when_it_succeeds(tmp_path):
    man = {"sources": [src(id="blk", status="blocked", blocked_reason="CF")]}
    f = fetcher_for({"https://example.test/a.pdf": (200, "application/pdf", PDF)})
    res = fd.run(man, tmp_path, f, try_blocked=True, log=lambda m: None)
    assert res["blk"] == "ok" and man["sources"][0]["status"] == "obtained" and "blocked_reason" not in man["sources"][0]


def test_only_filter(tmp_path):
    man = {"sources": [src(id="a"), src(id="b", url="https://example.test/b.pdf", filename="b.pdf")]}
    f = fetcher_for({"https://example.test/b.pdf": (200, "application/pdf", PDF)})
    assert list(fd.run(man, tmp_path, f, only=["b"], log=lambda m: None)) == ["b"]


def test_verify_detects_missing_and_modified(tmp_path):
    (tmp_path / "a.pdf").write_bytes(PDF)
    man = {"sources": [src(sha256=fd.sha256_bytes(PDF)), src(id="m", filename="m.pdf", sha256="1" * 64),
                       src(id="b", filename="b.pdf", status="blocked")]}
    assert fd.verify(man, tmp_path)[0].startswith("m: missing")
    (tmp_path / "m.pdf").write_bytes(PDF)
    assert "differs" in fd.verify(man, tmp_path)[0]
    (tmp_path / "m.pdf").unlink()
    (tmp_path / "a.pdf").write_bytes(PDF + b"x")
    assert len(fd.verify(man, tmp_path)) == 2


def test_main_verify_offline(tmp_path, capsys):
    (tmp_path / "raw").mkdir()
    (tmp_path / "raw" / "a.pdf").write_bytes(PDF)
    m = tmp_path / "manifest.json"
    m.write_text(json.dumps({"sources": [src(sha256=fd.sha256_bytes(PDF))]}))
    assert fd.main(["--manifest", str(m), "--raw-dir", str(tmp_path / "raw"), "--verify"]) == 0
    assert "match" in capsys.readouterr().out
    (tmp_path / "raw" / "a.pdf").write_bytes(b"%PDF-changed")
    assert fd.main(["--manifest", str(m), "--raw-dir", str(tmp_path / "raw"), "--verify"]) == 1


def test_main_fetch_updates_manifest_with_injected_fetcher(tmp_path, monkeypatch):
    m = tmp_path / "manifest.json"
    m.write_text(json.dumps({"sources": [src()]}))
    monkeypatch.setattr(fd, "urllib_fetcher", fetcher_for({"https://example.test/a.pdf": (200, "application/pdf", PDF)}))
    assert fd.main(["--manifest", str(m), "--raw-dir", str(tmp_path / "raw")]) == 0
    saved = json.loads(m.read_text())["sources"][0]
    assert saved["sha256"] == fd.sha256_bytes(PDF) and (tmp_path / "raw" / "a.pdf").exists()


def test_committed_manifest_is_well_formed():
    man = fd.load_manifest()
    ids = [s["id"] for s in man["sources"]]
    assert len(ids) == len(set(ids)) and len({s["filename"] for s in man["sources"]}) == len(ids)
    for s in man["sources"]:
        assert s["url"].startswith("https://") and s["format"] in ("pdf", "html") and s["status"] in ("obtained", "blocked")
        if s["format"] == "html":
            assert s["text_file"].endswith(".txt")
        if s["status"] == "obtained":
            assert re.fullmatch(r"[0-9a-f]{64}", s["sha256"]) and s["retrieved_at"] and s["bytes"] > 0
        else:
            assert s["blocked_reason"]
    assert Path(fd.KNOWLEDGE / ".gitignore").read_text().strip() == "raw/"
