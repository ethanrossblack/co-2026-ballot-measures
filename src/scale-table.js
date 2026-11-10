import { fmt, pct } from "./format.js";
import { COUNTY_BY_ID } from "./counties.js";

// ---------- Scale page: editable votes table ----------
// One row per county with the Yes and No counts as text inputs and a slider for the county's
// Yes/No split (which keeps its total), all read-only until the Edit votes button turns editing
// on (the choice is kept across measures). Edits change the shared
// `votes` map in place and call onEdit (debounced while typing); the reported numbers stay
// in `original` so each row, and the whole table, can be reset.

const SIDES = ["yes", "no"];
const EDIT_DELAY_MS = 300;
const RATIO_STEPS = 1000; // slider resolution: 0.1 point of share

const parse = s => {
  const digits = String(s).replace(/[^\d]/g, "");
  return digits ? Math.min(Number(digits), 1e9) : 0;
};

export function createVoteTable(section, { onEdit, onHover }) {
  const countyBody = section.querySelector(".county-body");
  const sumBody = section.querySelector(".statewide-body");
  const resetAll = section.querySelector(".reset-votes");
  const editCount = section.querySelector(".edit-count");
  const editBtn = section.querySelector(".edit-votes");
  let original = new Map(), votes = new Map(), timer = null, editing = false;

  const isEdited = id => SIDES.some(s => votes.get(id)[s] !== original.get(id)[s]);
  const edited = () => [...votes.keys()].filter(isEdited).length;
  const shareOf = v => (v.yes + v.no ? v.yes / (v.yes + v.no) : 0.5);
  const shareText = v => (v.yes + v.no ? pct(v.yes / (v.yes + v.no)) : "–");
  const counts = tr => tr.querySelectorAll("input.count");

  // Split bar (a slider in county rows, a plain bar in the statewide row) plus the share as text
  function ratioCell(td, v, slider) {
    td.className = "share";
    const wrap = document.createElement("div");
    wrap.className = "ratio-wrap";
    const bar = slider ?? Object.assign(document.createElement("span"), { className: "ratio-bar" });
    bar.style.setProperty("--p", `${shareOf(v) * 100}%`);
    const text = Object.assign(document.createElement("span"), { className: "share-text", textContent: shareText(v) });
    wrap.append(bar, text);
    td.append(wrap);
  }

  function commit({ now = false } = {}) {
    clearTimeout(timer);
    if (now) onEdit();
    else timer = setTimeout(onEdit, EDIT_DELAY_MS);
  }

  function syncRow(tr) {
    const id = tr.dataset.id, v = votes.get(id), o = original.get(id);
    for (const input of counts(tr)) {
      input.classList.toggle("edited", v[input.dataset.side] !== o[input.dataset.side]);
    }
    const slider = tr.querySelector("input.ratio");
    if (document.activeElement !== slider) slider.value = Math.round(shareOf(v) * RATIO_STEPS);
    slider.style.setProperty("--p", `${shareOf(v) * 100}%`);
    slider.setAttribute("aria-valuetext", v.yes + v.no ? `${shareText(v)} Yes` : "no votes");
    slider.disabled = !editing || v.yes + v.no === 0; // a county with no votes has no split to move
    slider.tabIndex = editing ? 0 : -1;
    tr.querySelector(".share-text").textContent = shareText(v);
    tr.querySelector(".row-reset").hidden = !editing || !isEdited(id);
  }

  function syncTotals() {
    const t = { yes: 0, no: 0 };
    for (const v of votes.values()) { t.yes += v.yes; t.no += v.no; }
    sumBody.innerHTML = "";
    const tr = sumBody.insertRow();
    tr.insertCell().textContent = "Statewide";
    for (const side of SIDES) {
      const td = tr.insertCell();
      td.className = "num";
      td.textContent = fmt(t[side]);
    }
    ratioCell(tr.insertCell(), t);
    const n = edited();
    editCount.textContent = n ? `${n} ${n === 1 ? "county" : "counties"} edited`
      : editing ? "Change any count" : "Showing reported results";
    resetAll.disabled = n === 0;
    resetAll.hidden = !editing && n === 0; // stays available while edits are in effect
  }

  // Read-only inputs are skipped by Tab, so the table reads like plain text until editing is on
  const setInputMode = input => { input.readOnly = !editing; input.tabIndex = editing ? 0 : -1; };

  function setEditing(on) {
    editing = on;
    editBtn.setAttribute("aria-pressed", String(on));
    editBtn.textContent = on ? "Done editing" : "Edit votes";
    if (!on && countyBody.contains(document.activeElement)) document.activeElement.blur();
    for (const tr of countyBody.rows) {
      counts(tr).forEach(setInputMode);
      syncRow(tr);
    }
    syncTotals();
  }

  function setData(orig, current) {
    original = orig;
    votes = current;
    clearTimeout(timer);
    countyBody.innerHTML = "";
    const ids = [...votes.keys()].sort((a, b) => COUNTY_BY_ID.get(a).name.localeCompare(COUNTY_BY_ID.get(b).name));
    for (const id of ids) {
      const name = COUNTY_BY_ID.get(id).name;
      const tr = countyBody.insertRow();
      tr.dataset.id = id;
      const nameCell = tr.insertCell();
      nameCell.className = "name";
      nameCell.append(name, " ");
      const reset = Object.assign(document.createElement("button"), {
        type: "button", className: "row-reset", textContent: "↺", title: `Reset ${name} to the reported numbers`
      });
      reset.setAttribute("aria-label", `Reset ${name}`);
      nameCell.append(reset);
      for (const side of SIDES) {
        const input = Object.assign(document.createElement("input"), {
          type: "text", inputMode: "numeric", autocomplete: "off", value: fmt(votes.get(id)[side])
        });
        input.className = "count";
        input.dataset.side = side;
        setInputMode(input);
        input.setAttribute("aria-label", `${name} ${side === "yes" ? "Yes" : "No"} votes`);
        const td = tr.insertCell();
        td.className = "num";
        td.append(input);
      }
      const slider = Object.assign(document.createElement("input"), {
        type: "range", className: "ratio", min: 0, max: RATIO_STEPS, step: 1
      });
      slider.setAttribute("aria-label", `${name} Yes share of the county's votes`);
      ratioCell(tr.insertCell(), votes.get(id), slider);
      syncRow(tr);
    }
    syncTotals();
  }

  countyBody.addEventListener("input", e => {
    const input = e.target.closest("input");
    if (!input || input.readOnly || input.disabled) return;
    const tr = input.closest("tr"), v = votes.get(tr.dataset.id);
    if (input.classList.contains("ratio")) {
      // Move the split, keeping the county's total
      const total = v.yes + v.no;
      v.yes = Math.round((total * Number(input.value)) / RATIO_STEPS);
      v.no = total - v.yes;
      for (const c of counts(tr)) c.value = fmt(v[c.dataset.side]);
    } else {
      v[input.dataset.side] = parse(input.value);
    }
    syncRow(tr);
    syncTotals();
    commit();
  });
  // Tidy the number when leaving the field (and apply at once, without waiting for the delay)
  countyBody.addEventListener("change", e => {
    const input = e.target.closest("input");
    if (!input || input.readOnly || input.disabled) return;
    if (input.classList.contains("count")) input.value = fmt(votes.get(input.closest("tr").dataset.id)[input.dataset.side]);
    else syncRow(input.closest("tr")); // let go of the slider: snap it to the exact split
    commit({ now: true });
  });
  countyBody.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.matches("input.count")) e.target.blur();
  });
  countyBody.addEventListener("click", e => {
    const btn = e.target.closest(".row-reset");
    if (!btn) return;
    const tr = btn.closest("tr"), id = tr.dataset.id;
    Object.assign(votes.get(id), original.get(id));
    for (const input of counts(tr)) input.value = fmt(votes.get(id)[input.dataset.side]);
    syncRow(tr);
    syncTotals();
    tr.querySelector("input.count").focus();
    commit({ now: true });
  });
  editBtn.addEventListener("click", () => {
    setEditing(!editing);
    if (editing) countyBody.querySelector("input.count")?.focus({ preventScroll: true });
  });
  resetAll.addEventListener("click", () => {
    for (const [id, o] of original) Object.assign(votes.get(id), o);
    for (const tr of countyBody.rows) {
      for (const input of counts(tr)) input.value = fmt(votes.get(tr.dataset.id)[input.dataset.side]);
      syncRow(tr);
    }
    syncTotals();
    commit({ now: true });
  });

  // Hovering a row or editing in it lights the county up on the scale
  countyBody.addEventListener("pointerover", e => onHover(e.target.closest("tr")?.dataset.id ?? null));
  countyBody.addEventListener("pointerleave", () => onHover(section.contains(document.activeElement) ? document.activeElement.closest("tr")?.dataset.id ?? null : null));
  countyBody.addEventListener("focusin", e => onHover(e.target.closest("tr")?.dataset.id ?? null));
  countyBody.addEventListener("focusout", () => onHover(null));

  return { setData, edited };
}
