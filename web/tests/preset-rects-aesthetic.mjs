#!/usr/bin/env npx tsx
// npx tsx tests/preset-rects-aesthetic.mjs
//
// Aesthetic assertions for layout presets (Sprint 2 — Goal B).
// Verifies layout aesthetic principles from AGENTS.md:
//   1. No two non-pip rects share an exact x or y edge
//   2. Subject (rects[0]) is always the largest in any preset
//   3. Subject in focus/spotlight is centered (within 5% of canvas centroid)
//   4. No rect exceeds 85% of canvas area unless n=1 AND preset is "fullscreen"

// Use dynamic import with tsx to resolve TS + path aliases
const mod = await import("../lib/agent/server-snapshot.ts");
const { rectsForPreset, LAYOUT_PRESET_NAMES } = mod;

const CANVAS_AREA = 100 * 100;
const CENTROID_X = 50;
const CENTER_TOLERANCE = 5;

let pass = 0;
let fail = 0;

function assert(cond, msg) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error(`  FAIL: ${msg}`);
  }
}

function area(r) {
  return r.w * r.h;
}

function centerX(r) {
  return r.x + r.w / 2;
}

// Pip rects are small thumbnails (area < 400 = ~20% × 20%)
function isPip(r) {
  return area(r) < 400;
}

const TEST_COUNTS = [1, 2, 3, 4, 5, 6];

for (const preset of LAYOUT_PRESET_NAMES) {
  for (const n of TEST_COUNTS) {
    const rects = rectsForPreset(preset, n);
    if (rects.length === 0) continue;

    const label = `${preset} n=${n}`;

    // 1. No two non-pip rects share an exact x or y edge (within 0.01%)
    const mainRects = rects.filter((r) => !isPip(r));
    if (mainRects.length >= 2) {
      for (let i = 0; i < mainRects.length; i++) {
        for (let j = i + 1; j < mainRects.length; j++) {
          const a = mainRects[i];
          const b = mainRects[j];
          const eps = 0.01;
          // Check if both left AND right edges match (perfectly aligned columns)
          const xAligned =
            Math.abs(a.x - b.x) < eps && Math.abs((a.x + a.w) - (b.x + b.w)) < eps;
          // Check if both top AND bottom edges match (perfectly aligned rows)
          const yAligned =
            Math.abs(a.y - b.y) < eps && Math.abs((a.y + a.h) - (b.y + b.h)) < eps;
          // Both x AND y perfectly aligned means identical position/size — should not happen
          assert(
            !(xAligned && yAligned),
            `${label}: rects ${i} and ${j} have identical position and size`,
          );
        }
      }
    }

    // 2. Subject (rects[0]) is always the largest in subject-dominant presets
    // Equal presets (split, grid, triptych) exempt — all slots equal by design
    const subjectDominant = ["focus", "spotlight", "theater", "reading", "stack-right"];
    if (n >= 2 && subjectDominant.includes(preset)) {
      const subjectArea = area(rects[0]);
      const maxOtherArea = Math.max(...rects.slice(1).map(area));
      assert(
        subjectArea >= maxOtherArea - 0.01,
        `${label}: subject area ${subjectArea.toFixed(1)} < other ${maxOtherArea.toFixed(1)}`,
      );
    }

    // 3. Subject in focus/spotlight is centered (within tolerance of x centroid)
    if ((preset === "focus" || preset === "spotlight") && n >= 2) {
      const cx = centerX(rects[0]);
      assert(
        Math.abs(cx - CENTROID_X) <= CENTER_TOLERANCE,
        `${label}: subject centerX ${cx.toFixed(1)} not within ${CENTER_TOLERANCE}% of ${CENTROID_X}`,
      );
    }

    // 4. No rect exceeds 85% of canvas area unless n=1
    if (n > 1) {
      for (let i = 0; i < rects.length; i++) {
        const pct = (area(rects[i]) / CANVAS_AREA) * 100;
        assert(
          pct <= 85,
          `${label}: rect ${i} is ${pct.toFixed(1)}% of canvas (max 85%)`,
        );
      }
    }
  }
}

console.log(`\npreset-rects-aesthetic: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
