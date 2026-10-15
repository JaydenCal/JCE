"""Data classes for the site data folder import (see docs/14-site-data-import.md).

Every value carries its provenance: the file it came from, the dataset, capture date, stated accuracy and coordinate system.  Nothing here is
invented: a missing item is listed in ``SiteData.missing`` and the consumers print DATA NOT AVAILABLE or NOT CHECKED for it.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from shapely.geometry import Polygon

AREA_TOLERANCE = 0.02            # 2 percent, the same tolerance SA1 uses for the registered area

USED = "USED"
NOT_USED = "NOT USED"
MISSING = "MISSING"
DRAFT = "DRAFT, UNVERIFIED, NOT DRAWN"
FLAG = "FLAGGED"


def ddmmyyyy(d: dt.date | None) -> str:
    return d.strftime("%d/%m/%Y") if d else ""


@dataclass
class SourceItem:
    """One row of the "Site data sources" table (report, SoEE, plan set cover)."""
    item: str
    file: str = ""
    dataset: str = ""
    date: str = ""
    accuracy: str = ""
    crs: str = ""
    status: str = USED
    note: str = ""

    def as_dict(self) -> dict[str, str]:
        return dict(self.__dict__)


@dataclass
class BoundaryData:
    name: str
    polygon: Polygon                     # MGA metres
    srid: int
    lotplan: str | None
    stated_area_ha: float | None
    computed_area_ha: float
    area_diff_pct: float | None          # (computed - stated) / stated * 100
    area_flag: bool
    source_file: str
    csv_file: str | None = None
    csv_max_diff_m: float | None = None
    csv_note: str = ""
    notes: list[str] = field(default_factory=list)

    @property
    def source_label(self) -> str:
        return f"SITE DATA COLLECTOR: {self.source_file}, {self.name}"


@dataclass
class LidarStatus:
    """Fields read from LiDAR/lidar_status.md.  Every field is optional: an absent line leaves it None."""
    dataset: str = ""
    status_text: str = ""
    received: str = ""                   # DD/MM/YYYY
    order_ref: str = ""
    crs: str = ""
    vertical_datum: str = ""
    accuracy_text: str = ""
    vertical_accuracy_text: str | None = None      # as written in the file, e.g. "0.30"
    horizontal_accuracy_text: str | None = None
    capture_year: str | None = None
    capture_month: str | None = None
    resolution_text: str | None = None             # e.g. "1" (metres)
    elvis: bool = False
    stats: dict[str, Any] = field(default_factory=dict)   # collector's own figures for the lot (min_rl, max_rl, mean_rl, median_slope_pct, fit_grade_pct, fit_bearing_deg)

    @property
    def vertical_accuracy_m(self) -> float | None:
        try:
            return float(self.vertical_accuracy_text) if self.vertical_accuracy_text is not None else None
        except ValueError:
            return None

    @property
    def label(self) -> str:
        """The terrain basis wording printed on plans, report and SoEE, e.g. "2022 LIDAR 1 m DEM (ELVIS), +/-0.30 m".  Built only from parsed fields."""
        parts = [p for p in (self.capture_year, "LIDAR") if p]
        parts.append((f"{self.resolution_text} m DEM" if self.resolution_text else "DEM"))
        s = " ".join(parts) + (" (ELVIS)" if self.elvis else "")
        s += f", +/-{self.vertical_accuracy_text} m" if self.vertical_accuracy_text is not None else ", ACCURACY NOT STATED"
        return s


@dataclass
class ContourLine:
    rl: float
    major: bool
    coords: np.ndarray                   # (n, 2) MGA metres


@dataclass
class LidarData:
    status: LidarStatus | None
    status_file: str | None
    points: np.ndarray | None            # (n, 3) easting, northing, RL
    points_file: str | None
    srid: int | None
    contours: list[ContourLine] | None
    contours_file: str | None
    contours_dxf_present: bool = False
    tif_file: str | None = None
    notes: list[str] = field(default_factory=list)

    @property
    def has_points(self) -> bool:
        return self.points is not None and len(self.points) >= 6

    @property
    def interval_m(self) -> float | None:
        if not self.contours:
            return None
        lv = sorted({round(c.rl, 6) for c in self.contours})
        d = [b - a for a, b in zip(lv[:-1], lv[1:]) if b - a > 1e-9]
        return min(d) if d else None

    @property
    def major_interval_m(self) -> float | None:
        if not self.contours:
            return None
        lv = sorted({round(c.rl, 6) for c in self.contours if c.major})
        d = [b - a for a, b in zip(lv[:-1], lv[1:]) if b - a > 1e-9]
        return min(d) if d else None


@dataclass
class Owner:
    name: str
    status: str
    responded: bool


@dataclass
class DraftFeature:
    """A vector feature from BYDA/gis/.  Always DRAFT and unverified: stored in the run JSON for the verification step (docs/12) and never drawn."""
    feature_id: str
    source_file: str
    owner: str
    geometry_wkt: str                    # MGA metres
    properties: dict[str, Any]
    status: str = "draft"
    verified: bool = False


@dataclass
class BydaData:
    status_file: str | None
    job_no: str | None = None
    enquiry_no: str | None = None
    lodged: str = ""                     # DD/MM/YYYY (time dropped)
    lodged_text: str = ""                # as written
    job_from: dt.date | None = None
    job_to: dt.date | None = None
    valid_until: dt.date | None = None
    owners: list[Owner] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    project_only: bool = False           # the status file states that the plans are for this project only
    plan_files: dict[str, list[str]] = field(default_factory=dict)   # owner folder -> plan file names (listed only, never copied or read)
    gis_files: list[str] = field(default_factory=list)
    gis_features: list[DraftFeature] = field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.owners)

    @property
    def responded(self) -> int:
        return sum(1 for o in self.owners if o.responded)

    def validity(self, run_date: dt.date) -> tuple[str, str]:
        """(state, text): state is valid, expired, or unknown.  Compared with the run date, never assumed."""
        if self.valid_until is None:
            return "unknown", "BYDA ENQUIRY VALIDITY DATE NOT STATED IN THE STATUS FILE: CONFIRM BEFORE USE"
        if run_date > self.valid_until:
            return "expired", f"BYDA ENQUIRY EXPIRED {ddmmyyyy(self.valid_until)} (RUN DATE {ddmmyyyy(run_date)}): LODGE A NEW ENQUIRY"
        return "valid", f"BYDA ENQUIRY VALID UNTIL {ddmmyyyy(self.valid_until)} (RUN DATE {ddmmyyyy(run_date)})"


@dataclass
class SiteData:
    root: str
    boundary: BoundaryData | None = None
    lidar: LidarData | None = None
    byda: BydaData | None = None
    controls_file: str | None = None
    controls_text: str = ""
    items: list[SourceItem] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def terrain_label(self) -> str | None:
        """Terrain basis label, only when LiDAR points are present to drive the levels."""
        if self.lidar is not None and self.lidar.has_points and self.lidar.status is not None:
            return self.lidar.status.label
        if self.lidar is not None and self.lidar.has_points:
            return "LIDAR DEM (STATUS FILE MISSING, ACCURACY NOT STATED)"
        return None

    @property
    def vertical_accuracy_m(self) -> float | None:
        if self.lidar is not None and self.lidar.status is not None:
            return self.lidar.status.vertical_accuracy_m
        return None
