"""Platform-wide statements.  One definition, imported by every producer (plan set, report, SoEE, 3D scene bundle, API).

Stage 8 (21/10/2026): documents (plan set cover, site report cover, SoEE cover) carry ``VERIFY_STATEMENT`` with a tick box and name, signature and date fields, on the FRONT
only.  The AI draft statement is kept for the non-document producers (3D scene bundle, API payloads, first design) that have no cover page.
"""
from __future__ import annotations

AI_DRAFT_STATEMENT = ("AI GENERATED DRAFT, NOT CHECKED OR CERTIFIED, MUST BE CHECKED AND VERIFIED BY A QUALIFIED PERSON "
                      "BEFORE ANY USE.")

VERIFY_STATEMENT = "TO BE VERIFIED BY A SUITABLY QUALIFIED PERSON"
VERIFY_TICK = "VERIFIED"
VERIFY_FIELDS = ("NAME", "SIGNATURE", "DATE")
VERIFY_TITLE = "VERIFICATION"

__all__ = ["AI_DRAFT_STATEMENT", "VERIFY_STATEMENT", "VERIFY_TICK", "VERIFY_FIELDS", "VERIFY_TITLE"]
