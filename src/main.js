import { CONFIG } from "./config.js";
import { fmt, msg, pct } from "./format.js";
import { measureToResults } from "./results.js";
import { fitSegLabels, setTableData } from "./table.js";
import { createSim } from "./sim.js";
import { state } from "./state.js";
import BALLOT_MEASURES from "../data/ballot-measures.js";

// ---------- Page ----------

const sims = ["yes", "no"].map(side =>
  createSim(side, document.querySelector(`.side[data-side="${side}"]`)));
let current = null;

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ["ink", "paper", "line", "active", "yes", "yes-2", "no", "no-2"]) {
    state.colors[k] = cs.getPropertyValue(`--${k}`).trim();
  }
}

let sizeFactor = 1;

function dropBoth() {
  if (!current) return;
  const { totals } = current;
  // One shared scale: the side with more votes fills `fillRatio` of the smaller stage
  // The size slider scales linear dimensions, so area scales with its square
  const k = (sizeFactor ** 2 * CONFIG.fillRatio * Math.min(...sims.map(s => s.area()))) / Math.max(totals.yes, totals.no);
  sims.forEach(s => s.drop(current, k));
}

function showResults(res, title) {
  current = res;
  document.getElementById("title").textContent = title;
  const all = res.totals.yes + res.totals.no;
  for (const side of ["yes", "no"]) {
    document.getElementById(`total-${side}`).textContent =
      `${fmt(res.totals[side])} votes, ${pct(all ? res.totals[side] / all : 0)}`;
  }
  const notes = [];
  if (res.unmatched.length) notes.push(`Rows not matched to a county: ${res.unmatched.join(", ")}.`);
  if (res.missing.length) notes.push(`Counties with no data: ${res.missing.join(", ")}.`);
  msg(notes.join(" "));
  setTableData(res);
  dropBoth();
}

const sizeInput = document.getElementById("size");
const sizeOut = document.getElementById("size-out");
sizeInput.addEventListener("input", () => {
  sizeOut.textContent = `${Math.round(sizeInput.value * 100)}%`; // live readout; re-drop on release
});
sizeInput.addEventListener("change", () => {
  sizeFactor = Number(sizeInput.value);
  dropBoth();
});
document.getElementById("drop").addEventListener("click", dropBoth);
document.getElementById("shake").addEventListener("click", () => sims.forEach(s => s.shake()));
const shapeBtn = document.getElementById("shape");
shapeBtn.addEventListener("click", () => {
  state.shapeMode = state.shapeMode === "map" ? "circle" : "map";
  shapeBtn.setAttribute("aria-pressed", String(state.shapeMode === "circle"));
  shapeBtn.textContent = state.shapeMode === "circle" ? "Show map shapes" : "Show as circles";
  sims.forEach(s => s.morph(state.shapeMode));
});
const gravityBtn = document.getElementById("gravity");
gravityBtn.addEventListener("click", () => {
  const on = gravityBtn.getAttribute("aria-pressed") !== "true";
  gravityBtn.setAttribute("aria-pressed", String(on));
  gravityBtn.textContent = on ? "Gravity on" : "Gravity off";
  sims.forEach(s => { s.setGravity(on); if (!on) s.shake(); });
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { sims.forEach(s => s.resize()); fitSegLabels(); }, 150);
});
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readColors);

function frame() {
  // Whichever side the pointer is on drives the highlight on both sides
  const picks = sims.map(s => s.pick());
  const source = picks.findIndex(id => id !== null);
  // A pointer on a canvas wins; otherwise use the county hovered in the table
  const id = source >= 0 ? picks[source] : state.tableHoverId;
  sims.forEach((s, i) => s.draw(state.colors, id, i === source));
  requestAnimationFrame(frame);
}

readColors();
sims.forEach(s => s.resize());

const measureSelect = document.getElementById("measure");
let measureData = null;

function showMeasure(key, { updateUrl = true } = {}) {
  const m = measureData.measures.find(x => x.key === key) ?? measureData.measures[0];
  measureSelect.value = m.key;
  document.getElementById("snapshot-note").textContent =
    `${measureData.election}. ${m.precinctsReportingPercent}% of precincts reporting as of ${measureData.snapshot}.`;
  showResults(measureToResults(m), m.title);
  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set("measure", m.key);
    history.replaceState(null, "", url);
  }
}

measureSelect.addEventListener("change", () => showMeasure(measureSelect.value));

function loadMeasures() {
  measureData = BALLOT_MEASURES;
  if (!measureData?.measures?.length) {
    msg("No ballot measures found. Run node scripts/build-ballot-measures.mjs to generate data/ballot-measures.js.");
    return;
  }
  for (const m of measureData.measures) measureSelect.add(new Option(m.title, m.key));
  measureSelect.disabled = false;
  showMeasure(new URLSearchParams(location.search).get("measure"), { updateUrl: false });
}
loadMeasures();
requestAnimationFrame(frame);
