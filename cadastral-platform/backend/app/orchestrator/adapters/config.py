"""Environment-driven construction of the SA1 and SA2 agents."""
from __future__ import annotations

import dataclasses
import json
import os
from datetime import date
from typing import Mapping

from app.agents.sa1_cadastre import clients as C
from app.agents.sa1_cadastre.agent import RoadConfig, Sa1Config
from app.agents.sa1_cadastre.zoning import ZoningConfig
from app.agents.sa2_dcp_rag.embeddings import Embedder, ExternalEmbedder, HashingEmbedder
from app.agents.sa2_dcp_rag.extract import AnthropicLlmClient, LlmClient
from app.agents.sa2_dcp_rag.ingest import ingest_pdf
from app.agents.sa2_dcp_rag.models import DocMeta

from .nodes import Sa1Adapter, Sa2Adapter


def sa1_config_from_env(env: Mapping[str, str] | None = None) -> Sa1Config:
    """Defaults from clients.py (unverified URLs) with overrides:

    SA1_NSW_LOT_URL, SA1_QLD_LOT_URL, SA1_NSW_ZONING_URL, SA1_NSW_GEOCODER_URL, SA1_QLD_GEOCODER_URL,
    SA1_ZONING_GEOJSON_NSW/_QLD (local file replaces the ArcGIS zoning layer),
    SA1_ROADS_URL_NSW/_QLD or SA1_ROADS_GEOJSON_NSW/_QLD, SA1_ROADS_NAME_FIELD, SA1_ROADS_TOLERANCE_M.
    """
    e = os.environ if env is None else env
    cfg = Sa1Config()
    for j, key in (("NSW", "SA1_NSW_LOT_URL"), ("QLD", "SA1_QLD_LOT_URL")):
        if e.get(key):
            cfg.lot_layers[j] = dataclasses.replace(cfg.lot_layers[j], url=e[key])
    if e.get("SA1_NSW_ZONING_URL"):
        z = cfg.zoning["NSW"]
        cfg.zoning["NSW"] = dataclasses.replace(z, layer=dataclasses.replace(z.layer, url=e["SA1_NSW_ZONING_URL"]))
    for j in ("NSW", "QLD"):
        if e.get(f"SA1_ZONING_GEOJSON_{j}"):
            cfg.zoning[j] = ZoningConfig(geojson_path=e[f"SA1_ZONING_GEOJSON_{j}"])
        if e.get(f"SA1_{j}_GEOCODER_URL"):
            cfg.geocoders[j] = e[f"SA1_{j}_GEOCODER_URL"]
        name = e.get("SA1_ROADS_NAME_FIELD", "roadname")
        tol = float(e.get("SA1_ROADS_TOLERANCE_M", "15"))
        if e.get(f"SA1_ROADS_GEOJSON_{j}"):
            cfg.roads[j] = RoadConfig(geojson_path=e[f"SA1_ROADS_GEOJSON_{j}"], name_field=name, tolerance_m=tol)
        elif e.get(f"SA1_ROADS_URL_{j}"):
            layer = C.LayerConfig(e[f"SA1_ROADS_URL_{j}"], "roads", "roads", "road centrelines", j)
            cfg.roads[j] = RoadConfig(layer=layer, name_field=name, tolerance_m=tol)
    return cfg


def build_sa1(env: Mapping[str, str] | None = None, client: C.ArcGISClient | None = None) -> Sa1Adapter:
    e = os.environ if env is None else env
    if client is None:
        client = C.ArcGISClient(retries=int(e.get("SA1_HTTP_RETRIES", "3")), timeout=float(e.get("SA1_HTTP_TIMEOUT", "30")))
    return Sa1Adapter(sa1_config_from_env(e), client)


def load_dcp_documents(env: Mapping[str, str] | None = None) -> list[DocMeta]:
    """SA2_DCP_DOCS = JSON list of {"path", "lga", "title"?, "doc_id"?, "effective_date"?} (inline JSON or a file path)."""
    e = os.environ if env is None else env
    raw = (e.get("SA2_DCP_DOCS") or "").strip()
    if not raw:
        return []
    if not raw.startswith("["):
        with open(raw) as f:
            raw = f.read()
    docs = []
    for i, d in enumerate(json.loads(raw)):
        doc_id = d.get("doc_id") or f"dcp{i}"
        chunks, _ = ingest_pdf(d["path"], doc_id)
        eff = date.fromisoformat(d["effective_date"]) if d.get("effective_date") else None
        docs.append(DocMeta(doc_id=doc_id, title=d.get("title") or d["lga"] + " DCP", lga=d["lga"],
                            effective_date=eff, chunks=chunks))
    return docs


def build_sa2(env: Mapping[str, str] | None = None, documents: list[DocMeta] | None = None,
              llm: LlmClient | None = None, embedder: Embedder | None = None) -> Sa2Adapter:
    """Hashing embedder and no LLM unless configured (SA2_EMBEDDER=external; SA2_LLM=anthropic + SA2_LLM_MODEL)."""
    e = os.environ if env is None else env
    if embedder is None:
        embedder = ExternalEmbedder() if e.get("SA2_EMBEDDER") == "external" else HashingEmbedder()
    if llm is None and e.get("SA2_LLM") == "anthropic":
        import anthropic  # optional dependency
        llm = AnthropicLlmClient(anthropic.Anthropic(), e.get("SA2_LLM_MODEL") or "claude-sonnet-4-5")
    return Sa2Adapter(documents if documents is not None else load_dcp_documents(e), llm, embedder)
