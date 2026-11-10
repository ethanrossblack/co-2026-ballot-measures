import { normName } from "./format.js";
import OUTLINES from "../data/county-outlines.js";

// ---------- County geometry (once) ----------
// The outlines arrive already projected (equal-area, 1000x1000 frame) and simplified by
// scripts/build-outlines.mjs, so there is nothing to decode or project here.

function loadCounties() {
  return OUTLINES.counties.map(({ id, name, projArea, rings }) => {
    // Home = centroid of the largest exterior ring (the county's place on the state map)
    const main = rings.map(p => p[0]).sort((a, b) => Math.abs(d3.polygonArea(b)) - Math.abs(d3.polygonArea(a)))[0];
    return { id, name, key: normName(name), rings, projArea, home: d3.polygonCentroid(main) };
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
