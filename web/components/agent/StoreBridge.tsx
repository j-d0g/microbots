"use client";

import { useEffect } from "react";
import { useAgentStore } from "@/lib/store";
import * as backend from "@/lib/api/backend";

const USER_ID_STORAGE_KEY = "microbots:userId";
const HEALTH_POLL_MS = 30_000;
const CONNECTIONS_POLL_MS = 30_000;

/**
 * Always-mounted bridge.
 *
 *  - Exposes the agent store on `window.__store` for dev/test harnesses.
 *  - Hydrates `userId` from localStorage on first mount and keeps the
 *    browser tab in sync via a `storage` event listener so settings
 *    edits in another tab propagate.
 *  - Fires a one-shot `warmUp()` on mount to wake the Render free-tier
 *    backend before the user touches anything.
 *  - Polls /api/health every 30 s so the snapshot agent + settings
 *    badge always reflect live degraded mode.
 *  - Polls /api/composio/connections every 30 s while a userId is set,
 *    so integration windows show fresh status without per-window polls.
 */
export function StoreBridge() {
  const userId = useAgentStore((s) => s.userId);
  const setUserId = useAgentStore((s) => s.setUserId);
  const setBackendHealth = useAgentStore((s) => s.setBackendHealth);
  const setConnections = useAgentStore((s) => s.setConnections);
  const setToolkits = useAgentStore((s) => s.setToolkits);

  /* dev/test global */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV === "production") return;
    (window as unknown as { __store: typeof useAgentStore }).__store =
      useAgentStore;
  }, []);

  /* userId hydration + cross-tab sync */
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(USER_ID_STORAGE_KEY);
      if (stored && stored.trim()) setUserId(stored.trim());
    } catch {
      /* private browsing — ignore */
    }
    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== USER_ID_STORAGE_KEY) return;
      const next = ev.newValue?.trim() || null;
      setUserId(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [setUserId]);

  /* warmup + health poll */
  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const h = await backend.getHealth();
        if (cancelled) return;
        setBackendHealth({
          surrealOk: !!h.surreal?.ok,
          composioOk: !!h.composio?.ok,
          checkedAt: Date.now(),
        });
      } catch {
        if (cancelled) return;
        setBackendHealth({
          surrealOk: false,
          composioOk: false,
          checkedAt: Date.now(),
        });
      }
    };
    void backend.warmUp();
    void probe();
    const tid = window.setInterval(probe, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(tid);
    };
  }, [setBackendHealth]);

  /* toolkits discovery — fetch once on mount */
  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      try {
        const tks = await backend.listToolkits();
        if (cancelled) return;
        setToolkits(
          tks.map((t) => ({
            slug: t.slug,
            name: t.name,
            auth_scheme: t.auth_scheme,
            expected_input_fields: t.expected_input_fields,
          })),
        );
      } catch {
        /* swallow — health poll surfaces degraded mode separately */
      }
    };
    void fetch();
    return () => { cancelled = true; };
  }, [setToolkits]);

  /* connections poll — only when userId is set */
  useEffect(() => {
    if (!userId) {
      setConnections([]);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const list = await backend.getConnections(userId);
        if (cancelled) return;
        setConnections(
          list.map((c) => ({ slug: c.toolkit, status: c.status })),
        );
      } catch {
        /* swallow — health poll surfaces degraded mode separately */
      }
    };
    void refresh();
    const tid = window.setInterval(refresh, CONNECTIONS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(tid);
    };
  }, [userId, setConnections]);

  return null;
}
