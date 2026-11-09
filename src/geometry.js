// Pure geometry/animation helpers (no Matter.js dependency, so the margin map can use them
// while the Yes/No physics libraries are not loaded).

// Douglas–Peucker on an open ring of [x, y] points
export function simplify(points, tol) {
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
