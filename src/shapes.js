import { CONFIG } from "./config.js";
import { ringArea } from "./format.js";
import { state } from "./state.js";
import { Bodies, Vertices } from "./matter.js";

// ---------- Shape helpers ----------

// Douglas–Peucker on an open ring of [x, y] points
function simplify(points, tol) {
  if (points.length < 8) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > t2) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  const out = points.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : points;
}

// Resample a closed ring to n points spaced evenly along its perimeter
export function resample(ring, n) {
  const pts = ring.concat([ring[0]]);
  const seg = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    seg.push(d); total += d;
  }
  const out = [];
  let i = 0, acc = 0;
  for (let j = 0; j < n; j++) {
    const target = (j / n) * total;
    while (i < seg.length - 1 && acc + seg[i] < target) acc += seg[i++];
    const t = seg[i] ? (target - acc) / seg[i] : 0;
    out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]);
  }
  return out;
}

// Reorder `to` so its points travel the least distance from `from`:
// same winding, best starting index
export function alignTo(from, to) {
  const area = r => d3.polygonArea(r);
  if (Math.sign(area(from)) !== Math.sign(area(to))) to = to.slice().reverse();
  let best = to, bestD = Infinity;
  for (let k = 0; k < to.length; k++) {
    let d = 0;
    for (let i = 0; i < from.length; i++) {
      const q = to[(i + k) % to.length];
      d += (from[i][0] - q[0]) ** 2 + (from[i][1] - q[1]) ** 2;
      if (d >= bestD) break;
    }
    if (d < bestD) { bestD = d; best = to.slice(k).concat(to.slice(0, k)); }
  }
  return best;
}

export const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// A county scaled so its area = value * k px², as a Matter body.
// mode "map" keeps the outline; "circle" uses a circle of the same area.
export function buildCountyBody(c, value, k, mode = state.shapeMode) {
  if (mode === "circle") {
    const r = Math.sqrt((value * k) / Math.PI);
    const body = Bodies.circle(0, 0, r, { ...CONFIG.body });
    const path = new Path2D();
    path.arc(0, 0, r, 0, Math.PI * 2);
    const n = CONFIG.morphPoints;
    const morphPts = d3.range(n).map(i => [r * Math.cos((i / n) * 2 * Math.PI), r * Math.sin((i / n) * 2 * Math.PI)]);
    body.county = { id: c.id, name: c.name, value, path, offset: { x: 0, y: 0 }, w: 2 * r, h: 2 * r, mode, morphPts };
    return body;
  }

  const s = Math.sqrt((value * k) / c.projArea);
  const rings = c.rings.map(poly => poly.map(ring => ring.map(([x, y]) => [x * s, y * s])));

  const path = new Path2D();
  for (const poly of rings) for (const ring of poly) {
    path.moveTo(ring[0][0], ring[0][1]);
    for (let i = 1; i < ring.length; i++) path.lineTo(ring[i][0], ring[i][1]);
    path.closePath();
  }

  const outer = rings.map(p => p[0]).sort((a, b) => ringArea(b) - ringArea(a))[0];
  const pts = simplify(outer, CONFIG.simplifyPx).map(([x, y]) => ({ x, y }));
  const polyArea = ringArea(outer);
  const clone = () => pts.map(p => ({ x: p.x, y: p.y }));

  let body = null;
  if (polyArea > 250 && !Vertices.isConvex(clone())) {
    try { body = Bodies.fromVertices(0, 0, [clone()], { ...CONFIG.body }, true, 0.01, 1); } catch { body = null; }
    const partsArea = body ? (body.parts.length > 1 ? d3.sum(body.parts.slice(1), p => p.area) : body.area) : 0;
    if (partsArea < 0.85 * polyArea) body = null;
  }
  if (!body) body = Bodies.fromVertices(0, 0, [Vertices.hull(clone())], { ...CONFIG.body });

  // Offset from the body's centre of mass to the outline's coordinate frame
  const minX = d3.min(pts, p => p.x), minY = d3.min(pts, p => p.y);
  const maxX = d3.max(pts, p => p.x), maxY = d3.max(pts, p => p.y);
  const offset = { x: body.bounds.min.x - body.position.x - minX, y: body.bounds.min.y - body.position.y - minY };

  body.county = { id: c.id, name: c.name, value, path, offset, w: maxX - minX, h: maxY - minY, mode,
    morphPts: resample(outer, CONFIG.morphPoints) };
  return body;
}
