"""DBYD view for the documents (stage 8): what the plan set, the site report and the SoEE say about Before You Dig responses.

Built from the registry (``<project>/dbyd/owners.json``, written by ``folder_import``) and the trace store (``<project>/dbyd/traces.json``).  The view carries:
  * one row per asset owner: the response status BYDA gave, whether plans were received (and what they are made of), how many services are traced (draft), verified and rejected,
    and the date the plans stop being valid;
  * the VERIFIED services only, each with its owner and plan date, as the only services a drawing may show;
  * the enquiry validity and a warning when it has passed or is near.

"Not confirmed" is the default.  A project with no registry has no view (``None``): the sheets then say EXISTING SERVICES NOT CONFIRMED.  A project with owners but nothing verified says
how many responses were received and that no service is verified: that is not the same as no services.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

from app.integrations.byda.folder_import import load_registry, parse_date
from app.integrations.byda.traces import TraceStore

LABEL_TEXT = "LOCATION INDICATIVE, CONFIRM BY POTHOLING"
SYNTHETIC_STAMP = "SYNTHETIC DEMO DATA: NOT REAL SERVICES"
NEAR_DAYS = 7                                     # a validity date within this many days is flagged as near (a display setting)


def dmy(iso: str | None) -> str:
    d = parse_date(iso or "")
    return d.strftime("%d/%m/%Y") if d else "NOT STATED"


@dataclass
class OwnerStatus:
    owner: str
    response_status: str
    referral: str | None
    plan_date: str | None
    valid_until: str | None                        # the owner's own validity (plan date plus the days the owner states)
    effective_valid_until: str | None              # the earlier of the owner's validity and the enquiry validity
    valid_days: int | None
    plans_received: bool
    content: str                                   # vector, raster, mixed, text, or none
    traced_draft: int = 0
    verified: int = 0
    rejected: int = 0
    excluded_files: list[str] = field(default_factory=list)
    georef: bool = False
    files: list[dict] = field(default_factory=list)

    def expired(self, today: date) -> bool:
        d = parse_date(self.effective_valid_until or "")
        return bool(d and today > d)


@dataclass
class DbydView:
    job_number: str | None
    enquiry_valid_until: str | None
    lodged: str | None
    responses_text: str | None
    site_address: str | None
    synthetic: bool
    owners: list[OwnerStatus]
    verified: list[dict]                           # verified services only (the ones a drawing may show)
    today: date
    messages: list[str] = field(default_factory=list)

    # ---- counts
    @property
    def n_owners(self) -> int:
        return len(self.owners)

    @property
    def n_received(self) -> int:
        return sum(1 for o in self.owners if (o.response_status or "").lower().startswith(("receiv", "response received")))

    @property
    def n_plans(self) -> int:
        return sum(1 for o in self.owners if o.plans_received)

    @property
    def n_draft(self) -> int:
        return sum(o.traced_draft for o in self.owners)

    @property
    def n_verified(self) -> int:
        return len(self.verified)

    # ---- validity
    def enquiry_days_left(self) -> int | None:
        d = parse_date(self.enquiry_valid_until or "")
        return (d - self.today).days if d else None

    def expiry_warning(self) -> str | None:
        n = self.enquiry_days_left()
        if n is None:
            return "THE VALIDITY DATE OF THE BYDA PLANS IS NOT STATED IN THE IMPORTED RESPONSE: CONFIRM IT BEFORE RELYING ON THE PLANS"
        if n < 0:
            return f"THE BYDA PLANS EXPIRED ON {dmy(self.enquiry_valid_until)} ({-n} DAYS AGO): A NEW ENQUIRY IS REQUIRED BEFORE ANY RELIANCE ON THESE PLANS"
        if n <= NEAR_DAYS:
            return f"THE BYDA PLANS EXPIRE ON {dmy(self.enquiry_valid_until)} ({n} DAYS): LODGE A NEW ENQUIRY BEFORE THAT DATE IF THE WORKS DO NOT START"
        return None

    # ---- text for the documents
    def drawn_label(self, f: dict) -> list[str]:
        """The label of one verified service: owner, service, plan date and the mandatory location statement."""
        return [f"{(f.get('owner') or 'OWNER NOT STATED').upper()} {str(f.get('service') or 'service').upper()} (EXISTING)", f"PLAN DATE {dmy(f.get('plan_date'))}", LABEL_TEXT]

    def not_confirmed_text(self) -> str:
        """The statement for the data not available panel and the notes when no service is verified."""
        if self.n_verified:
            return f"{self.n_verified} VERIFIED BYDA SERVICE(S) DRAWN: ALL OTHER EXISTING SERVICES ARE NOT CONFIRMED"
        got = f"{self.n_received} OF {self.n_owners} BYDA RESPONSES RECEIVED" if self.n_owners else "NO BYDA RESPONSE RECORDED"
        return f"EXISTING SERVICES NOT CONFIRMED: {got}, {self.n_draft} SERVICE(S) TRACED AS DRAFT, NONE VERIFIED, SO NONE IS DRAWN"

    def expiry_warning_plain(self) -> str | None:
        """The expiry warning as a formal sentence in ordinary case (report and SoEE)."""
        n = self.enquiry_days_left()
        if n is None:
            return "The validity date of the BYDA plans is not stated in the imported response. Confirm it before relying on the plans."
        if n < 0:
            return f"The BYDA plans expired on {dmy(self.enquiry_valid_until)} ({-n} days ago). A new enquiry is required before any reliance on these plans."
        if n <= NEAR_DAYS:
            return f"The BYDA plans expire on {dmy(self.enquiry_valid_until)} ({n} days). Lodge a new enquiry before that date if the works do not start."
        return None

    def status_header(self, upper: bool = True) -> tuple[str, ...]:
        h = ("Owner", "Response", "Plans", "Draft", "Verified", "Valid until")
        return tuple(x.upper() for x in h) if upper else h

    def status_rows(self, upper: bool = True) -> list[tuple[str, ...]]:
        rows = []
        for o in self.owners:
            if not o.plans_received:
                plans = "Not received" + (" (file excluded by BYDA)" if o.excluded_files else "")
            else:
                plans = f"Received, {o.content}" + (", georeferenced" if o.georef else "")
            vu = dmy(o.effective_valid_until)
            if o.expired(self.today):
                vu += " expired"
            rows.append((o.owner, (o.response_status or "Not stated"), plans, str(o.traced_draft), str(o.verified), vu))
        return [tuple(c.upper() for c in r) for r in rows] if upper else rows

    def summary_lines(self) -> list[str]:
        out = []
        if self.job_number:
            out.append(f"BYDA JOB {self.job_number}" + (f", LODGED {dmy(self.lodged)}" if self.lodged else "") + (f", PLANS VALID UNTIL {dmy(self.enquiry_valid_until)}" if self.enquiry_valid_until else ", VALIDITY NOT STATED"))
        if self.responses_text:
            out.append(self.responses_text.upper())
        out.append(f"{self.n_plans} OF {self.n_owners} OWNERS: PLANS RECEIVED; {self.n_draft} SERVICE(S) TRACED (DRAFT), {self.n_verified} VERIFIED")
        w = self.expiry_warning()
        if w:
            out.append(w)
        if self.synthetic:
            out.append(SYNTHETIC_STAMP)
        return out


def build_view(registry: dict | None, features: list[dict], today: date | None = None) -> DbydView | None:
    """The view from a registry dict and the list of traced services (all statuses; only verified ones are kept for drawing)."""
    if not registry:
        return None
    today = today or date.today()
    owners: list[OwnerStatus] = []
    for o in registry.get("owners") or []:
        fs = [f for f in features if (f.get("owner") or "").lower() == o["owner"].lower()]
        plan_files = [f for f in o.get("files") or [] if f.get("plan_candidate")]
        kinds = {f.get("content") for f in plan_files}
        content = "none" if not plan_files else (kinds.pop() if len(kinds) == 1 else "mixed")
        owners.append(OwnerStatus(
            owner=o["owner"], response_status=o.get("response_status") or "", referral=o.get("referral"), plan_date=o.get("plan_date"), valid_until=o.get("valid_until"),
            effective_valid_until=o.get("effective_valid_until"), valid_days=o.get("valid_days"), plans_received=bool(o.get("plans_received")), content=content,
            traced_draft=sum(1 for f in fs if f.get("status") == "draft"), verified=sum(1 for f in fs if f.get("status") == "verified"),
            rejected=sum(1 for f in fs if f.get("status") == "rejected"), excluded_files=[f["name"] for f in o.get("files") or [] if f.get("excluded")],
            georef=any(f.get("georef") for f in plan_files), files=o.get("files") or []))
    ver = [dict(f) for f in features if f.get("status") == "verified"]
    pd = {o["owner"].lower(): o.get("plan_date") for o in registry.get("owners") or []}
    for f in ver:
        f["plan_date"] = f.get("plan_date") or pd.get((f.get("owner") or "").lower())
    return DbydView(job_number=registry.get("job_number"), enquiry_valid_until=registry.get("enquiry_valid_until"), lodged=registry.get("lodged"),
                    responses_text=registry.get("responses_text"), site_address=registry.get("site_address"), synthetic=bool(registry.get("synthetic")),
                    owners=owners, verified=ver, today=today, messages=list(registry.get("messages") or []))


def load_view(project_dir: str | Path | None, today: date | None = None) -> DbydView | None:
    """The view for a project folder (``<project>/dbyd``), or None when the project has no BYDA registry (no enquiry recorded)."""
    if not project_dir:
        return None
    reg = load_registry(project_dir)
    return build_view(reg, TraceStore(project_dir).features(), today)
