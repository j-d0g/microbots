"use client";

import { useEffect } from "react";
import { useAgentStore } from "@/lib/store";
import * as backend from "@/lib/api/backend";
import { hydrateChatHistory } from "@/lib/chat-persistence";

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
 *  - Fires a one-shot `warmUp()` on mount so the local API is ready
 *    before the user touches anything.
 *  - Polls /api/health every 30 s so the snapshot agent + settings
 *    badge always reflect live degraded mode.
 *  - Polls /api/composio/connections every 30 s while configured,
 *    so integration windows show fresh status without per-window polls.
 */
export function StoreBridge() {
  const userId = useAgentStore((s) => s.userId);
  const backendHealth = useAgentStore((s) => s.backendHealth);
  const setUserId = useAgentStore((s) => s.setUserId);
  const setBackendHealth = useAgentStore((s) => s.setBackendHealth);
  const setConnections = useAgentStore((s) => s.setConnections);
  const setToolkits = useAgentStore((s) => s.setToolkits);
  const composioConfigured = backendHealth?.composioConfigured ?? false;

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
      const userId = stored?.trim() || "default";
      if (stored !== userId) localStorage.setItem(USER_ID_STORAGE_KEY, userId);
      setUserId(userId);
    } catch {
      /* private browsing — ignore */
    }
    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== USER_ID_STORAGE_KEY) return;
      const next = ev.newValue?.trim() || "default";
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
          apiOk: true,
          surrealOk: !!h.surreal?.ok,
          composioOk: !!h.composio?.ok,
          composioConfigured: !!h.composio?.configured,
          checkedAt: Date.now(),
        });
      } catch {
        if (cancelled) return;
        setBackendHealth({
          apiOk: false,
          surrealOk: false,
          composioOk: false,
          composioConfigured: false,
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
      if (!composioConfigured) {
        setToolkits([]);
        return;
      }
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
  }, [composioConfigured, setToolkits]);

  /* chat history hydration — once on mount (or when userId changes) */
  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      try {
        const msgs = await hydrateChatHistory(userId, 50);
        if (cancelled) return;
        // Only hydrate if the store is still empty (don't overwrite an
        // active conversation).
        const current = useAgentStore.getState().chatMessages;
        if (current.length === 0 && msgs.length > 0) {
          useAgentStore.setState({ chatMessages: msgs });
        }
      } catch {
        /* swallow — health poll surfaces degraded mode separately */
      }
    };
    void hydrate();
    return () => { cancelled = true; };
  }, [userId]);

  /* connections poll — only when userId is set */
  useEffect(() => {
    if (!userId || !composioConfigured) {
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
  }, [userId, composioConfigured, setConnections]);

  return null;
}
