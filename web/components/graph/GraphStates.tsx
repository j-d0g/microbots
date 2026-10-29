"use client";

interface Props {
  userId: string | null;
  loading: boolean;
  loadError: string | null;
  nodeCount: number;
  onOpenSettings: () => void;
  onRefresh: () => void;
}

export function GraphStates({
  userId,
  loading,
  loadError,
  nodeCount,
  onOpenSettings,
  onRefresh,
}: Props) {
  return (
    <>
      {!userId && (
        <div
          data-testid="graph-no-user"
          className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-paper-1/95 px-6 text-center"
        >
          <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
            graph
          </p>
          <p className="max-w-[40ch] text-[14px] leading-relaxed text-ink-90">
            set your <span className="font-mono text-[12px]">user_id</span> in
            settings to see your knowledge graph.
          </p>
          <button
            type="button"
            onClick={onOpenSettings}
            className="mt-2 inline-flex items-center rounded-sm border border-ink-90 bg-ink-90 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-paper-0 transition-colors duration-150 hover:bg-accent-indigo"
          >
            open settings →
          </button>
        </div>
      )}
      {userId && loading && nodeCount === 0 && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center font-mono text-[11px] uppercase tracking-wider text-ink-35">
          loading graph…
        </div>
      )}
      {userId && loadError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-paper-1/95 px-6 text-center">
          <p className="font-mono text-[11px] uppercase tracking-wider text-confidence-low">
            graph load failed
          </p>
          <p className="max-w-[40ch] text-[13px] text-ink-90">{loadError}</p>
          <button
            type="button"
            onClick={onRefresh}
            className="mt-2 inline-flex items-center rounded-sm border border-rule px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-ink-60 transition-colors hover:border-ink-90 hover:text-ink-90"
          >
            retry
          </button>
        </div>
      )}
      {userId && !loading && !loadError && nodeCount === 0 && (
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-1 px-6 text-center">
          <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
            empty graph
          </p>
          <p className="max-w-[36ch] text-[13px] text-ink-60">
            connect a tool to start filling this in.
          </p>
        </div>
      )}
    </>
  );
}
