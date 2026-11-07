// Stand-in for Matter.js + poly-decomp so the real page can run with no network (see e2e-test.js).
// Minimal stand-in for Matter.js so the real page can run in a sandbox with no network.
// Bodies are placed on a fixed grid (no physics); enough to exercise hover, labels and drawing.
window.decomp = {};
(function () {
  const noop = () => {};
  let placed = 0;
  const mk = (x, y, hw, hh) => ({ position: { x, y }, angle: 0, velocity: { x: 0, y: 0 }, bounds: { min: { x: x - hw, y: y - hh }, max: { x: x + hw, y: y + hh } }, parts: [] });
  const Body = {
    setPosition(b, p) {
      const w = b.bounds.max.x - b.bounds.min.x, h = b.bounds.max.y - b.bounds.min.y;
      if (b.county) { const i = placed++ % 40; p = { x: 90 + (i % 8) * 60, y: 90 + Math.floor(i / 8) * 60 }; }
      b.position = { x: p.x, y: p.y };
      b.bounds = { min: { x: p.x - w / 2, y: p.y - h / 2 }, max: { x: p.x + w / 2, y: p.y + h / 2 } };
    },
    setVelocity(b, v) { b.velocity = v; }, setAngle(b, a) { b.angle = a; }, setAngularVelocity: noop, setInertia: noop, setStatic: noop, applyForce: noop
  };
  window.Matter = {
    Engine: { create() { return { world: {}, gravity: { y: 1 } }; } },
    Runner: { create() { return {}; }, run: noop },
    Bodies: {
      circle(x, y, r) { return mk(x, y, r, r); },
      rectangle(x, y, w, h) { return mk(x, y, w / 2, h / 2); },
      fromVertices(x, y, v) {
        const xs = v[0].map(p => p.x), ys = v[0].map(p => p.y);
        const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
        const b = mk(x, y, w / 2, h / 2); b.area = w * h; return b;
      }
    },
    Composite: { add: noop, remove: noop },
    Mouse: {
      create(c) {
        const m = { position: { x: -1, y: -1 }, mousewheel: noop };
        c.addEventListener("pointermove", e => { const r = c.getBoundingClientRect(); m.position = { x: e.clientX - r.left, y: e.clientY - r.top }; });
        return m;
      },
      setScale: noop
    },
    MouseConstraint: { create() { return { body: null }; } },
    Query: { point(bodies, pt) { return bodies.filter(b => pt.x >= b.bounds.min.x && pt.x <= b.bounds.max.x && pt.y >= b.bounds.min.y && pt.y <= b.bounds.max.y); } },
    Vertices: { isConvex: () => true, hull: v => v },
    Common: { setDecomp: noop }, Events: { on: noop }, Sleeping: { set: noop }, Body
  };
})();
