import { CONFIG } from "./config.js";
import { fmt, pct } from "./format.js";
import { COUNTIES, MAP_BOUNDS } from "./counties.js";
import { layoutHulls } from "./layout.js";
import { alignTo, easeInOut, resample } from "./shapes.js";

// ---------- Margin map ----------
// One map of Colorado, sized by vote margin (|Yes - No|) and coloured for the winner. It moves
// through four stages, with one eased progress value P running 0..3:
//   0  the real state map              1  counties resized to their margins, spaced apart
//   2  counties grouped by winner (same sizes), split at the statewide vote ratio
//   3  every county folded into a slice of one Yes/No pie chart
// Between stages 1 and 2 a divider line grows down the stage and the two halves are tinted.
// No physics.

const SIDE_NAME = { yes: "Yes", no: "No" };
const RING_PTS = 96;      // points each outline is resampled to for the pie morph
const clamp01 = x => Math.max(0, Math.min(1, x));

export function createMarginMap(sectionEl) {
  const stage = sectionEl.querySelector(".stage");
  const canvas = stage.querySelector("canvas");
  const toggleBtn = sectionEl.querySelector(".mm-toggle");
  const prevBtn = sectionEl.querySelector(".mm-prev");
  const nextBtn = sectionEl.querySelector(".mm-next");
  const totalEl = sectionEl.querySelector(".mm-total");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1, mapM = 1;
  let res = null, items = [], overlaps = 0;
  let split = { x: 0, share: 0.5, pie: null }; // divider x, statewide Yes share of the vote, pie geometry
  let anim = { from: 0, to: 0, t0: 0, dur: 1 }; // stage progress P: from -> to (starts on the real map)
  let pointer = null; // pointer position in stage pixels, or null when outside

  canvas.addEventListener("pointermove", e => {
    const r = canvas.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
  });
  canvas.addEventListener("pointerleave", () => (pointer = null));

  const mapPoint = ([x, y]) => ({ x: W / 2 + (x - MAP_BOUNDS.cx) * mapM, y: H / 2 + (y - MAP_BOUNDS.cy) * mapM });
  const progress = now => anim.from + (anim.to - anim.from) * easeInOut(clamp01((now - anim.t0) / anim.dur));
  const settled = now => now >= anim.t0 + anim.dur;

  // Size every county to its margin at `k` px² per vote and find non-touching positions
  function layout(rows, k) {
    const sized = rows.map(({ c, diff }) => {
      const s = Math.sqrt((Math.abs(diff) * k) / c.projArea);
      const rings = c.rings.map(poly => poly[0].map(([x, y]) => [(x - c.home[0]) * s, (y - c.home[1]) * s]));
      return { c, diff, s, rings, hull: d3.polygonHull(rings.flat()) };
    });
    const laid = layoutHulls(sized.map(d => ({ id: d.c.id, hull: d.hull, home: mapPoint(d.c.home) })), W, H);
    return { sized, pos: laid.pos, overlaps: laid.overlaps };
  }

  // Stage 2: yes-won counties packed into the left region, no-won into the right, same sizes.
  // Each county's home is its margin-view position squeezed into its region.
  function sideLayout(sized, pos, xDiv) {
    const out = new Map();
    let bad = 0;
    for (const [side, x0, w] of [[1, 0, xDiv], [-1, xDiv, W - xDiv]]) {
      const group = sized.filter(d => Math.sign(d.diff) === side);
      if (!group.length) continue;
      const laid = layoutHulls(group.map(d => ({ id: d.c.id, hull: d.hull, home: { x: (pos.get(d.c.id).x / W) * w, y: pos.get(d.c.id).y } })), w, H);
      bad += laid.overlaps;
      for (const [id, p] of laid.pos) out.set(id, { x: x0 + p.x, y: p.y });
    }
    return { pos: out, overlaps: bad };
  }

  function sector(cx, cy, R, a0, a1) {
    const steps = Math.max(2, Math.ceil((a1 - a0) / 0.05));
    const pts = [[cx, cy]];
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
    }
    return pts;
  }

  function rebuild() {
    items = [];
    if (!res || !W || !H) return;
    const rows = COUNTIES.map(c => {
      const r = res.byId.get(c.id);
      return r && r.yes !== r.no ? { c, r, diff: r.yes - r.no } : null;
    }).filter(Boolean);
    const sum = d3.sum(rows, d => Math.abs(d.diff));
    if (!sum) return;
    const { yes, no } = res.totals, all = yes + no;
    const share = all ? yes / all : 0.5;
    const xDiv = W * share;

    // Start at the usual fill, but keep each side's counties within a sensible share of its region
    const sideSum = s => d3.sum(rows.filter(d => Math.sign(d.diff) === s), d => Math.abs(d.diff));
    let fill = CONFIG.mapFillRatio;
    for (const [s, w] of [[1, xDiv], [-1, W - xDiv]]) {
      if (sideSum(s)) fill = Math.min(fill, (CONFIG.mapFillRatio * w * sum) / (W * sideSum(s)));
    }
    // Hulls need room: if any stage can't separate everyone, shrink the shapes a little and retry
    let out, sides;
    for (let i = 0; i < 12; i++) {
      out = layout(rows, (fill * W * H) / sum);
      sides = sideLayout(out.sized, out.pos, xDiv);
      if (!out.overlaps && !sides.overlaps) break;
      fill *= 0.88;
    }
    overlaps = out.overlaps + sides.overlaps;

    // Pie: each wedge as wide as its vote share, with the No/Yes boundary running straight up from the centre
    const cx = W / 2, cy = H / 2, R = 0.4 * Math.min(W, H);
    const span = { yes: 2 * Math.PI * share, no: 2 * Math.PI * (1 - share) };
    const start = { no: -Math.PI / 2, yes: -Math.PI / 2 + span.no }; // No runs clockwise from straight up, Yes fills the rest, so one edge is a vertical line
    split = { x: xDiv, share, pie: { cx, cy, R, wedge: { yes: [start.yes, start.yes + span.yes], no: [start.no, start.no + span.no] } } };
    const cursor = { ...start };
    const total = { yes: sideSum(1), no: sideSum(-1) };
    const byMargin = out.sized.slice().sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    const slices = new Map();
    for (const d of byMargin) {
      const side = d.diff > 0 ? "yes" : "no";
      const a0 = cursor[side], a1 = a0 + (span[side] * Math.abs(d.diff)) / total[side];
      cursor[side] = a1;
      slices.set(d.c.id, sector(cx, cy, R, a0, a1));
    }

    items = out.sized.map((d, i) => {
      const end = out.pos.get(d.c.id), start0 = mapPoint(d.c.home), end2 = sides.pos.get(d.c.id) ?? end;
      const ringPath = ring => {
        const p = new Path2D();
        p.moveTo(ring[0][0], ring[0][1]);
        for (let j = 1; j < ring.length; j++) p.lineTo(ring[j][0], ring[j][1]);
        p.closePath();
        return p;
      };
      const path = new Path2D();
      for (const ring of d.rings) path.addPath(ringPath(ring));
      const r = rows[i].r;
      const winner = d.diff > 0 ? "yes" : "no";
      // Geometry is kept relative to the county's home point at its margin size
      const xs = d.rings.flat().map(p => p[0]), ys = d.rings.flat().map(p => p[1]);
      const mainIdx = d.rings.reduce((best, ring, j) => Math.abs(d3.polygonArea(ring)) > Math.abs(d3.polygonArea(d.rings[best])) ? j : best, 0);
      const main = d.rings[mainIdx];
      const [lx, ly] = d3.polygonCentroid(main);
      // Pie morph: the main ring (as placed in stage 2) travels to its slice; islands shrink away
      const ringAbs = resample(main, RING_PTS).map(([x, y]) => [x + end2.x, y + end2.y]);
      const slice = alignTo(ringAbs, resample(slices.get(d.c.id), RING_PTS));
      const extras = d.rings.filter((_, j) => j !== mainIdx).map(ring => ({ path: ringPath(ring), c: d3.polygonCentroid(ring) }));
      return {
        id: d.c.id, name: d.c.name, winner, margin: Math.abs(d.diff), points: d.diff / (r.yes + r.no),
        d0: mapM / d.s, path, start: start0, end, end2, rings: d.rings, ringAbs, slice, extras,
        box: { x0: d3.min(xs), x1: d3.max(xs), y0: d3.min(ys), y1: d3.max(ys) }, label: { x: lx, y: ly }, shade: i % 2
      };
    });
  }

  function resize() {
    W = stage.clientWidth; H = stage.clientHeight; dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    mapM = CONFIG.mapMargin * Math.min(W / MAP_BOUNDS.w, H / MAP_BOUNDS.h);
    if (res) restart();
  }

  // New data or a new stage size: rebuild the layout and stay on the current stage. Moving
  // between stages only happens when a button is pressed.
  function restart() {
    rebuild();
    anim = { from: anim.to, to: anim.to, t0: performance.now(), dur: 1 };
    syncButtons();
  }

  function setData(results) {
    res = results;
    const m = res.totals.yes - res.totals.no;
    totalEl.textContent = m === 0 ? "Statewide: tied" : `Statewide: ${SIDE_NAME[m > 0 ? "yes" : "no"]} by ${fmt(Math.abs(m))} votes`;
    restart();
  }

  // Glide the stage progress to `to` (always an adjacent stage), from wherever it is now
  function go(to) {
    const now = performance.now();
    const from = progress(Math.max(now, anim.t0));
    anim = { from, to, t0: now, dur: CONFIG.mapGrowMs * Math.max(0.4, Math.abs(to - from)) };
    syncButtons();
  }

  function syncButtons() {
    const t = anim.to;
    toggleBtn.hidden = t > 1;
    toggleBtn.textContent = t === 1 ? "Show physical map" : "Show margin map";
    toggleBtn.title = t === 1 ? "Animate back to the real shape and position of every county" : "Animate each county to its margin area, spaced so none touch";
    nextBtn.hidden = t === 0 || t === 3;
    nextBtn.textContent = t === 1 ? "Group by winner" : "Combine into pie chart";
    nextBtn.title = t === 1 ? "Move each county to its side, split at the statewide vote ratio" : "Fold the counties on each side into one pie chart";
    prevBtn.hidden = t < 2;
    prevBtn.textContent = t === 2 ? "Back to margin map" : "Split into counties";
  }
  toggleBtn.addEventListener("click", () => go(anim.to === 1 ? 0 : 1));
  nextBtn.addEventListener("click", () => go(Math.min(3, anim.to + 1)));
  prevBtn.addEventListener("click", () => go(Math.max(1, anim.to - 1)));

  // Where a county is at stage progress P <= 2: anchor position, draw scale, and the pixel
  // bounding box and label point derived from them
  function place(it, P) {
    let d = 1, x, y;
    if (P <= 1) {
      d = it.d0 + (1 - it.d0) * P;
      x = it.start.x + (it.end.x - it.start.x) * P; y = it.start.y + (it.end.y - it.start.y) * P;
    } else {
      const m = clamp01((P - 1 - 0.25) / 0.75); // the divider forms first, then counties move
      x = it.end.x + (it.end2.x - it.end.x) * m; y = it.end.y + (it.end2.y - it.end.y) * m;
    }
    const b = it.box;
    return { x, y, d, box: { x0: x + b.x0 * d, x1: x + b.x1 * d, y0: y + b.y0 * d, y1: y + b.y1 * d },
      label: { x: x + it.label.x * d, y: y + it.label.y * d } };
  }

  // The county under the pointer (only once a stage has settled, when what is drawn is stable)
  function hit() {
    const now = performance.now();
    if (!pointer || !settled(now)) return null;
    const P = progress(now);
    if (P > 2) return null; // the pie has no county slices to point at
    for (const it of items) {
      const g = place(it, P);
      if (pointer.x < g.box.x0 || pointer.x > g.box.x1 || pointer.y < g.box.y0 || pointer.y > g.box.y1) continue;
      const local = [(pointer.x - g.x) / g.d, (pointer.y - g.y) / g.d];
      if (it.rings.some(r => d3.polygonContains(r, local))) return it;
    }
    return null;
  }
  const pick = () => hit()?.id ?? null;

  // The wedge ("yes" / "no") under the pointer once the pie has settled
  function pieSide() {
    const now = performance.now();
    if (!pointer || !items.length || !settled(now) || progress(now) < 3) return null;
    const { cx, cy, R, wedge } = split.pie;
    const dx = pointer.x - cx, dy = pointer.y - cy;
    if (Math.hypot(dx, dy) > R) return null;
    for (const side of ["yes", "no"]) {
      const [a0, a1] = wedge[side];
      let a = Math.atan2(dy, dx);
      while (a < a0) a += 2 * Math.PI;
      if (a <= a1) return side;
    }
    return null;
  }

  function wedgePath(side) {
    const { cx, cy, R, wedge } = split.pie;
    const path = new Path2D();
    path.moveTo(cx, cy);
    path.arc(cx, cy, R, wedge[side][0], wedge[side][1]);
    path.closePath();
    return path;
  }

  function tooltip(text, ax, ay, colors) {
    ctx.font = '600 13px "Barlow", system-ui, sans-serif';
    const tw = ctx.measureText(text).width + 16;
    const x = Math.min(Math.max(ax, 4), W - tw - 4), y = Math.min(Math.max(ay, 4), H - 28);
    ctx.fillStyle = colors.ink;
    ctx.beginPath();
    ctx.roundRect(x, y, tw, 24, 5);
    ctx.fill();
    ctx.fillStyle = colors.paper;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 8, y + 12);
  }

  const fillFor = (it, colors, highlightId) =>
    it.id === highlightId ? colors.active : colors[it.shade ? `${it.winner}-2` : it.winner];

  // Backdrop for the grouped stages: tinted halves, a divider growing down, and the vote split
  function drawSplit(colors, P) {
    if (P <= 1 || !items.length) return;
    const fade = Math.min(P - 1, 1, 3 - P); // in during 1 -> 2, out during 2 -> 3
    const lineQ = P >= 2 ? 1 : easeInOut(clamp01((P - 1) / 0.5));
    ctx.save();
    ctx.globalAlpha = 0.16 * fade;
    ctx.fillStyle = colors.yes; ctx.fillRect(0, 0, split.x, H);
    ctx.fillStyle = colors.no; ctx.fillRect(split.x, 0, W - split.x, H);
    ctx.globalAlpha = 0.9 * Math.min(1, fade * 3);
    ctx.strokeStyle = colors.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(split.x, 0);
    ctx.lineTo(split.x, H * lineQ);
    ctx.stroke();
    ctx.restore();
  }

  // Side headings stay once shown, including over the pie; drawn last so counties never cover them
  function drawHeadings(colors, P) {
    if (P <= 1 || !items.length) return;
    ctx.save();
    ctx.globalAlpha = clamp01(P - 1) * (1 - clamp01((P - 2) * 2)); // hand over to the wedge labels
    ctx.font = '600 14px "Barlow", system-ui, sans-serif';
    ctx.textBaseline = "top";
    ctx.lineWidth = 4;
    ctx.strokeStyle = colors.paper;
    for (const [text, x, align] of [
      [`Yes ${pct(split.share)} · ${fmt(res.totals.yes)} votes`, 12, "left"],
      [`No ${pct(1 - split.share)} · ${fmt(res.totals.no)} votes`, W - 12, "right"]
    ]) {
      ctx.textAlign = align;
      ctx.strokeText(text, x, 10);
      ctx.fillStyle = colors.ink;
      ctx.fillText(text, x, 10);
    }
    ctx.restore();
  }

  function draw(colors, highlightId, isSource) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const now = performance.now(), P = progress(now);
    ctx.lineJoin = "round";
    // The whole container is tinted for the statewide winner, except while the two halves are
    // tinted for their own sides (stage 2); the two tints trade places between stages
    if (res && res.totals.yes !== res.totals.no) {
      const groupedTint = P <= 1 ? 0 : Math.min(P - 1, 1, 3 - P);
      ctx.save();
      ctx.globalAlpha = 0.16 * (1 - groupedTint);
      ctx.fillStyle = colors[res.totals.yes > res.totals.no ? "yes" : "no"];
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    drawSplit(colors, P);

    for (const it of items) {
      ctx.save();
      ctx.fillStyle = fillFor(it, colors, highlightId);
      ctx.strokeStyle = colors.line;
      if (P <= 2) {
        const g = place(it, P);
        ctx.translate(g.x, g.y);
        ctx.scale(g.d, g.d);
        ctx.fill(it.path, "evenodd");
        ctx.lineWidth = 1 / g.d; // keep the outline 1 px while resizing
        ctx.stroke(it.path);
      } else if (P < 2.999) {
        // The main outline morphs into its share of its side's wedge (same colour, no outline, so
        // the pieces read as one solid wedge); islands shrink to nothing
        const e = P - 2;
        const col = colors[it.winner];
        ctx.fillStyle = ctx.strokeStyle = col;
        const poly = new Path2D();
        it.ringAbs.forEach(([x0, y0], j) => {
          const [x1, y1] = it.slice[j];
          const x = x0 + (x1 - x0) * e, y = y0 + (y1 - y0) * e;
          j ? poly.lineTo(x, y) : poly.moveTo(x, y);
        });
        poly.closePath();
        ctx.lineWidth = 1;
        ctx.fill(poly);
        ctx.stroke(poly);
        for (const { path, c } of it.extras) {
          ctx.save();
          ctx.translate(it.end2.x + c[0] * (1 - e), it.end2.y + c[1] * (1 - e));
          ctx.scale(1 - e, 1 - e);
          ctx.translate(-c[0], -c[1]);
          ctx.fill(path);
          ctx.restore();
        }
      }
      ctx.restore();
    }

    if (P >= 2.999 && items.length) { // the finished pie: two solid wedges
      const hover = pieSide();
      for (const side of ["yes", "no"]) {
        const w = wedgePath(side);
        ctx.fillStyle = side === hover ? colors.active : colors[side];
        ctx.fill(w);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = colors.line;
        ctx.stroke(w);
      }
    } else if (P > 2 && items.length) { // outline fades in over the morph
      ctx.save();
      ctx.globalAlpha = (P - 2) ** 3;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = colors.line;
      for (const side of ["yes", "no"]) ctx.stroke(wedgePath(side));
      ctx.restore();
    }
    if (P >= 2.999 && items.length) { // the finished pie: two solid wedges
      for (const side of ["yes", "no"]) {
        const w = wedgePath(side);
        ctx.fillStyle = side === pieSide() ? colors.active : colors[side];
        ctx.fill(w);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = colors.line;
        ctx.stroke(w);
      }
    } else if (P > 2 && items.length) { // the wedge outline fades in over the morph
      ctx.save();
      ctx.globalAlpha = (P - 2) ** 3;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = colors.line;
      for (const side of ["yes", "no"]) ctx.stroke(wedgePath(side));
      ctx.restore();
    }
    drawHeadings(colors, P);
    if (P > 2.5 && items.length) { // wedge labels: side, share and votes, centred in each wedge
      const { cx, cy, R, wedge } = split.pie;
      ctx.save();
      ctx.globalAlpha = clamp01((P - 2.5) * 2);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 4;
      ctx.strokeStyle = colors.paper;
      ctx.fillStyle = colors.ink;
      for (const side of ["yes", "no"]) {
        const [a0, a1] = wedge[side];
        if (a1 <= a0) continue;
        const am = (a0 + a1) / 2, r = a1 - a0 < 0.7 ? R * 1.18 : R * 0.58; // narrow wedges label outside
        const x = cx + r * Math.cos(am), y = cy + r * Math.sin(am);
        const share = side === "yes" ? split.share : 1 - split.share;
        [[`${SIDE_NAME[side]} ${pct(share)}`, '600 20px'], [`${fmt(res.totals[side])} votes`, '600 14px']].forEach(([text, font], i) => {
          ctx.font = `${font} "Barlow", system-ui, sans-serif`;
          ctx.strokeText(text, x, y + (i ? 14 : -10));
          ctx.fillText(text, x, y + (i ? 14 : -10));
        });
      }
      ctx.restore();
    }
    if (!settled(now)) return; // labels and tooltips wait until a stage has settled
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (P <= 2) {
      ctx.font = '600 12px "Barlow", system-ui, sans-serif';
      for (const it of items) {
        const g = place(it, P);
        if (Math.min(g.box.x1 - g.box.x0, g.box.y1 - g.box.y0) < CONFIG.minLabelPx) continue;
        ctx.lineWidth = 3;
        ctx.strokeStyle = colors.paper;
        ctx.strokeText(it.name, g.label.x, g.label.y);
        ctx.fillStyle = colors.ink;
        ctx.fillText(it.name, g.label.x, g.label.y);
      }
    }

    if (P > 2) { // the pie answers for whole sides, not counties
      const side = pieSide();
      if (side && pointer) {
        const v = res.totals[side], share = side === "yes" ? split.share : 1 - split.share;
        tooltip(`${SIDE_NAME[side]}: ${fmt(v)} votes (${pct(share)})`, pointer.x + 14, pointer.y - 34 < 4 ? pointer.y + 18 : pointer.y - 34, colors);
      }
      return;
    }
    const active = highlightId ? items.find(it => it.id === highlightId) : null;
    if (!active) return;
    const text = `${active.name} County: ${SIDE_NAME[active.winner]} by ${fmt(active.margin)} votes (${pct(Math.abs(active.points))} margin)`;
    if (isSource && pointer) {
      tooltip(text, pointer.x + 14, pointer.y - 34 < 4 ? pointer.y + 18 : pointer.y - 34, colors);
    } else {
      ctx.font = '600 13px "Barlow", system-ui, sans-serif';
      const tw = ctx.measureText(text).width + 16;
      const b = place(active, P).box;
      const top = b.y0 - 30;
      tooltip(text, (b.x0 + b.x1) / 2 - tw / 2, top < 4 ? b.y1 + 6 : top, colors);
    }
  }

  return { resize, setData, pick, draw, overlaps: () => overlaps, stage: () => anim.to };
}
