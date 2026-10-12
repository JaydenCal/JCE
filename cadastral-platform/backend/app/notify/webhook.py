"""Webhook transport (Slack / Teams / Zapier style). Env: ENQUIRY_WEBHOOK_URL. Posts JSON with a ``text`` summary plus the full record."""
from __future__ import annotations

import json
import urllib.request
from dataclasses import dataclass

from app.notify.base import EnquiryMessage


@dataclass
class WebhookNotifier:
    url: str
    timeout: float = 15.0
    name: str = "webhook"

    def notify(self, msg: EnquiryMessage) -> None:
        if not self.url.lower().startswith("https://"):
            raise ValueError("ENQUIRY_WEBHOOK_URL must be https")
        text = (f"New engineer enquiry {msg.reference} from {msg.name} <{msg.email}>"
                f" ({', '.join(msg.enquiry_types) or 'no type'}) {msg.address or ''}\n{msg.message[:500]}")
        body = json.dumps({"text": text, "enquiry": msg.to_dict()}).encode()
        req = urllib.request.Request(self.url, data=body, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=self.timeout) as r:     # noqa: S310 (https enforced above)
            if r.status >= 300:
                raise RuntimeError(f"webhook returned {r.status}")

    def acknowledge(self, msg: EnquiryMessage) -> None:
        raise NotImplementedError("webhook cannot acknowledge the submitter")
