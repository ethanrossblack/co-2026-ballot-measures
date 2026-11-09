import { normName } from "./format.js";
import { COUNTIES, COUNTY_BY_KEY } from "./counties.js";

// ---------- Ballot measure results ----------

// Builds the results object the page works from out of one ballot measure in
// data/ballot-measures.js: { key, byId, totals, unmatched, missing }
export function measureToResults(measure) {
  const byId = new Map();
  const unmatched = [];
  for (const [name, v] of Object.entries(measure.counties)) {
    const c = COUNTY_BY_KEY.get(normName(name));
    if (!c) { unmatched.push(name); continue; }
    byId.set(c.id, { yes: v.yes, no: v.no });
  }
  if (!byId.size) throw new Error("No rows matched a Colorado county name.");
  const totals = {
    yes: d3.sum(byId.values(), d => d.yes),
    no: d3.sum(byId.values(), d => d.no)
  };
  return { key: measure.key, byId, totals, unmatched, missing: COUNTIES.filter(c => !byId.has(c.id)).map(c => c.name) };
}
