"""Design rainfall (stage 9): the provider interface, the BoM 2016 IFD table parser, the live provider stub and the ARR Data Hub export parser.

NOTHING HERE INVENTS RAINFALL. A depth or an intensity exists only as a value of a table that was uploaded by the user (parsed with its location, issue date, file name
and hash as provenance) or that an injected live client returned. The live request format of the BoM site is UNCONFIRMED (this sandbox cannot reach the BoM site), so the
default client refuses with ``LIVE_UNCONFIRMED`` and no value is guessed.

THE IFD CSV. The parser reads the table that the BoM 2016 IFD design rainfall page exports. The exact layout of that export has NOT been confirmed from a live download, so
the parser is tolerant and every assumption is recorded in the provenance (``assumptions``):

* The header row is the first row that has two or more cells that read as an exceedance column: an AEP in percent (``63.2%``, ``50%``, ``20%``, ``10%``, ``5%``, ``2%``,
  ``1%``) or an annual exceedance rate (``12EY``, ``6EY``, ``1EY``, ``0.5EY``). An EY column is converted with AEP = 1 - exp(-EY).
* Each row after the header starts with a duration written as a number and a unit (``5 min``, ``1 hour``, ``1.5 hour``, ``2 day``) followed by one number per column.
* The units (``intensity_mm_h`` or ``depth_mm``) are read from the lines above the table: the word intensity or ``mm/h`` for an intensity table, the word depth for a depth
  table. If the text does not say, or says both, the upload is refused unless the user declares the units at upload time (recorded as such).
* AEP MATCHING. A user AEP matches a table column when they differ by at most ``AEP_MATCH_TOL_PCT`` (0.05 percentage points, a matching tolerance of this tool, not a requirement). The
  BoM labels some columns in both forms (``63.2%`` and ``1EY`` are the same column, 1 - EXP(-1) = 63.21 percent). Two columns within the tolerance are one column: they are merged
  when their values agree and the upload is refused when they differ. A merged column keeps the exact EY conversion.
* HOSTILE FILES. A file is refused (never a server error) when a line is longer than ``MAX_LINE_CHARS``, a row has more cells than the header, a row has more than ``MAX_ROW_CELLS``
  cells, a value is not finite, is not above zero or is above ``MAX_VALUE``, or the csv reader itself fails. ``csv.field_size_limit`` is process wide and other modules read csv, so it is
  not changed: the line length check bounds every field instead.
* The latitude and longitude of the requested coordinate and of the grid cell are read from lines that contain ``Latitude`` and ``Longitude`` (with an optional N, S, E or W).
  The issue date is read from a line that starts with ``Issued``. A missing coordinate or date is stored as NOT STATED, never filled in.
"""
from __future__ import annotations

import csv
import functools
import hashlib
import io
import math
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Protocol

PARSER_VERSION = "bom_ifd_csv.v1"
ARR_PARSER_VERSION = "arr_datahub_txt.v1"
INTENSITY, DEPTH = "intensity_mm_h", "depth_mm"
MAX_ROWS = 400
MAX_COLS = 40
MAX_LINE_CHARS = 2000        # longest line (so longest field) accepted in an uploaded table
MAX_ROW_CELLS = 200          # most cells accepted in one row of an uploaded table
MAX_ARR_SECTIONS = 300       # most [sections] accepted in an ARR Data Hub export
MAX_VALUE = 1e5              # largest depth (mm) or intensity (mm/h) accepted: a sanity bound that keeps the arithmetic finite, not an engineering value
#: a user AEP matches a table column when the two differ by at most this many percentage points (the BoM prints 63.2% for 1EY, which is 63.21%)
AEP_MATCH_TOL_PCT = 0.05
LIVE_UNCONFIRMED = "LIVE_UNCONFIRMED"
#: the BoM design rainfall request format is NOT confirmed. This constant is shown wherever the live provider is offered.
LIVE_REQUEST_FORMAT = "UNCONFIRMED"
#: a table whose requested coordinate or grid cell is further than this (km) from the site is flagged. A warning limit of this tool, not a requirement.
LOCATION_WARN_KM = 5.0


class RainfallError(Exception):
    """A parse or provider failure. ``code`` is stable; the API answers 422 for a parse error."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code, self.message = code, message


_AEP = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*%?\s*(?:AEP)?\s*$", re.I)
_EY = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*EY\s*$", re.I)
_DUR = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*(min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)\s*$", re.I)
_COORD = re.compile(r"(?P<n>Latitude|Longitude)\s*[:=]?\s*(?P<v>[-+]?\d+(?:\.\d+)?)\s*(?:\(?\s*(?P<h>[NSEW])\s*\)?)?", re.I)


def _aep_cell(c: str) -> float | None:
    """The AEP (percent) a header cell stands for, or None. A bare number needs a percent sign to count (a duration cell must not read as a column)."""
    s = c.strip()
    m = _EY.match(s)
    if m:
        ey = float(m.group(1))
        return round((1.0 - math.exp(-ey)) * 100.0, 4) if ey > 0 else None
    if "%" in s or s.upper().endswith("AEP"):
        m = _AEP.match(s)
        if m:
            v = float(m.group(1))
            return v if 0 < v <= 100 else None
    return None


def parse_duration_min(c: str) -> float | None:
    m = _DUR.match(c.strip())
    if not m:
        return None
    v, u = float(m.group(1)), m.group(2).lower()
    mult = 1.0 if u.startswith("min") else 60.0 if u.startswith("h") else 1440.0
    d = v * mult
    return d if d > 0 and math.isfinite(d) else None


_DATE_FORMATS = ("%d %B %Y", "%d %b %Y", "%d/%m/%Y", "%Y-%m-%d", "%B %d, %Y", "%b %d, %Y", "%d-%m-%Y")


def parse_date(text: str) -> str | None:
    t = text.strip().strip('",;')
    for f in _DATE_FORMATS:
        try:
            return datetime.strptime(t, f).date().isoformat()
        except ValueError:
            continue
    return None


def _coords(line: str) -> dict[str, float] | None:
    got: dict[str, float] = {}
    for m in _COORD.finditer(line):
        v, h = float(m.group("v")), (m.group("h") or "").upper()
        if h in ("S", "W"):
            v = -abs(v)
        got[m.group("n").lower()[:3]] = v
    if "lat" in got and "lon" in got and -90 <= got["lat"] <= 90 and -180 <= got["lon"] <= 180:
        return {"lat": got["lat"], "lon": got["lon"]}
    return None


def decode(raw: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise RainfallError("NOT_TEXT", "THE FILE IS NOT TEXT THAT CAN BE READ (UTF-8 OR WINDOWS-1252)")


def read_csv_rows(text: str, *, max_rows: int, keep_blank: bool = False) -> list[list[str]]:
    """The rows of a csv text, bounded: a long line, too many rows, too many cells in a row or a csv reader failure is a ``RainfallError`` (422), never an exception of the csv module."""
    for line in text.splitlines():
        if len(line) > MAX_LINE_CHARS:
            raise RainfallError("FIELD_TOO_LONG", f"A LINE OF THE FILE HAS MORE THAN {MAX_LINE_CHARS} CHARACTERS. THIS IS NOT A DESIGN RAINFALL OR SOIL TABLE")
    out: list[list[str]] = []
    try:
        for r in csv.reader(io.StringIO(text)):
            if not keep_blank and not any(c.strip() for c in r):
                continue
            if len(r) > MAX_ROW_CELLS:
                raise RainfallError("TOO_MANY_COLUMNS", f"A ROW HAS MORE THAN {MAX_ROW_CELLS} CELLS")
            out.append(r)
            if len(out) > max_rows:
                raise RainfallError("TOO_MANY_ROWS", "THE FILE HAS TOO MANY ROWS FOR THIS TABLE")
    except csv.Error as e:
        raise RainfallError("CSV_ERROR", f"THE FILE COULD NOT BE READ AS CSV: {str(e).upper()[:120]}") from None
    return out


def _wrap(fn):
    """Any failure inside a parser other than a ``RainfallError`` is reported as one (422), never as a server error."""
    @functools.wraps(fn)
    def inner(*a, **kw):
        try:
            return fn(*a, **kw)
        except RainfallError:
            raise
        except Exception as e:  # noqa: BLE001  (hostile input: report, do not crash)
            raise RainfallError("PARSE_FAILED", f"THE FILE COULD NOT BE PARSED ({type(e).__name__.upper()})") from None
    return inner


@dataclass
class IfdTable:
    """A design rainfall table. ``values[i][j]`` is for ``durations_min[i]`` and ``aeps_pct[j]`` in the unit ``kind``."""
    kind: str
    durations_min: list[float]
    aeps_pct: list[float]
    values: list[list[float]]
    provenance: dict[str, Any]
    warnings: list[str] = field(default_factory=list)

    # ---- lookups: exact table cells only, except the labelled interpolation in duration
    def aep_index(self, aep_pct: float) -> int | None:
        """The column whose AEP is within ``AEP_MATCH_TOL_PCT`` percentage points of ``aep_pct`` (the nearest one), else None."""
        best, gap = None, AEP_MATCH_TOL_PCT + 1e-9
        for j, a in enumerate(self.aeps_pct):
            if abs(a - aep_pct) <= gap:
                best, gap = j, abs(a - aep_pct)
        return best

    def intensity_at_row(self, i: int, j: int) -> float:
        v = self.values[i][j]
        return v if self.kind == INTENSITY else v / (self.durations_min[i] / 60.0)

    def intensity(self, duration_min: float, aep_pct: float) -> tuple[float, str] | None:
        """(intensity mm/h, method) at a table duration (TABLE) or between two table durations (INTERPOLATED, log duration and log intensity). None when the AEP is not a
        table column or the duration is outside the table."""
        j = self.aep_index(aep_pct)
        if j is None:
            return None
        ds = self.durations_min
        for i, d in enumerate(ds):
            if math.isclose(d, duration_min, rel_tol=1e-9, abs_tol=1e-9):
                return self.intensity_at_row(i, j), "TABLE"
        if not ds[0] < duration_min < ds[-1]:
            return None
        hi = next(i for i, d in enumerate(ds) if d > duration_min)
        lo = hi - 1
        i0, i1 = self.intensity_at_row(lo, j), self.intensity_at_row(hi, j)
        t = (math.log(duration_min) - math.log(ds[lo])) / (math.log(ds[hi]) - math.log(ds[lo]))
        return math.exp(math.log(i0) + t * (math.log(i1) - math.log(i0))), "INTERPOLATED"

    def to_json(self) -> dict[str, Any]:
        return {"schema": "ifd_table.v1", "kind": self.kind, "durations_min": self.durations_min, "aeps_pct": self.aeps_pct, "values": self.values,
                "provenance": self.provenance, "warnings": self.warnings}

    @staticmethod
    def from_json(d: dict[str, Any]) -> "IfdTable":
        return IfdTable(d["kind"], [float(x) for x in d["durations_min"]], [float(x) for x in d["aeps_pct"]], [[float(x) for x in r] for r in d["values"]],
                        dict(d.get("provenance") or {}), list(d.get("warnings") or []))

    def summary(self) -> dict[str, Any]:
        return {"kind": self.kind, "durations": len(self.durations_min), "aeps_pct": self.aeps_pct, "first_duration_min": self.durations_min[0],
                "last_duration_min": self.durations_min[-1], "provenance": self.provenance, "warnings": self.warnings}


def _units(head_text: str, declared: str | None) -> tuple[str, bool]:
    if declared:
        if declared not in (INTENSITY, DEPTH):
            raise RainfallError("BAD_UNITS", f"UNITS MUST BE {INTENSITY} OR {DEPTH}")
        return declared, True
    low = head_text.lower()
    has_i = "intensity" in low or "mm/h" in low
    has_d = "depth" in low
    if has_i == has_d:
        raise RainfallError("UNITS_NOT_STATED", "THE FILE DOES NOT SAY WHETHER THE TABLE IS A DEPTH (MM) OR AN INTENSITY (MM/H), OR SAYS BOTH. DECLARE THE UNITS WHEN YOU UPLOAD IT")
    return (INTENSITY if has_i else DEPTH), False


@_wrap
def parse_ifd_csv(raw: bytes, file_name: str, *, declared_units: str | None = None, now: datetime | None = None) -> IfdTable:
    """Parse a BoM IFD table export (see the module notes for the assumed layout). Raises ``RainfallError`` for anything that is not a usable table."""
    text = decode(raw)
    rows = read_csv_rows(text, max_rows=MAX_ROWS * 4)
    if not rows:
        raise RainfallError("EMPTY_FILE", "THE FILE HAS NO ROWS")
    hdr_i = None
    for i, r in enumerate(rows):
        if sum(1 for c in r if _aep_cell(c) is not None) >= 2:
            hdr_i = i
            break
    if hdr_i is None:
        raise RainfallError("NO_HEADER", "NO HEADER ROW WITH EXCEEDANCE COLUMNS (FOR EXAMPLE 50%, 20%, 10%, 5%, 2%, 1%) WAS FOUND")
    header = rows[hdr_i]
    ncells = len(header) - next((n for n, c in enumerate(reversed(header)) if c.strip()), len(header))      # the header without trailing empty cells
    cols = [(k, _aep_cell(c)) for k, c in enumerate(header) if _aep_cell(c) is not None]
    if len(cols) > MAX_COLS:
        raise RainfallError("TOO_MANY_COLUMNS", "THE HEADER HAS TOO MANY COLUMNS")
    head_text = "\n".join(",".join(r) for r in rows[: hdr_i + 1])
    kind, declared = _units(head_text, declared_units)
    meta: dict[str, Any] = {"requested": None, "grid_cell": None, "issued": None, "location_label": None}
    for line in (",".join(r) for r in rows[:hdr_i]):
        low = line.lower()
        c = _coords(line)
        if c and "requested" in low:
            meta["requested"] = c
        elif c and ("grid" in low or "nearest" in low):
            meta["grid_cell"] = c
        elif c and meta["requested"] is None:
            meta["requested"] = c
        if low.lstrip().startswith("issued"):
            meta["issued"] = parse_date(line.split(":", 1)[1] if ":" in line else line[6:].strip(" ,"))
        if low.lstrip().startswith(("location label", "location:", "location name")):
            meta["location_label"] = line.split(":", 1)[1].strip(" ,\"") if ":" in line else None
    data: list[tuple[float, list[float]]] = []
    for r in rows[hdr_i + 1:]:
        d = parse_duration_min(r[0]) if r else None
        if d is None:
            if data:
                break                                                   # the table ended (a note or a blank section follows)
            continue
        if len(r) - next((n for n, c in enumerate(reversed(r)) if c.strip()), len(r)) > ncells:
            raise RainfallError("RAGGED_ROW", f"THE ROW FOR {r[0].strip().upper()} HAS MORE CELLS THAN THE HEADER ROW ({ncells})")
        vals: list[float] = []
        for k, _ in cols:
            try:
                v = float(r[k].strip())
            except (IndexError, ValueError):
                raise RainfallError("BAD_ROW", f"THE ROW FOR {r[0].strip().upper()} HAS A MISSING OR NON NUMERIC VALUE") from None
            if not math.isfinite(v) or v <= 0 or v > MAX_VALUE:
                raise RainfallError("BAD_VALUE", f"THE ROW FOR {r[0].strip().upper()} HAS A VALUE THAT IS NOT ABOVE ZERO AND AT MOST {MAX_VALUE:g}")
            vals.append(v)
        data.append((d, vals))
        if len(data) > MAX_ROWS:
            raise RainfallError("TOO_MANY_ROWS", "THE TABLE HAS TOO MANY DURATIONS")
    if not data:
        raise RainfallError("NO_ROWS", "NO ROW STARTS WITH A DURATION SUCH AS 5 MIN OR 1 HOUR")
    data.sort(key=lambda x: x[0])
    ds = [d for d, _ in data]
    if len(set(ds)) != len(ds):
        raise RainfallError("DUPLICATE_DURATION", "A DURATION APPEARS MORE THAN ONCE")
    aeps_raw = {k: a for k, a in cols}
    is_ey = {k: _EY.match(header[k].strip()) is not None for k, _ in cols}
    pos = {k: n for n, (k, _) in enumerate(cols)}                     # index of the column among the values read
    warnings: list[str] = []
    keep: list[int] = []
    for k, a in cols:
        twin = next((q for q in keep if abs(aeps_raw[q] - a) <= AEP_MATCH_TOL_PCT), None)
        if twin is None:
            keep.append(k)
            continue
        label = f"{header[twin].strip()} AND {header[k].strip()}"
        if not all(math.isclose(row[1][pos[k]], row[1][pos[twin]], rel_tol=1e-3) for row in data):
            raise RainfallError("DUPLICATE_COLUMN", f"THE COLUMNS {label.upper()} STAND FOR THE SAME AEP (WITHIN {AEP_MATCH_TOL_PCT:g} PERCENTAGE POINTS) BUT THEIR VALUES DIFFER")
        if is_ey[k] and not is_ey[twin]:
            keep[keep.index(twin)] = k                               # the exact EY conversion is the canonical AEP of the merged column
        final = aeps_raw[k] if is_ey[k] and not is_ey[twin] else aeps_raw[twin]
        warnings.append(f"THE COLUMNS {label.upper()} ARE THE SAME AEP ({final:g} PERCENT) AND WERE MERGED (SAME VALUES)")
    order = sorted(keep, key=lambda k: -aeps_raw[k])                  # descending AEP percent = most frequent first
    aeps = [aeps_raw[k] for k in order]
    values = [[row[1][pos[k]] for k in order] for row in data]
    # plausibility only (warnings): depth grows with duration, intensity falls with it, and rarer events are larger
    for j, a in enumerate(aeps):
        col = [values[i][j] for i in range(len(ds))]
        bad = any((b < a0 - 1e-9) if kind == DEPTH else (b > a0 + 1e-9) for a0, b in zip(col, col[1:]))
        if bad:
            warnings.append(f"AEP {a:g} PERCENT: THE VALUES DO NOT {'RISE' if kind == DEPTH else 'FALL'} WITH DURATION AS EXPECTED. CHECK THE FILE")
    for i, d in enumerate(ds):
        if any(values[i][j + 1] < values[i][j] - 1e-9 for j in range(len(aeps) - 1)):
            warnings.append(f"DURATION {d:g} MIN: A RARER EVENT HAS A SMALLER VALUE THAN A MORE FREQUENT ONE. CHECK THE FILE")
            break
    t = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    prov = {
        "source": "BOM 2016 IFD DESIGN RAINFALL TABLE, USER UPLOAD", "file_name": file_name[:200], "sha256": hashlib.sha256(raw).hexdigest(), "uploaded_at": t.isoformat(timespec="seconds"),
        "issued": meta["issued"], "location_label": meta["location_label"], "requested": meta["requested"], "grid_cell": meta["grid_cell"],
        "units": kind, "units_declared_by_user": declared, "parser": PARSER_VERSION,
        "assumptions": ["LAYOUT OF THE BOM EXPORT NOT CONFIRMED FROM A LIVE DOWNLOAD; THE PARSER READS THE HEADER AS AEP OR EY COLUMNS AND EACH ROW AS A DURATION WITH A UNIT",
                        "AN EY COLUMN IS CONVERTED WITH AEP = 1 - EXP(-EY)",
                        f"A USER AEP MATCHES A COLUMN WITHIN {AEP_MATCH_TOL_PCT:g} PERCENTAGE POINTS (SO 63.2% AND 1EY ARE ONE COLUMN)"] + (["UNITS WERE DECLARED BY THE USER AT UPLOAD"] if declared else []),
    }
    for k in ("issued", "requested", "grid_cell", "location_label"):
        if prov[k] is None:
            warnings.append(f"{k.replace('_', ' ').upper()} IS NOT STATED IN THE FILE")
    return IfdTable(kind, ds, aeps, values, prov, warnings)


def haversine_km(a: dict[str, float], b: dict[str, float]) -> float:
    r = 6371.0088
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dphi, dl = p2 - p1, math.radians(b["lon"] - a["lon"])
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


def location_check(table: IfdTable, site: dict[str, float] | None) -> dict[str, Any]:
    """Distance from the site to the location the table is for (the grid cell, else the requested coordinate). NOT EVALUATED without either."""
    ref = table.provenance.get("grid_cell") or table.provenance.get("requested")
    if site is None:
        return {"status": "NOT EVALUATED", "message": "THE SITE LOCATION IS NOT KNOWN (NO LOT BOUNDARY OR NO COORDINATE SYSTEM IN THE 3D MODEL)", "km": None}
    if ref is None:
        return {"status": "NOT EVALUATED", "message": "THE TABLE DOES NOT STATE ITS LOCATION", "km": None}
    km = haversine_km(site, ref)
    if km > LOCATION_WARN_KM:
        return {"status": "WARNING", "message": f"THE TABLE IS FOR A LOCATION {km:.1f} KM FROM THE SITE (WARNING LIMIT OF THIS TOOL {LOCATION_WARN_KM:g} KM, NOT A REQUIREMENT)", "km": round(km, 2)}
    return {"status": "OK", "message": f"THE TABLE IS FOR A LOCATION {km:.1f} KM FROM THE SITE", "km": round(km, 2)}


# ---- providers ----------------------------------------------------------------------------------------------------------------------
@dataclass
class IfdResult:
    table: IfdTable | None
    status: str                      # OK, NOT AVAILABLE or LIVE UNCONFIRMED
    message: str = ""
    source: str = ""


class RainfallProvider(Protocol):
    """Design rainfall by location. ``lat`` and ``lon`` are the site in WGS84 degrees (None when unknown). The provider returns a table or says why it cannot."""
    name: str

    def design_rainfall(self, lat: float | None, lon: float | None) -> IfdResult: ...


class UploadedIfdProvider:
    """The table the user uploaded for the project (stored with its provenance)."""
    name = "UPLOAD"

    def __init__(self, stored: dict[str, Any] | None) -> None:
        self.stored = stored

    def design_rainfall(self, lat: float | None, lon: float | None) -> IfdResult:
        if not self.stored:
            return IfdResult(None, "NOT AVAILABLE", "NO IFD TABLE HAS BEEN UPLOADED FOR THIS PROJECT", "UPLOAD")
        try:
            return IfdResult(IfdTable.from_json(self.stored), "OK", "", "UPLOAD")
        except (KeyError, TypeError, ValueError):
            return IfdResult(None, "NOT AVAILABLE", "THE STORED IFD TABLE COULD NOT BE READ. UPLOAD IT AGAIN", "UPLOAD")


class IfdClient(Protocol):
    """Fetches the text of a BoM IFD table for a coordinate. The real request format is UNCONFIRMED, so no default client exists that sends one."""

    def fetch_ifd_csv(self, lat: float, lon: float) -> bytes: ...


class LiveUnavailable(RainfallError):
    pass


class UnconfirmedBomClient:
    """The default client. It does not send anything: the BoM request format is UNCONFIRMED and the BoM site is blocked from the sandbox."""

    def fetch_ifd_csv(self, lat: float, lon: float) -> bytes:
        raise LiveUnavailable(LIVE_UNCONFIRMED, f"THE LIVE BOM REQUEST FORMAT IS {LIVE_REQUEST_FORMAT}. NO REQUEST WAS SENT AND NO VALUE WAS GUESSED. UPLOAD THE IFD TABLE CSV FROM THE BOM IFD PAGE")


class LiveBomProvider:
    """Live design rainfall through an injected client. Whatever the client returns is parsed by the same parser as an upload and carries the provenance of a live request."""
    name = "LIVE"

    def __init__(self, client: IfdClient | None = None, now: datetime | None = None) -> None:
        self.client = client or UnconfirmedBomClient()
        self.now = now

    def design_rainfall(self, lat: float | None, lon: float | None) -> IfdResult:
        if lat is None or lon is None:
            return IfdResult(None, "NOT AVAILABLE", "THE SITE LOCATION IS NOT KNOWN, SO A LIVE REQUEST CANNOT BE MADE", "LIVE")
        try:
            raw = self.client.fetch_ifd_csv(lat, lon)
            t = parse_ifd_csv(raw, "BOM LIVE REQUEST", now=self.now)
        except LiveUnavailable as e:
            return IfdResult(None, "LIVE UNCONFIRMED", e.message, "LIVE")
        except RainfallError as e:
            return IfdResult(None, "NOT AVAILABLE", f"THE LIVE RESPONSE COULD NOT BE USED: {e.message}", "LIVE")
        except Exception as e:  # noqa: BLE001  (a client failure is reported, never replaced by a value)
            return IfdResult(None, "NOT AVAILABLE", f"THE LIVE REQUEST FAILED: {type(e).__name__}", "LIVE")
        t.provenance["source"] = "BOM 2016 IFD DESIGN RAINFALL, LIVE REQUEST (CLIENT INJECTED)"
        t.provenance["requested_site"] = {"lat": lat, "lon": lon}
        return IfdResult(t, "OK", "", "LIVE")


# ---- ARR Data Hub export ---------------------------------------------------------------------------------------------------------------
_SECTION = re.compile(r"^\s*\[(?P<n>[^\]]+)\]\s*$")


@_wrap
def parse_arr_datahub(raw: bytes, file_name: str, *, now: datetime | None = None) -> dict[str, Any]:
    """Parse the text export of the ARR Data Hub (sections in square brackets, ``key,value`` lines). The layout is as best documented, NOT confirmed from a live export:
    the storm initial and continuing losses, the impervious surface losses, the location, the version and the time the data was accessed are read by their names; the other
    lines are kept as text. The losses and temporal patterns are RECORDED with provenance; the Modified Rational engine of this tool does not use them."""
    text = decode(raw)
    sections: dict[str, dict[str, str]] = {}
    cur = None
    n = 0
    for line in text.splitlines():
        if not line.strip():
            continue
        n += 1
        if n > 5000:
            raise RainfallError("TOO_MANY_ROWS", "THE FILE HAS TOO MANY LINES FOR AN ARR DATA HUB EXPORT")
        if len(line) > MAX_LINE_CHARS:
            raise RainfallError("FIELD_TOO_LONG", f"A LINE OF THE FILE HAS MORE THAN {MAX_LINE_CHARS} CHARACTERS. THIS IS NOT AN ARR DATA HUB TEXT EXPORT")
        m = _SECTION.match(line)
        if m:
            cur = m.group("n").strip()[:120]
            sections.setdefault(cur, {})
            if len(sections) > MAX_ARR_SECTIONS:
                raise RainfallError("TOO_MANY_SECTIONS", f"THE FILE HAS MORE THAN {MAX_ARR_SECTIONS} SECTIONS. THIS IS NOT AN ARR DATA HUB TEXT EXPORT")
            continue
        if cur is None:
            continue
        k, _, v = line.partition(",")
        if k.strip():
            sections[cur][k.strip()[:120]] = v.strip().strip('"')[:300]
    if not sections:
        raise RainfallError("ARR_NOT_RECOGNISED", "NO [SECTION] HEADINGS WERE FOUND. THIS IS NOT AN ARR DATA HUB TEXT EXPORT")
    flat = [(sec, k, v) for sec, d in sections.items() for k, v in d.items()]

    def num(v: str) -> float | None:
        try:
            x = float(v.replace(",", ""))
            return x if math.isfinite(x) else None
        except ValueError:
            return None

    def find(*needles: str, sec_has: str | None = None) -> float | None:
        for sec, k, v in flat:
            kl = k.lower()
            if all(nd in kl for nd in needles) and (sec_has is None or sec_has in sec.lower()):
                x = num(v)
                if x is not None:
                    return x
        return None

    def find_text(*needles: str) -> str | None:
        for _, k, v in flat:
            if all(nd in k.lower() for nd in needles) and v:
                return v
        return None
    lat, lon = find("latitude"), find("longitude")
    out = {
        "schema": "arr_datahub.v1",
        "location": {"lat": lat, "lon": lon} if lat is not None and lon is not None else None,
        "storm_initial_loss_mm": find("storm", "initial", "loss"), "storm_continuing_loss_mm_h": find("storm", "continuing", "loss"),
        "impervious_initial_loss_mm": find("impervious", "initial", "loss"), "impervious_continuing_loss_mm_h": find("impervious", "continuing", "loss"),
        "time_accessed": find_text("time", "accessed"), "data_version": find_text("version"),
        "temporal_pattern_sections": [s for s in sections if "temporal" in s.lower()],
        "sections": {s: list(d)[:60] for s, d in sections.items()},
    }
    if not any(out[k] is not None for k in ("storm_initial_loss_mm", "storm_continuing_loss_mm_h", "impervious_initial_loss_mm", "impervious_continuing_loss_mm_h")) and not out["temporal_pattern_sections"]:
        raise RainfallError("ARR_NOT_RECOGNISED", "NO STORM LOSSES AND NO TEMPORAL PATTERN SECTION WERE FOUND. THIS IS NOT AN ARR DATA HUB TEXT EXPORT")
    t = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    out["provenance"] = {
        "source": "ARR DATA HUB TEXT EXPORT, USER UPLOAD", "file_name": file_name[:200], "sha256": hashlib.sha256(raw).hexdigest(), "uploaded_at": t.isoformat(timespec="seconds"),
        "parser": ARR_PARSER_VERSION, "assumptions": ["LAYOUT OF THE ARR DATA HUB EXPORT NOT CONFIRMED FROM A LIVE EXPORT; VALUES ARE READ BY THE NAMES OF THEIR LINES"],
        "used_by": "NOT USED BY THE MODIFIED RATIONAL ENGINE. RECORDED FOR A RUNOFF ROUTING METHOD",
    }
    return out


# ---- soil table (indicative infiltration) -----------------------------------------------------------------------------------------------
#: 1 m/day = 1000 mm / 24 h (a unit conversion)
M_PER_DAY_TO_MM_H = 1000.0 / 24.0


@_wrap
def parse_soil_table(raw: bytes, file_name: str, *, source: str, source_date: str | None, now: datetime | None = None) -> dict[str, Any]:
    """Parse a soil table the user supplies: a header row with ``soil_unit`` and ``rate_mm_h`` (or ``ksat_m_day``), optional ``description``. The user also states the source
    (name of the data set) at upload and its date. Every rate is INDICATIVE, SITE TESTING REQUIRED. The table is not tied to the site: the user selects the row that applies."""
    text = decode(raw)
    if not source or not source.strip():
        raise RainfallError("SOURCE_REQUIRED", "STATE THE SOURCE OF THE SOIL DATA (THE NAME OF THE DATA SET) WHEN YOU UPLOAD IT")
    sd = None
    if source_date:
        sd = parse_date(source_date)
        if sd is None:
            raise RainfallError("BAD_DATE", "THE DATE OF THE SOIL DATA MUST BE WRITTEN YYYY-MM-DD OR DD/MM/YYYY")
    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
    rows = read_csv_rows("\n".join(lines), max_rows=1001)
    if len(rows) < 2:
        raise RainfallError("NO_ROWS", "THE SOIL FILE NEEDS A HEADER ROW AND AT LEAST ONE SOIL ROW")
    head = [h.strip().lower() for h in rows[0]]
    if "soil_unit" not in head:
        raise RainfallError("NO_SOIL_UNIT", "THE HEADER NEEDS A soil_unit COLUMN")
    if "rate_mm_h" in head:
        rc, conv = head.index("rate_mm_h"), 1.0
    elif "ksat_m_day" in head:
        rc, conv = head.index("ksat_m_day"), M_PER_DAY_TO_MM_H
    else:
        raise RainfallError("NO_RATE", "THE HEADER NEEDS A rate_mm_h COLUMN (OR ksat_m_day IN METRES PER DAY)")
    uc = head.index("soil_unit")
    dc = head.index("description") if "description" in head else None
    out: list[dict[str, Any]] = []
    ids: set[str] = set()
    for r in rows[1:]:
        try:
            uid = r[uc].strip()
            rate = float(r[rc].strip()) * conv
        except (IndexError, ValueError):
            raise RainfallError("BAD_ROW", "A SOIL ROW HAS A MISSING SOIL UNIT OR A NON NUMERIC RATE") from None
        if len(r) > len(head):
            raise RainfallError("RAGGED_ROW", f"THE SOIL ROW {uid.upper() or '(NO NAME)'} HAS MORE CELLS THAN THE HEADER ROW ({len(head)})")
        if not uid or not math.isfinite(rate):
            raise RainfallError("BAD_ROW", f"THE SOIL ROW {uid.upper() or '(NO NAME)'} HAS NO NAME OR A RATE THAT IS NOT A NUMBER")
        if rate <= 0 or rate > MAX_VALUE:
            raise RainfallError("BAD_RATE", f"THE SOIL ROW {uid.upper()} HAS A RATE OF {rate:g} MM/H. A RATE MUST BE ABOVE ZERO AND AT MOST {MAX_VALUE:g} MM/H. CORRECT THE ROW OR REMOVE IT")
        if uid in ids:
            raise RainfallError("DUPLICATE_SOIL", f"THE SOIL UNIT {uid.upper()} APPEARS MORE THAN ONCE")
        ids.add(uid)
        out.append({"soil_unit": uid[:80], "rate_mm_h": round(rate, 6), "description": (r[dc].strip()[:200] if dc is not None and dc < len(r) else "")})
    t = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    return {"schema": "soil_table.v1", "rows": out, "label": "INDICATIVE, SITE TESTING REQUIRED",
            "provenance": {"source": source.strip()[:200], "source_date": sd, "file_name": file_name[:200], "sha256": hashlib.sha256(raw).hexdigest(),
                           "uploaded_at": t.isoformat(timespec="seconds"), "parser": "soil_table_csv.v1", "units_converted": conv != 1.0,
                           "note": "THE TABLE IS NOT TIED TO THE SITE. THE USER SELECTS THE SOIL UNIT THAT APPLIES"}}
