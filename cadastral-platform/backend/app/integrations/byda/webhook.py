"""The BYDA webhook receiver: authentication and event reading.

AUTH. The signature scheme BYDA uses (if any) is UNCONFIRMED. Until it is read from the specification the route is protected by a SHARED SECRET: BYDA (or a proxy in
front of this service) must send it in the header ``X-JCE-Webhook-Secret``, compared in constant time against BYDA_WEBHOOK_SECRET. With no BYDA_WEBHOOK_SECRET the
route refuses everything (503). If BYDA_WEBHOOK_HMAC_HEADER names a header, a hex HMAC SHA256 keyed with the same secret must also match (UNCONFIRMED scheme, switched on only
by that setting); it covers ``<timestamp>.<delivery id>.`` followed by the raw body, so the replay headers below cannot be changed without breaking it. The secret is never
logged or returned.

REPLAY PROTECTION (this service's own scheme; the BYDA scheme is UNCONFIRMED). Every delivery must carry ``X-JCE-Webhook-Timestamp`` (seconds since 1970 UTC, or an ISO 8601
time with a zone) within ``MAX_SKEW_S`` (5 minutes) of the server clock, and ``X-JCE-Webhook-Delivery-Id`` (1 to 128 letters, digits, dot, underscore, hyphen, colon). A delivery
id seen before (the store keeps recent ids) is refused with 409. Without the HMAC header the timestamp and id are only as trustworthy as the sender: set
BYDA_WEBHOOK_HMAC_HEADER once the specification confirms a signature.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
from datetime import datetime
from typing import Any

from .config import BydaConfig
from .mapping import ENQUIRY_KEYS, first
from .store import now_iso

SECRET_HEADER = "X-JCE-Webhook-Secret"
TIMESTAMP_HEADER = "X-JCE-Webhook-Timestamp"
DELIVERY_HEADER = "X-JCE-Webhook-Delivery-Id"
MAX_BODY_BYTES = 256 * 1024
#: a delivery whose timestamp differs from the server clock by more than this many seconds is refused (a sanity limit set by the owner's instruction: 5 minutes)
MAX_SKEW_S = 300
_DELIVERY_ID = re.compile(r"^[A-Za-z0-9._:\-]{1,128}$")


class WebhookAuthError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def parse_timestamp(value: str | None) -> float | None:
    """Seconds since 1970 UTC from an epoch number or an ISO 8601 time with a zone, else None."""
    if value is None or not value.strip():
        return None
    v = value.strip()
    try:
        t = float(v)
        return t if t == t and abs(t) < 1e12 else None
    except ValueError:
        pass
    try:
        d = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None
    return d.timestamp() if d.tzinfo is not None else None


def verify(config: BydaConfig, secret_header: str | None, body: bytes, hmac_header_value: str | None = None, timestamp: str | None = None, delivery_id: str | None = None,
           now: float | None = None) -> str:
    """Authenticate one delivery and check it is fresh. Returns the delivery id (to be recorded by the caller so a repeat is refused)."""
    if not config.webhook_secret:
        raise WebhookAuthError(503, "WEBHOOK_DISABLED", "THE BYDA WEBHOOK IS NOT CONFIGURED (SET BYDA_WEBHOOK_SECRET)")
    secret = config.webhook_secret.reveal().encode()
    if not secret_header or not hmac.compare_digest(secret_header.encode(), secret):
        raise WebhookAuthError(401, "WEBHOOK_UNAUTHORISED", "THE WEBHOOK SECRET IS MISSING OR WRONG")
    if config.webhook_hmac_header:
        want = hmac.new(secret, f"{(timestamp or '').strip()}.{(delivery_id or '').strip()}.".encode() + body, hashlib.sha256).hexdigest()
        got = (hmac_header_value or "").strip().lower().removeprefix("sha256=")
        if not got or not hmac.compare_digest(got.encode(), want.encode()):
            raise WebhookAuthError(401, "WEBHOOK_SIGNATURE_INVALID", "THE WEBHOOK SIGNATURE DOES NOT MATCH")
    ts = parse_timestamp(timestamp)
    if ts is None:
        raise WebhookAuthError(401, "WEBHOOK_TIMESTAMP_REQUIRED", f"THE WEBHOOK NEEDS A VALID {TIMESTAMP_HEADER.upper()} HEADER (SECONDS SINCE 1970 UTC OR AN ISO 8601 TIME WITH A ZONE)")
    if abs((time.time() if now is None else now) - ts) > MAX_SKEW_S:
        raise WebhookAuthError(401, "WEBHOOK_STALE", f"THE WEBHOOK TIMESTAMP IS MORE THAN {MAX_SKEW_S // 60} MINUTES FROM THE SERVER CLOCK")
    did = (delivery_id or "").strip()
    if not _DELIVERY_ID.match(did):
        raise WebhookAuthError(401, "WEBHOOK_DELIVERY_ID_REQUIRED", f"THE WEBHOOK NEEDS A {DELIVERY_HEADER.upper()} HEADER OF 1 TO 128 LETTERS, DIGITS, DOT, UNDERSCORE, HYPHEN OR COLON")
    return did


def read_event(body: bytes) -> dict[str, Any]:
    """A stored event: when it arrived and the few fields read from it (UNCONFIRMED names). The body itself is not stored."""
    try:
        data = json.loads(body.decode("utf-8"))
    except ValueError:
        data = None
    d = data if isinstance(data, dict) else {}
    eid = first(d, ("enquiryId", "enquiry_id") + ENQUIRY_KEYS["id"] + ENQUIRY_KEYS["job_number"])
    st = first(d, ENQUIRY_KEYS["status"])
    kind = first(d, ("event", "type", "eventType"))
    return {"received_at": now_iso(), "enquiry_id": eid if isinstance(eid, (str, int)) else None, "status": st if isinstance(st, str) else None,
            "event": kind if isinstance(kind, str) else None, "parsed": isinstance(data, dict)}
