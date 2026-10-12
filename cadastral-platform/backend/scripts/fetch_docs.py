"""Re-download the governing documents listed in knowledge/manifest.json (reproducible knowledge-base fetch).

    python -m scripts.fetch_docs                    # fetch every 'obtained' source, refresh retrieved_at / sha256
    python -m scripts.fetch_docs --only gunnedah_dcp_2025
    python -m scripts.fetch_docs --verify           # no network: check files on disk against the manifest sha256
    python -m scripts.fetch_docs --try-blocked      # also retry sources recorded as blocked (Cloudflare etc.)

Raw files land in knowledge/raw/ (git-ignored). HTML sources also get a '<id>.txt' plain-text rendition used by
ingestion. TLS verification is never disabled; the proxy / CA bundle come from the standard environment variables
(HTTPS_PROXY, SSL_CERT_FILE).  Nothing here interprets the documents: extraction lives in knowledge/gunnedah/.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import ssl
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

KNOWLEDGE = Path(__file__).resolve().parents[1] / "knowledge"
USER_AGENT = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/124.0 Safari/537.36")
CHALLENGE_MARKERS = ("Just a moment...", "Performing security verification", "cf-browser-verification")

# fetcher(url) -> (http_status, content_type, body)
Fetcher = Callable[[str], "tuple[int, str, bytes]"]


class FetchError(Exception):
    pass


def urllib_fetcher(url: str, timeout: int = 120) -> "tuple[int, str, bytes]":
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    ctx = ssl.create_default_context()           # honours SSL_CERT_FILE; verification stays ON
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", ""), e.read()


_BLOCK = re.compile(r"</?(p|div|br|li|ul|ol|tr|h[1-6]|table|section|article|header|footer|nav|main)\b[^>]*>", re.I)


def html_to_text(raw: str) -> str:
    """Main-content text of an HTML page. Inline tags (sup/a/span...) are dropped without a line break so that
    '450 m<sup>2</sup>' reads '450 m2'."""
    m = re.search(r"<main\b.*?</main>", raw, flags=re.S | re.I)
    t = m.group(0) if m else raw
    t = re.sub(r"<(script|style|noscript)\b[^>]*>.*?</\1>", "", t, flags=re.S | re.I)
    t = _BLOCK.sub("\n", t)
    t = re.sub(r"<[^>]+>", "", t)
    lines = [re.sub(r"[ \t ]+", " ", ln).strip() for ln in html.unescape(t).splitlines()]
    return "\n".join(ln for ln in lines if ln) + "\n"


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def load_manifest(path: Path | None = None) -> dict:
    return json.loads((path or KNOWLEDGE / "manifest.json").read_text())


def save_manifest(man: dict, path: Path | None = None) -> None:
    (path or KNOWLEDGE / "manifest.json").write_text(json.dumps(man, indent=2, ensure_ascii=False) + "\n")


def validate_body(src: dict, status: int, ctype: str, body: bytes) -> None:
    if status != 200:
        raise FetchError(f"HTTP {status}")
    head = body[:2000].decode("utf-8", "ignore")
    if any(mk in head for mk in CHALLENGE_MARKERS):
        raise FetchError("bot-challenge page returned instead of the document")
    if src["format"] == "pdf" and not body.startswith(b"%PDF"):
        raise FetchError(f"expected a PDF, got {ctype or 'unknown content type'}")
    if src["format"] == "html" and "html" not in ctype.lower() and "<html" not in head.lower():
        raise FetchError(f"expected HTML, got {ctype or 'unknown content type'}")


def fetch_source(src: dict, raw_dir: Path, fetcher: Fetcher) -> dict:
    """Download one source; returns the manifest fields to update (retrieved_at, sha256, bytes, changed)."""
    status, ctype, body = fetcher(src["url"])
    validate_body(src, status, ctype, body)
    raw_dir.mkdir(parents=True, exist_ok=True)
    (raw_dir / src["filename"]).write_bytes(body)
    if src["format"] == "html":
        (raw_dir / src["text_file"]).write_text(html_to_text(body.decode("utf-8", "replace")))
    sha = sha256_bytes(body)
    return {"retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "sha256": sha,
            "bytes": len(body), "changed": bool(src.get("sha256")) and src["sha256"] != sha}


def verify(man: dict, raw_dir: Path) -> list[str]:
    """Offline check: every obtained source exists on disk and matches its recorded sha256."""
    problems = []
    for s in man["sources"]:
        if s["status"] != "obtained":
            continue
        p = raw_dir / s["filename"]
        if not p.exists():
            problems.append(f"{s['id']}: missing {p.name}")
        elif sha256_bytes(p.read_bytes()) != s.get("sha256"):
            problems.append(f"{s['id']}: sha256 differs from manifest (document changed or file edited)")
    return problems


def run(man: dict, raw_dir: Path, fetcher: Fetcher, only: list[str] | None = None, try_blocked: bool = False,
        log: Callable[[str], None] = print) -> dict:
    """Fetch the selected sources, mutating `man` in place. Returns {id: 'ok'|'changed'|'failed: ...'|'skipped'}."""
    out = {}
    for s in man["sources"]:
        if only and s["id"] not in only:
            continue
        if s["status"] == "blocked" and not try_blocked:
            out[s["id"]] = "skipped (blocked: " + s.get("blocked_reason", "") + ")"
            continue
        try:
            upd = fetch_source(s, raw_dir, fetcher)
        except Exception as e:  # noqa: BLE001 - one bad source must not abort the rest
            out[s["id"]] = f"failed: {e}"
            log(f"[fail] {s['id']}: {e}")
            continue
        changed = upd.pop("changed")
        s.update(upd)
        if s["status"] == "blocked":
            s["status"] = "obtained"
            s.pop("blocked_reason", None)
        out[s["id"]] = "changed" if changed else "ok"
        log(f"[{out[s['id']]}] {s['id']} {s['bytes']} bytes sha256={s['sha256'][:12]}")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", type=Path, default=KNOWLEDGE / "manifest.json")
    ap.add_argument("--raw-dir", type=Path, default=KNOWLEDGE / "raw")
    ap.add_argument("--only", nargs="*", help="source ids to fetch")
    ap.add_argument("--verify", action="store_true", help="offline: check files on disk against manifest sha256")
    ap.add_argument("--try-blocked", action="store_true")
    a = ap.parse_args(argv)
    man = load_manifest(a.manifest)
    if a.verify:
        probs = verify(man, a.raw_dir)
        print("\n".join(probs) or "all files match the manifest")
        return 1 if probs else 0
    res = run(man, a.raw_dir, urllib_fetcher, a.only, a.try_blocked)
    save_manifest(man, a.manifest)
    return 1 if any(v.startswith("failed") for v in res.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
