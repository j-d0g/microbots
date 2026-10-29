/** Canonical mount point catalogue and percent-rect resolution. */

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

const NAMED_ANCHORS_PCT: Record<Exclude<MountPoint, "pip-br" | "pip-tr" | "freeform">, RectPct> = {
  "full":          { x: 0,  y: 0,   w: 100, h: 100 },
  "left-half":     { x: 0,  y: 0,   w: 50,  h: 100 },
  "right-half":    { x: 50, y: 0,   w: 50,  h: 100 },
  "right-wide":    { x: 40, y: 0,   w: 60,  h: 100 },
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
  "right-wide",
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
