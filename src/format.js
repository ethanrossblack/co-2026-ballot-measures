export const fmt = d3.format(",");
export const pct = d3.format(".1%");
// Same wording wherever a county is called out on a canvas
export const countyLabel = (name, side, votes, share) =>
  `${name} County: ${fmt(votes)} ${side} votes (${pct(share)} of county)`;
export const normName = s => String(s ?? "").toLowerCase().replace(/\s+county$/, "").replace(/[^a-z]/g, "");
export const ringArea = r => Math.abs(d3.polygonArea(r));
export const msg = text => (document.getElementById("msg").textContent = text);
