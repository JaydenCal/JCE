from __future__ import annotations

import hashlib
import os
import re
from typing import Protocol

import numpy as np

DIM = 1536


class Embedder(Protocol):
    model_id: str

    def embed(self, texts: list[str]) -> np.ndarray: ...


class HashingEmbedder:
    """Deterministic feature-hashing embedder (unigrams+bigrams, signed, L2-normalised). Offline/tests."""

    model_id = "hashing-1536"

    def embed(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), DIM), dtype=np.float32)
        for i, t in enumerate(texts):
            toks = re.findall(r"[a-z0-9\.]+", t.lower())
            feats = toks + [a + "_" + b for a, b in zip(toks, toks[1:])]
            for f in feats:
                h = int.from_bytes(hashlib.blake2b(f.encode(), digest_size=8).digest(), "big")
                out[i, h % DIM] += 1.0 if (h >> 63) & 1 else -1.0
            n = np.linalg.norm(out[i])
            if n:
                out[i] /= n
        return out


class ExternalEmbedder:
    """Adapter stub for a hosted embedding provider. Configure via env SA2_EMBEDDING_API_KEY / _MODEL."""

    def __init__(self, api_key: str | None = None, model_id: str | None = None) -> None:
        self.api_key = api_key or os.environ.get("SA2_EMBEDDING_API_KEY")
        self.model_id = model_id or os.environ.get("SA2_EMBEDDING_MODEL", "external-1536")

    def embed(self, texts: list[str]) -> np.ndarray:
        if not self.api_key:
            raise RuntimeError("ExternalEmbedder not configured: set SA2_EMBEDDING_API_KEY (and SA2_EMBEDDING_MODEL)")
        raise NotImplementedError("Provider call to be implemented; must return array of shape [n, 1536]")
