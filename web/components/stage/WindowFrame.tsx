"use client";

import { useCallback, useRef, useState } from "react";
import { useAgentStore, type WindowState, getMinSize } from "@/lib/store";
import { cn } from "@/lib/cn";

type Edge = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const EDGE_CURSORS: Record<Edge, string> = {
  n: "cursor-n-resize",
  ne: "cursor-ne-resize",
  e: "cursor-e-resize",
  se: "cursor-se-resize",
  s: "cursor-s-resize",
  sw: "cursor-sw-resize",
  w: "cursor-w-resize",
  nw: "cursor-nw-resize",
};

const ROOM_LABELS: Record<string, string> = {
  brief: "brief",
  graph: "graph",
  workflow: "workflows",
  stack: "stack",
  waffle: "waffle",
  playbooks: "playbooks",
  settings: "settings",
};

export function WindowFrame({
  win,
  children,
}: {
  win: WindowState;
  children: React.ReactNode;
}) {
  const bringToFront = useAgentStore((s) => s.bringToFront);
  const moveWindow = useAgentStore((s) => s.moveWindow);
  const closeWindow = useAgentStore((s) => s.closeWindow);
  const minimizeWindow = useAgentStore((s) => s.minimizeWindow);
  const updateWindowRect = useAgentStore((s) => s.updateWindowRect);
  const [dragging, setDragging] = useState(false);

  const dragRef = useRef<{ startX: number; startY: number; winX: number; winY: number } | null>(null);
  const resizeRef = useRef<{
    edge: Edge;
    startX: number;
    startY: number;
    startRect: { x: number; y: number; w: number; h: number };
  } | null>(null);

  const onHeaderDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      bringToFront(win.id);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        winX: win.rect.x,
        winY: win.rect.y,
      };
      setDragging(true);

      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const dx = ev.clientX - dragRef.current.startX;
        const dy = ev.clientY - dragRef.current.startY;
        moveWindow(win.id, dragRef.current.winX + dx, dragRef.current.winY + dy);
      };
      const onUp = () => {
        dragRef.current = null;
        setDragging(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [win.id, win.rect.x, win.rect.y, bringToFront, moveWindow],
  );

  const onResizeDown = useCallback(
    (edge: Edge, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      bringToFront(win.id);
      resizeRef.current = {
        edge,
        startX: e.clientX,
        startY: e.clientY,
        startRect: { ...win.rect },
      };

      const min = getMinSize(win.kind);

      const onMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        const { edge: ed, startX, startY, startRect } = resizeRef.current;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        let { x, y, w, h } = startRect;

        if (ed.includes("e")) w = Math.max(startRect.w + dx, min.w);
        if (ed.includes("s")) h = Math.max(startRect.h + dy, min.h);
        if (ed.includes("w")) {
          const nw = Math.max(startRect.w - dx, min.w);
          x = startRect.x + (startRect.w - nw);
          w = nw;
        }
        if (ed.includes("n")) {
          const nh = Math.max(startRect.h - dy, min.h);
          y = startRect.y + (startRect.h - nh);
          h = nh;
        }

        updateWindowRect(win.id, { x, y, w, h });
      };
      const onUp = () => {
        resizeRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [win.id, win.rect, win.kind, bringToFront, updateWindowRect],
  );

  if (win.minimized) return null;

  return (
    <div
      data-testid={`window-${win.kind}`}
      data-window-id={win.id}
      onMouseDown={() => bringToFront(win.id)}
      style={{
        position: "absolute",
        left: win.rect.x,
        top: win.rect.y,
        width: win.rect.w,
        height: win.rect.h,
        zIndex: win.zIndex,
      }}
      className={cn(
        "flex flex-col overflow-hidden",
        "rounded-xl border border-black/[0.04] bg-paper-0",
        "shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.04)]",
        "backdrop-blur-sm",
      )}
    >
      {/* Title bar */}
      <div
        onMouseDown={onHeaderDown}
        className={cn(
          "flex h-8 shrink-0 items-center justify-between px-3",
          "border-b border-black/[0.04]",
          dragging ? "cursor-grabbing" : "cursor-grab",
          "select-none",
        )}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-35">
          {ROOM_LABELS[win.kind] ?? win.kind}
        </span>
        <div className="flex items-center gap-1.5" onMouseDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => minimizeWindow(win.id)}
            className="h-[7px] w-4 rounded-full bg-ink-35/12 hover:bg-ink-35/25 transition-colors duration-150"
            aria-label="minimize"
          />
          <button
            type="button"
            onClick={() => closeWindow(win.id)}
            className="h-[7px] w-[7px] rounded-full bg-ink-35/12 hover:bg-ink-35/25 transition-colors duration-150"
            aria-label="close"
          />
        </div>
      </div>

      {/* Content */}
      <div
        className={cn(
          "flex-1 muji-scroll",
          win.kind === "graph"
            ? "relative overflow-hidden"
            : "overflow-y-auto overflow-x-hidden p-4",
        )}
      >
        {children}
      </div>

      {/* Resize handles */}
      {(["n", "ne", "e", "se", "s", "sw", "w", "nw"] as Edge[]).map((edge) => (
        <div
          key={edge}
          onMouseDown={(e) => onResizeDown(edge, e)}
          className={cn(
            "absolute",
            EDGE_CURSORS[edge],
            edge === "n" && "left-3 right-3 top-0 h-1",
            edge === "s" && "left-3 right-3 bottom-0 h-1",
            edge === "e" && "top-3 bottom-3 right-0 w-1",
            edge === "w" && "top-3 bottom-3 left-0 w-1",
            edge === "ne" && "top-0 right-0 h-3 w-3",
            edge === "nw" && "top-0 left-0 h-3 w-3",
            edge === "se" && "bottom-0 right-0 h-3 w-3",
            edge === "sw" && "bottom-0 left-0 h-3 w-3",
          )}
        />
      ))}
    </div>
  );
}
