"""DocumentSource protocol: lists/fetches governing documents. No live fetching unless a fetcher is injected."""
from __future__ import annotations

import hashlib
import json
from datetime import date
from pathlib import Path
from typing import Callable, Protocol

from pydantic import BaseModel


class DocRef(BaseModel):
    doc_id: str
    title: str
    kind: str                       # rwt_rule | build_over | service_design | council_engineering | ...
    authority: str = ""
    jurisdiction: str | None = None
    lga: str | None = None
    path: str | None = None
    source_url: str | None = None
    effective_date: date | None = None
    version: str | None = None


class DocumentSource(Protocol):
    def list_documents(self) -> list[DocRef]: ...

    def fetch(self, ref: DocRef) -> Path: ...


class LocalFolderSource:
    """PDFs in a folder; metadata from a sidecar '<name>.json' (title, kind, authority, jurisdiction, lga, ...)."""

    def __init__(self, folder: str | Path) -> None:
        self.folder = Path(folder)

    def list_documents(self) -> list[DocRef]:
        out = []
        for p in sorted(self.folder.glob("*.pdf")):
            side = p.with_suffix(".json")
            meta = json.loads(side.read_text()) if side.exists() else {}
            meta.setdefault("title", p.stem)
            meta.setdefault("kind", "unknown")
            out.append(DocRef(doc_id=meta.pop("doc_id", p.stem), path=str(p), **meta))
        return out

    def fetch(self, ref: DocRef) -> Path:
        return Path(ref.path)


class UrlListSource:
    """Configured URL list; downloads only through the injected `fetcher(url) -> bytes` (none by default)."""

    def __init__(self, entries: list[dict], cache_dir: str | Path, fetcher: Callable[[str], bytes] | None = None) -> None:
        self.entries, self.cache, self.fetcher = entries, Path(cache_dir), fetcher

    def list_documents(self) -> list[DocRef]:
        return [DocRef(doc_id=e.get("doc_id") or hashlib.sha1(e["source_url"].encode()).hexdigest()[:10],
                       **{k: v for k, v in e.items() if k != "doc_id"}) for e in self.entries]

    def fetch(self, ref: DocRef) -> Path:
        p = self.cache / f"{ref.doc_id}.pdf"
        if not p.exists():
            if self.fetcher is None:
                raise RuntimeError(f"no fetcher configured; cannot download {ref.source_url}")
            self.cache.mkdir(parents=True, exist_ok=True)
            p.write_bytes(self.fetcher(ref.source_url))
        return p


class CompositeSource:
    def __init__(self, *sources: DocumentSource) -> None:
        self.sources = sources

    def list_documents(self) -> list[DocRef]:
        return [d for s in self.sources for d in s.list_documents()]

    def fetch(self, ref: DocRef) -> Path:
        for s in self.sources:
            if any(d.doc_id == ref.doc_id for d in s.list_documents()):
                return s.fetch(ref)
        raise KeyError(ref.doc_id)
