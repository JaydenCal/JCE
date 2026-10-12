"""File outbox: the last-resort record of every enquiry. Env: ENQUIRY_OUTBOX_DIR (default ./var/enquiry-outbox)."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from app.notify.base import EnquiryMessage, render_text


@dataclass
class OutboxNotifier:
    directory: str = "./var/enquiry-outbox"
    name: str = "outbox"

    def notify(self, msg: EnquiryMessage) -> None:
        d = Path(self.directory)
        d.mkdir(parents=True, exist_ok=True)
        stem = "".join(c for c in msg.reference if c.isalnum() or c in "-_")
        for suffix, content in ((".json", json.dumps(msg.to_dict(), indent=2)), (".txt", render_text(msg))):
            tmp = d / f".{stem}{suffix}.tmp"
            tmp.write_text(content, encoding="utf-8")
            os.replace(tmp, d / f"{stem}{suffix}")

    def acknowledge(self, msg: EnquiryMessage) -> None:
        raise NotImplementedError("outbox cannot acknowledge the submitter")
