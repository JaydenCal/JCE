"""LGA name normalisation and the lga_code convention (pure functions, no imports from the rest of the app).

Convention (docs/14-3d-site-design-tools.md section 7, stage 2B):

    lga_code = "<state>-<slug>"          e.g. "nsw-gunnedah", "qld-cairns", "nsw-mid-western"

* ``<state>`` is the lowercase state code ("nsw" or "qld").
* ``<slug>`` is the LGA name with its status words removed ("Shire Council", "Regional Council", "City Council",
  "Municipal Council", "Council", "Shire", "Regional", "City", "Municipality", and the leading "City of", "Shire of",
  "Town of", "Municipality of"), any ABS style bracket suffix such as "(A)" or "(C)" removed, lowercased, with every run of
  characters other than a-z and 0-9 collapsed to a single hyphen.
* The same code keys the knowledge folder (backend/knowledge/<lga_code>/, with the older lowercase name folder such as
  ``gunnedah/`` still accepted) and the ``lga_code`` column of ``planning.requirements``.

The normalisation exists so that "GUNNEDAH" (NSW cadastre attribute), "Gunnedah Shire Council" (council documents) and
"Gunnedah" (knowledge files) all resolve to the same code. It never invents a state: with no state the code is None.
"""
from __future__ import annotations

import re
import unicodedata

STATES = ("NSW", "QLD")

_PREFIXES = re.compile(r"^(?:council of the (?:city|shire|town) of|city of|shire of|town of|municipality of|municipal council of|regional council of)\s+", re.I)
_SUFFIXES = re.compile(r"\s+(?:shire council|regional council|city council|municipal council|town council|council|"
                       r"shire|regional|city|municipality|municipal)$", re.I)
_BRACKETS = re.compile(r"\s*\([^)]*\)\s*")
_STATE_PREFIX = re.compile(r"^(nsw|qld)-(.+)$")


def lga_slug(name: str | None) -> str:
    """Normalised slug of an LGA name ("Gunnedah Shire Council" -> "gunnedah"). Empty string when nothing is left."""
    if not name:
        return ""
    s = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode("ascii")
    s = _BRACKETS.sub(" ", s).replace("&", " and ").strip()
    prev = None
    while prev != s:                                   # strip repeated status words ("Regional Council" -> nothing left of it)
        prev = s
        stripped = _PREFIXES.sub("", s).strip()
        stripped = _SUFFIXES.sub("", stripped).strip()
        s = stripped or s                              # never reduce a name to nothing ("City Council" keeps its words)
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def normalise_lga_code(state: str | None, name: str | None) -> str | None:
    """"<state>-<slug>" or None when the state or the name is missing/unsupported. Accepts an existing code unchanged."""
    if not state or not name:
        return None
    st = str(state).strip().upper()
    if st not in STATES:
        return None
    m = _STATE_PREFIX.match(str(name).strip().lower())
    if m and m.group(1).upper() == st:                 # already a code
        return str(name).strip().lower()
    slug = lga_slug(name)
    return f"{st.lower()}-{slug}" if slug else None


def lga_match_key(value: str | None) -> str:
    """Comparison key for selectors: the slug, ignoring a leading state code ("nsw-gunnedah" == "Gunnedah Shire Council")."""
    if not value:
        return ""
    v = str(value).strip()
    m = _STATE_PREFIX.match(v.lower())
    return m.group(2) if m else lga_slug(v)


def lga_state(value: str | None) -> str | None:
    """State carried by an lga_code style value ("qld-gunnedah" -> "QLD"), None for a bare name."""
    if not value:
        return None
    m = _STATE_PREFIX.match(str(value).strip().lower())
    return m.group(1).upper() if m else None


def same_lga(a: str | None, b: str | None, state_a: str | None = None, state_b: str | None = None) -> bool:
    """True when both values name the same LGA. The state is compared whenever BOTH sides carry one (from an lga_code
    prefix, or from the optional ``state_a``/``state_b`` the caller holds), so "qld-gunnedah" never matches "nsw-gunnedah"."""
    ka, kb = lga_match_key(a), lga_match_key(b)
    if not ka or ka != kb:
        return False
    sa = lga_state(a) or (state_a.strip().upper() if state_a else None)
    sb = lga_state(b) or (state_b.strip().upper() if state_b else None)
    return not (sa and sb and sa != sb)
