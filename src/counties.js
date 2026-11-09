import { CONFIG } from "./config.js";
import { normName } from "./format.js";
import { simplify } from "./geometry.js";
import TOPO from "../data/colorado-topo.js";

// ---------- County geometry (once) ----------

function loadCounties() {
  const fc = topojson.feature(TOPO, TOPO.objects["colorado-counties"]);
  const projection = d3.geoConicEqualArea()
    .parallels([37.5, 40.5]).rotate([105.5, 0]).fitSize([1000, 1000], fc);
  const path = d3.geoPath(projection);
  return fc.features.map(f => {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    // The source outlines have far more detail than any stage can show (about 104k vertices);
    // simplifying once here makes every draw, hull and hit test cheaper
    const rings = polys.map(poly => poly.map(ring => simplify(ring.slice(0, -1).map(projection), CONFIG.outlineSimplify)));
    // Home = centroid of the largest exterior ring (the county's place on the state map)
    const main = rings.map(p => p[0]).sort((a, b) => Math.abs(d3.polygonArea(b)) - Math.abs(d3.polygonArea(a)))[0];
    return { id: f.id, name: f.properties.name, key: normName(f.properties.name), rings, projArea: path.area(f),
      home: d3.polygonCentroid(main) };
  });
}
export const COUNTIES = loadCounties();
// Bounding box of the whole state in the projected frame
const allPts = COUNTIES.flatMap(c => c.rings.flatMap(p => p[0]));
export const MAP_BOUNDS = {
  cx: (d3.min(allPts, p => p[0]) + d3.max(allPts, p => p[0])) / 2,
  cy: (d3.min(allPts, p => p[1]) + d3.max(allPts, p => p[1])) / 2,
  w: d3.max(allPts, p => p[0]) - d3.min(allPts, p => p[0]),
  h: d3.max(allPts, p => p[1]) - d3.min(allPts, p => p[1])
};
export const COUNTY_BY_KEY = new Map(COUNTIES.map(c => [c.key, c]));
export const COUNTY_BY_ID = new Map(COUNTIES.map(c => [c.id, c]));
