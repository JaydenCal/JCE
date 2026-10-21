"""JCS layers of the site design DXF (stage 11): one layer set per object type and status, named on the scheme of docs/11.

``JCS-SITE-{ELEMENT}-{LINE|HATCH|TEXT}`` with a four character ELEMENT. The elements that already exist in ``planset/codes.py`` are reused as they are (BNDY, ADJN, KERB, CONT,
LOTS) and so are the annotation elements (NOTE, NRTH). The objects of the site design have no element of their own there, so this module adds them: three characters for the
object type and one for the status (E existing, P proposed, R to be removed). An existing service is split by verification instead (V verified by the user, U unverified).
Every name matches ``LAYER_RE`` of ``planset/codes.py`` (a test checks it), and ``export_layer_legend_markdown`` writes the table that docs/11 prints.
"""
from __future__ import annotations

from app.agents.sa5_cad_dxf.planset.codes import LAYER_RE

#: object type -> (3 character code, ACI colour, lineweight mm, label used on the drawing)
TYPE_CODES: dict[str, tuple[str, int, float, str]] = {
    "building": ("BLD", 7, 0.35, "BUILDING"), "driveway": ("DRV", 8, 0.35, "DRIVEWAY"), "footpath": ("FTP", 9, 0.25, "FOOTPATH"), "landscape_area": ("LND", 3, 0.18, "LANDSCAPE AREA"),
    "grading_area": ("GRD", 4, 0.25, "GRADING AREA"), "retaining_wall": ("RTW", 6, 0.35, "RETAINING WALL"), "pool": ("POL", 5, 0.25, "POOL"), "pool_barrier": ("PBR", 6, 0.18, "POOL BARRIER"),
    "tree": ("TRE", 3, 0.18, "TREE"), "furniture": ("FUR", 8, 0.13, "FURNITURE"), "rwt": ("RWT", 5, 0.25, "RAINWATER TANK"), "osd": ("OSD", 5, 0.25, "OSD TANK"),
    "osd_basin": ("OSB", 5, 0.25, "OSD BASIN"), "infiltration_trench": ("TRN", 5, 0.25, "INFILTRATION TRENCH"), "stormwater_pit": ("PIT", 5, 0.25, "STORMWATER PIT"),
    "stormwater_pipe": ("PIP", 5, 0.25, "STORMWATER PIPE"), "overflow_route": ("OFR", 5, 0.18, "OVERFLOW ROUTE"), "discharge_point": ("DCH", 1, 0.25, "DISCHARGE POINT"),
    "sewer_drain": ("SWD", 6, 0.25, "SEWER DRAIN"), "water_service": ("WSV", 5, 0.25, "WATER SERVICE"), "service_node": ("SND", 2, 0.18, "SERVICE NODE"),
    "service_trace": ("TRC", 4, 0.18, "TRACED SERVICE"),
}
#: existing service kind -> (3 character code, ACI colour, label)
SERVICE_CODES: dict[str, tuple[str, int, str]] = {
    "water": ("WAT", 5, "WATER MAIN"), "sewer": ("SWR", 6, "SEWER MAIN"), "stormwater": ("STW", 4, "STORMWATER MAIN"), "gas": ("GAS", 2, "GAS MAIN"),
    "electricity": ("ELC", 1, "ELECTRICITY"), "telecommunications": ("TEL", 200, "TELECOMMUNICATIONS"), "other": ("OTH", 8, "OTHER SERVICE"),
}
STATUS_CODES = {"existing": "E", "proposed": "P", "to_be_removed": "R"}
STATUS_WORDS = {"existing": "EXISTING", "proposed": "PROPOSED", "to_be_removed": "TO BE REMOVED"}
ELEMENT_TYPES = ("LINE", "HATCH", "TEXT")
#: elements reused from planset/codes.py: (ACI, lineweight, description)
FIXED = {
    "BNDY": ("SITE", 7, 0.50, "Lot boundary"), "ADJN": ("SITE", 9, 0.13, "Adjoining lot boundaries"), "KERB": ("SITE", 7, 0.25, "Assumed kerb line (not surveyed)"),
    "CONT": ("SITE", 8, 0.13, "Contours of the scene bundle and their labels"), "LOTS": ("SITE", 7, 0.13, "Neighbour lot labels"),
    "NOTE": ("ANNO", 7, 0.18, "Title note: terrain status, services status, date and coordinate system"), "NRTH": ("ANNO", 7, 0.18, "North arrow and 10 m scale bar"),
}


def object_element(type_: str, status: str, service_kind: str | None = None, verified: bool = False) -> str:
    """The four character element of an object: 3 character type code and one status letter (V or U for an existing service)."""
    if type_ == "service_existing":
        code = SERVICE_CODES.get(service_kind or "other", SERVICE_CODES["other"])[0]
        return code + ("V" if verified else "U")
    return TYPE_CODES[type_][0] + STATUS_CODES.get(status, "P")


def layer(element: str, kind: str, disc: str = "SITE") -> str:
    name = f"JCS-{disc}-{element}-{kind}"
    if not LAYER_RE.match(name):
        raise ValueError(f"layer name {name} does not follow the JCS scheme")
    return name


def layer_defaults(element: str) -> tuple[int, float, str]:
    """(ACI, lineweight mm, linetype) of an element."""
    if element in FIXED:
        _d, aci, lw, _t = FIXED[element]
        return aci, lw, "CONTINUOUS"
    code, st = element[:3], element[3]
    for t, (c, aci, lw, _l) in TYPE_CODES.items():
        if c == code:
            return aci, lw, "HIDDEN" if st == "R" else "CONTINUOUS"
    for k, (c, aci, _l) in SERVICE_CODES.items():
        if c == code:
            return aci, 0.18, "DASHED" if st == "U" else "CONTINUOUS"
    raise KeyError(element)


def all_export_elements() -> list[str]:
    out = list(FIXED)
    for t in TYPE_CODES:
        for st in ("existing", "proposed", "to_be_removed"):
            out.append(object_element(t, st))
    for k in SERVICE_CODES:
        out += [object_element("service_existing", "existing", k, True), object_element("service_existing", "existing", k, False)]
    return out


def export_layer_legend_markdown() -> str:
    rows = ["| Layer name | Colour (ACI) | Lineweight (mm) | Linetype | Content |", "|---|---|---|---|---|"]
    for el in all_export_elements():
        aci, lw, lt = layer_defaults(el)
        if el in FIXED:
            disc, _a, _w, desc = FIXED[el]
        elif el[:3] in {c for c, *_ in SERVICE_CODES.values()}:
            kind = next(k for k, (c, *_r) in SERVICE_CODES.items() if c == el[:3])
            desc = f"{SERVICE_CODES[kind][2].capitalize()}, existing service, {'verified by the user' if el[3] == 'V' else 'UNVERIFIED, dashed'}"
            disc = "SITE"
        else:
            t = next(t for t, v in TYPE_CODES.items() if v[0] == el[:3])
            desc = f"{TYPE_CODES[t][3].capitalize()}, {STATUS_WORDS[{v: k for k, v in STATUS_CODES.items()}[el[3]]].lower()}"
            disc = "SITE"
        kinds = ("LINE", "TEXT") if disc == "ANNO" else ELEMENT_TYPES
        for k in kinds:
            rows.append(f"| `{layer(el, k, disc)}` | {aci} | {lw:.2f} | {lt} | {desc} ({k.lower()}) |")
    return "\n".join(rows)


def export_element_table_markdown() -> str:
    """The compact table printed in docs/11: one row per object type, with the codes of its status layers."""
    rows = ["| Object type | Element codes (status letter last) | Statuses | ACI | Lineweight (mm) | Linetype | Example layer |", "|---|---|---|---|---|---|---|"]
    for t, (c, aci, lw, lab) in TYPE_CODES.items():
        rows.append(f"| {t} ({lab.lower()}) | `{c}E`, `{c}P`, `{c}R` | existing, proposed, to be removed | {aci} | {lw:.2f} | CONTINUOUS (HIDDEN when to be removed) | `{layer(c + 'P', 'LINE')}` |")
    for k, (c, aci, lab) in SERVICE_CODES.items():
        rows.append(f"| service_existing, {k} | `{c}V`, `{c}U` | verified by the user, UNVERIFIED | {aci} | 0.18 | CONTINUOUS (DASHED when unverified) | `{layer(c + 'U', 'LINE')}` |")
    return "\n".join(rows)
