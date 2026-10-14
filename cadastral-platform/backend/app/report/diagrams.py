"""Schematic diagrams drawn in the report (vector, no data): the three screening outcomes around a lot, with buffer ring and distance line."""
from __future__ import annotations

from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.platypus import Flowable

from app.report import theme as T

CON = colors.HexColor("#b4601a")
CON_FILL = colors.Color(0.91, 0.57, 0.24, alpha=0.45)
RING = T.GOLD
SOFT = colors.HexColor("#f7f6f3")


class BufferDiagram(Flowable):
    """Three panels: INTERSECTS, WITHIN BUFFER (distance), NOT INTERSECTED BY THE DATA LOADED. Schematic only, not to scale, no values."""

    H = 66 * mm

    def __init__(self, width: float = T.CW):
        super().__init__()
        self.width, self.height = width, self.H

    def wrap(self, aw, ah):
        return self.width, self.height

    # panel geometry helpers (all in panel-local points; panel origin at bottom-left of the drawing area)
    def _panel(self, c, x0, w, title, sub, kind):
        top = self.height - 8 * mm            # panels sit above the legend row
        c.saveState()
        c.translate(0, 8 * mm)
        c.setFillColor(SOFT); c.setStrokeColor(T.RULE); c.setLineWidth(0.5)
        c.roundRect(x0, 0, w, top, 1.5 * mm, stroke=1, fill=1)
        c.setFillColor(T.INK); c.setFont("Mono-Medium", 6.2)
        c.drawString(x0 + 3 * mm, top - 5 * mm, title)
        c.setFillColor(T.MUTED); c.setFont("Plex", 6.4)
        c.drawString(x0 + 3 * mm, top - 8.6 * mm, sub)
        # drawing area
        ax, ay, aw, ah = x0 + 3 * mm, 3 * mm, w - 6 * mm, top - 15 * mm
        cx, cy = ax + aw / 2, ay + ah / 2
        lw, lh = aw * 0.26, ah * 0.40            # lot size
        lx, ly = cx - lw / 2, cy - lh / 2
        ring = aw * 0.20                         # screening distance as drawn
        # buffer ring around the lot (not drawn as a number)
        c.setStrokeColor(RING); c.setLineWidth(0.9); c.setDash(2.2, 1.8)
        c.roundRect(lx - ring, ly - ring, lw + 2 * ring, lh + 2 * ring, ring * 0.55, stroke=1, fill=0)
        c.setDash()
        # constraint polygon
        ch_ = ah * 0.46
        if kind == "intersects":
            px, py, cw_ = lx + lw * 0.55, ly + lh * 0.30, aw * 0.16
        elif kind == "within":
            px, py, cw_ = lx + lw + ring * 0.40, ly + lh * 0.05, aw * 0.12
        else:
            px, py, cw_ = lx + lw + ring * 1.22, ly + lh * 0.05, aw * 0.10
        c.setFillColor(CON_FILL); c.setStrokeColor(CON); c.setLineWidth(0.9)
        p = c.beginPath()
        p.moveTo(px, py); p.lineTo(px + cw_, py + ch_ * 0.15); p.lineTo(px + cw_ * 0.9, py + ch_); p.lineTo(px + cw_ * 0.1, py + ch_ * 0.85); p.close()
        c.drawPath(p, stroke=1, fill=1)
        # lot
        c.setFillColor(colors.Color(1, 1, 1, alpha=0.55)); c.setStrokeColor(T.INK); c.setLineWidth(1.3)
        c.rect(lx, ly, lw, lh, stroke=1, fill=1)
        c.setFillColor(T.INK); c.setFont("Mono-Medium", 6)
        c.drawCentredString(lx + lw * 0.42 if kind == "intersects" else cx, cy - 2, "LOT")
        # distance line for the within-buffer case
        if kind == "within":
            y = ly + lh * 0.45
            x_a, x_b = lx + lw, px + cw_ * 0.05
            c.setStrokeColor(colors.HexColor("#a63a2b")); c.setLineWidth(0.8)
            c.line(x_a, y, x_b, y)
            for xx, d in ((x_a, 1), (x_b, -1)):
                c.line(xx, y - 1.4, xx, y + 1.4)
            c.setFillColor(colors.HexColor("#a63a2b")); c.setFont("Mono-Medium", 6.2)
            c.drawCentredString((x_a + x_b) / 2, y + 2.2, "d")
        c.restoreState()

    def draw(self):
        c = self.canv
        gap = 3 * mm
        pw = (self.width - 2 * gap) / 3
        specs = [("INTERSECTS", "Feature overlaps the lot", "intersects"),
                 ("WITHIN BUFFER (distance)", "Feature inside the ring, d is shown", "within"),
                 ("NOT INTERSECTED", "Feature beyond the ring: none in the data loaded", "outside")]
        for i, (t, s, k) in enumerate(specs):
            self._panel(c, i * (pw + gap), pw, t, s, k)
        # legend row
        y = 3.2 * mm
        x = 2 * mm
        c.saveState()
        c.setFont("Plex", 6.4); c.setFillColor(T.INK)
        items = [("lot boundary", "lot"), ("mapped constraint feature", "con"), ("screening buffer ring (dashed)", "ring"),
                 ("d = distance from lot boundary to nearest feature", "dist")]
        for label, k in items:
            if k == "lot":
                c.setStrokeColor(T.INK); c.setLineWidth(1.3); c.rect(x, y - 1, 5, 3.4, stroke=1, fill=0); x += 7
            elif k == "con":
                c.setStrokeColor(CON); c.setFillColor(CON_FILL); c.setLineWidth(0.9); c.rect(x, y - 1, 5, 3.4, stroke=1, fill=1); x += 7
            elif k == "ring":
                c.setStrokeColor(RING); c.setLineWidth(0.9); c.setDash(2, 1.5); c.line(x, y + 0.7, x + 8, y + 0.7); c.setDash(); x += 10
            else:
                c.setStrokeColor(colors.HexColor("#a63a2b")); c.setLineWidth(0.8); c.line(x, y + 0.7, x + 8, y + 0.7); x += 10
            c.setFillColor(T.INK)
            c.drawString(x, y - 0.4, label)
            x += c.stringWidth(label, "Plex", 6.4) + 8
        c.restoreState()
