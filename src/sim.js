import { CONFIG } from "./config.js";
import { countyLabel } from "./format.js";
import { COUNTIES, COUNTY_BY_ID, MAP_BOUNDS } from "./counties.js";
import { layoutHulls } from "./layout.js";
import { alignTo, buildCountyBody, easeInOut } from "./shapes.js";
import { state } from "./state.js";
import { Bodies, Body, Composite, Engine, Events, Mouse, MouseConstraint, Query, Runner, Sleeping } from "./matter.js";

// ---------- One physics world per side ----------

export function createSim(side, sectionEl) {
  const stage = sectionEl.querySelector(".stage");
  const canvas = stage.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const engine = Engine.create({ positionIterations: 10, velocityIterations: 8, enableSleeping: true });
  const runner = Runner.create({ isFixed: true, delta: 1000 / 60 });
  let W = 0, H = 0, dpr = 1;
  let walls = [], bodies = [], live = [], timer = null, results = null, scaleK = 0;
  let mapM = 1;        // px per projected unit for the starting state map
  let layoutOverlaps = 0; // pairs the layout could not separate (0 = none)
  let layoutPos = new Map(); // map layout: county id -> final anchor position
  let phase = null;    // map layout: view animation + interaction state for the current drop
  // phase = { p0, p1, t0, dur }  view progress goes p0 -> p1 (0 physical map, 1 vote proportional)
  //         released: bodies are dynamic (only when settled in the proportional view)
  //         ret: the no-collision glide home after a drag
  let shakeTimer = null;

  const mouse = Mouse.create(canvas);
  for (const evt of ["mousewheel", "DOMMouseScroll", "wheel"]) canvas.removeEventListener(evt, mouse.mousewheel);
  const mouseConstraint = MouseConstraint.create(engine, {
    mouse, constraint: { stiffness: 0.2, damping: 0.1, render: { visible: false } }
  });
  Composite.add(engine.world, mouseConstraint);
  let pointerInside = false;
  canvas.addEventListener("pointerenter", () => (pointerInside = true));
  canvas.addEventListener("pointerleave", () => (pointerInside = false));

  const wakeAll = () => live.forEach(b => Sleeping.set(b, false));

  Events.on(engine, "afterUpdate", () => {
    for (const b of live) {
      const p = b.position;
      if (p.y > H + 300 || p.x < -300 || p.x > W + 300) {
        Body.setPosition(b, { x: W / 2, y: -b.county.h });
        Body.setVelocity(b, { x: 0, y: 0 });
      }
    }
  });

  // Map layout: stage position of a point in the projected 1000-unit frame
  const mapPoint = ([x, y]) => ({ x: W / 2 + (x - MAP_BOUNDS.cx) * mapM, y: H / 2 + (y - MAP_BOUNDS.cy) * mapM });

  // Attach what the map layout needs to a county body: the drawn anchor (the county's home
  // point in the body frame), where the body's centre must sit for that anchor to be home,
  // and the draw scale at which the shape has its true size on the state map.
  function mapInfo(b) {
    const c = COUNTY_BY_ID.get(b.county.id);
    const s = Math.sqrt((b.county.value * scaleK) / c.projArea);
    const anchor = b.county.mode === "circle"
      ? { x: 0, y: 0 }
      : { x: b.county.offset.x + c.home[0] * s, y: b.county.offset.y + c.home[1] * s };
    const start = mapPoint(c.home), end = layoutPos.get(c.id) ?? start;
    b.county.anchor = anchor;
    b.county.start = { x: start.x - anchor.x, y: start.y - anchor.y };
    b.county.home = { x: end.x - anchor.x, y: end.y - anchor.y };
    b.county.d0 = mapM / s;
  }

  // Matter's setStatic keeps the original mass in `_original`, so only call it on a real change
  function pin(b) { if (!b.isStatic) { Body.setVelocity(b, { x: 0, y: 0 }); Body.setAngularVelocity(b, 0); Body.setStatic(b, true); } }
  function unpin(b) { if (b.isStatic) Body.setStatic(b, false); }

  const ease = t => easeInOut(Math.max(0, Math.min(1, t)));
  const viewQ = now => ease((now - phase.t0) / phase.dur);          // eased 0..1 through the current animation
  const viewProgress = now => phase.p0 + (phase.p1 - phase.p0) * viewQ(now); // 0 physical map .. 1 proportional

  // Start gliding the view toward `to` at time t0, from wherever each county is now
  function beginView(to, t0 = performance.now(), dur = CONFIG.mapGrowMs) {
    const now = performance.now();
    phase.p0 = viewProgress(Math.max(now, phase.t0));
    phase.p1 = to; phase.t0 = t0; phase.dur = dur;
    phase.ret = null;
    phase.released = false;
    for (const b of live) { pin(b); b.county.from = { x: b.position.x, y: b.position.y }; }
  }

  function setView(to) {
    if (phase) beginView(to);
  }

  // Settled in the proportional view: counties become draggable physical bodies
  function release() {
    phase.released = true;
    for (const b of live) unpin(b);
  }

  // After a drag: every county glides back to its layout spot with collisions off
  // (all bodies are pinned for the glide), then becomes physical again at its exact home.
  function startReturn() {
    if (!phase?.released || mouseConstraint.body) return;
    const now = performance.now();
    phase.ret = { t0: now, items: live.map(b => ({ b, from: { x: b.position.x, y: b.position.y }, a: b.angle - Math.round(b.angle / (2 * Math.PI)) * 2 * Math.PI })) };
    for (const b of live) pin(b);
  }

  function finishReturn() {
    if (!phase?.ret) return;
    for (const { b } of phase.ret.items) {
      Body.setPosition(b, b.county.home);
      Body.setAngle(b, 0);
      unpin(b);
    }
    phase.ret = null;
  }

  Events.on(mouseConstraint, "enddrag", startReturn);

  Events.on(engine, "beforeUpdate", () => {
    if (!phase) return;
    const now = performance.now();
    if (phase.ret) {
      const e = ease((now - phase.ret.t0) / CONFIG.returnMs);
      for (const { b, from, a } of phase.ret.items) {
        const { home } = b.county;
        Body.setPosition(b, { x: from.x + (home.x - from.x) * e, y: from.y + (home.y - from.y) * e });
        Body.setAngle(b, a * (1 - e));
      }
      if (now - phase.ret.t0 >= CONFIG.returnMs) finishReturn();
      return;
    }
    if (!phase.released) {
      // Pinned: glide each county between its place on the state map and its place in the layout
      const q = viewQ(now), target = phase.p1 ? "home" : "start";
      for (const b of live) {
        const f = b.county.from, t = b.county[target];
        if (f && t) Body.setPosition(b, { x: f.x + (t.x - f.x) * q, y: f.y + (t.y - f.y) * q });
      }
      if (q >= 1 && phase.p1 === 1) release();
      return;
    }
    // Settled: counties pushed by a drag stay where they ended up (just damped to rest)
    for (const b of live) {
      if (mouseConstraint.body === b) continue;
      Body.setVelocity(b, { x: b.velocity.x * CONFIG.homeDamping, y: b.velocity.y * CONFIG.homeDamping });
      Body.setAngularVelocity(b, b.angularVelocity * CONFIG.homeDamping);
    }
  });

  function buildWalls() {
    Composite.remove(engine.world, walls);
    const T = 400, opts = { isStatic: true, friction: 0.8 };
    walls = [
      Bodies.rectangle(W / 2, H + T / 2, W + 2 * T, T, opts),
      Bodies.rectangle(-T / 2, -H, T, 4 * H + 2 * T, opts),
      Bodies.rectangle(W + T / 2, -H, T, 4 * H + 2 * T, opts),
      Bodies.rectangle(W / 2, -3 * H - T / 2, W + 2 * T, T, opts)
    ];
    Composite.add(engine.world, walls);
    wakeAll();
  }

  function resize() {
    W = stage.clientWidth; H = stage.clientHeight; dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    Mouse.setScale(mouse, { x: 1 / dpr, y: 1 / dpr });
    mapM = CONFIG.mapMargin * Math.min(W / MAP_BOUNDS.w, H / MAP_BOUNDS.h);
    buildWalls();
  }

  // Map layout: counties appear as the state of Colorado (true shapes, true places), hold,
  // then resize to their vote areas while a spring keeps each near its home.
  function dropMap(res, k) {
    const now = performance.now();
    phase = { p0: 0, p1: 1, t0: now + CONFIG.mapHoldMs, dur: CONFIG.mapGrowMs, released: false, ret: null };
    const shown = COUNTIES.map(c => ({ c, value: res.byId.get(c.id)?.[side] ?? 0 })).filter(d => d.value > 0);
    // Work out where every county ends up before anything moves
    const items = shown.map(({ c, value }) => {
      const s = Math.sqrt((value * k) / c.projArea), r = Math.sqrt((value * k) / Math.PI);
      const outline = c.rings.flatMap(p => p[0]).map(([x, y]) => [(x - c.home[0]) * s, (y - c.home[1]) * s]);
      const circle = d3.range(32).map(i => [r * Math.cos((i / 32) * 2 * Math.PI), r * Math.sin((i / 32) * 2 * Math.PI)]);
      // The hull covers both shapes, so the layout holds whichever one is showing
      return { id: c.id, hull: d3.polygonHull(outline.concat(circle)), home: mapPoint(c.home) };
    });
    const laid = layoutHulls(items, W, H);
    layoutPos = laid.pos;
    layoutOverlaps = laid.overlaps;
    for (const { c, value } of shown) {
      const b = buildCountyBody(c, value, k);
      mapInfo(b);
      Body.setAngle(b, 0);
      Body.setPosition(b, b.county.start);
      b.county.from = { ...b.county.start };
      pin(b);
      bodies.push(b);
      live.push(b);
      Composite.add(engine.world, b);
    }
  }

  function drop(res, k) {
    results = res;
    clearInterval(timer);
    Composite.remove(engine.world, bodies);
    scaleK = k;
    bodies = [];
    live = [];
    phase = null;
    clearTimeout(shakeTimer);
    if (state.layoutMode === "map") return dropMap(res, k);
    const queue = COUNTIES
      .map(c => ({ c, value: res.byId.get(c.id)?.[side] ?? 0 }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value); // largest first, lands on the bottom
    let i = 0;
    timer = setInterval(() => {
      if (i >= queue.length) return clearInterval(timer);
      const { c, value } = queue[i++];
      const b = buildCountyBody(c, value, k); // built at drop time, in the current shape mode
      bodies.push(b);
      const half = Math.max(b.county.w, b.county.h) / 2;
      Body.setPosition(b, { x: half + Math.random() * Math.max(1, W - 2 * half), y: -half - 20 });
      Body.setAngle(b, (Math.random() - 0.5) * 0.6);
      Composite.add(engine.world, b);
      live.push(b);
    }, CONFIG.dropIntervalMs);
  }

  // Swap every settled or moving body for the same county in the other shape,
  // keeping its position and velocity so the pile stays put.
  function morph(mode) {
    finishReturn(); // snap any glide home first so the swap sees real bodies
    const swapped = live.map(old => {
      const c = COUNTY_BY_ID.get(old.county.id);
      const b = buildCountyBody(c, old.county.value, scaleK, mode);
      Body.setPosition(b, old.position);
      Body.setVelocity(b, old.velocity);
      Body.setAngle(b, old.angle);
      // Animate the drawn shape from the old outline to the new one, in the
      // body's own frame (point + offset = position relative to centre of mass)
      const toLocal = (pts, off) => pts.map(([x, y]) => [x + off.x, y + off.y]);
      const from = toLocal(old.county.morphPts, old.county.offset);
      const to = alignTo(from, toLocal(b.county.morphPts, b.county.offset));
      b.county.tween = { from, to, start: performance.now(), dur: CONFIG.morphMs };
      if (phase) {
        mapInfo(b);
        b.county.from = old.county.from;
        if (old.isStatic) pin(b); // still pinned: the glide keeps placing it
      }
      Composite.remove(engine.world, old);
      Composite.add(engine.world, b);
      return b;
    });
    bodies = bodies.map(b => swapped.find(s => s.county.id === b.county.id) ?? b);
    live = swapped;
    wakeAll();
  }

  function shake() {
    const s = CONFIG.shakeStrength;
    for (const b of live) {
      Sleeping.set(b, false);
      Body.setVelocity(b, { x: (Math.random() - 0.5) * 12 * s, y: (-6 - Math.random() * 12) * s });
      Body.setAngularVelocity(b, (Math.random() - 0.5) * 0.15 * s);
    }
    // Map layout has no spring: after the shake settles, everyone glides home
    if (phase?.released) { clearTimeout(shakeTimer); shakeTimer = setTimeout(startReturn, 1200); }
  }

  function setGravity(on) {
    engine.gravity.y = on && state.layoutMode !== "map" ? 1 : 0;
    wakeAll();
  }

  // The county under this side's pointer (or being dragged here), if any
  function pick() {
    // In the map layout the bodies only match what is drawn once the proportional view is settled
    const settled = !phase || viewProgress(performance.now()) === 1;
    const hovered = pointerInside && settled ? Query.point(live, mouse.position)[0] : null;
    const active = mouseConstraint.body?.county ? mouseConstraint.body : hovered;
    canvas.style.cursor = mouseConstraint.body ? "grabbing" : hovered ? "grab" : "default";
    return active ? active.county.id : null;
  }

  function tooltip(text, anchorX, anchorY, colors) {
    ctx.font = '600 13px "Barlow", system-ui, sans-serif';
    const tw = ctx.measureText(text).width + 16;
    const x = Math.min(Math.max(anchorX, 4), W - tw - 4);
    const y = Math.min(Math.max(anchorY, 4), H - 28);
    ctx.fillStyle = colors.ink;
    ctx.beginPath();
    ctx.roundRect(x, y, tw, 24, 5);
    ctx.fill();
    ctx.fillStyle = colors.paper;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 8, y + 12);
  }

  // highlightId: county to light up on this side; isSource: whether the pointer is on this side
  function draw(colors, highlightId, isSource) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const active = highlightId ? live.find(b => b.county.id === highlightId) : null;
    const fillA = colors[side], fillB = colors[`${side}-2`];
    ctx.lineJoin = "round";
    const now = performance.now();
    const progress = phase ? viewProgress(now) : 1;
    live.forEach((b, i) => {
      const { offset, tween } = b.county;
      let path = b.county.path;
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      ctx.rotate(b.angle);
      let scale = 1;
      if (phase && b.county.d0 !== undefined) {
        // Resize about the county's home point: true state-map size <-> vote-proportional size
        const d = b.county.d0 + (1 - b.county.d0) * progress;
        const { x, y } = b.county.anchor;
        ctx.translate(x, y);
        scale = d;
        ctx.scale(d, d);
        ctx.translate(-x, -y);
      }
      if (tween) {
        const t = Math.min(1, (now - tween.start) / tween.dur);
        if (t >= 1) {
          delete b.county.tween;
          ctx.translate(offset.x, offset.y);
        } else {
          // Interpolated outline, already in the body's frame
          const e = easeInOut(t);
          path = new Path2D();
          tween.from.forEach(([x0, y0], j) => {
            const [x1, y1] = tween.to[j];
            const x = x0 + (x1 - x0) * e, y = y0 + (y1 - y0) * e;
            j ? path.lineTo(x, y) : path.moveTo(x, y);
          });
          path.closePath();
        }
      } else {
        ctx.translate(offset.x, offset.y);
      }
      ctx.fillStyle = b === active ? colors.active : i % 2 ? fillB : fillA;
      ctx.fill(path, "evenodd");
      ctx.lineWidth = 1 / scale; // keep the outline 1 px while the shape is being resized
      ctx.strokeStyle = colors.line;
      ctx.stroke(path);
      ctx.restore();
    });

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = '600 12px "Barlow", system-ui, sans-serif';
    for (const b of live) {
      const { w, h, name } = b.county;
      if (Math.min(w, h) < CONFIG.minLabelPx) continue;
      if (phase && progress < 1) continue; // labels wait until the proportional view is settled
      ctx.lineWidth = 3;
      ctx.strokeStyle = colors.paper;
      ctx.strokeText(name, b.position.x, b.position.y);
      ctx.fillStyle = colors.ink;
      ctx.fillText(name, b.position.x, b.position.y);
    }

    if (active && results) {
      const r = results.byId.get(active.county.id);
      const share = r.yes + r.no ? active.county.value / (r.yes + r.no) : 0;
      const text = countyLabel(active.county.name, side, active.county.value, share);
      if (isSource) {
        // Next to the pointer
        const above = mouse.position.y - 34;
        tooltip(text, mouse.position.x + 14, above < 4 ? mouse.position.y + 18 : above, colors);
      } else {
        // Pinned above the matching county (hover from the other container or from the table)
        ctx.font = '600 13px "Barlow", system-ui, sans-serif';
        const tw = ctx.measureText(text).width + 16;
        const top = active.bounds.min.y - 30;
        tooltip(text, active.position.x - tw / 2, top < 4 ? active.bounds.max.y + 6 : top, colors);
      }
    }
  }

  Runner.run(runner, engine);
  const viewTarget = () => (phase ? (phase.p1 === 1 ? "proportional" : "physical") : null);
  const toggleView = () => { setView(viewTarget() === "proportional" ? 0 : 1); return viewTarget(); };
  return { side, viewTarget, toggleView, layoutOverlaps: () => layoutOverlaps, resize, drop, morph, shake, setGravity, pick, draw, area: () => W * H };
}
