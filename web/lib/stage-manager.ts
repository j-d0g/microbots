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

/** Pinned-only sideline. Two slots; pin button refuses past this. */
export const MAX_LEFT_SIDELINE = 2;
/** Recency stack — the swap rotation. Three slots; oldest evicted. */
export const MAX_RIGHT_SIDELINE = 3;
const MAX_WINDOWS = 1 + MAX_LEFT_SIDELINE + MAX_RIGHT_SIDELINE + 1; // centre + sidelines + graph backdrop
/** Backwards-compat re-export for callers that still use the old
 *  symmetric cap; resolves to the larger of the two side caps. */
const MAX_SIDELINE_PER_SIDE = Math.max(MAX_LEFT_SIDELINE, MAX_RIGHT_SIDELINE);

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

  // Determine centre windows. Default "solo" — a single focal window
  // in centre stage. Multi-window arrangements (split / grid) are
  // explicit opt-in by the agent or future user UI; everything else
  // sidelines.
  const centreSlots = centreArrangement === "solo" ? 1
    : centreArrangement === "split-2" ? 2
    : centreArrangement === "split-3" ? 3
    : 4;

  const centreIds: string[] = [];

  // Active graph takes centre.
  if (isGraphActive && graphWin) {
    centreIds.push(graphWin.id);
  }

  // Active non-graph window joins centre.
  const activeWin = others.find((w) => w.id === activeId);
  if (activeWin && !centreIds.includes(activeWin.id)) {
    centreIds.push(activeWin.id);
  }

  // For non-solo arrangements (split/grid), pad centre with the most
  // recent unpinned windows so the agent's split layout is honoured.
  if (centreSlots > 1) {
    const padding = [...others]
      .filter((w) => !centreIds.includes(w.id) && !w.pinned)
      .sort((a, b) => b.zIndex - a.zIndex);
    for (const w of padding) {
      if (centreIds.length >= centreSlots) break;
      centreIds.push(w.id);
    }
  }

  /* Sideline routing.
   *   left  = pinned, capped at MAX_LEFT_SIDELINE (2)
   *   right = unpinned, capped at MAX_RIGHT_SIDELINE (3)
   * Both sorted newest-first by zIndex. Anything past the cap is
   * evicted — the pin button is disabled when left would overflow,
   * so the only realistic source of left overflow is agent-driven
   * mass-pinning. */
  const sidelineCandidates = others.filter((w) => !centreIds.includes(w.id));
  const leftCandidates = sidelineCandidates
    .filter((w) => w.pinned)
    .sort((a, b) => b.zIndex - a.zIndex);
  const rightCandidates = sidelineCandidates
    .filter((w) => !w.pinned)
    .sort((a, b) => b.zIndex - a.zIndex);

  const leftSidelineIds = leftCandidates
    .slice(0, MAX_LEFT_SIDELINE)
    .map((w) => w.id);
  const rightSidelineIds = rightCandidates
    .slice(0, MAX_RIGHT_SIDELINE)
    .map((w) => w.id);

  const evictedIds = [
    ...leftCandidates.slice(MAX_LEFT_SIDELINE),
    ...rightCandidates.slice(MAX_RIGHT_SIDELINE),
  ].map((w) => w.id);

  return {
    centreArrangement,
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

  /* Sideline rect builder. Three layouts depending on count:
   *   1 → full height column
   *   2 → 50/50 vertical split
   *   3 → fanned cascade with peeks distributed *down* the column —
   *       back card peeks at the top, mid in the middle, front at the
   *       bottom. Each behind card shows a substantial slice (~25% of
   *       column), the front card occupies the bottom ~50%.
   * Front card == ids[0] (most recent / focal in this side). */
  const writeSidelineRects = (ids: string[], xLeft: number) => {
    if (ids.length === 0) return;
    const columnH = usableH - INSET * 2;
    if (ids.length === 1) {
      rects.set(ids[0], {
        x: xLeft,
        y: INSET,
        w: SIDELINE_W,
        h: columnH,
        opacity: 0.9,
        zIndex: baseZ,
      });
      return;
    }
    if (ids.length === 2) {
      const slotH = Math.round((columnH - GAP) / 2);
      for (let i = 0; i < 2; i++) {
        rects.set(ids[i], {
          x: xLeft,
          y: INSET + i * (slotH + GAP),
          w: SIDELINE_W,
          h: slotH,
          opacity: 0.9,
          zIndex: baseZ + (1 - i),
        });
      }
      return;
    }
    /* N ≥ 3 cards: even cascade. We want each behind card to peek a
     * meaningful strip (not 14px clustered at the top). Solve:
     *   cardH       = columnH - (N − 1) * offset
     *   peek/behind = offset
     *   front shows = cardH (≥ peek so the focal card stays dominant)
     * Setting cardH = 2 * offset gives:
     *   2*offset + (N − 1)*offset = columnH
     *   offset = columnH / (N + 1)   cardH = 2 * columnH / (N + 1)
     * For N=3: offset = column/4, cardH = column/2 — back / mid each
     * show 25%, front shows 50%. The peeks read as evenly spaced down
     * the column rather than bunched at the top. */
    const N = ids.length;
    const offset = Math.round(columnH / (N + 1));
    const cardH = columnH - (N - 1) * offset;
    for (let i = 0; i < N; i++) {
      // i = 0  → front (bottom of column, highest z)
      // i = N-1 → back (top of column, lowest z)
      const depthFromFront = i;
      const fromBack = N - 1 - depthFromFront; // 0 = back, N-1 = front
      rects.set(ids[i], {
        x: xLeft,
        y: INSET + fromBack * offset,
        w: SIDELINE_W,
        h: cardH,
        opacity:
          depthFromFront === 0
            ? 0.9
            : Math.max(0.55, 0.9 - 0.15 * depthFromFront),
        zIndex: baseZ + (N - depthFromFront),
      });
    }
  };

  writeSidelineRects(layout.leftSidelineIds, INSET);
  writeSidelineRects(layout.rightSidelineIds, vw - INSET - SIDELINE_W);

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
        /* Solo centre layout. We use a single fixed GUTTER for the
         * gap on every "open" edge — between the centre and a
         * neighbouring sideline, or between the centre and the
         * viewport edge when no sideline is present. That keeps the
         * spacing consistent regardless of which sidelines are
         * populated, and gives the focal window more real estate
         * than the old 15%-each-side inset.
         *
         * Special case: when BOTH sidelines are populated, we keep
         * the GUTTER from the left sideline (so the centre's left
         * edge doesn't shift when a right sideline appears) but the
         * right edge extends *over* the right sideline (~55% overlay)
         * so the centre's aspect ratio doesn't collapse. The centre's
         * z already sits above sidelines so the overlay reads as
         * "centre stacked on top of right pane". */
        const GUTTER = Math.round(vw * 0.04);
        const hasLeft = layout.leftSidelineIds.length > 0;
        const hasRight = layout.rightSidelineIds.length > 0;
        const soloX = hasLeft
          ? INSET + SIDELINE_W + GUTTER
          : INSET + GUTTER;
        const soloRightEdge =
          hasLeft && hasRight
            ? vw - INSET - Math.round(SIDELINE_W * 0.45)
            : hasRight
              ? vw - INSET - SIDELINE_W - GUTTER
              : vw - INSET - GUTTER;
        const soloW = soloRightEdge - soloX;
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
