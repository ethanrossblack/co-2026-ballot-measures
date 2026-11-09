import { CONFIG } from "./config.js";
import { ringArea } from "./format.js";
import { state } from "./state.js";
import { Bodies, Vertices } from "./matter.js";

import { simplify, resample, alignTo, easeInOut } from "./geometry.js";
export { resample, alignTo, easeInOut };

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
