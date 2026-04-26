"use client";

import { useCallback, useEffect } from "react";
import { useAgentStore, type WindowKind } from "@/lib/store";
import { StageDesktop } from "./StageDesktop";
import { ConfirmCardStack } from "./ConfirmCard";

/**
 * The thin shell around <StageDesktop>.
 *
 * Owns global keyboard shortcuts and the resize-clamp pass that the
 * windows agent relies on; rendering itself is delegated to
 * StageDesktop, which arranges the open window set into the
 * Stage Manager / centre-stage layout.
 */
export function Desktop() {
  const closeTopWindow = useAgentStore((s) => s.closeTopWindow);
  const openWindow = useAgentStore((s) => s.openWindow);
  const arrangeWindows = useAgentStore((s) => s.arrangeWindows);
  const updateWindowRect = useAgentStore((s) => s.updateWindowRect);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeTopWindow();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const rooms: WindowKind[] = [
          "graph",
          "memories",
          "workflows",
          "skills",
          "wiki",
          "settings",
        ];
        const idx = parseInt(e.key, 10) - 1;
        if (idx >= 0 && idx < rooms.length) {
          e.preventDefault();
          openWindow(rooms[idx]);
        }
        if (e.key === "g") {
          e.preventDefault();
          arrangeWindows("grid");
        }
      }
    },
    [closeTopWindow, openWindow, arrangeWindows],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  /* Re-clamp every window on browser-resize. The windows agent's
     `updateWindowRect` runs through clampToBounds so passing the
     current rect through is enough — overflowing windows shrink/shift
     back into bounds, others are no-ops. Debounced via rAF. */
  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const live = useAgentStore.getState().windows;
        for (const w of live) updateWindowRect(w.id, w.rect);
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [updateWindowRect]);

  return (
    <>
      <StageDesktop />
      <ConfirmCardStack />
    </>
  );
}
