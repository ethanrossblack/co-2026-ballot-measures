// ---------- Non-overlapping layout for the map layout ----------
// Each county is a convex hull (a superset of its shape) at its final size. Hulls start at
// their map positions and are relaxed: overlapping or too-close pairs are pushed apart (the
// smaller county yields more), while a weak pull keeps everything near its map position.

// items: [{ id, hull: [[x, y]] relative to the county's anchor, home: {x, y}, start?: {x, y} }]
// (start defaults to home; pull is the per-step fraction of the way home during the growth stages)
// Returns { pos: Map id -> {x, y} (anchor position), overlaps: pairs still too close }
export function layoutHulls(items, W, H, { pad = 4, margin = 6, stages = 8, perStage = 40, settle = 800, pull = 0.03 } = {}) {
  let g = 1; // current growth factor: hulls grow from small to full size so the layout evolves smoothly
  const nodes = items.map(it => {
    const hull = it.hull;
    const normals = hull.map((p, i) => {
      const q = hull[(i + 1) % hull.length];
      const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
      return [dy / len, -dx / len];
    });
    return {
      id: it.id, hull, normals, home: it.home, x: (it.start ?? it.home).x, y: (it.start ?? it.home).y,
      minX: Math.min(...hull.map(p => p[0])), maxX: Math.max(...hull.map(p => p[0])),
      minY: Math.min(...hull.map(p => p[1])), maxY: Math.max(...hull.map(p => p[1])),
      area: Math.abs(d3.polygonArea(hull)) || 1
    };
  });

  const interval = (n, axis) => {
    let lo = Infinity, hi = -Infinity;
    for (const [px, py] of n.hull) {
      const d = (px * g + n.x) * axis[0] + (py * g + n.y) * axis[1];
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    return [lo, hi];
  };

  // Separating-axis test with a gap: null if at least `pad` apart, else the push (a -> b)
  function overlap(a, b) {
    if (a.x + a.maxX * g + pad <= b.x + b.minX * g || b.x + b.maxX * g + pad <= a.x + a.minX * g ||
        a.y + a.maxY * g + pad <= b.y + b.minY * g || b.y + b.maxY * g + pad <= a.y + a.minY * g) return null;
    let best = null;
    for (const axis of [...a.normals, ...b.normals]) {
      const [a0, a1] = interval(a, axis), [b0, b1] = interval(b, axis);
      const depth = Math.min(a1, b1) - Math.max(a0, b0) + pad;
      if (depth <= 0.05) return null; // pairs sitting exactly at the gap count as apart
      if (!best || depth < best.depth) {
        const sign = (b0 + b1) / 2 >= (a0 + a1) / 2 ? 1 : -1;
        best = { depth, nx: axis[0] * sign, ny: axis[1] * sign };
      }
    }
    return best;
  }

  function step(pull) {
    let count = 0;
    if (pull) for (const n of nodes) { n.x += (n.home.x - n.x) * pull; n.y += (n.home.y - n.y) * pull; }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const hit = overlap(a, b);
        if (!hit) continue;
        count++;
        const wa = Math.sqrt(b.area) / (Math.sqrt(a.area) + Math.sqrt(b.area)), wb = 1 - wa;
        a.x -= hit.nx * hit.depth * wa; a.y -= hit.ny * hit.depth * wa;
        b.x += hit.nx * hit.depth * wb; b.y += hit.ny * hit.depth * wb;
      }
    }
    for (const n of nodes) { // keep every hull inside the stage
      const loX = margin - n.minX * g, hiX = W - margin - n.maxX * g, loY = margin - n.minY * g, hiY = H - margin - n.maxY * g;
      n.x = loX > hiX ? W / 2 : Math.min(Math.max(n.x, loX), hiX);
      n.y = loY > hiY ? H / 2 : Math.min(Math.max(n.y, loY), hiY);
    }
    return count;
  }

  for (let st = 1; st <= stages; st++) {
    g = 0.25 + (0.75 * st) / stages;
    for (let it = 0; it < perStage; it++) step(pull);
  }
  let overlaps = 0;
  for (let it = 0; it < settle; it++) { overlaps = step(0); if (!overlaps) break; }
  return { pos: new Map(nodes.map(n => [n.id, { x: n.x, y: n.y }])), overlaps };
}
