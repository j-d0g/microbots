/**
 * Mount point catalogue + resolve/infer math.
 *
 * The layout sub-agent picks a `MountPoint` name; `resolveMount` maps
 * it to a percent rect in the viewport. The reverse — `inferMount` —
 * looks at a current pixel rect and returns the closest named mount,
 * or "freeform" if it doesn't match anything within IoU 0.85.
 *
 * Pixels are intentionally never returned from this module. The
 * window-renderer multiplies % by viewport at draw time.
 */

import type { MountPoint, RectPct } from "./types";

/** Pixel size of the picture-in-picture mount. Intentionally fixed;
 *  named-anchor mounts are in % so they scale with the viewport, but
 *  the PiP wants to stay tactile-small at any size. */
const PIP_PX_W = 320;
const PIP_PX_H = 220;

/** Bottom dock reserves this many pixels of vertical canvas. The
 *  Desktop component already shrinks itself by `bottom: 80`, so for
 *  rect math we treat the canvas as 100% of what's left above. */
export const DOCK_PX_H = 80;

/** Outer padding (pixels) around the canvas content area. Mirrors
 *  the existing GAP in `lib/store.ts`. */
export const GUTTER_PX = 16;

const NAMED_ANCHORS_PCT: Record<Exclude<MountPoint, "pip-br" | "pip-tr" | "freeform">, RectPct> = {
  "full":          { x: 0,  y: 0,   w: 100, h: 100 },
  "left-half":     { x: 0,  y: 0,   w: 50,  h: 100 },
  "right-half":    { x: 50, y: 0,   w: 50,  h: 100 },
  "top-half":      { x: 0,  y: 0,   w: 100, h: 50  },
  "bottom-half":   { x: 0,  y: 50,  w: 100, h: 50  },
  "left-third":    { x: 0,  y: 0,   w: 100 / 3,        h: 100 },
  "center-third":  { x: 100 / 3, y: 0, w: 100 / 3,    h: 100 },
  "right-third":   { x: 200 / 3, y: 0, w: 100 / 3,    h: 100 },
  "tl":            { x: 0,  y: 0,   w: 50,  h: 50 },
  "tr":            { x: 50, y: 0,   w: 50,  h: 50 },
  "bl":            { x: 0,  y: 50,  w: 50,  h: 50 },
  "br":            { x: 50, y: 50,  w: 50,  h: 50 },
};

export const ALL_MOUNTS: MountPoint[] = [
  "full",
  "left-half",
  "right-half",
  "top-half",
  "bottom-half",
  "left-third",
  "center-third",
  "right-third",
  "tl",
  "tr",
  "bl",
  "br",
  "pip-br",
  "pip-tr",
];

/** Resolve a mount-name to a % rect in the canvas. Pip mounts are
 *  computed against the live viewport because they're pixel-fixed. */
export function resolveMount(
  mount: MountPoint,
  viewport: { w: number; h: number },
): RectPct {
  if (mount === "freeform") {
    // Conservative default: a centered medium-sized window.
    return { x: 25, y: 15, w: 50, h: 70 };
  }
  if (mount === "pip-br" || mount === "pip-tr") {
    const usableHpx = Math.max(1, viewport.h - DOCK_PX_H);
    const wPct = (PIP_PX_W / viewport.w) * 100;
    const hPct = (PIP_PX_H / usableHpx) * 100;
    if (mount === "pip-br") {
      return { x: 100 - wPct, y: 100 - hPct, w: wPct, h: hPct };
    }
    return { x: 100 - wPct, y: 0, w: wPct, h: hPct };
  }
  return NAMED_ANCHORS_PCT[mount];
}

/** Pixel-rect → mount-name. Used to label the agent's snapshot when
 *  the user has dragged a window into something the agent didn't
 *  command (so the agent can still reason about the layout).
 *
 *  Threshold: IoU ≥ 0.85 against any named anchor wins; otherwise
 *  the mount is reported as `freeform`. */
export function inferMount(
  rectPx: { x: number; y: number; w: number; h: number },
  viewport: { w: number; h: number },
): { mount: MountPoint; rectPct: RectPct } {
  const usableHpx = Math.max(1, viewport.h - DOCK_PX_H);
  const rectPct: RectPct = {
    x: clamp((rectPx.x / viewport.w) * 100, 0, 100),
    y: clamp((rectPx.y / usableHpx) * 100, 0, 100),
    w: clamp((rectPx.w / viewport.w) * 100, 0, 100),
    h: clamp((rectPx.h / usableHpx) * 100, 0, 100),
  };

  let best: { mount: MountPoint; iou: number } = { mount: "freeform", iou: 0 };
  for (const mount of ALL_MOUNTS) {
    const candidate = resolveMount(mount, viewport);
    const score = iou(rectPct, candidate);
    if (score > best.iou) best = { mount, iou: score };
  }

  if (best.iou >= 0.85) return { mount: best.mount, rectPct };
  return { mount: "freeform", rectPct };
}

/** Intersection-over-union of two % rects. */
function iou(a: RectPct, b: RectPct): number {
  const ix0 = Math.max(a.x, b.x);
  const iy0 = Math.max(a.y, b.y);
  const ix1 = Math.min(a.x + a.w, b.x + b.w);
  const iy1 = Math.min(a.y + a.h, b.y + b.h);
  if (ix1 <= ix0 || iy1 <= iy0) return 0;
  const inter = (ix1 - ix0) * (iy1 - iy0);
  const union = a.w * a.h + b.w * b.h - inter;
  return union <= 0 ? 0 : inter / union;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
