// node tests/preset-rects-smoke.mjs
//
// Verifies the geometry of every layout preset:
//   - all rects sit inside the canvas bounds [0, 100]
//   - presets that promise non-overlap actually deliver non-overlap
//   - gutter / outer-margin invariants hold
//   - subject slot (rects[0]) is bigger than any demoted slot
//
// These tests safeguard the "agent never does math" promise: if any
// preset starts producing dirty geometry, this fails fast.
//
// We re-implement the math here in plain JS (mirrors PRESETS in
// lib/agent/server-snapshot.ts) so the test stays dependency-free.
// If the constants there change, update them here too.

const OUTER = 2.5;
const GUTTER = 2.5;
const PIP_STRIP_H = 18;

const rectFull = () => ({ x: OUTER, y: OUTER, w: 100 - 2*OUTER, h: 100 - 2*OUTER });

function pipRow(count, y, h) {
  const usable = 100 - 2*OUTER;
  const w = (usable - (count - 1) * GUTTER) / count;
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push({ x: OUTER + i * (w + GUTTER), y, w, h });
  }
  return out;
}

const PRESETS = {
  focus: (n) => {
    if (n <= 1) return [rectFull()];
    const subjectH = 100 - 2*OUTER - GUTTER - PIP_STRIP_H;
    const subject = { x: OUTER, y: OUTER, w: 100 - 2*OUTER, h: subjectH };
    const stripY = OUTER + subjectH + GUTTER;
    return [subject, ...pipRow(n - 1, stripY, PIP_STRIP_H)];
  },
  split: (n) => {
    if (n <= 1) return [rectFull()];
    const w = (100 - 2*OUTER - GUTTER) / 2;
    const h = 100 - 2*OUTER;
    const left  = { x: OUTER, y: OUTER, w, h };
    const right = { x: OUTER + w + GUTTER, y: OUTER, w, h };
    if (n === 2) return [left, right];
    const stackH = (h - (n - 2) * GUTTER) / (n - 1);
    const sideX  = OUTER + w + GUTTER;
    const sides  = [];
    for (let i = 0; i < n - 1; i++) sides.push({ x: sideX, y: OUTER + i * (stackH + GUTTER), w, h: stackH });
    return [left, ...sides];
  },
  triptych: (n) => {
    if (n <= 1) return [rectFull()];
    if (n === 2) return PRESETS.split(2);
    if (n > 3) return PRESETS.grid(n);
    const w = (100 - 2*OUTER - 2*GUTTER) / 3;
    const h = 100 - 2*OUTER;
    return [
      { x: OUTER,                  y: OUTER, w, h },
      { x: OUTER + w + GUTTER,     y: OUTER, w, h },
      { x: OUTER + 2*(w + GUTTER), y: OUTER, w, h },
    ];
  },
  grid: (n) => {
    if (n <= 1) return [rectFull()];
    if (n === 2) return PRESETS.split(2);
    if (n === 3) return PRESETS.triptych(3);
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const w = (100 - 2*OUTER - (cols - 1) * GUTTER) / cols;
    const h = (100 - 2*OUTER - (rows - 1) * GUTTER) / rows;
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      out.push({ x: OUTER + c * (w + GUTTER), y: OUTER + r * (h + GUTTER), w, h });
    }
    return out;
  },
  "stack-right": (n) => {
    if (n <= 1) return [rectFull()];
    const mainW = 62;
    const sideW = 100 - 2*OUTER - GUTTER - mainW;
    const sideX = OUTER + mainW + GUTTER;
    const totalH = 100 - 2*OUTER;
    const sides = n - 1;
    const sideH = (totalH - (sides - 1) * GUTTER) / sides;
    const main = { x: OUTER, y: OUTER, w: mainW, h: totalH };
    const right = [];
    for (let i = 0; i < sides; i++) right.push({ x: sideX, y: OUTER + i * (sideH + GUTTER), w: sideW, h: sideH });
    return [main, ...right];
  },
  spotlight: (n) => {
    if (n <= 1) return [rectFull()];
    const subjectH = 70;
    const subjectW = 64;
    const subject = { x: (100 - subjectW) / 2, y: OUTER, w: subjectW, h: subjectH };
    const stripY = OUTER + subjectH + GUTTER;
    const stripH = 100 - 2*OUTER - subjectH - GUTTER;
    return [subject, ...pipRow(n - 1, stripY, stripH)];
  },
  theater: (n) => {
    if (n <= 1) return [rectFull()];
    const topH = 64;
    const stripY = OUTER + topH + GUTTER;
    const stripH = 100 - 2*OUTER - topH - GUTTER;
    const subject = { x: OUTER, y: OUTER, w: 100 - 2*OUTER, h: topH };
    const cols = n - 1;
    const stripW = (100 - 2*OUTER - (cols - 1) * GUTTER) / cols;
    const strips = [];
    for (let i = 0; i < cols; i++) strips.push({ x: OUTER + i * (stripW + GUTTER), y: stripY, w: stripW, h: stripH });
    return [subject, ...strips];
  },
  reading: (n) => {
    if (n <= 1) return [rectFull()];
    const mainW = 60;
    const sideW = 100 - 2*OUTER - GUTTER - mainW;
    const h = 100 - 2*OUTER;
    const main = { x: OUTER, y: OUTER, w: mainW, h };
    if (n === 2) return [main, { x: OUTER + mainW + GUTTER, y: OUTER, w: sideW, h }];
    const sides = n - 1;
    const sideH = (h - (sides - 1) * GUTTER) / sides;
    const sideX = OUTER + mainW + GUTTER;
    const sidebar = [];
    for (let i = 0; i < sides; i++) sidebar.push({ x: sideX, y: OUTER + i * (sideH + GUTTER), w: sideW, h: sideH });
    return [main, ...sidebar];
  },
};

// Every preset is now non-overlapping per the user's "no boundaries
// touching" rule. Cascade was removed because overlap is fundamental
// to its semantics.
const NON_OVERLAPPING = Object.keys(PRESETS);
const ALLOW_OVERLAP   = [];

function area(r) { return r.w * r.h; }
function intersects(a, b) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}
function overlapArea(a, b) {
  const x1 = Math.max(a.x, b.x), x2 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.max(a.y, b.y), y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

let pass = 0, fail = 0;
const note = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else    { fail++; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`); }
};

for (const name of Object.keys(PRESETS)) {
  for (const n of [1, 2, 3, 4, 5]) {
    const rects = PRESETS[name](n);
    if (rects.length !== n) {
      note(false, `${name}(${n}) → wrong rect count`, `expected ${n}, got ${rects.length}`);
      continue;
    }

    // bounds
    const inBounds = rects.every(r =>
      r.x >= 0 && r.y >= 0 && r.x + r.w <= 100 + 0.01 && r.y + r.h <= 100 + 0.01,
    );
    note(inBounds, `${name}(${n}) → all rects within [0,100]`);

    // gutters: every rect ≥ ~OUTER from the canvas edge unless preset
    // is intentionally edge-flush (cascade can drift; pips can sit at
    // exactly OUTER from edges).
    if (!ALLOW_OVERLAP.includes(name)) {
      const respectsOuter = rects.every(r => r.x >= OUTER - 0.01 && r.y >= OUTER - 0.01);
      note(respectsOuter, `${name}(${n}) → respects outer margin (≥ ${OUTER}%)`);
    }

    // overlap policy
    if (NON_OVERLAPPING.includes(name) && n > 1) {
      let maxOverlap = 0;
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          if (intersects(rects[i], rects[j])) {
            maxOverlap = Math.max(maxOverlap, overlapArea(rects[i], rects[j]));
          }
        }
      }
      note(maxOverlap < 0.5, `${name}(${n}) → no rect-overlap (max area ${maxOverlap.toFixed(3)})`);
    }

    // subject (slot 0) is the largest in spotlight/theater/reading/focus/stack-right
    const subjectFirst = ["spotlight", "theater", "reading", "focus", "stack-right"];
    if (subjectFirst.includes(name) && n > 1) {
      const subjectArea = area(rects[0]);
      const maxOtherArea = Math.max(...rects.slice(1).map(area));
      note(
        subjectArea >= maxOtherArea,
        `${name}(${n}) → subject ≥ every demoted slot (subj ${subjectArea.toFixed(0)} vs max other ${maxOtherArea.toFixed(0)})`,
      );
    }
  }
}

console.log("");
console.log(`OUTER = ${OUTER}%, GUTTER = ${GUTTER}%`);
console.log(`${pass}/${pass + fail} preset-rect cases passed`);
process.exit(fail === 0 ? 0 : 1);
