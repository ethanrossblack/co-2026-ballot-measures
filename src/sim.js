import { CONFIG } from "./config.js";
import { countyLabel } from "./format.js";
import { COUNTIES, COUNTY_BY_ID } from "./counties.js";
import { alignTo, buildCountyBody, easeInOut } from "./shapes.js";
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
    buildWalls();
  }

  function drop(res, k) {
    results = res;
    clearInterval(timer);
    Composite.remove(engine.world, bodies);
    scaleK = k;
    bodies = [];
    live = [];
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
  }

  function setGravity(on) {
    engine.gravity.y = on ? 1 : 0;
    wakeAll();
  }

  // The county under this side's pointer (or being dragged here), if any
  function pick() {
    const hovered = pointerInside ? Query.point(live, mouse.position)[0] : null;
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
    live.forEach((b, i) => {
      const { offset, tween } = b.county;
      let path = b.county.path;
      ctx.save();
      ctx.translate(b.position.x, b.position.y);
      ctx.rotate(b.angle);
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
      ctx.lineWidth = 1;
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
  return { side, resize, drop, morph, shake, setGravity, pick, draw, area: () => W * H };
}
