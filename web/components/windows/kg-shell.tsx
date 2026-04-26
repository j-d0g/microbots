"use client";

/**
 * Shared visual shell for schema-driven KG windows.
 *
 * Centralises the muji loading skeleton, error pane, and empty
 * state so each window only renders its data path. Keep this
 * intentionally tiny — it's a presentational helper, not a router.
 */

import type { ReactNode } from "react";
import type { BackendError } from "@/lib/kg-client";
import { cn } from "@/lib/cn";

export function KgShell({
  loading,
  error,
  empty,
  emptyHint,
  children,
  onRetry,
}: {
  loading: boolean;
  error: BackendError | null;
  empty?: boolean;
  emptyHint?: string;
  children: ReactNode;
  onRetry?: () => void;
}) {
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-mono text-[10px] uppercase tracking-wider text-confidence-low">
          backend unreachable · {error.status || "?"}
        </p>
        <p className="max-w-[300px] font-mono text-[11px] text-ink-60">
          {error.detail}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="font-mono text-[10px] uppercase tracking-wider text-accent-indigo hover:underline"
          >
            retry
          </button>
        )}
      </div>
    );
  }

  if (loading && empty) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
          loading…
        </p>
      </div>
    );
  }

  if (empty) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="font-mono text-[12px] text-ink-60">nothing yet</p>
        {emptyHint && (
          <p className="max-w-[280px] font-mono text-[10px] text-ink-35">
            {emptyHint}
          </p>
        )}
      </div>
    );
  }

  return <>{children}</>;
}

/** Slim, consistent header used inside window bodies. */
export function KgHeader({
  label,
  right,
  className,
}: {
  label: string;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-baseline justify-between border-b border-rule/60 px-3 py-2",
        className,
      )}
    >
      <p className="font-mono text-[10px] uppercase tracking-wider text-ink-35">
        {label}
      </p>
      {right}
    </div>
  );
}
