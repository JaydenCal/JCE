"""Company branding for title blocks, report covers and pack covers.

The default brand is JCE Infrastructure (logo retrieved from jceinfrastructure.com.au on 2026-10-12). Contact details
and registration numbers are NOT filled in here: set them through the profile/organisation settings or environment
variables so nothing is invented. Other organisations (custom municipalities, white-label partners) supply their own
logo through `Brand.from_env` / the organisation record.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ASSETS = Path(__file__).parent / "assets"


@dataclass(frozen=True)
class Brand:
    company_name: str = "JCE Infrastructure"
    trading_line: str = "Civil engineering and land development"      # editable; shown under the logo on title blocks
    website: str = "jceinfrastructure.com.au"
    logo_path: Path = ASSETS / "jce_logo.webp"                          # RGBA, transparent background, gold outline lettering
    logo_alt: str = "JCE"
    abn: str | None = None
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    registrations: tuple[str, ...] = field(default_factory=tuple)       # e.g. ("CPEng NER 0000000",) entered by the owner

    @classmethod
    def from_env(cls, env=None) -> "Brand":
        e = os.environ if env is None else env
        b = cls()
        kw = {}
        for k, var in (("company_name", "BRAND_COMPANY"), ("trading_line", "BRAND_TAGLINE"), ("website", "BRAND_WEBSITE"),
                       ("abn", "BRAND_ABN"), ("address", "BRAND_ADDRESS"), ("phone", "BRAND_PHONE"), ("email", "BRAND_EMAIL")):
            if e.get(var):
                kw[k] = e[var]
        if e.get("BRAND_LOGO"):
            kw["logo_path"] = Path(e["BRAND_LOGO"])
        if e.get("BRAND_REGISTRATIONS"):
            kw["registrations"] = tuple(x.strip() for x in e["BRAND_REGISTRATIONS"].split(";") if x.strip())
        return cls(**{**b.__dict__, **kw})


DEFAULT_BRAND = Brand()
