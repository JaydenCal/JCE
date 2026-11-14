import * as G from '../../src/model/geometry.js';
export const insideYard = (poly, yard, tol = 5) => poly.every((q) => G.pointInPolygon(q, yard) || yard.some((a, i) => G.projectToSegment(q, a, yard[(i + 1) % yard.length]).d <= tol));
