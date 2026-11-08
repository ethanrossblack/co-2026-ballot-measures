import { CONFIG } from "./config.js";
import { fmt, pct } from "./format.js";
import { COUNTIES, MAP_BOUNDS } from "./counties.js";
import { layoutHulls } from "./layout.js";
import { easeInOut } from "./shapes.js";

// ---------- Margin map ----------
// One map of Colorado. Each county keeps its true outline but is sized by the vote margin
// (|Yes - No|) and coloured for the side that won it. Like the map layout in the containers it
// starts as the real state, then every county resizes and is spaced so none touch. No physics.

const SIDE_NAME = { yes: "Yes", no: "No" };

export function createMarginMap(sectionEl) {
  const stage = sectionEl.querySelector(".stage");
  const canvas = stage.querySelector("canvas");
  const toggleBtn = sectionEl.querySelector(".mm-toggle");
  const totalEl = sectionEl.querySelector(".mm-total");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1, mapM = 1;
  let res = null, items = [], overlaps = 0;
  let anim = { from: 1, to: 1, t0: 0, dur: 1 }; // view progress: 0 = real state map, 1 = margin-proportional
  let pointer = null; // pointer position in stage pixels, or null when outside

  canvas.addEventListener("pointermove", e => {
    const r = canvas.getBoundingClientRect();
    pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
  });
  canvas.addEventListener("pointerleave", () => (pointer = null));

  const mapPoint = ([x, y]) => ({ x: W / 2 + (x - MAP_BOUNDS.cx) * mapM, y: H / 2 + (y - MAP_BOUNDS.cy) * mapM });
  const progress = now => anim.from + (anim.to - anim.from) * easeInOut(Math.max(0, Math.min(1, (now - anim.t0) / anim.dur)));

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

  function rebuild() {
    items = [];
    if (!res || !W || !H) return;
    const rows = COUNTIES.map(c => {
      const r = res.byId.get(c.id);
      return r && r.yes !== r.no ? { c, r, diff: r.yes - r.no } : null;
    }).filter(Boolean);
    const sum = d3.sum(rows, d => Math.abs(d.diff));
    if (!sum) return;
    // Hulls need room: if a layout can't separate everyone, shrink the shapes a little and retry
    let fill = CONFIG.mapFillRatio, out;
    for (let i = 0; i < 8; i++) {
      out = layout(rows, (fill * W * H) / sum);
      if (!out.overlaps) break;
      fill *= 0.88;
    }
    overlaps = out.overlaps;
    items = out.sized.map((d, i) => {
      const end = out.pos.get(d.c.id), start = mapPoint(d.c.home);
      const path = new Path2D();
      for (const ring of d.rings) {
        path.moveTo(ring[0][0], ring[0][1]);
        for (let j = 1; j < ring.length; j++) path.lineTo(ring[j][0], ring[j][1]);
        path.closePath();
      }
      const abs = rows[i].r;
      const winner = d.diff > 0 ? "yes" : "no";
      // Geometry is kept relative to the county's home point at its margin size; `place` scales and moves it
      const xs = d.rings.flat().map(p => p[0]), ys = d.rings.flat().map(p => p[1]);
      const main = d.rings.slice().sort((a, b) => Math.abs(d3.polygonArea(b)) - Math.abs(d3.polygonArea(a)))[0];
      const [cx, cy] = d3.polygonCentroid(main);
      return {
        id: d.c.id, name: d.c.name, winner, margin: Math.abs(d.diff), points: d.diff / (abs.yes + abs.no),
        s: d.s, d0: mapM / d.s, path, start, end, rings: d.rings,
        box: { x0: d3.min(xs), x1: d3.max(xs), y0: d3.min(ys), y1: d3.max(ys) }, label: { x: cx, y: cy }, shade: i % 2
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

  // Show the real state, hold, then resize every county to its margin
  function restart() {
    rebuild();
    anim = { from: 0, to: 1, t0: performance.now() + CONFIG.mapHoldMs, dur: CONFIG.mapGrowMs };
    syncToggle();
  }

  function setData(results) {
    res = results;
    const m = res.totals.yes - res.totals.no;
    totalEl.textContent = m === 0 ? "Statewide: tied" : `Statewide: ${SIDE_NAME[m > 0 ? "yes" : "no"]} by ${fmt(Math.abs(m))} votes`;
    restart();
  }

  function syncToggle() {
    const toMargin = anim.to === 1;
    toggleBtn.textContent = toMargin ? "Show physical map" : "Show margin map";
    toggleBtn.title = toMargin ? "Animate back to the real shape and position of every county" : "Animate each county to its margin area, spaced so none touch";
  }
  toggleBtn.addEventListener("click", () => {
    const now = performance.now();
    anim = { from: progress(Math.max(now, anim.t0)), to: anim.to === 1 ? 0 : 1, t0: now, dur: CONFIG.mapGrowMs };
    syncToggle();
  });

  // Settled in either view (not mid-animation)
  const settled = now => now >= anim.t0 + anim.dur;

  // Where a county is at view progress p: its anchor position, draw scale, and the pixel
  // bounding box and label point derived from them
  function place(it, p) {
    const d = it.d0 + (1 - it.d0) * p;
    const x = it.start.x + (it.end.x - it.start.x) * p, y = it.start.y + (it.end.y - it.start.y) * p;
    const b = it.box;
    return { x, y, d, box: { x0: x + b.x0 * d, x1: x + b.x1 * d, y0: y + b.y0 * d, y1: y + b.y1 * d },
      label: { x: x + it.label.x * d, y: y + it.label.y * d } };
  }

  // The county under the pointer (only once a view has settled, when what is drawn is stable)
  function hit() {
    const now = performance.now();
    if (!pointer || !settled(now)) return null;
    const p = progress(now);
    for (const it of items) {
      const g = place(it, p);
      if (pointer.x < g.box.x0 || pointer.x > g.box.x1 || pointer.y < g.box.y0 || pointer.y > g.box.y1) continue;
      const local = [(pointer.x - g.x) / g.d, (pointer.y - g.y) / g.d];
      if (it.rings.some(r => d3.polygonContains(r, local))) return it;
    }
    return null;
  }
  function pick() {
    return hit()?.id ?? null;
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

  function draw(colors, highlightId, isSource) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const now = performance.now(), p = progress(now);
    ctx.lineJoin = "round";
    for (const it of items) {
      const d = it.d0 + (1 - it.d0) * p;
      ctx.save();
      ctx.translate(it.start.x + (it.end.x - it.start.x) * p, it.start.y + (it.end.y - it.start.y) * p);
      ctx.scale(d, d);
      ctx.fillStyle = it.id === highlightId ? colors.active : colors[it.shade ? `${it.winner}-2` : it.winner];
      ctx.fill(it.path, "evenodd");
      ctx.lineWidth = 1 / d; // keep the outline 1 px while resizing
      ctx.strokeStyle = colors.line;
      ctx.stroke(it.path);
      ctx.restore();
    }

    if (!settled(now)) return; // labels and tooltips wait until a view has settled
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = '600 12px "Barlow", system-ui, sans-serif';
    for (const it of items) {
      const g = place(it, p);
      if (Math.min(g.box.x1 - g.box.x0, g.box.y1 - g.box.y0) < CONFIG.minLabelPx) continue;
      ctx.lineWidth = 3;
      ctx.strokeStyle = colors.paper;
      ctx.strokeText(it.name, g.label.x, g.label.y);
      ctx.fillStyle = colors.ink;
      ctx.fillText(it.name, g.label.x, g.label.y);
    }

    const active = highlightId ? items.find(it => it.id === highlightId) : null;
    if (!active) return;
    const text = `${active.name} County: ${SIDE_NAME[active.winner]} by ${fmt(active.margin)} votes (${pct(Math.abs(active.points))} margin)`;
    if (isSource && pointer) {
      tooltip(text, pointer.x + 14, pointer.y - 34 < 4 ? pointer.y + 18 : pointer.y - 34, colors);
    } else {
      ctx.font = '600 13px "Barlow", system-ui, sans-serif';
      const tw = ctx.measureText(text).width + 16;
      const b = place(active, p).box, top = b.y0 - 30;
      tooltip(text, (b.x0 + b.x1) / 2 - tw / 2, top < 4 ? b.y1 + 6 : top, colors);
    }
  }

  return { resize, setData, pick, draw, overlaps: () => overlaps, view: () => (anim.to === 1 ? "margin" : "physical") };
}
