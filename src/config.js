export const CONFIG = {
  showSideContainers: false, // Yes/No physics containers and their controls; ?sides=on also enables them
  fillRatio: 0.40,       // share of a stage covered by the larger side's counties
  outlineSimplify: 0.2,  // county outline simplification at load, in projected units (1000 = state width or height)
  simplifyPx: 0.8,       // collision-shape simplification tolerance, px
  minLabelPx: 46,        // label counties whose smaller side is at least this
  dropIntervalMs: 70,
  // restitution 0 = no bounce; slop = allowed overlap before correction (higher = less jitter)
  body: { friction: 0.6, frictionStatic: 1, frictionAir: 0.02, restitution: 0, slop: 0.1 },
  shakeStrength: 1,
  morphMs: 550,          // duration of the outline <-> circle animation
  mapFillRatio: 0.30,    // map layout: like fillRatio but lower, since hulls need room to avoid touching
  mapHoldMs: 1000,       // map layout: how long the true state shape is shown before resizing
  mapGrowMs: 1400,       // map layout: duration of the resize to vote-proportional areas
  mapMargin: 0.92,       // map layout: share of the stage the starting state map spans
  homeDamping: 0.93,     // map layout: per-step velocity retention, so pushed counties stop quickly
  returnMs: 900,         // map layout: how long counties glide home after a drag
  morphPoints: 64,       // points each shape is resampled to for the animation
  scale: {               // scale page (scale.html)
    fill: 0.72,          // share of a bowl's cross-section the heavier side's circles cover
    maxTiltDeg: 14,      // the beam's stops
    fullTiltGap: 0.2,    // sensitivity: a final lead of this share of all votes (60-40) settles on the stops
    dropEvery: 4,        // physics steps between counties (60 steps per second)
    minBodyR: 1.5,       // smallest collision radius, px; tiny counties are still drawn and weighed at true size
    gravity: 2,          // px/s^2 per px of drawing width, so motion looks the same at every size
    panMass: 0.15,       // an empty pan, as a share of a full pan's load
    beamInertia: 0.2,    // the beam's own moment of inertia, in full-pan loads x arm length^2
    beamDamping: 0.2,    // damping ratio of the beam (< 1 sways before settling)
    swingDamping: 0.08,  // damping ratio of each pan's swing on its chains
    stopBounce: 0.25     // share of the beam's speed kept when it hits a stop
  }
};
