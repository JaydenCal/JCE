import sys
from PIL import Image, ImageFilter, ImageEnhance, ImageChops
import numpy as np
def grade(src, size):
    im = Image.open(src).convert('RGB').resize(size, Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)/255.0
    h, w, _ = a.shape
    y = np.linspace(0, 1, h)[:, None]
    x = np.linspace(0, 1, w)[None, :]
    # atmospheric haze toward the top (far ground), warm late afternoon tone
    haze = np.clip(1 - y/0.45, 0, 1)**1.6 * 0.22
    hc = np.array([0.86, 0.78, 0.66])
    a = a*(1-haze[..., None]) + hc*haze[..., None]
    # gentle s-curve and warm split tone
    a = np.clip(a, 0, 1)
    a = a + 0.06*(a-0.5)*(1-np.abs(2*a-1))  # mild contrast
    a[..., 0] *= 1.025; a[..., 2] *= 0.965
    # vignette centred on the house
    d = np.sqrt(((x-0.6)/0.9)**2 + ((y-0.45)/0.85)**2)
    v = 1 - 0.18*np.clip(d-0.35, 0, 1)**1.5
    a = a*v[..., None]
    out = Image.fromarray((np.clip(a, 0, 1)*255+0.5).astype(np.uint8))
    out = out.filter(ImageFilter.UnsharpMask(radius=1.2, percent=60, threshold=2))
    out = ImageEnhance.Color(out).enhance(0.95)
    return out
def save(im, path, maxkb):
    q = 86
    while True:
        im.save(path, 'WEBP', quality=q, method=6)
        import os
        if os.path.getsize(path) <= maxkb*1024 or q <= 60: break
        q -= 4
    print(path, im.size, os.path.getsize(path)//1024, 'KB q', q)
w = grade('final-wide.png', (2400, 1350))
w.save('out-2400.png')
save(w, 'hero-home-2400.webp', 340)
save(w.resize((1600, 900), Image.LANCZOS).filter(ImageFilter.UnsharpMask(radius=0.8, percent=40, threshold=2)), 'hero-home-1600.webp', 220)
p = grade('final-phone.png', (1200, 900))
save(p, 'hero-home-phone.webp', 220)
# og cover 1200x630 from the wide render, house centred
og = w.crop((420, 120, 420+2000, 120+1050)).resize((1200, 630), Image.LANCZOS)
og.save('og-cover.jpg', 'JPEG', quality=86, optimize=True, progressive=True)
import os; print('og', os.path.getsize('og-cover.jpg')//1024, 'KB')
