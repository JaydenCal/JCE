"""Building linked driveway end, resolved on the server.

A driveway whose end is dropped on a building carries ``end_building_id`` (the link). The link is the source of truth for the end level: the end level
IS that building's finished floor level (``ffl_rl``), read when the driveway is computed or exported. Whatever ``end_level_rl`` the object also carries
(a level typed before the link, or a copy the browser wrote) is never used while a link exists, so it can never be stale.

Where the building comes from, in order:

1. the SAVED site design of the project (``design``), by id; or
2. the building object sent with the request (``sent``), accepted only when the saved design holds a building with the same id (and, when both carry
   one, the same stored import) so a client cannot name a building the project does not have. The sent object supplies the CURRENT floor level and
   footprint, which may be edited in the browser and not saved yet.

Nothing is invented: a building with no FFL leaves the end level NOT SET ("END LEVEL NOT SET"); a link to a building that is not in the saved design is
also NOT SET and says so.
"""
from __future__ import annotations

from dataclasses import dataclass

from .site_design import Param, SiteDesign, SiteObject

KEY_LINK, KEY_END = "end_building_id", "end_level_rl"
END_LEVEL_NOT_SET = "END LEVEL NOT SET"


@dataclass(frozen=True)
class LinkedEnd:
    """Result of resolving the link of one driveway."""
    linked: bool
    building_id: str | None = None
    building: SiteObject | None = None        # the building whose FFL and footprint are used
    ffl_rl: float | None = None
    note: str = ""                            # why the end level is NOT SET, or "" when it is resolved or there is no link


def link_id(obj: SiteObject) -> str | None:
    p = obj.params.get(KEY_LINK)
    return p.value if p is not None and p.basis != "unresolved" and isinstance(p.value, str) and p.value else None


def _ffl(b: SiteObject) -> float | None:
    p = b.params.get("ffl_rl")
    if p is None or p.basis == "unresolved" or isinstance(p.value, bool) or not isinstance(p.value, (int, float)):
        return None
    return float(p.value)


def _building(design: SiteDesign | None, bid: str) -> SiteObject | None:
    return next((o for o in design.objects if o.id == bid and o.type == "building"), None) if design is not None else None


def resolve_end_building(obj: SiteObject, design: SiteDesign | None, sent: SiteObject | None = None) -> LinkedEnd:
    """Resolve ``end_building_id`` of a driveway against the saved design and, optionally, a building object sent with the request."""
    bid = link_id(obj)
    if bid is None:
        return LinkedEnd(False)
    saved = _building(design, bid)
    if sent is not None:
        if sent.type != "building" or sent.id != bid:
            return LinkedEnd(True, bid, None, None, f"{END_LEVEL_NOT_SET}: THE BUILDING SENT IS NOT THE LINKED BUILDING {bid}")
        if saved is None:
            return LinkedEnd(True, bid, None, None, f"{END_LEVEL_NOT_SET}: THE LINKED BUILDING {bid} IS NOT IN THE SAVED SITE DESIGN (SAVE THE DESIGN FIRST)")
        si, vi = saved.building.import_id if saved.building else None, sent.building.import_id if sent.building else None
        if si is not None and vi is not None and si != vi:
            return LinkedEnd(True, bid, None, None, f"{END_LEVEL_NOT_SET}: THE BUILDING SENT IS NOT THE SAVED BUILDING {bid} (DIFFERENT IMPORT)")
        b = sent
    elif saved is not None:
        b = saved
    else:
        return LinkedEnd(True, bid, None, None, f"{END_LEVEL_NOT_SET}: THE LINKED BUILDING {bid} IS NOT IN THE SAVED SITE DESIGN")
    ffl = _ffl(b)
    return LinkedEnd(True, bid, b, ffl, "" if ffl is not None else f"{END_LEVEL_NOT_SET}: THE LINKED BUILDING {bid} HAS NO FFL")


def with_end_level(obj: SiteObject, link: LinkedEnd) -> SiteObject:
    """The driveway as the engine must see it: with a link, ``end_level_rl`` is the building FFL (or unresolved); without one the object is unchanged."""
    if not link.linked:
        return obj
    b = link.building
    param = (Param(value=link.ffl_rl, basis="user", ref=f"FFL OF {(b.label or b.id).upper()}") if link.ffl_rl is not None and b is not None
             else Param(value=None, basis="unresolved"))
    return obj.model_copy(update={"params": {**obj.params, KEY_END: param}})
