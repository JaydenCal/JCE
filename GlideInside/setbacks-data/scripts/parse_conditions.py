"""Condition-text parsers for the setback rule builder.

Pure functions, no I/O. Every parser works on the free text in a record's
`condition` (and, for a few things, `value_text`). Anything that cannot be
expressed as a structured condition is returned as a qualifier tag so that the
rule is excluded from generic matching rather than guessed.
"""
import re

# ---------------------------------------------------------------- zones
ALWAYS_ZONE = re.compile(r'\b(RU[1-6]|R[1-5]|IN[1-4]|MU1|SP[1-3]|RE[12]|W[1-4])\b')
MAYBE_ZONE = re.compile(r'\b([CEB][1-8])\b')
MAYBE_ZONE_OK_AFTER = re.compile(
    r'^\s*(zone|local centre|mixed use|environmental|general industrial|light industrial|heavy industrial|'
    r'business|neighbourhood|enterprise|commercial|primary|productivity|national park|nature reserve|'
    r'conservation|living|management|centre|corridor|development|park|zones|and\b|or\b|,|/|\))', re.I)
ZONE_NAMES = [
    (re.compile(r'\blow density residential\b', re.I), 'R2'),
    (re.compile(r'\bmedium density residential\b', re.I), 'R3'),
    (re.compile(r'\bhigh density residential\b', re.I), 'R4'),
    (re.compile(r'\blarge lot residential\b', re.I), 'R5'),
    (re.compile(r'\bgeneral residential\b', re.I), 'R1'),
    (re.compile(r'\bprimary production\b', re.I), 'RU1'),
]


def parse_zones(cond):
    """Return (zones list, how) where how in stated|named|none."""
    zs = []
    for m in ALWAYS_ZONE.finditer(cond):
        zs.append(m.group(1))
    for m in MAYBE_ZONE.finditer(cond):
        tail = cond[m.end():m.end() + 24]
        pre = cond[max(0, m.start() - 12):m.start()].lower()
        if MAYBE_ZONE_OK_AFTER.match(tail) and not re.search(r'(cl\.?|clause|table|part|chapter|section|figure)\s*$', pre):
            zs.append(m.group(1))
    how = 'stated' if zs else 'none'
    if not zs:
        for rx, z in ZONE_NAMES:
            if rx.search(cond):
                zs.append(z)
                how = 'named'
    # ranges such as "R1 to R3" are not expanded: record only stated codes
    out = []
    for z in zs:
        if z not in out:
            out.append(z)
    return out, how


# ---------------------------------------------------------------- uses
USE_PATTERNS = [
    ('secondary_dwelling', r'secondary dwelling|granny|ancillary dwelling|secondary residence'),
    ('dual_occupancy', r'dual occupanc|duplex|dual-occupanc'),
    ('residential_flat_building', r'residential flat|\brfb|apartment|flat building'),
    ('shop_top_housing', r'shop top|shop-top'),
    ('boarding_house', r'boarding house'),
    ('seniors_housing', r'seniors|aged care|retirement|independent living'),
    ('multi_dwelling', r'multi[- ]?dwelling|multi[- ]?unit|multiple dwelling|townhouse|town house|terrace|villa|manor house|medium density|group housing|attached dwelling|semi[- ]?detached|row house|attached housing|integrated housing|urban housing'),
    ('outbuilding', r'outbuilding|\bshed|ancillary building|ancillary structure|studio|cabana|detached garage|farm building|agricultural building|rural shed|workshop'),
    ('garage', r'garage|carport|car port|car accommodation|parking structure|car parking'),
    ('swimming_pool', r'swimming pool|\bpool\b|tennis court'),
    ('verandah_deck', r'verandah|veranda|pergola|\bdeck|balcon|porch|awning|patio|carport'),
    ('dwelling', r'dwelling house|dwelling-house|single dwelling|detached dwelling|\bdwellings?\b|\bhouses?\b|general housing|low density housing|residential development|single house|detached housing|house/dwelling|\bresidential\b|\bhousing\b|large lot|rural residential'),
]
USE_RX = [(n, re.compile(p, re.I)) for n, p in USE_PATTERNS]


def parse_uses(cond):
    out = []
    for n, rx in USE_RX:
        if rx.search(cond):
            if n == 'dwelling' and any(u in out for u in ('residential_flat_building', 'multi_dwelling')) and not re.search(r'dwelling house|single dwelling|detached dwelling|general housing|dwellings?, ', cond, re.I):
                # "multi dwelling housing" mentions "dwelling" and "housing"; do not also tag as plain dwelling
                continue
            if n == 'verandah_deck' and 'garage' in out and not re.search(r'verandah|pergola|deck|porch|awning|patio|balcon', cond, re.I):
                continue
            out.append(n)
    # garage is also a dwelling element: leave as tagged
    return out


# ---------------------------------------------------------------- qualifiers
QUAL_PATTERNS = [
    ('battle_axe', r'battle.?ax|hatchet|rear lot|access handle|internal lot|panhandle|pan-handle'),
    ('laneway', r'lane ?way|rear lane|\blane\b|rear access|rear-loaded|rear loaded'),
    ('classified_road', r'classified road|state highway|arterial|main road|sub-arterial|distributor road|\bhighway|sp2 road|regional road|trunk road'),
    ('heritage', r'heritage|conservation area|character area|townscape'),
    ('flood', r'flood'),
    ('bushfire', r'bushfire|\bbal[- ]?\d'),
    ('waterfront', r'foreshore|waterfront|waterway|watercourse|\blake\b|\briver\b|\bcreek|coastal|beach|wetland|riparian|\bdam\b|canal|\bbushland'),
    ('established_area', r'infill|established (?:area|residential|street|neighbourhood)|existing (?:street|neighbourhood)|streetscape'),
    ('new_release_area', r'new release|greenfield|new subdivision|new areas|new estate'),
    ('irregular_lot', r'irregular|splayed|trapezoid|tapered|curved|truncat|cul-de-sac lot|cul de sac|wedge|pie[- ]shaped|kite|hatchet'),
    ('boundary_wall', r'zero lot|nil setback|zero setback|wall on (?:the )?boundary|boundary wall|built to (?:the )?boundary|parapet|party wall|wall to (?:the )?(?:side )?boundary|nil side|zero side|walls? (?:built )?on boundary|boundary walls'),
    ('building_element', r'\beaves?\b|articulation|projection|bay window|portico|\bfence|retaining|driveway|landscap|chimney|\bblade|hood|sun ?shade|downpipe|gutter|\bstairs?\b|\bsteps\b|ramp'),
    ('habitable', r'(?<!non-)(?<!non )habitable'),
    ('non_habitable', r'non-habitable|non habitable'),
    ('averaging_impractical', r'averaging (?:is )?(?:not|im)practical|not practical|impractical|unable to (?:be )?average|cannot be averaged|where averaging'),
    ('no_adjoining_buildings', r'no (?:existing )?(?:buildings?|dwellings?|houses?) (?:on|adjoining|adjacent)|vacant (?:adjoining|adjacent)|no adjoining|no adjacent|where there (?:are|is) no'),
    ('adjoins_other', r'adjoin(?:s|ing)|adjacent to|abutting|backing onto|back(?:s|ing) on|opposite|rear boundary (?:that )?(?:directly )?abuts|directly abuts|next to'),
    ('not_precinct', r'not within a precinct|not in a precinct'),
    ('basement', r'basement|underground|below ground|semi-basement'),
    ('open_space_frontage', r'open space|public reserve|park\b|reserve\b'),
    ('slope', r'slope|steep|gradient|fall of'),
    ('corner_splay', r'splayed corner|corner splay|truncated'),
    ('top_floor_attic', r'attic|roof terrace|rooftop'),
    ('height_plane', r'height plane|building envelope|solar access'),
    ('shared_driveway', r'shared (?:drive|access)|common driveway'),
    ('non_standard_street', r'cul-de-sac|culdesac|turning head|private street|internal road|internal roads|spine road'),
    ('subdivision_stage', r'stage [0-9]+|\bstage\b'),
]
QUAL_RX = [(n, re.compile(p, re.I)) for n, p in QUAL_PATTERNS]
# qualifiers that are the property of the rule (not of the lot) and that the caller can positively assert
ASSERTABLE = {'battle_axe', 'laneway', 'classified_road', 'heritage', 'flood', 'bushfire', 'waterfront',
              'established_area', 'new_release_area', 'irregular_lot', 'boundary_wall', 'habitable',
              'non_habitable', 'averaging_impractical', 'no_adjoining_buildings', 'basement', 'open_space_frontage'}


def parse_qualifiers(cond, skip=()):
    q = []
    for n, rx in QUAL_RX:
        if n in skip:
            continue
        if rx.search(cond):
            q.append(n)
    return q


# ---------------------------------------------------------------- precinct
PRECINCT_RES = [
    re.compile(r'^((?:[A-Z][\w\'’&.\-]*\s+){0,6}?(?:DCP area))'),
    re.compile(r'\b((?:[A-Z][\w\'’&.\-]*\s+){1,5}precinct)\b'),
    re.compile(r'\b((?:[A-Z][\w\'’&.\-]*\s+){1,5}(?:Urban Release Area|Release Area|URA))\b'),
    re.compile(r'\b((?:[A-Z][\w\'’&.\-]*\s+){1,4}Estate)\b'),
    re.compile(r'\b((?:[A-Z][\w\'’&.\-]*\s+){1,4}(?:Growth Centre Precincts?|Masterplan|Master Plan))\b'),
]


def parse_precinct(cond):
    m = PRECINCT_RES[0].search(cond)
    if m:
        return m.group(1).strip()
    for rx in PRECINCT_RES[1:]:
        m = rx.search(cond)
        if m:
            p = m.group(1).strip()
            if re.match(r'^(Table|Part|Chapter|Dwelling|Rural|Large|Low|Medium|High|General|Residential)\b', p):
                continue
            return p
    return None


# ---------------------------------------------------------------- numbers
def num(s):
    return float(s.replace(',', ''))


N = r'(\d[\d,]*(?:\.\d+)?)'


# ---------------------------------------------------------------- storeys
def parse_storeys(c):
    """returns dict with storeys / storeysMin / storeysMax / level"""
    cl = c.lower()
    out = {}
    if re.search(r'two or more|2 or more|more than (?:one|1|a single)|multi-?storey|two storeys? and (?:above|over)|2 storeys? and (?:above|over)|above single|2\+ storey|two\+', cl):
        out['storeysMin'] = 2
    elif re.search(r'three or more|3 or more|3 storeys? and (?:above|over)|three storeys? and (?:above|over)|3\+ storey|over (?:2|two) storeys?|more than (?:2|two) storeys?|(?:3|three) storeys? or more', cl):
        out['storeysMin'] = 3
    elif re.search(r'up to (?:2|two) storeys?|(?:1|one) and (?:2|two) storeys?|(?:1|one) or (?:2|two) storeys?|one to two storeys?|1 and 2 storey|1-2 storey|1 to 2 storey|up to two storeys', cl):
        out['storeysMax'] = 2
    elif re.search(r'up to (?:3|three) storeys?|(?:3|three) storeys? or less', cl):
        out['storeysMax'] = 3
    elif re.search(r'\b(?:single|one|1)[ -]storeys?\b|\bsingle[ -]level\b|single-storey|1 storey|one level\b|single story', cl):
        out['storeys'] = 1
    elif re.search(r'\b(?:two|2)[ -]storeys?\b|double[ -]storey|\b2 storeys\b|two-storey|2-storey|two levels?\b|two story|double story', cl):
        out['storeys'] = 2
    elif re.search(r'\b(?:three|3)[ -]storeys?\b|3-storey|three-storey', cl):
        out['storeys'] = 3
    elif re.search(r'\b(?:four|4)[ -]storeys?\b', cl):
        out['storeys'] = 4
    # level of the building the value applies to
    lvl = None
    if re.search(r'upper (?:level|floor|storey|story|walls?)|second (?:storey|story|floor|level)|first floor|upper-level|second floor|second-storey|level 2\b|2nd storey|upper storeys?', cl):
        lvl = 'upper'
    if re.search(r'ground (?:floor|level|storey|story)|first storey|lower (?:level|floor|storey)|1st storey|first-storey|single storey ground|ground-floor', cl):
        lvl = 'ground' if lvl is None else 'both'
    if lvl == 'both':
        lvl = None  # statement mentions both levels; keep as text (no level split)
    if lvl:
        out['level'] = lvl
    return out


# ---------------------------------------------------------------- wall height
def parse_wall_height(c):
    cl = c.lower()
    out = {}
    if not re.search(r'wall height|building height|height of (?:the )?wall|wall heights|walls? (?:up to|over|exceeding|not exceeding|less than)|\bheight\b|eaves height|external wall', cl):
        return out
    m = re.search(r'(?:wall|building|eaves|external|overall)?\s*heights?[^,;:()]{0,50}?(?:not exceeding|up to|no more than|less than|under|below|maximum(?: of)?|max\.?|at or below|of)\s*' + N + r'\s*m\b', cl)
    # direction needs care: split into max/min words
    best = None
    for mm in re.finditer(r'(not exceeding|up to|no more than|less than|under|below|maximum(?: of)?|max\.?|at or below|does not exceed|not more than|exceeding|exceeds|over|more than|greater than|above|at least|minimum(?: of)?|min\.?|taller than)\s*' + N + r'\s*m\b(?!\s*2)(?!2)', cl):
        pre = cl[max(0, mm.start() - 50):mm.start()]
        post = cl[mm.end():mm.end() + 25]
        if re.search(r'height|wall|eaves', pre + post):
            if not re.search(r'storey|setback|boundary|frontage|width|lot|site area', post[:12]):
                best = mm
                break
    if best:
        w = best.group(1)
        v = num(best.group(2))
        if re.match(r'(exceeding|exceeds|over|more than|greater than|above|at least|minimum|min|taller)', w):
            out['wallHeightOverM'] = v
        else:
            out['wallHeightMaxM'] = v
    else:
        mm = re.search(N + r'\s*m\s*(?:wall )?(?:height )?(or less|and under|or lower|or below|maximum)', cl)
        if mm and re.search(r'height|wall', cl):
            out['wallHeightMaxM'] = num(mm.group(1))
        mm = re.search(N + r'\s*m\s*(?:wall )?(?:height )?(or more|and over|or higher|or above|and above)', cl)
        if mm and re.search(r'height|wall', cl):
            out['wallHeightOverM'] = num(mm.group(1))
    return out


# ---------------------------------------------------------------- lot width / area
LT = r'(?:under|less than|below|up to|<|smaller than|not exceeding|no more than|maximum(?: of)?|narrower than|not more than|at most|<=|≤)'
GT = r'(?:over|more than|greater than|above|exceeding|>|at least|minimum(?: of)?|wider than|larger than|not less than|>=|≥|at or above)'
RNG = r'(?:to|-|–|and|<|up to|through)'


def _seg_numbers_area(seg):
    """parse area constraints in a segment with m2/ha"""
    s = seg.replace('m²', 'm2').replace('sqm', 'm2').replace('sq m', 'm2').replace('square metres', 'm2').replace('m 2', 'm2')
    s = s.lower()
    out = {}
    unit = r'\s*(m2|ha|hectares?)'

    def val(v, u):
        v = num(v)
        return v * 10000 if u.startswith('h') else v

    # a to b
    m = re.search(N + r'\s*(?:m2|ha)?\s*(?:to|-|–|<|and up to|up to|but not more than|but less than)\s*(?:under |less than |below )?' + N + unit, s)
    if m:
        u = m.group(3)
        out['lotAreaMinM2'] = val(m.group(1), u)
        out['lotAreaMaxM2'] = val(m.group(2), u)
        return out
    m = re.search(LT + r'\s*' + N + unit, s)
    if m:
        out['lotAreaMaxM2'] = val(m.group(1), m.group(2))
    m = re.search(GT + r'\s*' + N + unit, s)
    if m:
        out['lotAreaMinM2'] = val(m.group(1), m.group(2))
    m = re.search(N + unit + r'\s*(?:or more|and over|and above|or larger|or greater|\+|plus|minimum)', s)
    if m:
        out['lotAreaMinM2'] = val(m.group(1), m.group(2))
    m = re.search(N + unit + r'\s*(?:or less|and under|and below|or smaller|or lower|maximum)', s)
    if m:
        out['lotAreaMaxM2'] = val(m.group(1), m.group(2))
    return out


def parse_lot_area(c):
    cl = c.lower()
    if not re.search(r'm2|m²|sqm|sq m|square met|\bha\b|hectare', cl):
        return {}
    out = {}
    for seg in re.split(r'[;,](?![\d])|:|\(|\)', c):
        sl = seg.lower()
        if re.search(r'm2|m²|sqm|sq m|square met|\bha\b|hectare', sl) and re.search(r'lot|site|area|allotment|block|size|land|over|under|up to|to|less|more|\d', sl):
            if re.search(r'landscap|private open|open space|floor area|gfa|floor space|deep soil|garage|carport|shed|outbuilding area|pergola|building area|pool|private|storage|room|dwelling size|unit size|site coverage|coverage|plan area', sl) and not re.search(r'\blots?\b|\bsite area\b|lot size|lot area|allotment', sl):
                continue
            r = _seg_numbers_area(sl)
            for k, v in r.items():
                out.setdefault(k, v)
    return out


def parse_lot_width(c):
    cl = c.lower().replace('metres', 'm').replace('meters', 'm')
    if not re.search(r'width|frontage|wide|narrow', cl):
        return {}
    out = {}
    K = r'(?:lot |site |block |allotment |land |street |road |primary |building line |boundary )*(?:width|frontage|wide)'
    # a to b m (lot width)
    m = re.search(N + r'\s*m?\s*(?:to|-|–|<|and)\s*(?:under |less than |below |up to )?' + N + r'\s*m\s*(?:lot |site )?(?:' + K + r'|wide)', cl)
    if not m:
        m = re.search(K + r'\s*(?:of |is |at |from |between )?\s*' + N + r'\s*m?\s*(?:to|-|–|<|and)\s*(?:under |less than |below |up to )?' + N + r'\s*m', cl)
    if m:
        out['lotWidthMinM'] = num(m.group(1))
        out['lotWidthMaxM'] = num(m.group(2))
        return out
    # key then comparator
    for pat, key in [
        (K + r'\s*(?:of |is |at (?:the )?(?:building line )?|measured )?\s*' + LT + r'\s*' + N + r'\s*m', 'lotWidthMaxM'),
        (K + r'\s*(?:of |is |at (?:the )?(?:building line )?|measured )?\s*' + GT + r'\s*' + N + r'\s*m', 'lotWidthMinM'),
        (LT + r'\s*' + N + r'\s*m\s*(?:lot |site |in )?(?:' + K + r'|wide)', 'lotWidthMaxM'),
        (GT + r'\s*' + N + r'\s*m\s*(?:lot |site |in )?(?:' + K + r'|wide)', 'lotWidthMinM'),
        (N + r'\s*m\s*(?:lot |site )?(?:wide|width|frontage)?\s*(?:or less|and under|or narrower|and below)', 'lotWidthMaxM'),
        (N + r'\s*m\s*(?:lot |site )?(?:wide|width|frontage)?\s*(?:or more|and over|or wider|and above|\+|minimum)', 'lotWidthMinM'),
        (r'(?:lots?|sites?|blocks?)\s*' + LT + r'\s*' + N + r'\s*m\b(?!\s*2)(?!2)(?=[^\d]{0,12}(?:wide|width|frontage))', 'lotWidthMaxM'),
        (r'(?:lots?|sites?|blocks?)\s*' + GT + r'\s*' + N + r'\s*m\b(?!\s*2)(?!2)(?=[^\d]{0,12}(?:wide|width|frontage))', 'lotWidthMinM'),
    ]:
        mm = re.search(pat, cl)
        if mm and key not in out:
            out[key] = num(mm.group(1))
    return out


def parse_land_size_map(c):
    m = re.search(r'\bLSM[- ]?([A-Z][A-Z0-9]*)\b', c)
    return ('LSM-' + m.group(1)) if m else None


def parse_corner(c):
    return bool(re.search(r'corner|secondary (?:street|frontage|road)|secondary frontages?|side street|street side', c, re.I))
