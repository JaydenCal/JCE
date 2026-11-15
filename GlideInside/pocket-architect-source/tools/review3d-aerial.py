#!/usr/bin/env python3
# Synthetic aerial picture for the 3D review shots: a deterministic made up industrial street drawn in world metres (east, north of the
# lot origin), so the sharp inner tile (0.1 m per pixel) and the wide tile show the same ground. No real imagery is used.
#   python3 tools/review3d-aerial.py minE minN maxE maxN widthPx heightPx out.jpg [residential]
import sys
import numpy as np
from PIL import Image, ImageFilter

x0, y0, x1, y1 = [float(v) for v in sys.argv[1:5]]
W, H = int(sys.argv[5]), int(sys.argv[6])
out = sys.argv[7]
res_mode = len(sys.argv) > 8
mpp = (x1 - x0) / W
xs = x0 + (np.arange(W) + 0.5) * mpp
ys = y1 - (np.arange(H) + 0.5) * (y1 - y0) / H
X, Y = np.meshgrid(xs, ys)

def hash2(ix, iy, seed):
    h = (ix.astype(np.int64) * 374761393 + iy.astype(np.int64) * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    h = (h ^ (h >> 13)) * 1274126177 & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFF) / 65535.0

_memo = {}
def vnoise(scale, seed):
    k = (scale, seed)
    if k not in _memo:
        _memo[k] = _vnoise(scale, seed)
    return _memo[k]

def _vnoise(scale, seed):
    gx = X / scale; gy = Y / scale
    ix = np.floor(gx); iy = np.floor(gy)
    fx = gx - ix; fy = gy - iy
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
    a = hash2(ix, iy, seed); b = hash2(ix + 1, iy, seed); c = hash2(ix, iy + 1, seed); d = hash2(ix + 1, iy + 1, seed)
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy

img = np.zeros((H, W, 3), np.float32)
n = 0.45 * vnoise(60, 1) + 0.3 * vnoise(11, 2) + 0.17 * vnoise(2.2, 3) + 0.08 * vnoise(0.45, 4)
grass = np.stack([92 + 46 * n, 112 + 34 * n, 62 + 22 * n], -1)
dry = np.stack([150 + 30 * n, 140 + 26 * n, 96 + 20 * n], -1)
t = np.clip((vnoise(35, 5) - 0.42) * 4, 0, 1)[..., None]
img[:] = grass * (1 - t) + dry * t

def rect(ax0, ay0, ax1, ay1):
    return (X >= ax0) & (X < ax1) & (Y >= ay0) & (Y < ay1)

def paint(mask, col, grain=6, seed=9, scale=0.35):
    g = (vnoise(scale, seed) - 0.5) * 2 * grain
    for k in range(3):
        img[..., k] = np.where(mask, col[k] + g, img[..., k])

LW, LD = (24.0, 45.0) if res_mode else (70.0, 110.0)
front = -LD / 2
ROAD = 18.0
ry0, ry1 = front - 4.45 - 9.0, front - 4.45
def road_h(a, b):
    paint(rect(-1e5, a, 1e5, b), (74, 76, 80), 7, 11)
    paint(rect(-1e5, b, 1e5, b + 0.45), (168, 166, 158), 4, 12)
    paint(rect(-1e5, a - 0.45, 1e5, a), (168, 166, 158), 4, 12)
    mid = (a + b) / 2
    paint(rect(-1e5, mid - 0.07, 1e5, mid + 0.07) & ((np.floor(X / 6) % 2) == 0), (222, 220, 206), 2, 13)
road_h(ry0, ry1)
road_h(front + LD + 40 + 4.45, front + LD + 40 + 13.45)
for cx in (-3.5 * LW - 9, 3.5 * LW + 9) if not res_mode else (-6.5 * LW - 9, 6.5 * LW + 9):
    paint(rect(cx - 4.5, -1e5, cx + 4.5, 1e5), (74, 76, 80), 7, 14)
# footpath on the near verge
paint(rect(-1e5, front - 2.35, 1e5, front - 0.85), (186, 183, 174), 4, 15)

rng = np.random.RandomState(7)
def lot_block(cx, cy, w, d, subject=False):
    if subject:
        return
    r = np.random.RandomState(int(abs(cx * 13 + cy * 7)) % 100000)
    if res_mode:
        hw, hd = w * (0.3 + 0.08 * r.rand()), d * (0.2 + 0.05 * r.rand())
        oy = cy + (d * 0.12 if cy > front - 1 else -d * 0.12)
        col = [(150, 84, 70), (96, 104, 112), (178, 174, 166), (120, 126, 118)][r.randint(4)]
        paint(rect(cx - hw + 1.5, oy - hd + 1.5 - 2, cx + hw + 1.5, oy + hd - 0.5), (48, 56, 44), 3, 21)
        paint(rect(cx - hw, oy - hd, cx + hw, oy + hd), col, 5, 22)
        sh = np.clip((Y - oy) / hd, -1, 1)
        m = rect(cx - hw, oy - hd, cx + hw, oy + hd)
        for k in range(3): img[..., k] = np.where(m, img[..., k] * (1 + 0.1 * sh), img[..., k])
    else:
        paint(rect(cx - w / 2 + 3, cy - d / 2 + 3, cx + w / 2 - 3, cy + d / 2 - 3), (150, 148, 142), 6, 23, 0.6)
        hw, hd = w * (0.3 + 0.06 * r.rand()), d * (0.24 + 0.1 * r.rand())
        oy = cy + d * (0.08 * (r.rand() - 0.5))
        col = [(206, 208, 206), (188, 192, 196), (214, 208, 190), (160, 170, 164), (120, 128, 136)][r.randint(5)]
        paint(rect(cx - hw + 2.5, oy - hd - 3.5, cx + hw + 2.5, oy + hd - 1), (70, 72, 70), 3, 24)
        m = rect(cx - hw, oy - hd, cx + hw, oy + hd)
        paint(m, col, 3, 25)
        rib = 0.94 + 0.06 * (np.floor(X / 0.76) % 2)
        ridge = 1 + 0.07 * np.sign(X - cx)
        for k in range(3): img[..., k] = np.where(m, img[..., k] * rib * ridge, img[..., k])
        for i in range(r.randint(4, 10)):
            px = cx - hw + r.rand() * 2 * hw; py = oy - hd - 4 - r.rand() * 6
            c = [(210, 210, 212), (40, 44, 52), (150, 30, 34), (60, 90, 150), (190, 190, 180)][r.randint(5)]
            paint(rect(px, py, px + 1.9, py + 4.4), c, 2, 26)
    for i in range(r.randint(2, 6)):
        tx = cx + (r.rand() - 0.5) * (w - 6); ty = cy + (0.5 - 0.12 * r.rand()) * d * (1 if r.rand() > 0.5 else -1) * 0.9
        rr = 2 + 2.5 * r.rand()
        dd = (X - tx - 1.2) ** 2 + (Y - ty + 1.6) ** 2
        for k in range(3): img[..., k] = np.where(dd < rr * rr, img[..., k] * 0.62, img[..., k])
        dd = (X - tx) ** 2 + (Y - ty) ** 2
        lump = vnoise(0.7, 31) * 0.5 + 0.5
        paint(dd < (rr * (0.8 + 0.25 * vnoise(1.1, 32))) ** 2, (52 + 30 * 0, 86, 46), 14, 33, 0.5)
        for k in range(3): img[..., k] = np.where(dd < (rr * 0.5) ** 2, img[..., k] * (1.0 + 0.12 * lump), img[..., k])

for row, (cy, d) in enumerate([(0.0, LD), (front + LD + 20, 40.0), (front - ROAD - LD / 2, LD), (front + LD + 40 + ROAD + LD / 2, LD), (front - ROAD - LD * 1.5 - 20, 40.0)]):
    for k in range(-14, 15):
        cx = k * LW
        if cx + LW < x0 or cx - LW > x1 or cy + d < y0 or cy - d > y1:
            continue
        if any(abs(cx - c) < LW * 0.75 for c in ((-3.5 * LW - 9, 3.5 * LW + 9) if not res_mode else (-6.5 * LW - 9, 6.5 * LW + 9))):
            continue
        lot_block(cx, cy, LW, d, subject=(row == 0 and k == 0))

im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
# Real 0.1 m imagery is a little soft; coarser pictures are sharp at their own scale.
if mpp < 0.2:
    im = im.filter(ImageFilter.GaussianBlur(0.9))
im.save(out, quality=88)
