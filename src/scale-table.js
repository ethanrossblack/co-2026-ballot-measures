import { fmt, pct } from "./format.js";
import { COUNTY_BY_ID } from "./counties.js";

// ---------- Scale page: editable votes table ----------
// One row per county: Yes, No and Total counts, and the Yes share as a slider plus a percentage
// field. All are read-only until the Edit votes button turns editing on (the choice is kept
// across measures). The fields are linked:
//   Yes / No   change that count; the total and share follow
//   Total      changes the county's size, keeping its Yes share
//   Yes share  (slider or %) moves votes between Yes and No, keeping the total
// Edits change the shared `votes` map in place and call onEdit (debounced while typing); the
// reported numbers stay in `original` so each row, and the whole table, can be reset.

const SIDES = ["yes", "no"];
const EDIT_DELAY_MS = 300;
const RATIO_STEPS = 1000; // slider resolution: 0.1 point of share
const FIELDS = [["yes", "Yes votes"], ["no", "No votes"], ["total", "total votes"]];

const parseCount = s => {
  const digits = String(s).replace(/[^\d]/g, "");
  return digits ? Math.min(Number(digits), 1e9) : 0;
};
// "52.4", "52.4%" -> 0.524; null when there is no number yet
const parseShare = s => {
  const n = parseFloat(String(s).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) / 100 : null;
};

export function createVoteTable(section, { onEdit, onHover }) {
  const countyBody = section.querySelector(".county-body");
  const sumBody = section.querySelector(".statewide-body");
  const resetAll = section.querySelector(".reset-votes");
  const editCount = section.querySelector(".edit-count");
  const editBtn = section.querySelector(".edit-votes");
  let original = new Map(), votes = new Map(), timer = null, editing = false;
  // Each county's intended Yes share. Editing the total keeps this, so typing a total digit by
  // digit doesn't drift the split through rounding (a total of "1" can only be 100% or 0%).
  const intent = new Map();

  const total = v => v.yes + v.no;
  const shareOf = v => (total(v) ? v.yes / total(v) : 0.5);
  const shareText = v => (total(v) ? pct(shareOf(v)) : "–");
  const isEdited = id => SIDES.some(s => votes.get(id)[s] !== original.get(id)[s]);
  const edited = () => [...votes.keys()].filter(isEdited).length;
  const fieldsOf = tr => tr.querySelectorAll("input.field");
  const fieldText = (v, f) => (f === "share" ? shareText(v) : fmt(f === "total" ? total(v) : v[f]));
  const differs = (v, o, f) => (f === "share" ? shareText(v) !== shareText(o) : f === "total" ? total(v) !== total(o) : v[f] !== o[f]);

  function commit({ now = false } = {}) {
    clearTimeout(timer);
    if (now) onEdit();
    else timer = setTimeout(onEdit, EDIT_DELAY_MS);
  }

  // Bring a row's fields, slider and markers in line with its votes. The field being typed in
  // keeps what the user typed, unless it is passed as `tidy` (when the user leaves it).
  function syncRow(tr, tidy = null) {
    const id = tr.dataset.id, v = votes.get(id), o = original.get(id);
    for (const input of fieldsOf(tr)) {
      const f = input.dataset.field;
      if (document.activeElement !== input || input === tidy) input.value = fieldText(v, f);
      input.classList.toggle("edited", differs(v, o, f));
    }
    const slider = tr.querySelector("input.ratio");
    if (document.activeElement !== slider || slider === tidy) slider.value = Math.round(shareOf(v) * RATIO_STEPS);
    slider.style.setProperty("--p", `${shareOf(v) * 100}%`);
    slider.setAttribute("aria-valuetext", total(v) ? `${shareText(v)} Yes` : "no votes");
    slider.disabled = !editing || total(v) === 0; // a county with no votes has no split to move
    slider.tabIndex = editing ? 0 : -1;
    tr.querySelector(".row-reset").hidden = !editing || !isEdited(id);
  }

  function syncTotals() {
    const t = { yes: 0, no: 0 };
    for (const v of votes.values()) { t.yes += v.yes; t.no += v.no; }
    sumBody.innerHTML = "";
    const tr = sumBody.insertRow();
    tr.insertCell().textContent = "Statewide";
    for (const value of [t.yes, t.no, total(t)]) {
      const td = tr.insertCell();
      td.className = "num";
      td.textContent = fmt(value);
    }
    const td = tr.insertCell();
    td.className = "share";
    const wrap = Object.assign(document.createElement("div"), { className: "ratio-wrap" });
    const bar = Object.assign(document.createElement("span"), { className: "ratio-bar" });
    bar.style.setProperty("--p", `${shareOf(t) * 100}%`);
    wrap.append(bar, Object.assign(document.createElement("span"), { className: "share-text", textContent: shareText(t) }));
    td.append(wrap);
    const n = edited();
    editCount.textContent = n ? `${n} ${n === 1 ? "county" : "counties"} edited`
      : editing ? "Change any count or share" : "Showing reported results";
    resetAll.disabled = n === 0;
    resetAll.hidden = !editing && n === 0; // stays available while edits are in effect
  }

  // Read-only fields are skipped by Tab, so the table reads like plain text until editing is on
  const setInputMode = input => { input.readOnly = !editing; input.tabIndex = editing ? 0 : -1; };

  function setEditing(on) {
    editing = on;
    editBtn.setAttribute("aria-pressed", String(on));
    editBtn.textContent = on ? "Done editing" : "Edit votes";
    if (!on && countyBody.contains(document.activeElement)) document.activeElement.blur();
    for (const tr of countyBody.rows) {
      fieldsOf(tr).forEach(setInputMode);
      syncRow(tr);
    }
    syncTotals();
  }

  function makeField(name, field, label, inputMode) {
    const input = Object.assign(document.createElement("input"), {
      type: "text", inputMode, autocomplete: "off", className: `field ${field === "share" ? "pct" : "count"}`
    });
    input.dataset.field = field;
    input.setAttribute("aria-label", `${name} ${label}`);
    setInputMode(input);
    return input;
  }

  function setData(orig, current) {
    original = orig;
    votes = current;
    clearTimeout(timer);
    intent.clear();
    for (const [id, v] of votes) intent.set(id, shareOf(v));
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
      for (const [field, label] of FIELDS) {
        const td = tr.insertCell();
        td.className = `num ${field === "total" ? "total-col" : ""}`;
        td.append(makeField(name, field, label, "numeric"));
      }
      const td = tr.insertCell();
      td.className = "share";
      const wrap = Object.assign(document.createElement("div"), { className: "ratio-wrap" });
      const slider = Object.assign(document.createElement("input"), {
        type: "range", className: "ratio", min: 0, max: RATIO_STEPS, step: 1
      });
      slider.setAttribute("aria-label", `${name} Yes share slider`);
      wrap.append(slider, makeField(name, "share", "Yes share, percent", "decimal"));
      td.append(wrap);
      syncRow(tr);
    }
    syncTotals();
  }

  // Apply one field's (or the slider's) new value to the county's votes
  function applyInput(input) {
    const tr = input.closest("tr"), id = tr.dataset.id, v = votes.get(id);
    const field = input.classList.contains("ratio") ? "ratio" : input.dataset.field;
    if (field === "yes" || field === "no") {
      v[field] = parseCount(input.value);
      if (total(v)) intent.set(id, shareOf(v));
    } else if (field === "total") {
      const t = parseCount(input.value);
      v.yes = Math.round(t * intent.get(id));
      v.no = t - v.yes;
    } else {
      const s = field === "ratio" ? Number(input.value) / RATIO_STEPS : parseShare(input.value);
      if (s === null) return false; // nothing to apply yet (empty field)
      intent.set(id, s);
      const t = total(v);
      v.yes = Math.round(t * s);
      v.no = t - v.yes;
    }
    syncRow(tr);
    syncTotals();
    return true;
  }

  countyBody.addEventListener("input", e => {
    const input = e.target.closest("input");
    if (!input || input.readOnly || input.disabled) return;
    if (applyInput(input)) commit();
  });
  // Leaving a field (or letting go of the slider) tidies it and applies at once
  countyBody.addEventListener("change", e => {
    const input = e.target.closest("input");
    if (!input || input.readOnly || input.disabled) return;
    syncRow(input.closest("tr"), input);
    commit({ now: true });
  });
  countyBody.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.matches("input.field")) e.target.blur();
  });
  countyBody.addEventListener("click", e => {
    const btn = e.target.closest(".row-reset");
    if (!btn) return;
    const tr = btn.closest("tr"), id = tr.dataset.id;
    Object.assign(votes.get(id), original.get(id));
    intent.set(id, shareOf(votes.get(id)));
    syncRow(tr);
    syncTotals();
    tr.querySelector("input.field").focus();
    commit({ now: true });
  });
  editBtn.addEventListener("click", () => {
    setEditing(!editing);
    if (editing) countyBody.querySelector("input.field")?.focus({ preventScroll: true });
  });
  resetAll.addEventListener("click", () => {
    for (const [id, o] of original) {
      Object.assign(votes.get(id), o);
      intent.set(id, shareOf(o));
    }
    for (const tr of countyBody.rows) syncRow(tr);
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
