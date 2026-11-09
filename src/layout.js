// ---------- Non-overlapping layout for the map layout ----------
// Each county is a convex hull (a superset of its shape) at its final size. Hulls start at
// their map positions and are relaxed: overlapping or too-close pairs are pushed apart (the
// smaller county yields more), while a weak pull keeps everything near its map position.
//
// This runs tens of thousands of pair tests per layout, so the inner loops avoid allocating:
// hull points and edge normals live in typed arrays and the separating-axis result is written
// to a few shared variables instead of returned as an object.

// items: [{ id, hull: [[x, y]] relative to the county's anchor, home: {x, y}, start?: {x, y} }]
// (start defaults to home; pull is the per-step fraction of the way home during the growth stages)
// Returns { pos: Map id -> {x, y} (anchor position), overlaps: pairs still too close }
export function layoutHulls(items, W, H, { pad = 4, margin = 6, stages = 8, perStage = 40, settle = 800, pull = 0.03 } = {}) {
  let g = 1; // current growth factor: hulls grow from small to full size so the layout evolves smoothly
  const nodes = items.map(it => {
    const hull = it.hull, m = hull.length;
    const hx = new Float64Array(m), hy = new Float64Array(m), nx = new Float64Array(m), ny = new Float64Array(m);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < m; i++) {
      const p = hull[i], q = hull[(i + 1) % m];
      hx[i] = p[0]; hy[i] = p[1];
      const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
      nx[i] = dy / len; ny[i] = -dx / len;
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    // The hull's extent along each of its own edge normals at scale 1 and anchor (0, 0); at
    // growth g and anchor (x, y) it is g * [own0, own1] + (x, y) . normal, so it needn't be recomputed
    const own0 = new Float64Array(m), own1 = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      let a = Infinity, b = -Infinity;
      for (let j = 0; j < m; j++) {
        const d = hx[j] * nx[i] + hy[j] * ny[i];
        if (d < a) a = d;
        if (d > b) b = d;
      }
      own0[i] = a; own1[i] = b;
    }
    const start = it.start ?? it.home;
    return {
      id: it.id, home: it.home, x: start.x, y: start.y, hx, hy, nx, ny, own0, own1, m, minX, maxX, minY, maxY,
      root: Math.sqrt(Math.abs(d3.polygonArea(hull)) || 1)
    };
  });

  // Projection of a hull onto an axis (another hull's edge normal), written to lo / hi
  let lo = 0, hi = 0;
  function project(n, ax, ay) {
    lo = Infinity; hi = -Infinity;
    const { hx, hy, m, x, y } = n;
    for (let i = 0; i < m; i++) {
      const d = (hx[i] * g + x) * ax + (hy[i] * g + y) * ay;
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
  }

  // Overlap depth of a and b along one edge normal: axis i of a (k = 0) or of b (k = 1).
  // The two extents are left in a0..a1 and b0..b1.
  let a0 = 0, a1 = 0, b0 = 0, b1 = 0;
  function axisDepth(a, b, k, i) {
    const src = k ? b : a;
    const ax = src.nx[i], ay = src.ny[i], off = src.x * ax + src.y * ay;
    const s0 = src.own0[i] * g + off, s1 = src.own1[i] * g + off;
    project(k ? a : b, ax, ay);
    if (k) { a0 = lo; a1 = hi; b0 = s0; b1 = s1; } else { a0 = s0; a1 = s1; b0 = lo; b1 = hi; }
    return Math.min(a1, b1) - Math.max(a0, b0) + pad;
  }

  // Separating-axis test with a gap: false if at least `pad` apart, else true with the push
  // (a -> b) in hitDepth / hitX / hitY. Axes are tried a's edges first, then b's. Pairs move
  // little between steps, so the axis that last separated a pair is tried first; that can only
  // end the test sooner, never change its answer.
  const sepAxis = new Int32Array(nodes.length * nodes.length).fill(-1); // k * 65536 + i, or -1
  const APART = 0.05; // pairs sitting exactly at the gap count as apart
  let hitDepth = 0, hitX = 0, hitY = 0;
  function overlap(a, b, pair) {
    if (a.x + a.maxX * g + pad <= b.x + b.minX * g || b.x + b.maxX * g + pad <= a.x + a.minX * g ||
        a.y + a.maxY * g + pad <= b.y + b.minY * g || b.y + b.maxY * g + pad <= a.y + a.minY * g) return false;
    const cached = sepAxis[pair];
    if (cached >= 0 && axisDepth(a, b, cached >> 16, cached & 0xffff) <= APART) return false;
    hitDepth = Infinity;
    for (let k = 0; k < 2; k++) {
      const src = k ? b : a;
      for (let i = 0; i < src.m; i++) {
        const depth = axisDepth(a, b, k, i);
        if (depth <= APART) { sepAxis[pair] = (k << 16) | i; return false; }
        if (depth < hitDepth) {
          const sign = (b0 + b1) / 2 >= (a0 + a1) / 2 ? 1 : -1;
          hitDepth = depth; hitX = src.nx[i] * sign; hitY = src.ny[i] * sign;
        }
      }
    }
    return true;
  }

  function step(pull) {
    let count = 0;
    if (pull) for (const n of nodes) { n.x += (n.home.x - n.x) * pull; n.y += (n.home.y - n.y) * pull; }
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        if (!overlap(a, b, i * nodes.length + j)) continue;
        count++;
        const wa = b.root / (a.root + b.root), wb = 1 - wa;
        a.x -= hitX * hitDepth * wa; a.y -= hitY * hitDepth * wa;
        b.x += hitX * hitDepth * wb; b.y += hitY * hitDepth * wb;
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
