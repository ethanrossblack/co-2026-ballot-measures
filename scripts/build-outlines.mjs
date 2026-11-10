// Projects and simplifies the county outlines once, ahead of time, into a small JavaScript module
// (`export default {...}`) that the page imports, so the browser does no TopoJSON decoding,
// projection or simplification at load.
//
// Needs the build packages: run `npm install` once in the repo root (the site itself needs none).
//
// Projection: d3.geoConicEqualArea().parallels([37.5, 40.5]).rotate([105.5, 0]).fitSize([1000,
// 1000], counties). Equal-area, so a county's projected area is proportional to its real area.
//
// Simplification is topology-preserving: TopoJSON stores each shared border once (an arc), so
// every arc is simplified once (Douglas–Peucker in the projected frame, ends fixed) and both
// neighbours get the same line, with no gaps or overlaps on the state map. Any arc that would
// cross another arc, or leave a ring with fewer than 3 points, is redone at half the tolerance
// (after 8 halvings it keeps its source detail). The source already has a few crossings, tiny
// slivers around Denver and Broomfield; only crossings the simplification adds count.
// (Visvalingam, as in topojson-simplify, was tried: at the same vertex count it smooths away
// Denver's small blocky notches, which are what Denver looks like when the margin map enlarges it.)
//
// Usage: node scripts/build-outlines.mjs [--tolerance 0.25] [input.json] [output.js]
//   tolerance is in projected units (the state is 1000 wide)
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { geoConicEqualArea, geoPath } from "d3-geo";

const require = createRequire(import.meta.url);
const { feature, transform } = require("topojson-client");

const args = process.argv.slice(2);
const tolIdx = args.indexOf("--tolerance");
const TOLERANCE = tolIdx >= 0 ? Number(args.splice(tolIdx, 2)[1]) : 0.25;
if (!(TOLERANCE >= 0)) throw new Error("--tolerance needs a number >= 0");
const input = args[0] ?? "data/colorado-counties.json";
const output = args[1] ?? "data/county-outlines.js";
const SIZE = 1000;   // fitted frame
const DIGITS = 2;    // decimals kept in the output (0.01 units, well under a pixel)

const topo = JSON.parse(readFileSync(input, "utf8"));
const object = topo.objects["colorado-counties"];
const geoms = object.geometries;

// ---------- Projection ----------
const lonLat = feature(topo, object);
const projection = geoConicEqualArea().parallels([37.5, 40.5]).rotate([105.5, 0]).fitSize([SIZE, SIZE], lonLat);
const path = geoPath(projection);
// The same topology with every arc decoded and projected (no quantization transform)
const projected = {
  type: "Topology", objects: topo.objects,
  arcs: topo.arcs.map(arc => { const t = transform(topo.transform); return arc.map((p, i) => projection(t(p, i))); })
};

// ---------- Simplification ----------
// Douglas–Peucker on an open polyline with both ends kept. A closed arc (an island or hole made
// of one arc) starts and ends on the same point, so its first split is at the farthest point.
function simplifyArc(points, tol) {
  if (points.length <= 2 || tol <= 0) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]], t2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const ex = ax + t * dx - px, ey = ay + t * dy - py, d = ex * ex + ey * ey;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > t2) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

const round = v => Math.round(v * 10 ** DIGITS) / 10 ** DIGITS;
const tolOf = projected.arcs.map(() => TOLERANCE);
const cut = () => projected.arcs.map((arc, i) => simplifyArc(arc, tolOf[i]).map(([x, y]) => [round(x), round(y)]));

// Segments of two arcs cross (touching at a shared end point is fine)
function crosses(p1, p2, p3, p4) {
  const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
// Pairs of arcs ("i,j", i <= j) whose lines cross, via a uniform grid of segments
function crossingPairs(arcs) {
  const CELL = 10, grid = new Map(), bad = new Set();
  const segs = [];
  arcs.forEach((a, ai) => { for (let i = 1; i < a.length; i++) segs.push([ai, i, a[i - 1], a[i]]); });
  segs.forEach(([, , p, q], si) => {
    for (let gx = Math.floor(Math.min(p[0], q[0]) / CELL); gx <= Math.floor(Math.max(p[0], q[0]) / CELL); gx++)
      for (let gy = Math.floor(Math.min(p[1], q[1]) / CELL); gy <= Math.floor(Math.max(p[1], q[1]) / CELL); gy++) {
        const key = gx * 4096 + gy;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(si);
      }
  });
  for (const cell of grid.values()) for (let i = 0; i < cell.length; i++) for (let j = i + 1; j < cell.length; j++) {
    const [aa, ia, p1, p2] = segs[cell[i]], [ab, ib, p3, p4] = segs[cell[j]];
    if (aa === ab && Math.abs(ia - ib) <= 1) continue; // neighbouring segments of one arc
    if (crosses(p1, p2, p3, p4)) bad.add(Math.min(aa, ab) + "," + Math.max(aa, ab));
  }
  return bad;
}

const polygonsOf = g => (g.type === "Polygon" ? [g.arcs] : g.arcs);
const sourceCrossings = crossingPairs(projected.arcs.map(a => a.map(([x, y]) => [round(x), round(y)])));
let simple;
for (let pass = 0; ; pass++) {
  simple = cut();
  const redo = new Set();
  for (const pair of crossingPairs(simple))
    if (!sourceCrossings.has(pair)) pair.split(",").forEach(i => redo.add(Number(i)));
  // A ring's distinct points: each arc adds all but its last point (the next arc's first)
  for (const g of geoms) for (const poly of polygonsOf(g)) for (const ids of poly)
    if (ids.reduce((n, id) => n + simple[id < 0 ? ~id : id].length - 1, 0) < 3) ids.forEach(id => redo.add(id < 0 ? ~id : id));
  if (!redo.size) break;
  if (pass > 20) throw new Error(`simplification did not converge (${redo.size} arcs still invalid)`);
  for (const i of redo) tolOf[i] = pass < 8 ? tolOf[i] / 2 : 0;
}

// ---------- Output ----------
const shapes = feature({ type: "Topology", objects: topo.objects, arcs: simple }, object).features;
const polys = f => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates);
const vertexCount = fs => fs.reduce((s, f) => s + polys(f).flat().reduce((t, r) => t + r.length - 1, 0), 0);
const counties = geoms.map((g, i) => {
  return {
    id: g.properties.GEOID, name: g.properties.NAME,
    // Area of the unsimplified outline; the vote scale depends on it
    projArea: round(path.area(lonLat.features[i])),
    // GeoJSON rings repeat their first point at the end; the page wants them open
    rings: polys(shapes[i]).map(poly => poly.map(ring => ring.slice(0, -1)))
  };
});  // source order: neighbour shading and layout order depend on it

const before = vertexCount(lonLat.features), after = vertexCount(shapes);
const refined = tolOf.filter(t => t < TOLERANCE).length;

const header = `// Generated by scripts/build-outlines.mjs from ${input}; do not edit by hand.
// County outlines in the projected frame (d3.geoConicEqualArea, parallels 37.5/40.5, rotate
// [105.5, 0], fitted to ${SIZE}x${SIZE}; y points down). Each county: rings grouped by polygon,
// exterior ring first, then holes; rings are open (the last point does not repeat the first).
// Simplified (Douglas–Peucker, ${TOLERANCE} units), shared borders identical between neighbours:
// ${before} -> ${after} vertices. projArea is the projected area of the unsimplified outline.
`;
const body = counties.map(c => "  " + JSON.stringify(c)).join(",\n");
writeFileSync(output, `${header}export default {\n tolerance: ${TOLERANCE},\n counties: [\n${body}\n]};\n`);
console.log(`${counties.length} counties, ${before} -> ${after} vertices at tolerance ${TOLERANCE}` +
  (refined ? ` (${refined} arcs kept more detail to avoid crossings)` : "") + `; wrote ${output}`);
