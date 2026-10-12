"""Enquiry units that need no database: validation, rate limit bucket, attachment checks, notifiers."""
import io
import json

import pytest
from pydantic import ValidationError
from starlette.datastructures import UploadFile

from app.api.deps import ApiError
from app.api.enquiries import CONSENT_VERSION, EnquiryIn, TokenBucket, validate_and_store
from app.notify import (CompositeNotifier, EnquiryMessage, OutboxNotifier, SmtpNotifier, build_notifier,
                        render_html, render_text)
from app.notify import smtp as smtp_mod
from app.notify.base import NotifyConfigError

GOOD = dict(name="Jo Citizen", email="jo@example.com", message="Need a driveway design", consent=True,
            consent_version=CONSENT_VERSION)


def up(name, data, ct):
    return UploadFile(file=io.BytesIO(data), filename=name, headers={"content-type": ct})


# ---- validation
def test_valid_minimal():
    e = EnquiryIn(**GOOD)
    assert e.role == "other" and e.enquiry_types == []


@pytest.mark.parametrize("patch", [
    {"consent": False}, {"email": "nope"}, {"email": "a@b"}, {"name": "  "}, {"message": ""}, {"phone": "abc"},
    {"role": "wizard"}, {"enquiry_types": ["civil_design", "bogus"]}, {"message": "x" * 5001}, {"preferred_contact": "fax"},
])
def test_invalid(patch):
    with pytest.raises(ValidationError):
        EnquiryIn(**{**GOOD, **patch})


def test_types_deduped_and_phone_ok():
    e = EnquiryIn(**GOOD, phone="+61 2 9999 0000", enquiry_types=["civil_design", "civil_design", "services"])
    assert e.enquiry_types == ["civil_design", "services"] and e.phone == "+61 2 9999 0000"


# ---- rate limit
def test_token_bucket():
    t = [0.0]
    b = TokenBucket(capacity=2, refill_per_sec=1 / 60, clock=lambda: t[0])
    assert b.allow("1.1.1.1") and b.allow("1.1.1.1") and not b.allow("1.1.1.1")
    assert b.allow("2.2.2.2")
    t[0] = 61
    assert b.allow("1.1.1.1") and not b.allow("1.1.1.1")


# ---- attachments
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 20
DXF = b"  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nEOF\n"


def test_attachments_ok_and_content_addressed(tmp_path):
    out = validate_and_store([up("plan.pdf", PDF, "application/pdf"), up("site.png", PNG, "image/png"),
                              up("lot.dxf", DXF, "application/octet-stream")], tmp_path)
    assert [a["filename"] for a in out] == ["plan.pdf", "site.png", "lot.dxf"]
    assert all(len(a["sha256"]) == 64 and a["storage_path"].endswith(a["sha256"] + "." + a["filename"].split(".")[-1]) for a in out)


@pytest.mark.parametrize("name,data,ct,code", [
    ("evil.exe", b"MZ", "application/octet-stream", "UNSUPPORTED_MEDIA_TYPE"),
    ("a.pdf", PDF, "image/png", "MIME_MISMATCH"),
    ("a.pdf", b"<html>", "application/pdf", "CONTENT_MISMATCH"),
    ("a.png", PDF, "image/png", "CONTENT_MISMATCH"),
    ("a.pdf", b"", "application/pdf", "EMPTY_FILE"),
    ("a.pdf", b"%PDF-1.4\n/JavaScript (x)\n", "application/pdf", "PDF_ACTIVE_CONTENT"),
])
def test_attachments_rejected(tmp_path, name, data, ct, code):
    with pytest.raises(ApiError) as e:
        validate_and_store([up(name, data, ct)], tmp_path)
    assert e.value.code == code


def test_attachments_total_size_and_count(tmp_path, monkeypatch):
    monkeypatch.setattr("app.api.enquiries.MAX_TOTAL_BYTES", 100)
    with pytest.raises(ApiError) as e:
        validate_and_store([up("a.pdf", PDF + b"0" * 90, "application/pdf"), up("b.pdf", PDF + b"0" * 90, "application/pdf")], tmp_path)
    assert e.value.status == 413
    monkeypatch.setattr("app.api.enquiries.MAX_FILES", 1)
    with pytest.raises(ApiError) as e2:
        validate_and_store([up("a.pdf", PDF, "application/pdf")] * 2, tmp_path)
    assert e2.value.code == "TOO_MANY_FILES"


# ---- notifiers
def msg(**kw):
    base = dict(reference="ENQ-20261012-ABC234", created_at="now", name="Jo <b>", email="jo@example.com", role="builder",
                preferred_contact="email", enquiry_types=["civil_design"], message="Hello <script>", address="1 Test St",
                share_context=True, context={"lot": {"id": "1/DP1"}, "plans": ["http://x/plan.pdf"]},
                attachments=[{"filename": "a.pdf", "content_type": "application/pdf", "byte_size": 5, "sha256": "ab", "url": "http://x/a"}])
    return EnquiryMessage(**{**base, **kw})


def test_render_contains_everything_and_escapes():
    t, h = render_text(msg()), render_html(msg())
    for s in ("ENQ-20261012-ABC234", "1 Test St", "1/DP1", "http://x/plan.pdf", "http://x/a", "not engineering advice"):
        assert s in t
    assert "<script>" not in h and "&lt;script&gt;" in h and "&lt;b&gt;" in h


def test_unshared_context_not_rendered():
    t = render_text(msg(share_context=False, context=None))
    assert "No project summary shared" in t and "1/DP1" not in t


class FakeSMTP:
    sent = []

    def __init__(self, *a, **k): pass
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def starttls(self, context=None): self.tls = True
    def login(self, u, p): self.cred = (u, p)
    def send_message(self, m): FakeSMTP.sent.append(m)


def test_smtp_notify_and_ack(monkeypatch):
    FakeSMTP.sent = []
    monkeypatch.setattr(smtp_mod.smtplib, "SMTP", FakeSMTP)
    s = SmtpNotifier(host="h", user="u", password="p", sender="noreply@example.test", to=["owner@example.test"])
    s.notify(msg(name="Jo\r\nBcc: evil@x.test"))
    s.acknowledge(msg())
    a, b = FakeSMTP.sent
    assert a["To"] == "owner@example.test" and "\n" not in a["Subject"] and "evil" not in a["Subject"].split("Bcc")[0] and a["Bcc"] is None
    assert b["To"] == "jo@example.com" and "ENQ-20261012-ABC234" in b.get_content()
    assert a.get_body(("html",)) is not None


def test_smtp_requires_recipient():
    with pytest.raises(NotifyConfigError):
        SmtpNotifier(host="h", sender="a@b.c").notify(msg())


class Boom:
    name = "boom"
    def notify(self, m): raise RuntimeError("down")
    def acknowledge(self, m): raise RuntimeError("down")


def test_composite_failure_writes_outbox_and_raises(tmp_path):
    c = CompositeNotifier([Boom()], OutboxNotifier(str(tmp_path)))
    with pytest.raises(RuntimeError, match="boom"):
        c.notify(msg())
    assert json.loads((tmp_path / "ENQ-20261012-ABC234.json").read_text())["name"] == "Jo <b>"


def test_composite_no_transport_uses_outbox(tmp_path):
    CompositeNotifier([], OutboxNotifier(str(tmp_path))).notify(msg())
    assert (tmp_path / "ENQ-20261012-ABC234.txt").exists()


def test_build_notifier_from_env_has_no_hardcoded_recipient():
    n = build_notifier({})
    assert n.transports == []
    n = build_notifier({"ENQUIRY_SMTP_HOST": "h", "ENQUIRY_TO": "a@x.test, b@x.test", "ENQUIRY_WEBHOOK_URL": "https://h/x"})
    assert [t.name for t in n.transports] == ["smtp", "webhook"] and n.transports[0].to == ["a@x.test", "b@x.test"]
