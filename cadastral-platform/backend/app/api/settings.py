"""API settings from environment variables."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str = ""
    upload_dir: str = "./var/uploads"
    export_dir: str = "./var/exports"
    max_upload_bytes: int = 50 * 1024 * 1024     # schema hard limit is 200 MiB
    default_token_budget: int = 200_000
    pool_max_size: int = 16

    @classmethod
    def from_env(cls) -> "Settings":
        e = os.environ.get
        return cls(
            database_url=e("DATABASE_URL", ""),
            upload_dir=e("UPLOAD_DIR", cls.upload_dir),
            export_dir=e("EXPORT_DIR", cls.export_dir),
            max_upload_bytes=int(e("MAX_UPLOAD_BYTES", cls.max_upload_bytes)),
            default_token_budget=int(e("DEFAULT_TOKEN_BUDGET", cls.default_token_budget)),
            pool_max_size=int(e("DB_POOL_MAX", cls.pool_max_size)),
        )
