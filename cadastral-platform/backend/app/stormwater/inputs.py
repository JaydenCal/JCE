"""The user's entries for the stormwater helper (basis USER). Every field is optional: a field left empty falls back to the requirement key, and when that is UNRESOLVED
the calculation that needs it is NOT EVALUATED and names it. The bounds below are the limits of what the arithmetic can take, not requirement values."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

USER_REF = "ENTERED IN THE STORMWATER PANEL"
OSD_METHODS = ("mass_balance_modified_rational", "user_ssr")
#: the longest duration the critical duration search runs to when the user does not state one (minutes). A COMPUTATION RANGE of this tool, not a requirement.
DEFAULT_SEARCH_MAX_MIN = 1440.0


class _M(BaseModel):
    model_config = ConfigDict(extra="forbid")


class InfiltrationEntry(_M):
    """``site_test``: a measured rate (needs the test date and method). ``indicative``: a rate typed from a desktop source (needs the source). ``soil_table``: a row of the uploaded soil table."""
    source: Literal["site_test", "indicative", "soil_table"]
    rate_mm_h: float | None = Field(default=None, gt=0, le=1e6, allow_inf_nan=False)
    test_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    test_method: str | None = Field(default=None, max_length=200)
    source_note: str | None = Field(default=None, max_length=200)
    soil_unit: str | None = Field(default=None, max_length=80)


class StormwaterInputs(_M):
    design_aep_pct: float | None = Field(default=None, gt=0, le=100, allow_inf_nan=False)
    tc_pre_min: float | None = Field(default=None, gt=0, le=10080, allow_inf_nan=False)
    tc_post_min: float | None = Field(default=None, gt=0, le=10080, allow_inf_nan=False)
    #: runoff coefficient (0 to 1) by surface id: roof, pool, concrete, asphalt, pavers, gravel, permeable_pavers, landscape_turf, landscape_garden_bed, landscape_mulch, ...
    runoff_coefficients: dict[str, float] = Field(default_factory=dict, max_length=30)
    osd_method: str | None = Field(default=None, max_length=80)
    ssr_m3: float | None = Field(default=None, gt=0, le=1e7, allow_inf_nan=False)
    ssr_m3_per_ha: float | None = Field(default=None, gt=0, le=1e7, allow_inf_nan=False)
    ssr_area_basis: Literal["lot", "osd_catchment"] | None = None
    psd_l_s: float | None = Field(default=None, gt=0, le=1e5, allow_inf_nan=False)
    rainwater_tank_excluded: bool | None = None
    discharge_coefficient: float | None = Field(default=None, gt=0, le=1, allow_inf_nan=False)
    orifice_head_m: float | None = Field(default=None, gt=0, le=100, allow_inf_nan=False)
    search_max_duration_min: float | None = Field(default=None, gt=0, le=10080, allow_inf_nan=False)
    infiltration: InfiltrationEntry | None = None

    @field_validator("runoff_coefficients")
    @classmethod
    def _c(cls, v: dict[str, float]) -> dict[str, float]:
        for k, x in v.items():
            if not (isinstance(k, str) and 1 <= len(k) <= 40 and k.replace("_", "").isalnum()):
                raise ValueError(f"surface id {k!r} is not valid")
            if isinstance(x, bool) or not (0.0 <= x <= 1.0):
                raise ValueError(f"the runoff coefficient of {k} must be between 0 and 1")
        return v

    @field_validator("osd_method")
    @classmethod
    def _m(cls, v: str | None) -> str | None:
        return v.strip() if isinstance(v, str) and v.strip() else None


class OverlandOptions(_M):
    """Overland flow settings. ``cell_m`` is a computation resolution and ``threshold_m2`` a DISPLAY parameter (see ``overland.py``); neither is a requirement."""
    enabled: bool = False
    cell_m: float = Field(default=0.5, ge=0.25, le=5.0, allow_inf_nan=False)
    threshold_m2: float = Field(default=25.0, gt=0, le=1e6, allow_inf_nan=False)
    surface: Literal["design", "existing"] = "design"
