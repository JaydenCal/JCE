"""Label helpers shared by the terrain chain and the 3D scene builder."""
from __future__ import annotations

import re

# A number followed by a length, area or volume unit: the unit keeps its case ("5 m", "0.3 m", "30 m2", "12 ha").
_UNIT = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?\s?(?:mm|cm|km|m2|m3|m|ha))(?![\w])")


def upper_label(text: str) -> str:
    """Upper-case a label while keeping unit tokens as written (``INDICATIVE 5 m DEM`` stays ``5 m``, never ``5 M``)."""
    parts = _UNIT.split(text or "")
    return "".join(p if i % 2 else p.upper() for i, p in enumerate(parts))


__all__ = ["upper_label"]
