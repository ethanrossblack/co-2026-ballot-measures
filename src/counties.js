import { normName } from "./format.js";
import TOPO from "../data/colorado-topo.js";

// ---------- County geometry (once) ----------

function loadCounties() {
    const fc = topojson.feature(TOPO, TOPO.objects["colorado-counties"]);
  const projection = d3.geoConicEqualArea()
    .parallels([37.5, 40.5]).rotate([105.5, 0]).fitSize([1000, 1000], fc);
  const path = d3.geoPath(projection);
  return fc.features.map(f => {
    const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const rings = polys.map(poly => poly.map(ring => ring.slice(0, -1).map(projection)));
    return { id: f.id, name: f.properties.name, key: normName(f.properties.name), rings, projArea: path.area(f) };
  });
}
export const COUNTIES = loadCounties();
export const COUNTY_BY_KEY = new Map(COUNTIES.map(c => [c.key, c]));
export const COUNTY_BY_ID = new Map(COUNTIES.map(c => [c.id, c]));
