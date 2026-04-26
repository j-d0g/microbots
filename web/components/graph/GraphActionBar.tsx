"use client";

import { cn } from "@/lib/cn";

interface Props {
  onZoomFit: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onClear: () => void;
  hasFocus: boolean;
}

export function GraphActionBar({
  onZoomFit,
  onZoomIn,
  onZoomOut,
  onClear,
  hasFocus,
}: Props) {
  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md border border-rule bg-paper-0/85 p-1 backdrop-blur-md shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <ActionButton title="zoom in" onClick={onZoomIn} ariaLabel="zoom in">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <line x1="6" y1="2.5" x2="6" y2="9.5" stroke="currentColor" strokeLinecap="round" />
          <line x1="2.5" y1="6" x2="9.5" y2="6" stroke="currentColor" strokeLinecap="round" />
        </svg>
      </ActionButton>
      <ActionButton title="zoom out" onClick={onZoomOut} ariaLabel="zoom out">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <line x1="2.5" y1="6" x2="9.5" y2="6" stroke="currentColor" strokeLinecap="round" />
        </svg>
      </ActionButton>
      <ActionButton title="fit to window" onClick={onZoomFit} ariaLabel="fit">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="none">
          <path
            d="M2 4V2H4 M8 2H10V4 M10 8V10H8 M4 10H2V8"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </ActionButton>
      {hasFocus && (
        <>
          <span className="mx-0.5 h-3 w-px bg-rule" />
          <ActionButton title="clear focus" onClick={onClear} ariaLabel="clear">
            <span className="font-mono text-[10px] uppercase tracking-wider px-0.5">
              clear
            </span>
          </ActionButton>
        </>
      )}
    </div>
  );
}

function ActionButton({
  title,
  ariaLabel,
  onClick,
  children,
}: {
  title: string;
  ariaLabel: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        "flex h-6 min-w-6 items-center justify-center rounded px-1",
        "text-ink-60 hover:bg-paper-2 hover:text-ink-90 transition-colors",
      )}
    >
      {children}
    </button>
  );
}
