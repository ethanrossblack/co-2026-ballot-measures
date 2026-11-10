import { normName } from "./format.js";
import OUTLINES from "../data/county-outlines.js";

// ---------- County geometry ----------
// scripts/build-outlines.mjs does all the map work ahead of time: the outlines arrive projected
// (equal-area, 1000x1000 frame) and simplified, with each county's home point (centroid of its
// largest exterior ring, its place on the state map) and the state's bounding box.

export const COUNTIES = OUTLINES.counties.map(({ id, name, projArea, home, rings }) =>
  ({ id, name, key: normName(name), rings, projArea, home }));
// Bounding box of the whole state in the projected frame: { cx, cy, w, h }
export const MAP_BOUNDS = OUTLINES.bounds;
export const COUNTY_BY_KEY = new Map(COUNTIES.map(c => [c.key, c]));
export const COUNTY_BY_ID = new Map(COUNTIES.map(c => [c.id, c]));
