/**
 * Stage-manager layout engine.
 *
 * Pure functions that compute window positions from the window set,
 * the active window, and pin state. No side effects, no DOM, no store.
 *
 * Layout model (plan §3.3):
 *   CENTRE STAGE — 1–4 windows in a named arrangement
 *   SIDELINES    — up to 3 per side (left + right), max 6
 *   BACKDROP     — graph at 8% opacity when not centred
 *   MODAL        — ask_user overrides everything
 *
 * Max simultaneous windows on screen: 10.
 * Overflow evicts the oldest sideline window.
 */

export type CentreArrangement = "solo" | "split-2" | "split-3" | "grid-4";

export type StageRole =
  | "centre"
  | "sideline-left"
  | "sideline-right"
  | "backdrop"
  | "modal";

export interface StageLayout {
  centreArrangement: CentreArrangement;
  /** Window IDs in centre stage, ordered by slot. */
  centreIds: string[];
  /** Left sideline IDs, top → bottom. */
  leftSidelineIds: string[];
  /** Right sideline IDs, top → bottom. */
  rightSidelineIds: string[];
  /** Whether the graph is in atmospheric backdrop mode. */
  graphBackdrop: boolean;
  /** Window IDs that were evicted (over the 10-window cap). */
  evictedIds: string[];
  /** ask_user modal window ID, if any. */
  modalId: string | null;
}

export interface StageRect {
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  zIndex: number;
}

interface WindowInput {
  id: string;
  kind: string;
  zIndex: number;
  pinned: boolean;
  openedAt: number;
}

const MAX_WINDOWS = 10;
const MAX_SIDELINE_PER_SIDE = 3;

/**
 * Compute the stage layout from the current window set.
 *
 * @param windows — all open windows
 * @param activeId — the most recently opened/focused window
 * @param centreArrangement — the arrangement hint (default "solo")
 */
export function computeStageLayout(
  windows: WindowInput[],
  activeId: string | null,
  centreArrangement: CentreArrangement = "solo",
): StageLayout {
  if (windows.length === 0) {
    return {
      centreArrangement: "solo",
      centreIds: [],
      leftSidelineIds: [],
      rightSidelineIds: [],
      graphBackdrop: false,
      evictedIds: [],
      modalId: null,
    };
  }

  // Check for ask_user modal — overrides everything
  const modal = windows.find((w) => w.kind === "ask_user");
  const modalId = modal?.id ?? null;

  // Separate graph (may become backdrop)
  const graphWin = windows.find((w) => w.kind === "graph");
  const isGraphActive = graphWin?.id === activeId;

  // Non-graph, non-modal windows
  const others = windows.filter(
    (w) => w.kind !== "graph" && w.kind !== "ask_user",
  );

  // Pinned windows stay in place, not demoted
  const pinned = new Set(windows.filter((w) => w.pinned).map((w) => w.id));

  // Determine centre windows
  const centreSlots = centreArrangement === "solo" ? 1
    : centreArrangement === "split-2" ? 2
    : centreArrangement === "split-3" ? 3
    : 4;

  // Start with the active window in centre
  const centreIds: string[] = [];
  const sidelineCandidates: WindowInput[] = [];

  // If graph is active, it takes centre
  if (isGraphActive && graphWin) {
    centreIds.push(graphWin.id);
  }

  // Active non-graph window
  const activeWin = others.find((w) => w.id === activeId);
  if (activeWin && !centreIds.includes(activeWin.id)) {
    centreIds.push(activeWin.id);
  }

  // Fill remaining centre slots with most recent windows
  const byRecency = [...others]
    .filter((w) => !centreIds.includes(w.id))
    .sort((a, b) => b.zIndex - a.zIndex);

  for (const w of byRecency) {
    if (centreIds.length >= centreSlots) break;
    centreIds.push(w.id);
  }

  // Everything else → sideline candidates
  for (const w of others) {
    if (!centreIds.includes(w.id)) {
      sidelineCandidates.push(w);
    }
  }
  // Graph goes to sideline if not active and not already in centre
  if (graphWin && !isGraphActive && !centreIds.includes(graphWin.id)) {
    // Graph becomes backdrop, not a sideline
  }

  // Sort sideline candidates by recency (newest first)
  sidelineCandidates.sort((a, b) => b.zIndex - a.zIndex);

  // Assign sidelines: right = history stack, left = user-pinned
  const rightSidelineIds: string[] = [];
  const leftSidelineIds: string[] = [];

  for (const w of sidelineCandidates) {
    if (pinned.has(w.id) && leftSidelineIds.length < MAX_SIDELINE_PER_SIDE) {
      leftSidelineIds.push(w.id);
    } else if (rightSidelineIds.length < MAX_SIDELINE_PER_SIDE) {
      rightSidelineIds.push(w.id);
    } else if (leftSidelineIds.length < MAX_SIDELINE_PER_SIDE) {
      leftSidelineIds.push(w.id);
    }
    // else: overflow, will be evicted
  }

  // Evict overflow
  const allPlaced = new Set([
    ...centreIds,
    ...leftSidelineIds,
    ...rightSidelineIds,
    ...(graphWin && !isGraphActive ? [graphWin.id] : []),
    ...(modalId ? [modalId] : []),
  ]);
  const evictedIds = windows
    .filter((w) => !allPlaced.has(w.id) && w.kind !== "ask_user")
    .map((w) => w.id);

  return {
    centreArrangement: centreIds.length <= 1 ? "solo"
      : centreIds.length === 2 ? "split-2"
      : centreIds.length === 3 ? "split-3"
      : "grid-4",
    centreIds,
    leftSidelineIds,
    rightSidelineIds,
    graphBackdrop: !!graphWin && !isGraphActive,
    evictedIds,
    modalId,
  };
}

/**
 * Convert a StageLayout to pixel rects for rendering.
 */
export function stageLayoutToRects(
  layout: StageLayout,
  viewport: { w: number; h: number },
): Map<string, StageRect> {
  const rects = new Map<string, StageRect>();
  const { w: vw, h: vh } = viewport;
  const DOCK_H = 80; // dock height + gap
  const usableH = vh - DOCK_H;
  const INSET = Math.round(vw * 0.025); // 2.5% outer margin
  const GAP = 12;

  // Sideline dimensions
  const SIDELINE_W = Math.round(vw * 0.22);
  const SIDELINE_OVERLAP = 40; // px overlap behind centre

  let baseZ = 10;

  // --- Left sidelines ---
  for (let i = 0; i < layout.leftSidelineIds.length; i++) {
    const id = layout.leftSidelineIds[i];
    const slotH = Math.round(
      (usableH - INSET * 2 - (layout.leftSidelineIds.length - 1) * GAP) /
        layout.leftSidelineIds.length,
    );
    rects.set(id, {
      x: INSET,
      y: INSET + i * (slotH + GAP),
      w: SIDELINE_W,
      h: slotH,
      opacity: 0.85,
      zIndex: baseZ + i,
    });
  }

  // --- Right sidelines ---
  for (let i = 0; i < layout.rightSidelineIds.length; i++) {
    const id = layout.rightSidelineIds[i];
    const slotH = Math.round(
      (usableH - INSET * 2 - (layout.rightSidelineIds.length - 1) * GAP) /
        layout.rightSidelineIds.length,
    );
    rects.set(id, {
      x: vw - INSET - SIDELINE_W,
      y: INSET + i * (slotH + GAP),
      w: SIDELINE_W,
      h: slotH,
      opacity: 0.85,
      zIndex: baseZ + i,
    });
  }

  // --- Centre stage ---
  const leftOffset = layout.leftSidelineIds.length > 0
    ? SIDELINE_W + INSET - SIDELINE_OVERLAP
    : INSET;
  const rightOffset = layout.rightSidelineIds.length > 0
    ? SIDELINE_W + INSET - SIDELINE_OVERLAP
    : INSET;
  const centreX = leftOffset;
  const centreW = vw - leftOffset - rightOffset;
  const centreY = INSET;
  const centreH = usableH - INSET * 2;
  const centreZ = baseZ + MAX_SIDELINE_PER_SIDE * 2 + 1;

  switch (layout.centreArrangement) {
    case "solo": {
      if (layout.centreIds.length > 0) {
        // ~70% width, centred within the centre zone
        const soloW = Math.round(centreW * 0.7);
        const soloX = centreX + Math.round((centreW - soloW) / 2);
        rects.set(layout.centreIds[0], {
          x: soloX,
          y: centreY,
          w: soloW,
          h: centreH,
          opacity: 1,
          zIndex: centreZ,
        });
      }
      break;
    }
    case "split-2": {
      const halfW = Math.round((centreW - GAP) / 2);
      for (let i = 0; i < Math.min(2, layout.centreIds.length); i++) {
        rects.set(layout.centreIds[i], {
          x: centreX + i * (halfW + GAP),
          y: centreY,
          w: halfW,
          h: centreH,
          opacity: 1,
          zIndex: centreZ + i,
        });
      }
      break;
    }
    case "split-3": {
      // 1 half-width left, 2 quarter-height stacked right
      const leftW = Math.round(centreW * 0.5);
      const rightW = centreW - leftW - GAP;
      const rightH = Math.round((centreH - GAP) / 2);
      if (layout.centreIds[0]) {
        rects.set(layout.centreIds[0], {
          x: centreX,
          y: centreY,
          w: leftW,
          h: centreH,
          opacity: 1,
          zIndex: centreZ,
        });
      }
      for (let i = 1; i < Math.min(3, layout.centreIds.length); i++) {
        rects.set(layout.centreIds[i], {
          x: centreX + leftW + GAP,
          y: centreY + (i - 1) * (rightH + GAP),
          w: rightW,
          h: rightH,
          opacity: 1,
          zIndex: centreZ + i,
        });
      }
      break;
    }
    case "grid-4": {
      const gridW = Math.round((centreW - GAP) / 2);
      const gridH = Math.round((centreH - GAP) / 2);
      for (let i = 0; i < Math.min(4, layout.centreIds.length); i++) {
        const col = i % 2;
        const row = Math.floor(i / 2);
        rects.set(layout.centreIds[i], {
          x: centreX + col * (gridW + GAP),
          y: centreY + row * (gridH + GAP),
          w: gridW,
          h: gridH,
          opacity: 1,
          zIndex: centreZ + i,
        });
      }
      break;
    }
  }

  // --- Graph backdrop ---
  if (layout.graphBackdrop) {
    // Find the graph window ID — it's not in centreIds or sidelines
    // The caller provides it implicitly; we just need a convention.
    // We'll set a special rect at a known key.
    rects.set("__graph_backdrop__", {
      x: 0,
      y: 0,
      w: vw,
      h: vh,
      opacity: 0.08,
      zIndex: 1,
    });
  }

  // --- Modal (ask_user) ---
  if (layout.modalId) {
    const modalW = Math.min(480, vw - 64);
    const modalH = 200;
    rects.set(layout.modalId, {
      x: Math.round((vw - modalW) / 2),
      y: usableH - modalH - 32,
      w: modalW,
      h: modalH,
      opacity: 1,
      zIndex: 1000,
    });
  }

  return rects;
}

/**
 * Determine the role of a window in the current layout.
 */
export function getWindowRole(
  layout: StageLayout,
  windowId: string,
): StageRole {
  if (layout.modalId === windowId) return "modal";
  if (layout.centreIds.includes(windowId)) return "centre";
  if (layout.leftSidelineIds.includes(windowId)) return "sideline-left";
  if (layout.rightSidelineIds.includes(windowId)) return "sideline-right";
  return "backdrop";
}
