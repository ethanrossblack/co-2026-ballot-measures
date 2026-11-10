import { CONFIG } from "./config.js";
import { countyLabel, fmt, msg, pct } from "./format.js";
import { measureToResults } from "./results.js";
import { COUNTY_BY_ID } from "./counties.js";
import BALLOT_MEASURES from "../data/ballot-measures.js";

// ---------- Scale page: Yes and No votes weighed on a balance ----------
// Everything is simulated. Matter.js handles the circles: each pan's pile lives in the pan's
// own frame (one Matter world, the two pans far apart) and feels gravity minus the pan's
// acceleration. The balance itself is integrated here: a beam on a pivot with its centre of
// mass below the pivot (which is what makes a real balance tilt in proportion to the weight
// difference), turned by the chain tension of each pan, and two pans that swing on their
// chains as pendulums. A circle starts to weigh on its pan when it lands, with a kick equal
// to its momentum.

// Matter.js is a global from the <script> tag; circles need no poly-decomp, so src/matter.js isn't used
const { Engine, Runner, Bodies, Body, Composite, Events, Sleeping } = Matter;
const S = CONFIG.scale;
const SIDES = ["yes", "no"]; // Yes hangs on the left, No on the right
const PAN_GAP = 5000;        // x offset between the two pans in the physics world
const MAX_W = 1100;          // widest the scale is drawn, CSS px
const DENSITY = 0.001;       // Matter's default; mass = area x density
const DT = 1 / 60;           // physics step, s
// Matter turns body.force into acceleration as force / mass * (1000/60 ms)^2 per step, so an
// acceleration in px/s^2 needs a force of mass * a * 1e-6
const FORCE_PER_ACC = 1e-6;

const frameEl = document.querySelector(".scale-frame");
const stage = frameEl.querySelector(".scale-stage");
const canvas = stage.querySelector("canvas");
const ctx = canvas.getContext("2d");
const engine = Engine.create({ positionIterations: 10, velocityIterations: 8, enableSleeping: true });
engine.gravity.scale = 0; // gravity is applied per pan in stepBalance()
const runner = Runner.create({ isFixed: true, delta: 1000 / 60 });
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let L = null;           // geometry and balance constants for the current width (see geometry())
let dpr = 1;
let results = null, scaleK = 0;
let items = [];         // dropped circles: { body, side, id, name, votes, r, idx, born, landed }
const byBody = new Map(); // Matter body id -> item
let walls = [];
let queue = [];         // counties still to drop, biggest first
let tick = 0;
const beam = { a: 0, v: 0 };                         // angle (rad, + = Yes side down), angular velocity
const swing = SIDES.map(() => ({ phi: 0, w: 0 }));   // each pan's swing angle on its chains, + = toward the right
const loads = SIDES.map(() => 0);                    // mass of the circles that have landed in each pan
const panG = SIDES.map(() => ({ x: 0, y: 0 }));      // apparent gravity in each pan's frame, px/s^2
const colors = {};
let pointer = null;     // pointer position in CSS px while over the canvas

function readColors() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ["ink", "paper", "line", "active", "yes", "yes-2", "no", "no-2", "metal", "metal-2", "chain", "base"]) {
    colors[k] = cs.getPropertyValue(`--${k}`).trim();
  }
}

// Everything is proportional to the drawing width w. Pan-local frame: origin at the
// centre of the pan's rim, y down; the bowl is the lower half of an a x b ellipse.
function geometry(w) {
  const a = 0.135 * w, maxTilt = (S.maxTiltDeg * Math.PI) / 180;
  const R = 0.31 * w, lift = R * Math.sin(maxTilt);
  const g = {
    w, cx: w / 2, R, a, b: 0.8 * a, th: 0.11 * a, maxTilt,
    chainH: 1.75 * a,        // hook to rim
    wallH: 0.6 * a,          // invisible walls above the rim that keep a heap from spilling
    beamW: Math.max(5, 0.015 * w), ringR: Math.max(4, 0.011 * w)
  };
  g.pivotY = lift + 0.06 * w;
  g.baseTop = g.pivotY + lift + g.chainH + g.b + g.th + 0.03 * w; // clear of the lowest pan
  g.baseH = 0.035 * w;
  g.h = Math.ceil(g.baseTop + g.baseH + 4);

  // Balance constants. A full pan holds the heavier side's votes (that is how scaleK is set).
  g.grav = S.gravity * w;                                  // px/s^2
  g.ell = g.chainH + 0.5 * g.b;                            // hook to a pan's centre of mass
  g.full = (S.fill * Math.PI * a * g.b * DENSITY) / 2;     // mass of a full pan's load
  g.panMass = S.panMass * g.full;
  g.inertia = S.beamInertia * g.full * R * R;
  // Beam mass x its centre-of-mass depth below the pivot. At rest tan(tilt) = (mL - mR) R / mh,
  // so this sets the sensitivity: a final gap of fullTiltGap of all votes reaches the stops.
  const d = S.fullTiltGap, dmFull = (g.full * 2 * d) / (1 + d);
  g.mh = (dmFull * R) / Math.tan(maxTilt);
  return g;
}
const ASPECT = geometry(1000).h / 1000;

function resize() {
  const avail = frameEl.parentElement.clientWidth - parseFloat(getComputedStyle(frameEl.parentElement).paddingLeft) * 2;
  // Fit the whole scale in the window where possible, but never narrower than 300 px
  const byHeight = (window.innerHeight - 150) / ASPECT;
  const w = Math.floor(Math.max(Math.min(avail, 300), Math.min(avail, MAX_W, byHeight)));
  if (L && L.w === w) return;
  L = geometry(w);
  frameEl.style.width = `${w}px`;
  stage.style.height = `${L.h}px`;
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(L.h * dpr);
  buildWalls();
  if (results) drop({ instant: true }); // sizes depend on the width; re-settle without the animation
}

// Static bowl (segments along the inner ellipse) plus a short wall above each rim
function buildWalls() {
  Composite.remove(engine.world, walls);
  walls = [];
  const T = 40, n = 28, { a, b, wallH } = L;
  SIDES.forEach((side, i) => {
    const ox = i * PAN_GAP;
    const pt = t => [ox + a * Math.cos(t), b * Math.sin(t)];
    for (let j = 0; j < n; j++) {
      const t0 = (Math.PI * j) / n, t1 = (Math.PI * (j + 1)) / n, tm = (t0 + t1) / 2;
      const [x0, y0] = pt(t0), [x1, y1] = pt(t1);
      let nx = Math.cos(tm) / a, ny = Math.sin(tm) / b; // outward normal of the ellipse
      const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
      walls.push(Bodies.rectangle((x0 + x1) / 2 + (nx * T) / 2, (y0 + y1) / 2 + (ny * T) / 2,
        Math.hypot(x1 - x0, y1 - y0) + 4, T, { isStatic: true, angle: Math.atan2(y1 - y0, x1 - x0), friction: 0.6 }));
    }
    for (const s of [-1, 1]) walls.push(Bodies.rectangle(ox + s * (a + T / 2), -wallH / 2, T, wallH + 4, { isStatic: true }));
  });
  Composite.add(engine.world, walls);
}

const panOf = item => SIDES.indexOf(item.side);
const spawnY = r => -L.wallH - r - 6;

function spawnCounty({ id, v, idx }) {
  const name = COUNTY_BY_ID.get(id).name;
  SIDES.forEach((side, i) => {
    const votes = v[side];
    if (!votes) return;
    const r = Math.sqrt((votes * scaleK) / Math.PI);
    const pr = Math.max(r, S.minBodyR);
    const spread = Math.max(0, L.a * 0.55 - pr);
    const body = Bodies.circle(i * PAN_GAP + (Math.random() * 2 - 1) * spread, spawnY(pr), pr,
      { friction: 0.4, frictionStatic: 0.8, frictionAir: 0.015, restitution: 0.05, slop: 0.05 });
    Body.setMass(body, Math.PI * r * r * DENSITY); // weight follows the votes, even for the size floor
    Composite.add(engine.world, body);
    const it = { body, side, id, name, votes, r, idx, born: performance.now(), landed: false };
    items.push(it);
    byBody.set(body.id, it);
  });
}

// Hook point of each pan, relative to the pivot, and its derivative with respect to the angle
const arm = (i, a) => (i === 0 ? { x: -L.R * Math.cos(a), y: L.R * Math.sin(a) } : { x: L.R * Math.cos(a), y: -L.R * Math.sin(a) });
const panTotal = i => L.panMass + loads[i];
// Torque that turns the beam toward + (Yes side down) from a force F at the hook of pan i
// (canvas y points down, so a positive cross product is clockwise, which is the - direction)
const torqueAt = (i, F) => { const r = arm(i, beam.a); return -(r.x * F.y - r.y * F.x); };

// One step of the balance: beam, then each pan's swing, then the apparent gravity in each pan
function stepBalance(dt) {
  const g = L.grav;
  let torque = -L.mh * g * Math.sin(beam.a), inertia = L.inertia;
  SIDES.forEach((side, i) => {
    const p = swing[i], M = panTotal(i);
    // Chain tension pulls the hook toward the pan; the pan's mass also rides on the beam's ends
    const T = M * (g * Math.cos(p.phi) + L.ell * p.w * p.w);
    torque += torqueAt(i, { x: T * Math.sin(p.phi), y: T * Math.cos(p.phi) });
    inertia += M * L.R * L.R;
  });
  torque -= 2 * S.beamDamping * Math.sqrt(L.mh * g * inertia) * beam.v;
  let acc = torque / inertia;
  beam.v += acc * dt;
  beam.a += beam.v * dt;
  if (Math.abs(beam.a) >= L.maxTilt) {
    // Against a stop: it can only move back off it
    beam.a = Math.sign(beam.a) * L.maxTilt;
    if (Math.sign(beam.v) === Math.sign(beam.a)) beam.v *= -S.stopBounce;
    acc = 0;
  }
  const c = Math.cos(beam.a), s = Math.sin(beam.a), v2 = beam.v * beam.v;
  SIDES.forEach((side, i) => {
    // Hook acceleration: r'' for r = (-R cos a, R sin a) on the left, the negative on the right
    const sg = i === 0 ? 1 : -1;
    const aH = { x: sg * L.R * (s * acc + c * v2), y: sg * L.R * (c * acc - s * v2) };
    const p = swing[i], sp = Math.sin(p.phi), cp = Math.cos(p.phi);
    // Pendulum with a moving pivot
    const w0 = Math.sqrt(g / L.ell);
    const alpha = (-g * sp - aH.x * cp + aH.y * sp) / L.ell - 2 * S.swingDamping * w0 * p.w;
    p.w += alpha * dt;
    p.phi += p.w * dt;
    // Apparent gravity at the rim centre, in the pan's frame (x along the rim, y down the chain)
    const aO = {
      x: aH.x + L.chainH * (alpha * cp - p.w * p.w * sp),
      y: aH.y + L.chainH * (-alpha * sp - p.w * p.w * cp)
    };
    const gx = -aO.x, gy = g - aO.y;
    panG[i] = { x: gx * cp - gy * sp, y: gx * sp + gy * cp };
  });
}

// At rest, pans hanging straight: tan(tilt) = (mL - mR) R / mh, up to the stops
function settleBalance() {
  const t = Math.atan(((loads[0] - loads[1]) * L.R) / L.mh);
  beam.a = Math.max(-L.maxTilt, Math.min(L.maxTilt, t));
  beam.v = 0;
  for (const p of swing) { p.phi = 0; p.w = 0; }
  for (let i = 0; i < 2; i++) panG[i] = { x: 0, y: L.grav };
}

Events.on(engine, "beforeUpdate", () => {
  if (!L) return;
  if (queue.length && ++tick % S.dropEvery === 0) spawnCounty(queue.shift());
  stepBalance(DT);
  // While the balance moves, the piles feel it: wake them and push them with the pan's gravity
  const moving = Math.abs(beam.v) > 0.03 || swing.some(p => Math.abs(p.w) > 0.03);
  for (const it of items) {
    const gp = panG[panOf(it)], b = it.body;
    if (moving && b.isSleeping) Sleeping.set(b, false);
    b.force.x += b.mass * gp.x * FORCE_PER_ACC;
    b.force.y += b.mass * gp.y * FORCE_PER_ACC;
  }
});

// A circle weighs on its pan from the moment it lands (touches the bowl or a landed circle).
// Its momentum at that moment is the kick the pan receives: along the chain it turns the beam,
// across it it swings the pan.
function land(b, other) {
  const it = byBody.get(b.id);
  if (!it || it.landed) return;
  if (!other.isStatic && !byBody.get(other.id)?.landed) return;
  it.landed = true;
  const i = panOf(it);
  loads[i] += b.mass;
  const fps = 1000 / runner.delta; // Matter velocities are px per step
  const J = { x: b.mass * b.velocity.x * fps, y: b.mass * b.velocity.y * fps }; // in the pan's frame
  const p = swing[i], sp = Math.sin(p.phi), cp = Math.cos(p.phi);
  p.w += J.x / (panTotal(i) * L.ell);
  let inertia = L.inertia;
  for (let k = 0; k < 2; k++) inertia += panTotal(k) * L.R * L.R;
  beam.v += torqueAt(i, { x: J.y * sp, y: J.y * cp }) / inertia;
}
Events.on(engine, "collisionStart", e => {
  for (const { bodyA, bodyB } of e.pairs) { land(bodyA, bodyB); land(bodyB, bodyA); }
});

Events.on(engine, "afterUpdate", () => {
  for (const it of items) {
    const p = it.body.position, ox = panOf(it) * PAN_GAP;
    if (p.y > L.b + 400 || Math.abs(p.x - ox) > L.a + 400) {
      // Escaped: back to the top of its pan, no longer weighing on it
      if (it.landed) { loads[panOf(it)] -= it.body.mass; it.landed = false; }
      Body.setPosition(it.body, { x: ox, y: spawnY(it.body.circleRadius) });
      Body.setVelocity(it.body, { x: 0, y: 0 });
    }
  }
});

function drop({ instant = reduceMotion.matches } = {}) {
  for (const it of items) Composite.remove(engine.world, it.body);
  items = [];
  byBody.clear();
  loads.fill(0); // the empty pans weigh the same, so the beam swings back to level
  tick = 0;
  if (!results || !L) { queue = []; return; }
  // One scale for both pans: the heavier side fills `fill` of a bowl's cross-section
  const max = Math.max(results.totals.yes, results.totals.no);
  scaleK = max ? (S.fill * (Math.PI * L.a * L.b) / 2) / max : 0;
  // Biggest counties first: they settle at the bottom and the small ones fill the gaps
  queue = [...results.byId]
    .map(([id, v]) => ({ id, v }))
    .sort((x, y) => y.v.yes + y.v.no - (x.v.yes + x.v.no) || x.id.localeCompare(y.id))
    .map((c, idx) => ({ ...c, idx }));
  if (instant) {
    settleBalance();
    while (queue.length) Engine.update(engine, runner.delta);
    for (let s = 0; s < 600; s++) Engine.update(engine, runner.delta);
    for (const it of items) it.born = -Infinity;
    settleBalance(); // skip the remaining sway
  }
}

// Pan i's frame: x along the rim, y down the chain, origin at the rim centre
function hooks() {
  return SIDES.map((side, i) => { const r = arm(i, beam.a); return { x: L.cx + r.x, y: L.pivotY + r.y }; });
}
function toCanvas(it, H) {
  const i = panOf(it), { phi } = swing[i], c = Math.cos(phi), s = Math.sin(phi);
  const lx = it.body.position.x - i * PAN_GAP, ly = it.body.position.y + L.chainH;
  return { x: H[i].x + lx * c + ly * s, y: H[i].y - lx * s + ly * c };
}
const drawnR = (it, now) => it.r * Math.min(1, (now - it.born) / 160);

// Circle under the pointer (the closest one it is inside; tiny ones get a 4 px target)
function pick(H) {
  if (!pointer) return null;
  let best = null, bestD = Infinity;
  for (const it of items) {
    const c = toCanvas(it, H), d = Math.hypot(pointer.x - c.x, pointer.y - c.y);
    if (d <= Math.max(it.r, 4) && d < bestD) { best = it; bestD = d; }
  }
  return best;
}

function drawStand() {
  const { cx, pivotY, baseTop, baseH, w, beamW } = L;
  ctx.fillStyle = colors["metal-2"];
  ctx.fillRect(cx - beamW * 0.8, pivotY, beamW * 1.6, baseTop - pivotY + 1);
  ctx.fillStyle = colors.base;
  ctx.beginPath();
  ctx.roundRect(cx - 0.055 * w, baseTop, 0.11 * w, baseH * 0.6, [baseH * 0.25, baseH * 0.25, 0, 0]);
  ctx.roundRect(cx - 0.11 * w, baseTop + baseH * 0.45, 0.22 * w, baseH * 0.55, [baseH * 0.5, baseH * 0.5, 2, 2]);
  ctx.fill();
}

function drawBeam(H) {
  const { cx, pivotY, R, w, beamW, ringR } = L;
  ctx.save();
  ctx.translate(cx, pivotY);
  ctx.rotate(-beam.a);
  ctx.strokeStyle = colors["metal-2"];
  ctx.lineWidth = beamW;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-R, 0);
  ctx.quadraticCurveTo(-R * 0.45, -0.045 * w, 0, -0.03 * w);
  ctx.quadraticCurveTo(R * 0.45, -0.045 * w, R, 0);
  ctx.stroke();
  ctx.restore();
  // Pivot housing and pin
  const hr = 0.042 * w;
  ctx.fillStyle = colors.metal;
  ctx.beginPath();
  ctx.moveTo(cx - hr, pivotY - hr * 0.75);
  ctx.lineTo(cx + hr, pivotY - hr * 0.75);
  ctx.ellipse(cx, pivotY - hr * 0.75, hr, hr * 1.25, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = colors["metal-2"];
  ctx.beginPath();
  ctx.arc(cx, pivotY - hr * 0.1, Math.max(2.5, hr * 0.17), 0, 2 * Math.PI);
  ctx.fill();
  // Hooks
  ctx.strokeStyle = colors.base;
  ctx.lineWidth = Math.max(2, ringR * 0.5);
  for (const h of H) {
    ctx.beginPath();
    ctx.arc(h.x, h.y, ringR, 0, 2 * Math.PI);
    ctx.stroke();
  }
}

// Chains, and the bowl in cross-section (a crescent) with a short lip at each rim, drawn in
// the pan's frame (the caller has translated to the rim centre and rotated by the swing)
function drawPan() {
  const { a, b, th, chainH, ringR } = L;
  ctx.strokeStyle = colors.chain;
  ctx.lineWidth = Math.max(1.5, ringR * 0.45);
  ctx.setLineDash([Math.max(3, ringR * 0.7), Math.max(2, ringR * 0.35)]);
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const s of [-1, 1]) {
    ctx.moveTo(s * ringR * 0.4, -chainH + ringR * 0.9);
    ctx.lineTo(s * (a + th * 0.6), -th * 0.4);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = colors.metal;
  ctx.beginPath();
  ctx.ellipse(0, 0, a + th, b + th, 0, 0, Math.PI);
  ctx.ellipse(0, 0, a, b, 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = colors["metal-2"];
  ctx.beginPath();
  ctx.roundRect(-a - th * 2, -th * 0.5, th * 2.2, th, th * 0.4);
  ctx.roundRect(a - th * 0.2, -th * 0.5, th * 2.2, th, th * 0.4);
  ctx.fill();
}

function tooltip(text, x0, y0) {
  ctx.font = '600 13px "Barlow", system-ui, sans-serif';
  const tw = ctx.measureText(text).width + 16;
  const x = Math.min(Math.max(x0, 4), L.w - tw - 4);
  const y = Math.min(Math.max(y0, 4), L.h - 28);
  ctx.fillStyle = colors.ink;
  ctx.beginPath();
  ctx.roundRect(x, y, tw, 24, 5);
  ctx.fill();
  ctx.fillStyle = colors.paper;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 8, y + 12);
}

function draw(now) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, L.w, L.h);
  const H = hooks();
  drawStand();
  drawBeam(H);

  const hovered = pick(H);
  canvas.style.cursor = hovered ? "pointer" : "default";
  const hid = hovered?.id;
  SIDES.forEach((side, i) => {
    ctx.save();
    ctx.translate(H[i].x, H[i].y);
    ctx.rotate(-swing[i].phi);
    ctx.translate(0, L.chainH);
    drawPan();
    ctx.translate(-i * PAN_GAP, 0); // physics x of this pan's bodies
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.line;
    const mine = items.filter(it => it.side === side);
    for (const it of mine) {
      const r = drawnR(it, now);
      if (r <= 0) continue;
      ctx.fillStyle = it.id === hid ? colors.active : colors[it.idx % 2 ? `${side}-2` : side];
      ctx.beginPath();
      ctx.arc(it.body.position.x, it.body.position.y, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }
    // County names on circles wide enough to hold them
    ctx.font = '600 11px "Barlow", system-ui, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    for (const it of mine) {
      if (drawnR(it, now) < it.r || ctx.measureText(it.name).width + 4 > 2 * it.r) continue;
      const { x, y } = it.body.position;
      ctx.strokeStyle = colors.paper;
      ctx.strokeText(it.name, x, y);
      ctx.fillStyle = colors.ink;
      ctx.fillText(it.name, x, y);
    }
    ctx.restore();
  });

  if (hovered) {
    const r = results.byId.get(hovered.id);
    for (const it of items.filter(x => x.id === hid)) {
      const share = r.yes + r.no ? it.votes / (r.yes + r.no) : 0;
      const text = countyLabel(it.name, it.side, it.votes, share);
      if (it === hovered) {
        const above = pointer.y - 34;
        tooltip(text, pointer.x + 14, above < 4 ? pointer.y + 18 : above);
      } else {
        // The same county in the other pan, labelled above its circle
        ctx.font = '600 13px "Barlow", system-ui, sans-serif';
        const c = toCanvas(it, H), tw = ctx.measureText(text).width + 16;
        tooltip(text, c.x - tw / 2, c.y - it.r - 30);
      }
    }
  }
}

function frame(now) {
  draw(now);
  requestAnimationFrame(frame);
}

// ---------- Page ----------

const needText = p => (p > 0.5 ? `at least ${d3.format(".0%")(p)}` : "a majority");

function showMeasureInfo(m, res) {
  const set = (id, text) => (document.getElementById(id).textContent = text ?? "");
  set("title", m.name ?? m.title);
  set("measure-name", m.shortTitle);
  const all = res.totals.yes + res.totals.no;
  const share = all ? res.totals.yes / all : 0;
  const chip = document.getElementById("pass-chip");
  chip.hidden = !(m.passShare && all);
  if (!chip.hidden) {
    const passing = m.passShare > 0.5 ? share >= m.passShare : share > 0.5;
    chip.textContent = passing ? "Passing" : "Failing";
    chip.className = `pass-chip ${passing ? "yes" : "no"}`;
    set("pass-text", `Yes has ${pct(share)} of the vote and needs ${needText(m.passShare)}.`);
  } else set("pass-text", "");
  for (const side of SIDES) set(`total-${side}`, `${fmt(res.totals[side])} votes, ${pct(all ? res.totals[side] / all : 0)}`);
  const gap = res.totals.yes - res.totals.no;
  const verdict = gap === 0 ? "The two sides weigh exactly the same."
    : `${gap > 0 ? "Yes" : "No"} outweighs ${gap > 0 ? "No" : "Yes"} by ${fmt(Math.abs(gap))} votes.`;
  set("scale-verdict", verdict);
  canvas.setAttribute("aria-label", `Balance scale: Yes ${fmt(res.totals.yes)} votes, No ${fmt(res.totals.no)} votes. ${verdict}`);
}

const measureSelect = document.getElementById("measure");
const data = BALLOT_MEASURES;

function showMeasure(key, { updateUrl = true } = {}) {
  const m = data.measures.find(x => x.key === key) ?? data.measures[0];
  measureSelect.value = m.key;
  document.getElementById("snapshot-note").textContent =
    `${data.election}. ${m.precinctsReportingPercent}% of precincts reporting as of ${data.snapshot}.`;
  results = measureToResults(m);
  msg(results.missing.length ? `Counties with no data: ${results.missing.join(", ")}.` : "");
  showMeasureInfo(m, results);
  document.getElementById("page-link").href = `index.html?measure=${m.key}`;
  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set("measure", m.key);
    history.replaceState(null, "", url);
  }
  drop();
}

// Sticky picker bar: same behaviour as the main page
const measureBar = document.querySelector(".measure-bar");
new ResizeObserver(() =>
  document.documentElement.style.setProperty("--bar-h", `${measureBar.offsetHeight}px`)).observe(measureBar);
const syncBarShadow = () => measureBar.classList.toggle("stuck", window.scrollY > 0);
window.addEventListener("scroll", syncBarShadow, { passive: true });
syncBarShadow();

canvas.addEventListener("pointermove", e => {
  const r = canvas.getBoundingClientRect();
  pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
});
canvas.addEventListener("pointerleave", () => (pointer = null));
document.getElementById("drop").addEventListener("click", () => drop());
measureSelect.addEventListener("change", () => showMeasure(measureSelect.value));
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readColors);
let resizeTimer;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 150); });

readColors();
resize();
if (!data?.measures?.length) {
  msg("No ballot measures found. Run node scripts/build-ballot-measures.mjs to generate data/ballot-measures.js.");
} else {
  for (const m of data.measures) measureSelect.add(new Option(m.shortTitle ? `${m.name}: ${m.shortTitle}` : m.title, m.key));
  measureSelect.disabled = false;
  const params = new URLSearchParams(location.search);
  showMeasure(params.get("measure"), { updateUrl: false });
}
Runner.run(runner, engine);
requestAnimationFrame(frame);
