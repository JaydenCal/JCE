"""BYDA SmarterWX client with an injectable transport (tests use a fake; the sandbox cannot reach byda.com.au).

* Token: POST the credentials, keep the access token until its stated lifetime (minus a skew) or the configured fallback, renew on expiry and once on a 401.
* Calls: lodge an enquiry, list enquiries, get one, list its responses, download a response file when the API serves one. Anything other than the token is UNCONFIRMED
  (see ``mapping``). A response that does not have the expected shape raises BYDA_UNEXPECTED_RESPONSE.
* Logging: only the method, the path name and the status code. Never headers, bodies, credentials or tokens; errors carry a code and a plain message only.
* Redirects are never followed: a redirect would send the Authorization header (or the credentials) to wherever the server points, so a 3xx answer is an error.
* SANDBOX mode makes no live call unless BYDA_ALLOW_LIVE=true: with the real transport, every call is refused before it leaves the server (BYDA_LIVE_OFF). A test transport
  injected by the caller is not a live call and is not blocked.
* A call that fails AFTER the request was sent (a timeout, a dropped connection, a 5xx, an answer that is not the expected shape) carries ``after_send`` true. For a lodge
  request that means the outcome is unknown: BYDA may or may not have created the enquiry (see ``BydaError.ambiguous`` and api/dbyd.py).
"""
from __future__ import annotations

import http.client
import json
import logging
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

from . import mapping as M
from .config import LIVE_OFF_MESSAGE, TIMEOUT_S, TOKEN_SKEW_S, BydaConfig, Secret

log = logging.getLogger("jce.byda")
MAX_RESPONSE_BYTES = 25 * 1024 * 1024

#: transport(method, url, headers, body_bytes_or_None, timeout) -> (status, response_headers, response_bytes)
Transport = Callable[[str, str, dict[str, str], "bytes | None", float], "tuple[int, dict[str, str], bytes]"]


class BydaError(Exception):
    def __init__(self, code: str, message: str, status: int | None = None, *, after_send: bool = False) -> None:
        super().__init__(message)
        self.code, self.message, self.status = code, message, status
        #: the request had been sent when this failed (so BYDA may have acted on it)
        self.after_send = after_send

    @property
    def ambiguous(self) -> bool:
        """After a request was sent, the failure leaves the outcome unknown unless BYDA answered with a 4xx (a refusal: nothing was created)."""
        return self.after_send and not (self.status is not None and 400 <= self.status < 500)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never follow a redirect: the 3xx answer comes back as an HTTPError and is reported as BYDA_REDIRECT_REFUSED."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):          # noqa: D401, ANN001
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def urllib_transport(method: str, url: str, headers: dict[str, str], body: bytes | None, timeout: float) -> tuple[int, dict[str, str], bytes]:
    if not url.lower().startswith("https://"):
        raise BydaError("BYDA_INSECURE_URL", "THE BYDA URL MUST BE HTTPS")
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with _OPENER.open(req, timeout=timeout) as r:                                # noqa: S310 (https enforced above; redirects refused by the opener)
            return r.status, dict(r.headers.items()), r.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as e:
        if 300 <= e.code < 400:
            raise BydaError("BYDA_REDIRECT_REFUSED", f"BYDA ANSWERED WITH A REDIRECT (STATUS {e.code}); REDIRECTS ARE NOT FOLLOWED BECAUSE THEY WOULD SEND THE CREDENTIALS ELSEWHERE", e.code, after_send=True) from None
        return e.code, dict(e.headers.items()) if e.headers else {}, e.read(MAX_RESPONSE_BYTES + 1) if e.fp else b""
    except urllib.error.URLError as e:
        before = isinstance(e.reason, (socket.gaierror, ConnectionRefusedError))      # no connection was made: nothing was sent
        raise BydaError("BYDA_UNREACHABLE", "BYDA COULD NOT BE REACHED", after_send=not before) from None
    except (TimeoutError, http.client.HTTPException, OSError):
        raise BydaError("BYDA_UNREACHABLE", "BYDA COULD NOT BE REACHED", after_send=True) from None


class BydaClient:
    def __init__(self, config: BydaConfig, transport: Transport | None = None, clock: Callable[[], float] = time.monotonic) -> None:
        self.config = config
        self._real = transport is None                                      # only the real transport reaches BYDA; a transport injected by a test is not a live call
        self._transport = transport or urllib_transport
        self._clock = clock
        self._token: Secret | None = None
        self._expires = 0.0
        self._lock = threading.Lock()

    def _guard_live(self) -> None:
        if self._real and self.config.live_blocked:
            raise BydaError("BYDA_LIVE_OFF", LIVE_OFF_MESSAGE)

    # ---- token
    def _fetch_token(self) -> Secret:
        self._guard_live()
        if not self.config.configured:
            raise BydaError("BYDA_NOT_CONFIGURED", "BYDA CREDENTIALS ARE NOT CONFIGURED (SET BYDA_CLIENT_ID AND BYDA_CLIENT_SECRET)")
        method, path, _st = M.ENDPOINTS["token"]
        body = json.dumps({M.TOKEN_REQUEST_FIELDS[0]: self.config.client_id.reveal(), M.TOKEN_REQUEST_FIELDS[1]: self.config.client_secret.reveal()}).encode()
        status, _h, raw = self._transport(method, self.config.base_url + path, {"Content-Type": "application/json", "Accept": "application/json"}, body, TIMEOUT_S)
        log.info("byda token status=%s", status)
        if status != 200:
            raise BydaError("BYDA_AUTH_FAILED", f"BYDA REFUSED THE CREDENTIALS (STATUS {status})", status)
        try:
            data = json.loads(raw.decode("utf-8"))
            tok = data[M.TOKEN_FIELD]
        except (ValueError, KeyError, TypeError, AttributeError):
            raise BydaError("BYDA_UNEXPECTED_RESPONSE", "THE BYDA TOKEN RESPONSE HAD NO ACCESS TOKEN") from None
        if not isinstance(tok, str) or not tok:
            raise BydaError("BYDA_UNEXPECTED_RESPONSE", "THE BYDA TOKEN RESPONSE HAD NO ACCESS TOKEN")
        life = data.get(M.TOKEN_LIFETIME_FIELD)
        life_s = float(life) if isinstance(life, (int, float)) and not isinstance(life, bool) and life > 0 else float(self.config.token_fallback_s)
        self._expires = self._clock() + (life_s - TOKEN_SKEW_S if life_s > 2 * TOKEN_SKEW_S else life_s / 2)
        return Secret(tok)

    def token(self, force: bool = False) -> Secret:
        with self._lock:
            if force or self._token is None or self._clock() >= self._expires:
                self._token = self._fetch_token()
            return self._token

    # ---- requests
    def _call(self, name: str, *, params: dict[str, str] | None = None, body: dict[str, Any] | None = None, **path_args: str) -> tuple[int, dict[str, str], bytes]:
        method, path, _st = M.ENDPOINTS[name]
        url = self.config.base_url + path.format(**{k: urllib.parse.quote(str(v), safe="") for k, v in path_args.items()})
        if params:
            url += "?" + "&".join(f"{urllib.parse.quote(k)}={urllib.parse.quote(str(v))}" for k, v in params.items())
        raw = json.dumps(body).encode() if body is not None else None
        self._guard_live()
        for attempt in (0, 1):
            tok = self.token(force=attempt == 1)
            headers = {"Authorization": "Bearer " + tok.reveal(), "Accept": "application/json"}
            if raw is not None:
                headers["Content-Type"] = "application/json"
            status, rh, data = self._transport(method, url, headers, raw, TIMEOUT_S)
            log.info("byda call=%s status=%s", name, status)
            if status == 401 and attempt == 0:
                continue                                                   # the token may have expired early: renew once
            break
        if status in (401, 403):
            raise BydaError("BYDA_AUTH_FAILED", f"BYDA REFUSED THE REQUEST (STATUS {status})", status, after_send=True)
        if status == 429:
            raise BydaError("BYDA_RATE_LIMITED", "BYDA SAYS TOO MANY REQUESTS; TRY LATER", status, after_send=True)
        if status == 404:
            raise BydaError("BYDA_NOT_FOUND", "BYDA HAS NO SUCH RESOURCE (THE ENDPOINT IS UNCONFIRMED OR THE ID IS WRONG)", status, after_send=True)
        if not 200 <= status < 300:
            raise BydaError("BYDA_ERROR", f"BYDA ANSWERED WITH STATUS {status}", status, after_send=True)
        if len(data) > MAX_RESPONSE_BYTES:
            raise BydaError("BYDA_RESPONSE_TOO_LARGE", "THE BYDA RESPONSE IS LARGER THAN THE LIMIT", after_send=True)
        return status, rh, data

    @staticmethod
    def _json(data: bytes) -> Any:
        try:
            return json.loads(data.decode("utf-8"))
        except ValueError:
            raise BydaError("BYDA_UNEXPECTED_RESPONSE", "THE BYDA RESPONSE WAS NOT JSON", after_send=True) from None

    # ---- operations (all UNCONFIRMED paths)
    def lodge_enquiry(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Lodge an enquiry. A failure after the request was sent is a BydaError with ``ambiguous`` true unless BYDA refused with a 4xx: the enquiry may exist."""
        _s, _h, data = self._call("lodge_enquiry", body=payload)
        body = self._json(data)
        if not isinstance(body, dict):
            raise BydaError("BYDA_UNEXPECTED_RESPONSE", "THE BYDA ENQUIRY RESPONSE WAS NOT AN OBJECT", after_send=True)
        rec = M.normalise(body, M.ENQUIRY_KEYS)
        if rec["id"] is None and rec["job_number"] is None:
            raise BydaError("BYDA_UNEXPECTED_RESPONSE", "THE BYDA ENQUIRY RESPONSE HAD NO ENQUIRY ID OR JOB NUMBER", after_send=True)
        return rec

    def list_enquiries_paged(self, max_pages: int = M.MAX_LIST_PAGES) -> tuple[list[dict[str, Any]], bool]:
        """Every enquiry BYDA lists, following the paging fields of the mapping (UNCONFIRMED), at most ``max_pages`` pages. Returns (enquiries, truncated): truncated is
        true when the body still said there was more after the last page read. A page with no items, or one that repeats the previous page, ends the paging."""
        out: list[dict[str, Any]] = []
        seen_pages: list[list[Any]] = []
        param: tuple[str, str] | None = None
        requested = 1
        for _n in range(1, max_pages + 1):
            _s, _h, data = self._call("list_enquiries", params={param[0]: param[1]} if param else None)
            body = self._json(data)
            items = M.as_list(body)
            if items is None:
                raise BydaError("BYDA_UNEXPECTED_RESPONSE", "THE BYDA ENQUIRY LIST WAS NOT A LIST", after_send=True)
            recs = [M.normalise(i, M.ENQUIRY_KEYS) for i in items]
            key = [(r.get("id"), r.get("job_number")) for r in recs]
            if not recs or key in seen_pages:
                return out, False
            seen_pages.append(key)
            out += recs
            param = M.next_request(body, requested)
            if param is None:
                return out, False
            if param[0] == M.PAGE_PARAM:
                requested = int(param[1])
        return out, True

    def list_enquiries(self, max_pages: int = M.MAX_LIST_PAGES) -> list[dict[str, Any]]:
        return self.list_enquiries_paged(max_pages)[0]

    def get_enquiry(self, enquiry_id: str) -> dict[str, Any]:
        _s, _h, data = self._call("get_enquiry", enquiry_id=enquiry_id)
        body = self._json(data)
        if not isinstance(body, dict):
            raise BydaError("BYDA_UNEXPECTED_RESPONSE", "THE BYDA ENQUIRY WAS NOT AN OBJECT")
        return M.normalise(body, M.ENQUIRY_KEYS)

    def list_responses(self, enquiry_id: str) -> list[dict[str, Any]]:
        _s, _h, data = self._call("list_responses", enquiry_id=enquiry_id)
        items = M.as_list(self._json(data))
        if items is None:
            raise BydaError("BYDA_UNEXPECTED_RESPONSE", "THE BYDA RESPONSE LIST WAS NOT A LIST")
        return [M.normalise_response(i) for i in items]

    def download_response_file(self, enquiry_id: str, response_id: str, file_id: str) -> tuple[bytes, str]:
        """(bytes, content type). If the API does not serve files (404 or an HTML page) the plans arrive by email and are uploaded by hand (POST /dbyd/plans)."""
        _s, h, data = self._call("download_response_file", enquiry_id=enquiry_id, response_id=response_id, file_id=file_id)
        ctype = next((v for k, v in h.items() if k.lower() == "content-type"), "application/octet-stream")
        if "html" in ctype.lower():
            raise BydaError("BYDA_UNEXPECTED_RESPONSE", "THE BYDA FILE ENDPOINT ANSWERED WITH A WEB PAGE, NOT A FILE; UPLOAD THE PLAN YOU RECEIVED BY EMAIL INSTEAD")
        return data, ctype


_client: BydaClient | None = None
_client_lock = threading.Lock()


def get_client() -> BydaClient:
    """The process wide client built from the environment (tests override the API dependency, not this)."""
    global _client
    with _client_lock:
        if _client is None:
            _client = BydaClient(BydaConfig.from_env())
        return _client
