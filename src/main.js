import { CONFIG } from "./config.js";
import { fmt, msg, pct } from "./format.js";
import { measureToResults } from "./results.js";
import { fitSegLabels, setTableData } from "./table.js";
import { createMarginMap } from "./marginmap.js";
import { state } from "./state.js";
import BALLOT_MEASURES from "../data/ballot-measures.js";

// ---------- Page ----------

const sidesEnabled = CONFIG.showSideContainers || new URLSearchParams(location.search).get("sides") === "on";
let sims = [];
if (sidesEnabled) {
  // Mount the Yes/No containers + controls, then load the physics libraries and the sim
  const loadScript = src => new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement("script"), { src });
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.append(s);
  });
  document.getElementById("sides-mount").replaceWith(document.getElementById("sides-template").content);
  await loadScript("https://cdn.jsdelivr.net/npm/poly-decomp@0.3.0/build/decomp.min.js");
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.19.0/matter.min.js");
  const { createSim } = await import("./sim.js");
  sims = ["yes", "no"].map(side =>
    createSim(side, document.querySelector(`.side[data-side="${side}"]`)));
}
const marginMap = createMarginMap(document.querySelector(".margin-section"));
let current = null;

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ["ink", "paper", "line", "active", "yes", "yes-2", "no", "no-2"]) {
    state.colors[k] = cs.getPropertyValue(`--${k}`).trim();
  }
}

let sizeFactor = 1;

function dropBoth() {
  if (!current || !sims.length) return;
  const { totals } = current;
  // One shared scale: the side with more votes fills `fillRatio` of the smaller stage
  // The size slider scales linear dimensions, so area scales with its square
  const k = (sizeFactor ** 2 * (state.layoutMode === "map" ? CONFIG.mapFillRatio : CONFIG.fillRatio) * Math.min(...sims.map(s => s.area()))) / Math.max(totals.yes, totals.no);
  sims.forEach(s => s.drop(current, k));
  syncDropBtn();
}

// In the map layout this button switches between the physical map and the vote-proportional
// layout (with an animation); in the falling layout it replays the drop.
const dropBtn = document.getElementById("drop"); // null while the Yes/No containers are off
function syncDropBtn() {
  if (!dropBtn) return;
  if (state.layoutMode !== "map") {
    dropBtn.textContent = "Drop again";
    dropBtn.title = "Drop the counties again";
    return;
  }
  const toProportional = sims[0].viewTarget() === "proportional";
  dropBtn.textContent = toProportional ? "Show physical map" : "Show vote-proportional map";
  dropBtn.title = toProportional
    ? "Animate back to the real shape and position of every county"
    : "Animate each county to its vote area, spaced so none touch";
}

// Header: measure number, Blue Book short name, type/origin/threshold, pass status,
// what a Yes and a No vote mean, and the official ballot title (collapsed)
const ORIGIN = { initiative: "Citizen initiative", legislature: "Referred by the legislature" };
const KIND = { constitutional: "Constitutional amendment", statutory: "Statutory change" };
const needText = p => (p > 0.5 ? `at least ${d3.format(".0%")(p)}` : "a majority");

function showMeasureInfo(m, res) {
  const set = (id, text) => (document.getElementById(id).textContent = text ?? "");
  set("title", m.name ?? m.title);
  set("measure-name", m.shortTitle);
  set("measure-meta", [KIND[m.kind], ORIGIN[m.origin], m.passShare && `Needs ${needText(m.passShare)} to pass`]
    .filter(Boolean).join(" · "));
  const all = res.totals.yes + res.totals.no;
  const share = all ? res.totals.yes / all : 0;
  const chip = document.getElementById("pass-chip");
  chip.hidden = !(m.passShare && all);
  if (!chip.hidden) {
    // A majority means more than half; the 55% rule is "at least 55 percent of the votes cast"
    const passing = m.passShare > 0.5 ? share >= m.passShare : share > 0.5;
    chip.textContent = passing ? "Passing" : "Failing";
    chip.className = `pass-chip ${passing ? "yes" : "no"}`;
    set("pass-text", `Yes has ${pct(share)} of the vote and needs ${needText(m.passShare)}.`);
  } else set("pass-text", "");
  document.getElementById("vote-means").hidden = !(m.yes && m.no);
  set("means-yes", m.yes);
  set("means-no", m.no);
  document.getElementById("ballot-title").hidden = !m.ballotTitle;
  set("ballot-title-text", m.ballotTitle);
  set("ballot-title-note", m.ballotTitleNote);
  const src = document.getElementById("measure-source");
  src.replaceChildren();
  if (measureData.source?.url) {
    const a = Object.assign(document.createElement("a"), {
      href: m.page ? `${measureData.source.url}#page=${m.page}` : measureData.source.url,
      textContent: `full analysis in the Blue Book${m.page ? ` (PDF, p. ${m.page})` : ""}`,
      target: "_blank", rel: "noopener"
    });
    src.append("Source: Colorado Legislative Council Staff; ", a, ".");
  }
  markPassLine(m.passShare);
}

// A thin line across both statewide bars at the Yes share needed to pass
function markPassLine(p) {
  document.querySelectorAll(".statewide").forEach(sw => {
    const bar = sw.querySelector(".split");
    if (bar && p) {
      const line = document.createElement("span");
      line.className = "pass-line";
      line.style.left = `${p * 100}%`;
      line.title = `${d3.format(".0%")(p)} Yes needed to pass`;
      bar.append(line);
    }
    sw.querySelector(".statewide-cap").textContent = p
      ? `Statewide votes · line at ${d3.format(".0%")(p)}, the Yes share needed to pass`
      : "Statewide votes";
  });
}

function showResults(res) {
  current = res;
  const all = res.totals.yes + res.totals.no;
  for (const side of ["yes", "no"]) {
    const el = document.getElementById(`total-${side}`);
    if (el) el.textContent = `${fmt(res.totals[side])} votes, ${pct(all ? res.totals[side] / all : 0)}`;
  }
  const notes = [];
  if (res.unmatched.length) notes.push(`Rows not matched to a county: ${res.unmatched.join(", ")}.`);
  if (res.missing.length) notes.push(`Counties with no data: ${res.missing.join(", ")}.`);
  msg(notes.join(" "));
  setTableData(res);
  dropBoth();
  marginMap.setData(res);
}

function wireSideControls() {
  const sizeInput = document.getElementById("size");
  const sizeOut = document.getElementById("size-out");
  sizeInput.addEventListener("input", () => {
    sizeOut.textContent = `${Math.round(sizeInput.value * 100)}%`; // live readout; re-drop on release
  });
  sizeInput.addEventListener("change", () => {
    sizeFactor = Number(sizeInput.value);
    dropBoth();
  });
  dropBtn.addEventListener("click", () => {
    if (state.layoutMode !== "map") return dropBoth();
    sims.forEach(s => s.toggleView());
    syncDropBtn();
  });
  document.getElementById("shake").addEventListener("click", () => sims.forEach(s => s.shake()));
  const shapeBtn = document.getElementById("shape");
  shapeBtn.addEventListener("click", () => {
    state.shapeMode = state.shapeMode === "map" ? "circle" : "map";
    shapeBtn.setAttribute("aria-pressed", String(state.shapeMode === "circle"));
    shapeBtn.textContent = state.shapeMode === "circle" ? "Show map shapes" : "Show as circles";
    sims.forEach(s => s.morph(state.shapeMode));
  });
  const gravityBtn = document.getElementById("gravity");
  const gravityOn = () => gravityBtn.getAttribute("aria-pressed") === "true";
  gravityBtn.addEventListener("click", () => {
    const on = !gravityOn();
    gravityBtn.setAttribute("aria-pressed", String(on));
    gravityBtn.textContent = on ? "Gravity on" : "Gravity off";
    sims.forEach(s => { s.setGravity(on); if (!on) s.shake(); });
  });

  // Layout: "fall" drops counties into a pile; "map" starts as the state and resizes in place
  const layoutBtn = document.getElementById("layout");
  function setLayout(mode, { redrop = true } = {}) {
    state.layoutMode = mode;
    const map = mode === "map";
    layoutBtn.setAttribute("aria-pressed", String(map));
    layoutBtn.textContent = map ? "Back to falling" : "Try map layout";
    gravityBtn.disabled = map; // the springs replace gravity
    sims.forEach(s => s.setGravity(gravityOn()));
    if (map && state.shapeMode !== "map") { // outlines show the state; the re-drop below builds them
      state.shapeMode = "map";
      shapeBtn.setAttribute("aria-pressed", "false");
      shapeBtn.textContent = "Show as circles";
    }
    if (redrop) dropBoth(); else syncDropBtn();
  }
  layoutBtn.addEventListener("click", () => setLayout(state.layoutMode === "map" ? "fall" : "map"));
  return setLayout;
}
const setLayout = sidesEnabled ? wireSideControls() : null;

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    sims.forEach(s => s.resize());
    marginMap.resize();
    fitSegLabels();
    if (state.layoutMode === "map") dropBoth(); // the starting map depends on the stage size
  }, 150);
});
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readColors);

function frame() {
  // Whichever side the pointer is on drives the highlight on both sides
  const picks = [...sims.map(s => s.pick()), marginMap.pick()];
  const source = picks.findIndex(id => id !== null);
  // A pointer on a canvas wins; otherwise use the county hovered in the table
  const id = source >= 0 ? picks[source] : state.tableHoverId;
  sims.forEach((s, i) => s.draw(state.colors, id, i === source));
  marginMap.draw(state.colors, id, source === sims.length);
  requestAnimationFrame(frame);
}

readColors();
sims.forEach(s => s.resize());
marginMap.resize();

const measureSelect = document.getElementById("measure");

// The picker bar sticks to the top: publish its height so the table's sticky header sits
// below it, and give it a shadow once the page has scrolled under it
const measureBar = document.querySelector(".measure-bar");
new ResizeObserver(() =>
  document.documentElement.style.setProperty("--bar-h", `${measureBar.offsetHeight}px`)).observe(measureBar);
const syncBarShadow = () => measureBar.classList.toggle("stuck", window.scrollY > 0);
window.addEventListener("scroll", syncBarShadow, { passive: true });
syncBarShadow();
let measureData = null;

function showMeasure(key, { updateUrl = true } = {}) {
  const m = measureData.measures.find(x => x.key === key) ?? measureData.measures[0];
  measureSelect.value = m.key;
  document.getElementById("snapshot-note").textContent =
    `${measureData.election}. ${m.precinctsReportingPercent}% of precincts reporting as of ${measureData.snapshot}.`;
  const res = measureToResults(m);
  showResults(res); // builds the statewide bars that showMeasureInfo marks
  showMeasureInfo(m, res);
  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set("measure", m.key);
    history.replaceState(null, "", url);
  }
}

if (setLayout && new URLSearchParams(location.search).get("layout") === "map") setLayout("map", { redrop: false });

measureSelect.addEventListener("change", () => showMeasure(measureSelect.value));

function loadMeasures() {
  measureData = BALLOT_MEASURES;
  if (!measureData?.measures?.length) {
    msg("No ballot measures found. Run node scripts/build-ballot-measures.mjs to generate data/ballot-measures.js.");
    return;
  }
  for (const m of measureData.measures) {
    measureSelect.add(new Option(m.shortTitle ? `${m.name}: ${m.shortTitle}` : m.title, m.key));
  }
  measureSelect.disabled = false;
  showMeasure(new URLSearchParams(location.search).get("measure"), { updateUrl: false });
}
loadMeasures();
requestAnimationFrame(frame);
