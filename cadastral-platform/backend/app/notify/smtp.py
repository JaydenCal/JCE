"""SMTP transport. Env: ENQUIRY_SMTP_HOST/PORT/USER/PASSWORD/FROM, ENQUIRY_TO (comma separated), ENQUIRY_SMTP_TLS (starttls|ssl|none)."""
from __future__ import annotations

import smtplib
import ssl
from dataclasses import dataclass, field
from email.message import EmailMessage
from email.utils import formataddr

from app.notify.base import EnquiryMessage, NotifyConfigError, render_ack_text, render_html, render_text


def _clean(s: str) -> str:
    return " ".join(s.replace("\r", " ").replace("\n", " ").split())


@dataclass
class SmtpNotifier:
    host: str
    port: int = 587
    user: str = ""
    password: str = ""
    sender: str = ""
    to: list[str] = field(default_factory=list)
    tls: str = "starttls"         # starttls | ssl | none
    timeout: float = 20.0
    name: str = "smtp"

    def _send(self, em: EmailMessage) -> None:
        ctx = ssl.create_default_context()
        if self.tls == "ssl":
            cm = smtplib.SMTP_SSL(self.host, self.port, timeout=self.timeout, context=ctx)
        else:
            cm = smtplib.SMTP(self.host, self.port, timeout=self.timeout)
        with cm as s:
            if self.tls == "starttls":
                s.starttls(context=ctx)
            if self.user:
                s.login(self.user, self.password)
            s.send_message(em)

    def notify(self, msg: EnquiryMessage) -> None:
        if not self.to:
            raise NotifyConfigError("ENQUIRY_TO is not set (the owner must set the enquiries mailbox)")
        if not self.sender:
            raise NotifyConfigError("ENQUIRY_SMTP_FROM is not set")
        em = EmailMessage()
        em["Subject"] = _clean(f"[{msg.reference}] Engineer enquiry from {msg.name}")[:200]
        em["From"] = self.sender
        em["To"] = ", ".join(self.to)
        em["Reply-To"] = formataddr((_clean(msg.name), _clean(msg.email)))
        em.set_content(render_text(msg))
        em.add_alternative(render_html(msg), subtype="html")
        self._send(em)

    def acknowledge(self, msg: EnquiryMessage) -> None:
        if not self.sender:
            raise NotifyConfigError("ENQUIRY_SMTP_FROM is not set")
        em = EmailMessage()
        em["Subject"] = _clean(f"We received your enquiry {msg.reference}")
        em["From"] = self.sender
        em["To"] = _clean(msg.email)
        if self.to:
            em["Reply-To"] = self.to[0]
        em.set_content(render_ack_text(msg))
        self._send(em)
