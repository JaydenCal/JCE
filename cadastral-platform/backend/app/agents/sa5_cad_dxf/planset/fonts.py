"""Plan-set font: Arial Narrow where available, otherwise the metric-compatible Liberation Sans Narrow.

Arial Narrow is proprietary (Monotype) and cannot be bundled.  Liberation Sans Narrow (SIL OFL 1.1; copy bundled in ./fonts)
is metrically compatible with Arial Narrow, so line breaks, widths and label fits are identical when a CAD user opens the
DXF on a machine that has Arial Narrow.  DXF text style is always 'ARIAL NARROW' with font file 'arialn.ttf'.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfbase.ttfonts import TTFont

HERE = Path(__file__).parent
DXF_STYLE = "ARIAL NARROW"
DXF_FONT_FILE = "arialn.ttf"
CAP_RATIO = 0.716            # Arial / Liberation cap height / em
REG, BOLD, ITAL = "PlanNarrow", "PlanNarrow-Bold", "PlanNarrow-Italic"


@dataclass
class FontInfo:
    regular: Path
    bold: Path
    italic: Path
    is_arial_narrow: bool
    name: str

    @property
    def note(self) -> str:
        return ("Arial Narrow" if self.is_arial_narrow else
                "Liberation Sans Narrow (metric-compatible substitute for the proprietary Arial Narrow; DXF text style 'ARIAL NARROW' -> arialn.ttf)")


_INFO: FontInfo | None = None


def _find(names: list[str], dirs: list[Path]) -> Path | None:
    low = {n.lower() for n in names}
    for d in dirs:
        if d.is_dir():
            for p in d.rglob("*"):
                if p.name.lower() in low:
                    return p
    return None


def locate() -> FontInfo:
    dirs = [Path(p) for p in os.environ.get("PLANSET_FONT_DIR", "").split(os.pathsep) if p]
    dirs += [Path("/usr/share/fonts"), Path("/Library/Fonts"), Path("/System/Library/Fonts/Supplemental"),
             Path("C:/Windows/Fonts"), Path.home() / ".fonts", Path.home() / ".local/share/fonts"]
    r, b, i = (_find(["arialn.ttf"], dirs), _find(["arialnb.ttf"], dirs), _find(["arialni.ttf"], dirs))
    if r and b:
        return FontInfo(r, b, i or r, True, "Arial Narrow")
    lr = _find(["LiberationSansNarrow-Regular.ttf"], dirs + [HERE / "fonts"]) or HERE / "fonts" / "LiberationSansNarrow-Regular.ttf"
    lb = lr.with_name("LiberationSansNarrow-Bold.ttf")
    li = lr.with_name("LiberationSansNarrow-Italic.ttf")
    return FontInfo(lr, lb if lb.exists() else lr, li if li.exists() else lr, False, "Liberation Sans Narrow")


def info() -> FontInfo:
    global _INFO
    if _INFO is None:
        _INFO = locate()
        for n, p in ((REG, _INFO.regular), (BOLD, _INFO.bold), (ITAL, _INFO.italic)):
            if n not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont(n, str(p)))
    return _INFO


def face(bold: bool = False, italic: bool = False) -> str:
    info()
    return BOLD if bold else (ITAL if italic else REG)


def text_width(s: str, h_mm: float, bold: bool = False) -> float:
    """Width in paper mm of ``s`` set with cap height ``h_mm``."""
    return stringWidth(s, face(bold), h_mm / CAP_RATIO)


def wrap(s: str, h_mm: float, width_mm: float, bold: bool = False) -> list[str]:
    out: list[str] = []
    for para in s.split("\n"):
        line = ""
        for w in para.split(" "):
            t = (line + " " + w).strip()
            if text_width(t, h_mm, bold) <= width_mm or not line:
                line = t
            else:
                out.append(line)
                line = w
        out.append(line)
    return out
