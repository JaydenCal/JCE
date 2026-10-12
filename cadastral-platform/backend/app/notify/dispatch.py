"""Delivery orchestration. An enquiry is stored first; delivery failures are recorded in notify_error and retried."""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Mapping
from uuid import UUID

from app.notify.base import EnquiryMessage, Notifier
from app.notify.outbox import OutboxNotifier
from app.notify.smtp import SmtpNotifier
from app.notify.webhook import WebhookNotifier

log = logging.getLogger(__name__)
MAX_ATTEMPTS = 8


@dataclass
class CompositeNotifier:
    """Partner notification succeeds if ANY real transport succeeds. With no real transport configured, the
    outbox is the transport. If every real transport fails, the outbox still gets a copy but the enquiry stays
    un-notified (so it is retried) and the errors are raised."""
    transports: list[Notifier]
    outbox: OutboxNotifier
    name: str = "composite"
    attachment_base_url: str = ""

    def notify(self, msg: EnquiryMessage) -> None:
        if not self.transports:
            self.outbox.notify(msg)
            return
        errors, ok = [], False
        for t in self.transports:
            try:
                t.notify(msg)
                ok = True
            except Exception as e:  # noqa: BLE001
                errors.append(f"{t.name}: {type(e).__name__}: {e}")
        if not ok:
            try:
                self.outbox.notify(msg)
            except Exception as e:  # noqa: BLE001
                errors.append(f"outbox: {type(e).__name__}: {e}")
            raise RuntimeError("; ".join(errors))

    def acknowledge(self, msg: EnquiryMessage) -> None:
        errors = []
        for t in self.transports:
            try:
                t.acknowledge(msg)
                return
            except NotImplementedError:
                continue
            except Exception as e:  # noqa: BLE001
                errors.append(f"{t.name}: {type(e).__name__}: {e}")
        raise RuntimeError("; ".join(errors) or "no transport can acknowledge the submitter (configure SMTP)")


def build_notifier(env: Mapping[str, str] | None = None) -> CompositeNotifier:
    e = env if env is not None else os.environ
    to = [a.strip() for a in e.get("ENQUIRY_TO", "").split(",") if a.strip()]
    transports: list[Notifier] = []
    if e.get("ENQUIRY_SMTP_HOST"):
        transports.append(SmtpNotifier(
            host=e["ENQUIRY_SMTP_HOST"], port=int(e.get("ENQUIRY_SMTP_PORT", "587")), user=e.get("ENQUIRY_SMTP_USER", ""),
            password=e.get("ENQUIRY_SMTP_PASSWORD", ""), sender=e.get("ENQUIRY_SMTP_FROM", ""), to=to,
            tls=e.get("ENQUIRY_SMTP_TLS", "starttls").lower()))
    if e.get("ENQUIRY_WEBHOOK_URL"):
        transports.append(WebhookNotifier(e["ENQUIRY_WEBHOOK_URL"]))
    return CompositeNotifier(transports, OutboxNotifier(e.get("ENQUIRY_OUTBOX_DIR", "./var/enquiry-outbox")),
                             attachment_base_url=e.get("ENQUIRY_PUBLIC_BASE_URL", ""))


def deliver(pool, notifier, row: dict) -> bool:
    """Try to notify the partner and acknowledge the submitter, then record the outcome. Never raises."""
    base = getattr(notifier, "attachment_base_url", "") or os.environ.get("ENQUIRY_PUBLIC_BASE_URL", "")
    notified = bool(row.get("notified_at"))
    acked = bool(row.get("acknowledged_at"))
    errors: list[str] = []
    try:
        msg = EnquiryMessage.from_row(row, base)
        if not notified:
            try:
                notifier.notify(msg)
                notified = True
            except Exception as e:  # noqa: BLE001
                errors.append(f"notify: {type(e).__name__}: {e}")
        if not acked and notified:       # acknowledge only once the partner has it
            try:
                notifier.acknowledge(msg)
                acked = True
            except Exception as e:  # noqa: BLE001
                errors.append(f"ack: {type(e).__name__}: {e}")
    except Exception as e:  # noqa: BLE001
        errors.append(f"render: {type(e).__name__}: {e}")
    try:
        with pool.connection() as conn:
            conn.execute("SELECT core.enquiry_record_delivery(%s,%s,%s,%s)",
                         (row["enquiry_id"], notified, acked, "; ".join(errors) or None))
    except Exception:  # noqa: BLE001
        log.exception("could not record delivery state for enquiry %s", row.get("reference"))
    if errors:
        log.warning("enquiry %s delivery issues: %s", row.get("reference"), errors)
    return notified


def retry_pending(pool, notifier, limit: int = 50, max_attempts: int = MAX_ATTEMPTS) -> int:
    """Re-attempt enquiries that are not yet notified/acknowledged. Returns the number attempted."""
    with pool.connection() as conn:
        rows = conn.execute("SELECT * FROM core.enquiry_pending(%s,%s)", (max_attempts, limit)).fetchall()
    for r in rows:
        deliver(pool, notifier, r)
    return len(rows)


if __name__ == "__main__":          # python -m app.notify.dispatch  (cron / systemd timer retry)
    from app.common.db import make_pool
    p = make_pool(os.environ["DATABASE_URL"], max_size=2)
    print("retried", retry_pending(p, build_notifier()))
    p.close()
