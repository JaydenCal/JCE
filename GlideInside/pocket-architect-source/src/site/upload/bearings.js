// Bearings and distances entry: a start point and a list of legs (bearing, distance in metres) walked around the boundary. Reports the
// misclose (how far the last leg ends from the start) and can spread it over the legs (Bowditch). Pure, no DOM.

const RAD = Math.PI / 180;

/**
 * parseBearing(text, { dotted }) -> degrees clockwise from north (0 to 360), or null. Reads
 *   quadrant bearings: N 45 30 15 E, N45°30'15"E, S12-30-00W, N45.5E, due north words are not accepted
 *   azimuths: 045°30'15", 45-30-15, 45 30 15, 45.5
 * A bare number with a decimal point is decimal degrees, unless `dotted` is true (Australian survey ddd.mmss, so 45.3015 is 45 30 15).
 */
export function parseBearing(text, { dotted = false } = {}) {
  let s = String(text || '').trim().toUpperCase().replace(/[°º˚]/g, ' ').replace(/['’′]/g, ' ').replace(/["”″]/g, ' ').replace(/-/g, ' ').replace(/\s+/g, ' ');
  if (!s) return null;
  let first = null;
  let last = null;
  const m = /^([NS])\s*([\d .]+?)\s*([EW])$/.exec(s);
  if (m) { first = m[1]; last = m[3]; s = m[2].trim(); }
  else if (/[NSEW]/.test(s)) return null;
  const parts = s.split(' ').filter(Boolean);
  if (!parts.length || parts.length > 3 || parts.some((x) => !/^\d+(\.\d+)?$/.test(x))) return null;
  let deg;
  if (parts.length === 1 && parts[0].includes('.') && dotted) {
    const [d, frac] = parts[0].split('.');
    const f = (frac + '0000').slice(0, 4);
    deg = Number(d) + Number(f.slice(0, 2)) / 60 + Number(f.slice(2, 4)) / 3600;
    if (Number(f.slice(0, 2)) >= 60 || Number(f.slice(2, 4)) >= 60) return null;
  } else {
    const [d, mi = 0, se = 0] = parts.map(Number);
    if (mi >= 60 || se >= 60) return null;
    deg = d + mi / 60 + se / 3600;
  }
  if (first) {
    if (deg > 90) return null;
    if (first === 'N' && last === 'E') return deg;
    if (first === 'S' && last === 'E') return 180 - deg;
    if (first === 'S' && last === 'W') return 180 + deg;
    return (360 - deg) % 360;
  }
  if (deg >= 360) return null;
  return deg;
}

/** A bearing as degrees, minutes and seconds text (045 30 15). */
export function formatBearing(deg) {
  let total = Math.round((((deg % 360) + 360) % 360) * 3600);
  if (total >= 360 * 3600) total = 0;
  const d = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(d).padStart(3, '0')}°${String(m).padStart(2, '0')}'${String(s).padStart(2, '0')}"`;
}

/**
 * parseLegs(text, { dotted }) -> { legs: [{ bearing, distance, line, source }], errors: [{ line, text, reason }] }
 * One leg per line: "bearing distance", separated by spaces, commas, tabs or a slash. Distances are metres.
 */
export function parseLegs(text, { dotted = false } = {}) {
  const legs = [];
  const errors = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    // The distance is the last number on the line; everything before it is the bearing.
    const m = /^(.*?)[\s,;\t/]+(\d+(?:\.\d+)?)\s*(?:m|metres|meters)?$/i.exec(line);
    if (!m) { errors.push({ line: i + 1, text: line, reason: 'Needs a bearing and a distance in metres.' }); return; }
    const bearing = parseBearing(m[1].trim().replace(/,$/, ''), { dotted });
    const distance = Number(m[2]);
    if (bearing == null) { errors.push({ line: i + 1, text: line, reason: 'The bearing could not be read.' }); return; }
    if (!(distance > 0)) { errors.push({ line: i + 1, text: line, reason: 'The distance must be more than zero.' }); return; }
    legs.push({ bearing, distance, line: i + 1, source: line });
  });
  return { legs, errors };
}

/**
 * walkLegs(start, legs, { adjust }) -> { points, closed, misclose: { dE, dN, distance, ratio, bearing }, perimeter, ring }
 * `start` is { e, n } in metres. `points` are the traverse stations from the start (the start included, and the end point). `ring` is the
 * boundary without the repeated start: the stations, with the misclose spread over the legs when `adjust` is 'bowditch'. With the
 * misclose left as is, the boundary closes by a straight line from the last station to the start.
 */
export function walkLegs(start, legs, { adjust = 'none' } = {}) {
  const pts = [{ e: start.e, n: start.n }];
  let e = start.e;
  let n = start.n;
  let perimeter = 0;
  for (const l of legs) {
    e += l.distance * Math.sin(l.bearing * RAD);
    n += l.distance * Math.cos(l.bearing * RAD);
    perimeter += l.distance;
    pts.push({ e, n });
  }
  const dE = e - start.e;
  const dN = n - start.n;
  const distance = Math.hypot(dE, dN);
  const misclose = { dE, dN, distance, ratio: distance > 1e-9 ? Math.round(perimeter / distance) : Infinity, bearing: distance > 1e-9 ? (((Math.atan2(dE, dN) / RAD) % 360) + 360) % 360 : 0 };
  let ring = pts.slice(0, -1);
  if (adjust === 'bowditch' && distance > 1e-9 && perimeter > 0) {
    let run = 0;
    ring = pts.slice(0, -1).map((p, i) => {
      if (i > 0) run += legs[i - 1].distance;
      const f = run / perimeter;
      return { e: p.e - dE * f, n: p.n - dN * f };
    });
  }
  return { points: pts, ring, closed: distance < 1e-6, misclose, perimeter, adjusted: adjust === 'bowditch' };
}

/** "1:12500" style text for a misclose ratio, or "closes exactly". */
export function miscloseText(m) {
  if (!m || !(m.distance > 1e-6)) return 'Closes exactly';
  return `Misclose ${m.distance.toFixed(3)} m, 1 in ${Number.isFinite(m.ratio) ? m.ratio.toLocaleString('en-AU') : 'n/a'}`;
}
