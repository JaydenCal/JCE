"""BYDA configuration from the environment. The secret is held in a wrapper whose repr and str never show it."""
from __future__ import annotations

import os
from dataclasses import dataclass, field

DEFAULT_BASE_URL = "https://smarterwx.byda.com.au"          # the host of the confirmed token endpoint
#: enquiries per user in the window (the owner stated about 90 per 15 minutes); both are configurable
DEFAULT_RATE_MAX = 90
DEFAULT_RATE_WINDOW_S = 15 * 60
#: how long a token is trusted when the token response states no lifetime (UNCONFIRMED field name); a 401 always forces a new token
DEFAULT_TOKEN_FALLBACK_S = 60
#: seconds before the stated expiry at which a token is renewed
TOKEN_SKEW_S = 30
TIMEOUT_S = 20.0
LIVE_OFF_MESSAGE = ("THE BYDA CONNECTION IS IN SANDBOX MODE AND LIVE CALLS ARE OFF, SO NOTHING WAS SENT TO BYDA. SET BYDA_ALLOW_LIVE=true ON THE SERVER TO ALLOW LIVE CALLS "
                    "WHILE IN SANDBOX MODE (BYDA_MODE=commercial IS FOR AFTER BYDA'S CONSENT)")


class Secret:
    """A string that never prints itself."""
    __slots__ = ("_v",)

    def __init__(self, value: str) -> None:
        self._v = value

    def reveal(self) -> str:
        return self._v

    def __repr__(self) -> str:
        return "Secret(***)"

    __str__ = __repr__

    def __bool__(self) -> bool:
        return bool(self._v)


def _int(name: str, default: int) -> int:
    try:
        v = int(os.environ.get(name, ""))
        return v if v > 0 else default
    except ValueError:
        return default


@dataclass(frozen=True)
class BydaConfig:
    client_id: Secret = field(default_factory=lambda: Secret(""))
    client_secret: Secret = field(default_factory=lambda: Secret(""))
    base_url: str = DEFAULT_BASE_URL
    webhook_secret: Secret = field(default_factory=lambda: Secret(""))
    webhook_hmac_header: str = ""            # UNCONFIRMED: name of a header carrying an HMAC SHA256 of the body, when the specification defines one
    rate_max: int = DEFAULT_RATE_MAX
    rate_window_s: int = DEFAULT_RATE_WINDOW_S
    token_fallback_s: int = DEFAULT_TOKEN_FALLBACK_S
    mode: str = "SANDBOX"
    #: SANDBOX mode makes no live call unless this is true (BYDA_ALLOW_LIVE=true). COMMERCIAL mode is live by definition.
    allow_live: bool = False

    @property
    def configured(self) -> bool:
        return bool(self.client_id) and bool(self.client_secret)

    @property
    def live_blocked(self) -> bool:
        """True in SANDBOX mode without BYDA_ALLOW_LIVE=true: no call to BYDA may leave this server (lodge, list, refresh, token, files)."""
        return self.mode != "COMMERCIAL" and not self.allow_live

    @classmethod
    def from_env(cls) -> "BydaConfig":
        e = os.environ
        return cls(Secret(e.get("BYDA_CLIENT_ID", "")), Secret(e.get("BYDA_CLIENT_SECRET", "")), (e.get("BYDA_BASE_URL") or DEFAULT_BASE_URL).rstrip("/"),
                   Secret(e.get("BYDA_WEBHOOK_SECRET", "")), e.get("BYDA_WEBHOOK_HMAC_HEADER", "").strip(), _int("BYDA_RATE_MAX", DEFAULT_RATE_MAX),
                   _int("BYDA_RATE_WINDOW_S", DEFAULT_RATE_WINDOW_S), _int("BYDA_TOKEN_FALLBACK_S", DEFAULT_TOKEN_FALLBACK_S),
                   "SANDBOX" if (e.get("BYDA_MODE", "sandbox").strip().lower() != "commercial") else "COMMERCIAL",
                   e.get("BYDA_ALLOW_LIVE", "").strip().lower() == "true")
