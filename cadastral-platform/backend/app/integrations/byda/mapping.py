"""Every BYDA path, request field and response field in one place.

STATUS OF EACH ITEM. ``CONFIRMED`` came from the owner (15/10/2026). ``UNCONFIRMED`` was not readable (the BYDA documentation pages
https://help.byda.com.au/article/api-integration/, https://help.byda.com.au/api-spec/enquiries and https://help.byda.com.au/api-spec/system could not be fetched), so the
name is the best reading of the endpoint family and MUST be checked against the specification before use against the live service. The client treats an unexpected
response as an error (BYDA_UNEXPECTED_RESPONSE), never as data.
"""
from __future__ import annotations

from typing import Any

CONFIRMED, UNCONFIRMED = "CONFIRMED", "UNCONFIRMED"

#: name -> (method, path, status)
ENDPOINTS: dict[str, tuple[str, str, str]] = {
    "token": ("POST", "/api/community/auth/tokens", CONFIRMED),
    "lodge_enquiry": ("POST", "/api/community/enquiries", UNCONFIRMED),
    "list_enquiries": ("GET", "/api/community/enquiries", UNCONFIRMED),
    "get_enquiry": ("GET", "/api/community/enquiries/{enquiry_id}", UNCONFIRMED),
    "list_responses": ("GET", "/api/community/enquiries/{enquiry_id}/responses", UNCONFIRMED),
    "download_response_file": ("GET", "/api/community/enquiries/{enquiry_id}/responses/{response_id}/files/{file_id}", UNCONFIRMED),
}
#: token request and response field names. ``clientId``, ``clientSecret`` and ``access_token`` are CONFIRMED; the lifetime field is UNCONFIRMED.
TOKEN_REQUEST_FIELDS = ("clientId", "clientSecret")
TOKEN_FIELD = "access_token"
TOKEN_LIFETIME_FIELD = "expires_in"                                  # UNCONFIRMED (seconds)
#: normalised enquiry record <- the first present key of these (UNCONFIRMED names)
ENQUIRY_KEYS = {"id": ("id", "enquiryId", "enquiry_id"), "job_number": ("jobNumber", "job_number", "referenceNumber", "reference"), "status": ("status", "state"),
                "created_at": ("createdAt", "created_at", "created"), "expires_at": ("expiresAt", "expires_at", "expiry")}
RESPONSE_KEYS = {"id": ("id", "responseId", "response_id"), "owner": ("assetOwner", "owner", "organisation", "organization", "name"), "status": ("status", "state"),
                 "received_at": ("respondedAt", "receivedAt", "created_at", "createdAt"), "files": ("files", "attachments", "documents")}
FILE_KEYS = {"id": ("id", "fileId", "file_id"), "name": ("name", "fileName", "filename"), "size": ("size", "sizeBytes", "bytes"), "type": ("contentType", "mimeType", "type")}
LIST_WRAPPERS = ("items", "data", "results", "enquiries", "responses")        # UNCONFIRMED list envelopes
#: PAGING of the enquiry list. ALL of this is UNCONFIRMED (the specification could not be read). The client asks for page 1 with no parameter, then for ``page`` = 2, 3 ...
#: while the body says there is more, up to a page limit. The body states "more" by ANY of: a true ``has_more`` field, a ``next_page`` field holding a page number, a
#: ``total_pages`` field above the page just read. The page just read is the body's own ``page`` field when it has one, else the number requested. These fields are looked
#: up in the body and in the envelopes of ``PAGING_ENVELOPES``. A cursor scheme (``next_cursor`` sent back as ``cursor``) is read too. A page that repeats the previous page,
#: or has no items, ends the paging.
PAGE_PARAM = "page"                                                         # UNCONFIRMED
CURSOR_PARAM = "cursor"                                                     # UNCONFIRMED
PAGING_ENVELOPES = ("pagination", "meta", "paging", "page_info", "pageInfo")
PAGING_KEYS = {"has_more": ("hasMore", "has_more", "hasNext", "has_next"), "next_page": ("nextPage", "next_page"), "total_pages": ("totalPages", "total_pages", "pages"),
               "page": ("page", "currentPage", "current_page"), "next_cursor": ("nextCursor", "next_cursor", "cursor")}
#: the client reads at most this many pages of the enquiry list in one call (a sanity limit, not a BYDA value)
MAX_LIST_PAGES = 20
#: a name for a reference of our own sent with a lodge request; None until the specification confirms a field for it (then the client reference is sent as well as stored)
CLIENT_REFERENCE_FIELD: str | None = None                                   # UNCONFIRMED


def first(d: dict[str, Any], names: tuple[str, ...]) -> Any:
    for n in names:
        if n in d and d[n] is not None:
            return d[n]
    return None


def as_list(body: Any) -> list[dict[str, Any]] | None:
    """A response body as a list of objects, or None when it is not one (a bare list, or an object holding a list under a known envelope key)."""
    if isinstance(body, list):
        return [x for x in body if isinstance(x, dict)]
    if isinstance(body, dict):
        for k in LIST_WRAPPERS:
            if isinstance(body.get(k), list):
                return [x for x in body[k] if isinstance(x, dict)]
    return None


def normalise(item: dict[str, Any], keys: dict[str, tuple[str, ...]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, names in keys.items():
        v = first(item, names)
        out[k] = v if isinstance(v, (str, int, float, bool, list)) or v is None else None
    return out


def normalise_response(item: dict[str, Any]) -> dict[str, Any]:
    r = normalise(item, RESPONSE_KEYS)
    files = first(item, RESPONSE_KEYS["files"])
    r["files"] = [normalise(f, FILE_KEYS) for f in files if isinstance(f, dict)] if isinstance(files, list) else []
    return r


def _paging_value(body: dict[str, Any], names: tuple[str, ...]) -> Any:
    v = first(body, names)
    if v is not None:
        return v
    for env in PAGING_ENVELOPES:
        inner = body.get(env)
        if isinstance(inner, dict):
            v = first(inner, names)
            if v is not None:
                return v
    return None


def next_request(body: Any, requested_page: int) -> tuple[str, str] | None:
    """What to ask for next after reading one page of a list: ``("page", "3")`` or ``("cursor", "abc")``, or None when the body says it was the last page (or states nothing).
    A bare list states nothing, so it is the whole list."""
    if not isinstance(body, dict):
        return None
    cur = _paging_value(body, PAGING_KEYS["next_cursor"])
    if isinstance(cur, str) and cur:
        return (CURSOR_PARAM, cur)
    page = _paging_value(body, PAGING_KEYS["page"])
    page = page if isinstance(page, int) and not isinstance(page, bool) and page >= 1 else requested_page
    nxt = _paging_value(body, PAGING_KEYS["next_page"])
    if isinstance(nxt, int) and not isinstance(nxt, bool) and nxt > page:
        return (PAGE_PARAM, str(nxt))
    total = _paging_value(body, PAGING_KEYS["total_pages"])
    if isinstance(total, int) and not isinstance(total, bool) and total > page:
        return (PAGE_PARAM, str(page + 1))
    if _paging_value(body, PAGING_KEYS["has_more"]) is True:
        return (PAGE_PARAM, str(page + 1))
    return None


def enquiry_payload(polygon_lonlat: list[list[float]], *, description: str | None, start_date: str | None, end_date: str | None, client_reference: str | None = None) -> dict[str, Any]:
    """The body of a lodge request (field names UNCONFIRMED). ``polygon_lonlat`` is the closed outer ring in WGS84 longitude, latitude as a GeoJSON Polygon."""
    body: dict[str, Any] = {"geometry": {"type": "Polygon", "coordinates": [polygon_lonlat]}}
    if description:
        body["workDescription"] = description
    if start_date:
        body["startDate"] = start_date
    if end_date:
        body["endDate"] = end_date
    if client_reference and CLIENT_REFERENCE_FIELD:
        body[CLIENT_REFERENCE_FIELD] = client_reference
    return body
