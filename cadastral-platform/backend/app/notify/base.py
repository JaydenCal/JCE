"""Notifier protocol, the message model and plain-text / HTML rendering."""
from __future__ import annotations

import html
import json
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


class NotifyConfigError(RuntimeError):
    """A transport is selected but not fully configured (e.g. ENQUIRY_TO missing)."""


@dataclass
class EnquiryMessage:
    reference: str
    created_at: str
    name: str
    email: str
    role: str
    preferred_contact: str
    enquiry_types: list[str]
    message: str
    phone: str | None = None
    company: str | None = None
    timeframe: str | None = None
    address: str | None = None
    lot_plan: str | None = None
    project_id: str | None = None
    share_context: bool = False
    context: dict[str, Any] | None = None
    attachments: list[dict[str, Any]] = field(default_factory=list)   # {filename, content_type, byte_size, sha256, url?}
    referral_partner: str = "JCE Infrastructure"
    consent_version: str = ""

    @classmethod
    def from_row(cls, r: dict, attachment_base_url: str = "") -> "EnquiryMessage":
        atts = []
        for i, a in enumerate(r.get("attachments") or []):
            a = dict(a)
            a.pop("storage_path", None)     # never put server paths in outgoing messages
            if attachment_base_url:
                a["url"] = f"{attachment_base_url.rstrip('/')}/enquiries/{r['reference']}/attachments/{i}"
            atts.append(a)
        ctx = r.get("context_json") if r.get("share_context") else None
        return cls(reference=r["reference"], created_at=str(r["created_at"]), name=r["name"], email=r["email"],
                   role=r["role"], preferred_contact=r["preferred_contact"], enquiry_types=list(r["enquiry_types"] or []),
                   message=r["message"], phone=r.get("phone"), company=r.get("company"), timeframe=r.get("timeframe"),
                   address=r.get("address"), lot_plan=r.get("lot_plan"),
                   project_id=str(r["project_id"]) if r.get("project_id") else None,
                   share_context=bool(r.get("share_context")), context=ctx, attachments=atts,
                   referral_partner=r.get("referral_partner") or "JCE Infrastructure",
                   consent_version=r.get("consent_version") or "")

    def to_dict(self) -> dict[str, Any]:
        return json.loads(json.dumps(self.__dict__, default=str))


@runtime_checkable
class Notifier(Protocol):
    """A delivery channel. ``notify`` tells the partner; ``acknowledge`` tells the submitter.
    Both raise on failure; the dispatcher records the error and retries later."""
    name: str

    def notify(self, msg: EnquiryMessage) -> None: ...
    def acknowledge(self, msg: EnquiryMessage) -> None: ...


def _rows(m: EnquiryMessage) -> list[tuple[str, str]]:
    rows = [("Reference", m.reference), ("Received", m.created_at), ("Name", m.name), ("Email", m.email),
            ("Phone", m.phone or ""), ("Company", m.company or ""), ("Role", m.role),
            ("Preferred contact", m.preferred_contact), ("Timeframe", m.timeframe or ""),
            ("Enquiry types", ", ".join(m.enquiry_types)), ("Site address", m.address or ""),
            ("Lot/plan", m.lot_plan or ""), ("Project id", m.project_id or "")]
    return [(k, v) for k, v in rows if v]


def _ctx_lines(ctx: dict[str, Any], indent: str = "") -> list[str]:
    out: list[str] = []
    for k, v in ctx.items():
        if isinstance(v, dict):
            out.append(f"{indent}{k}:")
            out += _ctx_lines(v, indent + "  ")
        elif isinstance(v, list):
            out.append(f"{indent}{k}:")
            out += [f"{indent}  - {json.dumps(x, default=str) if isinstance(x, (dict, list)) else x}" for x in v]
        else:
            out.append(f"{indent}{k}: {v}")
    return out


def render_text(m: EnquiryMessage) -> str:
    L = [f"New engineer enquiry {m.reference} for {m.referral_partner}", ""]
    L += [f"{k}: {v}" for k, v in _rows(m)]
    L += ["", "Message:", m.message, ""]
    if m.share_context and m.context:
        L += ["Project summary (shared by the submitter with consent):"] + _ctx_lines(m.context) + [""]
    elif m.share_context:
        L += ["Submitter chose to share a project summary but none was available.", ""]
    else:
        L += ["No project summary shared.", ""]
    if m.attachments:
        L.append("Attachments:")
        for a in m.attachments:
            L.append(f"- {a.get('filename')} ({a.get('content_type')}, {a.get('byte_size')} bytes, sha256 {a.get('sha256')})"
                     + (f" {a['url']}" if a.get("url") else ""))
        L.append("")
    L.append(f"Consent version: {m.consent_version}. Platform outputs are indicative and are not engineering advice.")
    return "\n".join(L)


def render_html(m: EnquiryMessage) -> str:
    e = html.escape
    rows = "".join(f"<tr><th align='left' style='padding:2px 12px 2px 0'>{e(k)}</th><td>{e(v)}</td></tr>" for k, v in _rows(m))
    ctx = ""
    if m.share_context and m.context:
        ctx = "<h3>Project summary (shared with consent)</h3><pre style='font-size:12px'>" + e("\n".join(_ctx_lines(m.context))) + "</pre>"
    elif not m.share_context:
        ctx = "<p><em>No project summary shared.</em></p>"
    atts = ""
    if m.attachments:
        items = "".join(
            "<li>" + (f"<a href='{e(a['url'], quote=True)}'>{e(str(a.get('filename')))}</a>" if a.get("url") else e(str(a.get("filename"))))
            + f" ({e(str(a.get('content_type')))}, {e(str(a.get('byte_size')))} bytes)</li>" for a in m.attachments)
        atts = f"<h3>Attachments</h3><ul>{items}</ul>"
    return (f"<html><body style='font-family:sans-serif'><h2>New engineer enquiry {e(m.reference)}</h2>"
            f"<table>{rows}</table><h3>Message</h3><p style='white-space:pre-wrap'>{e(m.message)}</p>{ctx}{atts}"
            f"<p style='color:#666;font-size:12px'>Consent version {e(m.consent_version)}. Platform outputs are indicative "
            f"and are not engineering advice.</p></body></html>")


def render_ack_text(m: EnquiryMessage) -> str:
    return (f"Hi {m.name},\n\nThanks for your enquiry. Your reference number is {m.reference}.\n\n"
            f"We have passed it to {m.referral_partner}, an industry partner of this platform, and they will contact you by "
            f"{m.preferred_contact}. We cannot guarantee a response time or that they can act on your matter.\n\n"
            "Outputs from the platform are indicative and are not engineering advice until you engage an engineer under a "
            "written agreement.\n\nTo access or correct the personal information you gave us, reply to this email quoting "
            "your reference.\n")
