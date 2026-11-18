// Very dark roof colours go black under the 3D view's tone mapping and hide the roof form, so the 3D model keeps their lightness above a
// floor (src/viewer3d/build.js). The top view, the lot card map and the plan show the same lifted colour, so a roof reads the same in every
// place. Pure (no three.js): same maths as THREE.Color.getHSL / setHSL in the linear working space.

const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
  return p;
}

/** '#rrggbb' with its HSL lightness (linear space) raised to at least minL. Anything that is not a hex colour is returned as it came. */
export function liftDarkHex(hexStr, minL) {
  if (typeof hexStr !== 'string' || !/^#[0-9a-f]{6}$/i.test(hexStr)) return hexStr;
  const r = toLin(parseInt(hexStr.slice(1, 3), 16) / 255);
  const g = toLin(parseInt(hexStr.slice(3, 5), 16) / 255);
  const b = toLin(parseInt(hexStr.slice(5, 7), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (min + max) / 2;
  if (l >= minL) return hexStr;
  if (min !== max) {
    const d = max - min;
    s = l <= 0.5 ? d / (max + min) : d / (2 - max - min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  const L = minL;
  let nr = L; let ng = L; let nb = L;
  if (s !== 0) {
    const p2 = L <= 0.5 ? L * (1 + s) : L + s - L * s;
    const p1 = 2 * L - p2;
    nr = hue2rgb(p1, p2, h + 1 / 3); ng = hue2rgb(p1, p2, h); nb = hue2rgb(p1, p2, h - 1 / 3);
  }
  const to = (v) => Math.round(Math.min(1, Math.max(0, toSrgb(v))) * 255).toString(16).padStart(2, '0');
  return `#${to(nr)}${to(ng)}${to(nb)}`;
}
