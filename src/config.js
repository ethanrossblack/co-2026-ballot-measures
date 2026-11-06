export const CONFIG = {
  fillRatio: 0.40,       // share of a stage covered by the larger side's counties
  simplifyPx: 0.8,       // collision-shape simplification tolerance, px
  minLabelPx: 46,        // label counties whose smaller side is at least this
  dropIntervalMs: 70,
  // restitution 0 = no bounce; slop = allowed overlap before correction (higher = less jitter)
  body: { friction: 0.6, frictionStatic: 1, frictionAir: 0.02, restitution: 0, slop: 0.1 },
  shakeStrength: 1,
  morphMs: 550,          // duration of the outline <-> circle animation
  morphPoints: 64        // points each shape is resampled to for the animation
};
