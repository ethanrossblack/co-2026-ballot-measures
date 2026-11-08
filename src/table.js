import { fmt, pct } from "./format.js";
import { COUNTIES } from "./counties.js";
import { state } from "./state.js";

// ---------- Results table ----------

const tableState = { key: "name", dir: "asc" };
let tableRows = [];
let tableQuery = "";     // lowercase search text

// Every sort the dropdown offers: the column-header sorts, plus two extra measures
const SORT_GROUPS = [
  ["Table columns", [
    ["name", "asc", "County (A to Z)"], ["name", "desc", "County (Z to A)"],
    ["yes", "desc", "Yes votes (most first)"], ["yes", "asc", "Yes votes (fewest first)"],
    ["no", "desc", "No votes (most first)"], ["no", "asc", "No votes (fewest first)"],
    ["share", "desc", "% Yes (highest first)"], ["share", "asc", "% Yes (lowest first)"],
    ["margin", "desc", "Margin (biggest Yes lead first)"], ["margin", "asc", "Margin (biggest No lead first)"],
    ["total", "desc", "Total votes (most first)"], ["total", "asc", "Total votes (fewest first)"]
  ]],
  ["Other measures", [
    ["absMargin", "asc", "Closest races first"], ["absMargin", "desc", "Widest margins first"],
    ["diff", "desc", "Vote differential (largest first)"], ["diff", "asc", "Vote differential (smallest first)"]
  ]]
];
const sortSelect = document.getElementById("sort-select");
for (const [label, options] of SORT_GROUPS) {
  const group = document.createElement("optgroup");
  group.label = label;
  for (const [key, dir, text] of options) {
    const opt = document.createElement("option");
    opt.value = `${key}:${dir}`;
    opt.textContent = text;
    group.append(opt);
  }
  sortSelect.append(group);
}

function td(text, cls) {
  const el = document.createElement("td");
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

// Small shares need two decimals so San Juan reads 0.02% rather than 0.0%
const fmtShare = p => d3.format(p < 0.01 ? ".2%" : ".1%")(p);

// One rectangle split into Yes and No segments, each as wide as its share of the votes.
// Percentages sit inside the segments; vote counts sit beneath, under their own side.
function splitBar(name, yes, no) {
  const all = yes + no;
  const ys = all ? yes / all : 0, ns = all ? no / all : 0;
  const wrap = document.createElement("div");
  wrap.className = "split-wrap";
  wrap.setAttribute("role", "img");
  const summary = `${name}: Yes ${fmt(yes)} (${pct(ys)}), No ${fmt(no)} (${pct(ns)})`;
  wrap.setAttribute("aria-label", summary);
  wrap.title = summary;
  const bar = document.createElement("div");
  bar.className = "split";
  const counts = document.createElement("div");
  counts.className = "split-counts";
  for (const [cls, votes, share] of [["yes", yes, ys], ["no", no, ns]]) {
    const seg = document.createElement("span");
    seg.className = `seg ${cls}`;
    seg.style.width = `${share * 100}%`;
    const lab = document.createElement("span");
    lab.className = "lab";
    lab.textContent = pct(share);
    seg.append(lab);
    bar.append(seg);
    const count = document.createElement("span");
    count.textContent = fmt(votes);
    counts.append(count);
  }
  wrap.append(bar, counts);
  return wrap;
}

// Hide a percentage label when its segment is too narrow to hold it
export function fitSegLabels() {
  document.querySelectorAll(".seg").forEach(seg => {
    const lab = seg.firstElementChild;
    const cs = getComputedStyle(seg);
    const room = seg.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    lab.style.visibility = lab.offsetWidth > room ? "hidden" : "";
  });
}

// Net margin in percentage points, e.g. "+3.1 Yes" or "+14.0 No"; m = (yes - no) / (yes + no)
function fmtMargin(m) {
  const pts = Math.abs(m) * 100;
  if (pts < 0.005) return { num: "", word: "Even", cls: "even" };
  let num = pts.toFixed(1);
  if (num === "0.0") num = pts.toFixed(2); // keep a tiny lead from reading as zero
  return { num: `+${num}`, word: m > 0 ? "Yes" : "No", cls: m > 0 ? "yes" : "no" };
}

// Bold number, cell filled with the color of the leading side,
// with the raw vote differential in smaller text underneath
function tdMargin(yes, no) {
  const all = yes + no;
  const { num, word, cls } = fmtMargin(all ? (yes - no) / all : 0);
  const diff = Math.abs(yes - no);
  const el = document.createElement("td");
  el.className = `margin-cell ${cls}`;
  const main = document.createElement("div");
  main.className = "margin-main";
  if (num) {
    const strong = document.createElement("strong");
    strong.textContent = num;
    // Own element with preserved whitespace: a flex container would swallow a bare leading space
    const label = document.createElement("span");
    label.textContent = ` ${word}`;
    main.append(strong, label);
  } else {
    main.textContent = word;
  }
  const sub = document.createElement("div");
  sub.className = "margin-sub";
  sub.textContent = fmt(diff);
  el.title = diff ? `${word} leads by ${fmt(diff)} ${diff === 1 ? "vote" : "votes"}` : "Tied";
  el.append(main, sub);
  return el;
}

// County total, with its share of the statewide total in smaller text underneath
function tdTotal(total, share) {
  const el = document.createElement("td");
  el.className = "num total-cell";
  el.title = `${fmtShare(share)} of the statewide total`;
  const main = document.createElement("div");
  main.className = "total-main";
  main.textContent = fmt(total);
  const sub = document.createElement("div");
  sub.className = "total-sub";
  sub.textContent = fmtShare(share);
  el.append(main, sub);
  return el;
}

function tdBar(name, yes, no) {
  const el = document.createElement("td");
  el.className = "split-cell";
  el.append(splitBar(name, yes, no));
  return el;
}

function renderTable() {
  const { key, dir } = tableState;
  const sign = dir === "asc" ? 1 : -1;
  // Substring match on county name, plus a space-insensitive prefix match
  // so "elpaso" finds "El Paso" without "san" matching "Las Animas"
  const q = tableQuery, qCompact = q.replace(/\s+/g, "");
  const matches = r => {
    const n = r.name.toLowerCase();
    return !q || n.includes(q) || n.replace(/\s+/g, "").startsWith(qCompact);
  };
  const rows = tableRows.filter(matches).sort((a, b) => {
    const d = key === "name" ? a.name.localeCompare(b.name) : a[key] - b[key];
    return sign * d || a.name.localeCompare(b.name); // ties fall back to name
  });
  const body = rows.map(r => {
    const tr = document.createElement("tr");
    tr.dataset.id = r.id;
    tr.append(td(r.name, "name"), tdBar(r.name, r.yes, r.no), tdMargin(r.yes, r.no),
      tdTotal(r.total, r.pctState));
    return tr;
  });
  if (!rows.length) {
    const tr = document.createElement("tr");
    const cell = td(`No counties match \u201c${document.getElementById("county-search").value.trim()}\u201d`, "empty");
    cell.colSpan = 4;
    tr.append(cell);
    body.push(tr);
  }
  document.querySelector("#results-table tbody").replaceChildren(...body);
  document.getElementById("table-count").textContent = tableQuery
    ? `${rows.length} of ${tableRows.length} counties`
    : `${tableRows.length} counties`;
  // Arrows live on each button; a header cell reports aria-sort if one of its buttons is active
  document.querySelectorAll("#results-table .sort-btn").forEach(btn => {
    btn.dataset.sort = btn.dataset.key === key ? dir : "none";
  });
  document.querySelectorAll("#results-table thead th").forEach(th => {
    const active = th.querySelector(`.sort-btn[data-key="${key}"]`);
    th.setAttribute("aria-sort", active ? (dir === "asc" ? "ascending" : "descending") : "none");
  });
  sortSelect.value = `${key}:${dir}`; // keep the dropdown in step with header clicks
  fitSegLabels();
}

export function setTableData(res) {
  const grand = res.totals.yes + res.totals.no; // statewide total
  tableRows = COUNTIES.filter(c => res.byId.has(c.id)).map(c => {
    const { yes, no } = res.byId.get(c.id);
    const total = yes + no;
    return {
      id: c.id, name: c.name, yes, no, total,
      share: total ? yes / total : 0,          // Yes share within the county
      margin: total ? (yes - no) / total : 0,  // + favors Yes, - favors No
      absMargin: total ? Math.abs(yes - no) / total : 0, // size of the lead, either side
      diff: Math.abs(yes - no),                // raw vote differential
      pctState: grand ? total / grand : 0      // county total as a share of the statewide total
    };
  });
  // The same Yes/No bar, standalone, above the margin map and at the top of the table
  document.querySelectorAll(".statewide-bar").forEach(el =>
    el.replaceChildren(splitBar("Statewide", res.totals.yes, res.totals.no)));
  const tr = document.createElement("tr");
  tr.append(td("Statewide"), tdBar("Statewide", res.totals.yes, res.totals.no),
    tdMargin(res.totals.yes, res.totals.no), tdTotal(grand, grand ? 1 : 0));
  document.querySelector("#results-table tfoot").replaceChildren(tr);
  renderTable();
}

document.querySelector("#results-table thead").addEventListener("click", e => {
  const btn = e.target.closest(".sort-btn");
  if (!btn) return;
  const key = btn.dataset.key;
  if (tableState.key === key) tableState.dir = tableState.dir === "asc" ? "desc" : "asc";
  else { tableState.key = key; tableState.dir = key === "name" ? "asc" : "desc"; }
  renderTable();
});

sortSelect.addEventListener("change", () => {
  const [key, dir] = sortSelect.value.split(":");
  tableState.key = key;
  tableState.dir = dir;
  state.tableHoverId = null; // rows are about to be rebuilt
  renderTable();
});

document.getElementById("county-search").addEventListener("input", e => {
  tableQuery = e.target.value.trim().toLowerCase();
  state.tableHoverId = null; // rows are about to be rebuilt
  renderTable();
});

// Web fonts change text widths, so re-check which labels fit once they load
document.fonts?.ready.then(fitSegLabels);

// Hovering anywhere on a county's row highlights that county in both containers
const tbody = document.querySelector("#results-table tbody");
tbody.addEventListener("mouseover", e => {
  const row = e.target.closest("tr[data-id]");
  state.tableHoverId = row ? row.dataset.id : null;
});
tbody.addEventListener("mouseleave", () => (state.tableHoverId = null));
// Re-sorting rebuilds the rows under a stationary pointer, so drop any stale hover
document.querySelector("#results-table thead").addEventListener("mouseenter", () => (state.tableHoverId = null));
