import { fmt, pct } from "./format.js";
import { COUNTY_BY_ID } from "./counties.js";

// ---------- Scale page: editable votes table ----------
// One row per county with the Yes and No counts as text inputs. Edits change the shared
// `votes` map in place and call onEdit (debounced while typing); the reported numbers stay
// in `original` so each row, and the whole table, can be reset.

const SIDES = ["yes", "no"];
const EDIT_DELAY_MS = 300;

const parse = s => {
  const digits = String(s).replace(/[^\d]/g, "");
  return digits ? Math.min(Number(digits), 1e9) : 0;
};

export function createVoteTable(section, { onEdit, onHover }) {
  const countyBody = section.querySelector(".county-body");
  const sumBody = section.querySelector(".statewide-body");
  const resetAll = section.querySelector(".reset-votes");
  const editCount = section.querySelector(".edit-count");
  let original = new Map(), votes = new Map(), timer = null;

  const isEdited = id => SIDES.some(s => votes.get(id)[s] !== original.get(id)[s]);
  const edited = () => [...votes.keys()].filter(isEdited).length;
  const shareText = v => (v.yes + v.no ? pct(v.yes / (v.yes + v.no)) : "–");

  function commit({ now = false } = {}) {
    clearTimeout(timer);
    if (now) onEdit();
    else timer = setTimeout(onEdit, EDIT_DELAY_MS);
  }

  function syncRow(tr) {
    const id = tr.dataset.id, v = votes.get(id), o = original.get(id);
    for (const input of tr.querySelectorAll("input")) {
      input.classList.toggle("edited", v[input.dataset.side] !== o[input.dataset.side]);
    }
    tr.querySelector(".share").textContent = shareText(v);
    tr.querySelector(".row-reset").hidden = !isEdited(id);
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
    const share = tr.insertCell();
    share.className = "num share";
    share.textContent = shareText(t);
    const n = edited();
    editCount.textContent = n ? `${n} ${n === 1 ? "county" : "counties"} edited` : "Showing reported results";
    resetAll.disabled = n === 0;
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
        input.dataset.side = side;
        input.setAttribute("aria-label", `${name} ${side === "yes" ? "Yes" : "No"} votes`);
        const td = tr.insertCell();
        td.className = "num";
        td.append(input);
      }
      const share = tr.insertCell();
      share.className = "num share";
      syncRow(tr);
    }
    syncTotals();
  }

  countyBody.addEventListener("input", e => {
    const input = e.target.closest("input");
    if (!input) return;
    const tr = input.closest("tr");
    votes.get(tr.dataset.id)[input.dataset.side] = parse(input.value);
    syncRow(tr);
    syncTotals();
    commit();
  });
  // Tidy the number when leaving the field (and apply at once, without waiting for the delay)
  countyBody.addEventListener("change", e => {
    const input = e.target.closest("input");
    if (!input) return;
    input.value = fmt(votes.get(input.closest("tr").dataset.id)[input.dataset.side]);
    commit({ now: true });
  });
  countyBody.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.matches("input")) e.target.blur();
  });
  countyBody.addEventListener("click", e => {
    const btn = e.target.closest(".row-reset");
    if (!btn) return;
    const tr = btn.closest("tr"), id = tr.dataset.id;
    Object.assign(votes.get(id), original.get(id));
    for (const input of tr.querySelectorAll("input")) input.value = fmt(votes.get(id)[input.dataset.side]);
    syncRow(tr);
    syncTotals();
    tr.querySelector("input").focus();
    commit({ now: true });
  });
  resetAll.addEventListener("click", () => {
    for (const [id, o] of original) Object.assign(votes.get(id), o);
    for (const tr of countyBody.rows) {
      for (const input of tr.querySelectorAll("input")) input.value = fmt(votes.get(tr.dataset.id)[input.dataset.side]);
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
