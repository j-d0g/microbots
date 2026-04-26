"use client";

/**
 * Tiny hook bridging KG endpoints into window components.
 *
 * Every new schema-driven window follows the same contract:
 *   - optional agent-pushed `payload` seeds an initial snapshot for
 *     instant paint (no spinner flash on open);
 *   - the window then fetches from `kg-client.ts` on mount + whenever
 *     the fetcher's identity changes (caller stabilises it with
 *     useCallback), reconciling the authoritative server response
 *     over the seed;
 *   - the caller renders a clear error state when the backend is
 *     unreachable — `BackendError.detail` surfaces directly.
 *
 * No external deps. If caching becomes desirable later, we can swap
 * this to SWR or react-query without touching call sites.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { BackendError } from "./kg-client";

export interface KgResource<T> {
  /** Most recent authoritative snapshot, or the agent-pushed seed
   *  while the first fetch is in flight. */
  data: T | null;
  /** True while any fetch is in flight (including refetches). */
  loading: boolean;
  /** Last error, or null after a successful reload. Prefer rendering
   *  `error.detail` — that's the server's human-readable message. */
  error: BackendError | null;
  /** Re-run the fetcher, bypassing any debounce. */
  refetch: () => void;
}

/**
 * @param fetcher - async thunk that returns the resource. Must be
 *   stable across renders (wrap in `useCallback`).
 * @param initial - optional instant-paint seed (e.g. the agent's
 *   payload snapshot). Ignored once the first fetch resolves.
 */
export function useKgResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  initial: T | null = null,
): KgResource<T> {
  const [data, setData] = useState<T | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<BackendError | null>(null);
  const [tick, setTick] = useState(0);

  // Track the active controller so a fast refetch cancels the in-flight request.
  const controllerRef = useRef<AbortController | null>(null);

  // Swap the seed in if the caller hands us a new initial before the
  // first fetch settles. Keeps payload-driven re-opens snappy.
  useEffect(() => {
    if (initial !== null) setData(initial);
    // Intentionally depending on `initial` identity — callers should
    // pass a stable reference (memoised) unless they actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    fetcher(controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setData(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof BackendError) setError(err);
        else
          setError(
            new BackendError(
              err instanceof Error ? err.message : "unknown error",
              0,
            ),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [fetcher, tick]);

  const refetch = useCallback(() => {
    controllerRef.current?.abort();
    setTick((n) => n + 1);
  }, []);

  return { data, loading, error, refetch };
}
