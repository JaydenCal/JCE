"""Download the ESC source documents into knowledge/raw/esc/ (git-ignored) and (re)write sources.json.

    python -I knowledge/esc/fetch_esc_docs.py            # download if missing, refresh sha256
    python -I knowledge/esc/fetch_esc_docs.py --force

Browser User-Agent is required (planning/environment sites reject bare clients).
"""
from __future__ import annotations

import hashlib
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE.parent / "raw" / "esc"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"

SOURCES = [
    {"id": "bs2024", "filename": "bs2024_final.pdf", "kind": "state_guideline",
     "title": "Guidelines for erosion and sediment control on building sites",
     "authority": "NSW Department of Planning, Housing and Infrastructure", "jurisdiction": "NSW", "lga": None,
     "version": "October 2024", "effective_date": "2024-10-01",
     "url": "https://shared-drupal-s3fs.s3.ap-southeast-2.amazonaws.com/master-test/fapub_pdf/NSW%2BPlanning%2BPortal%2BDocuments/guidelines-for-erosion-and-sediment-control-on-building-sites.pdf",
     "landing": "https://www.planningportal.nsw.gov.au/draftplans/made-and-finalised/guidelines-erosion-and-sediment-control-building-sites",
     "notes": "Final (not the Sept 2023 draft). Applies to sites 250-2,500 m2. Cited page = PDF page = printed page."},
    {"id": "bluebook_v1", "filename": "bluebook_v1.pdf", "kind": "state_guideline",
     "title": "Managing Urban Stormwater: Soils and Construction, Volume 1 (the Blue Book), 4th edition",
     "authority": "Landcom", "jurisdiction": "NSW", "lga": None, "version": "4th edition, March 2004 (reprinted 2006)",
     "effective_date": "2004-03-01",
     "url": "https://www.environment.nsw.gov.au/sites/default/files/managing-urban-stormwater-soils-construction-volume-1-fourth-edition.pdf",
     "landing": "https://www.environment.nsw.gov.au/publications/managing-urban-stormwater-soils-and-construction-volume-1",
     "notes": "Cited page = PDF page index (printed chapter page numbers differ, e.g. 6-43 is PDF p.163). Volume 2 (land-use specific: A urban, C unsealed roads, D main roads, E mines) was reviewed for scope only; "
              "Vol 2A (urban land development) is for subdivision, not a single-lot build, and is NOT ingested."},
]


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> int:
    force = "--force" in sys.argv
    RAW.mkdir(parents=True, exist_ok=True)
    out = []
    for s in SOURCES:
        p = RAW / s["filename"]
        status, reason = "obtained", ""
        if force or not p.exists():
            try:
                req = urllib.request.Request(s["url"], headers={"User-Agent": UA})
                p.write_bytes(urllib.request.urlopen(req, timeout=300).read())
            except Exception as ex:  # noqa: BLE001
                status, reason = "blocked", str(ex)
        if p.exists() and p.read_bytes()[:4] != b"%PDF":
            status, reason = "blocked", "response was not a PDF"
        e = dict(s, status=status, reason=reason, format="pdf", ingest=True)
        if p.exists():
            e.update(sha256=sha256(p), bytes=p.stat().st_size,
                     retrieved_at=datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).isoformat(timespec="seconds"))
        out.append(e)
        print(s["id"], status, reason)
    (HERE / "sources.json").write_text(json.dumps({"schema": 1, "region": "NSW erosion and sediment control", "sources": out}, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
