"use client";

/**
 * Tiny hook bridging KG endpoints into window components.
 *
 * Every new schema-driven window follows the same contract:
 *   - optional agent-pushed `payload` seeds an initial snapshot for
 *     instant paint (no spinner flash on open);
 *   - the window then fetches from the backend client on mount + whenever
 *     the fetcher's identity changes (caller stabilises it with
 *     useCallback), reconciling the authoritative server response
 *     over the seed;
 *   - the caller renders a clear error state when the backend is
 *     unreachable — `BackendError.detail` surfaces directly.
 *
 * Endpoint responses are shared for a short time so cards and canvases
 * can reuse the same KG snapshots.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { BackendError } from "./api/backend";

export interface KgResource<T> {
  /** Most recent authoritative snapshot, or the agent-pushed seed
   *  while the first fetch is in flight. */
  data: T | null;
  /** True while any fetch is in flight (including refetches). */
  loading: boolean;
  /** Last error, or null after a successful reload. Prefer rendering
   *  `error.detail` — that's the server's human-readable message. */
  error: BackendError | null;
  /** Re-run the fetcher, bypassing the shared response cache. */
  refetch: () => void;
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { value: unknown; expiresAt: number }>();
const inFlight = new Map<string, Promise<unknown>>();
const requestVersions = new Map<string, number>();

export function fetchKgResource<T>(
  url: string,
  fetcher: (signal: AbortSignal) => Promise<T>,
  bypassCache = false,
): Promise<T> {
  const cached = cache.get(url);
  if (!bypassCache && cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.value as T);
  }
  const pending = inFlight.get(url);
  if (!bypassCache && pending) return pending as Promise<T>;

  const version = (requestVersions.get(url) ?? 0) + 1;
  requestVersions.set(url, version);
  const request = fetcher(new AbortController().signal);
  inFlight.set(url, request);
  return request
    .then((value) => {
      if (requestVersions.get(url) === version) {
        cache.set(url, { value, expiresAt: Date.now() + CACHE_TTL_MS });
      }
      return value;
    })
    .finally(() => {
      if (inFlight.get(url) === request) inFlight.delete(url);
    });
}

/**
 * @param fetcher - async thunk that returns the resource. Must be
 *   stable across renders (wrap in `useCallback`).
 * @param url - the URL used to share cached responses.
 * @param initial - optional instant-paint seed (e.g. the agent's
 *   payload snapshot). Ignored once the first fetch resolves.
 */
export function useKgResource<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  url: string,
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
    fetchKgResource(url, fetcher, tick > 0)
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
  }, [fetcher, tick, url]);

  const refetch = useCallback(() => {
    controllerRef.current?.abort();
    setTick((n) => n + 1);
  }, []);

  return { data, loading, error, refetch };
}
