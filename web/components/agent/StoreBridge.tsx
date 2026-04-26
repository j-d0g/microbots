"use client";

import { useEffect } from "react";
import { useAgentStore, type WindowKind } from "@/lib/store";
import { registerTools } from "@/lib/room-tools";
import * as backend from "@/lib/api/backend";
import { hydrateChatHistory } from "@/lib/chat-persistence";

/* Every window can be the target of a window-management `ui.tool`
 * event (`pin_window`, `unpin_window`, `toggle_pin`, `send_to_back`)
 * because the orchestrator emits those into `target.kind`. Rather
 * than make every window component duplicate the same handler set,
 * we register a shared meta tool bag for every WindowKind here.
 *
 * Per-window registries can still register their own
 * domain-specific tools — `registerTools` adds entries; it does not
 * replace the bag. */
const META_WINDOW_KINDS: readonly WindowKind[] = [
  "graph",
  "chat",
  "ask_user",
  "settings",
  "profile",
  "integrations",
  "integration_detail",
  "entities",
  "entity_detail",
  "memories",
  "skills",
  "workflows",
  "wiki",
  "chats_summary",
  "composio_connect",
];

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

  /* Meta window-management tools registered for every WindowKind so
   * any centre-staged window can receive `pin_window` / `unpin_window`
   * / `toggle_pin` / `send_to_back` from the orchestrator (those
   * events are dispatched to `target.kind` by `window-management.ts`,
   * which can be any of the ~14 kinds). */
  useEffect(() => {
    const offs = META_WINDOW_KINDS.map((kind) =>
      registerTools(kind, [
        {
          name: "pin_window",
          description: "Pin the targeted window so the stage manager won't demote it.",
          args: { id: "string" },
          run: (args) => {
            const id = typeof args.id === "string" ? args.id : "";
            if (!id) return;
            useAgentStore.getState().pinWindow(id);
          },
        },
        {
          name: "unpin_window",
          description: "Unpin the targeted window.",
          args: { id: "string" },
          run: (args) => {
            const id = typeof args.id === "string" ? args.id : "";
            if (!id) return;
            useAgentStore.getState().unpinWindow(id);
          },
        },
        {
          name: "toggle_pin",
          description: "Flip the pin state of the targeted window.",
          args: { id: "string" },
          run: (args) => {
            const id = typeof args.id === "string" ? args.id : "";
            if (!id) return;
            const w = useAgentStore.getState().windows.find((win) => win.id === id);
            if (!w) return;
            if (w.pinned) {
              useAgentStore.getState().unpinWindow(id);
            } else {
              useAgentStore.getState().pinWindow(id);
            }
          },
        },
        {
          name: "send_to_back",
          description:
            "Demote the targeted window to the lowest z-index in the stack.",
          args: { id: "string" },
          run: (args) => {
            const id = typeof args.id === "string" ? args.id : "";
            if (!id) return;
            const wins = useAgentStore.getState().windows;
            if (!wins.some((w) => w.id === id)) return;
            const minZ = Math.min(0, ...wins.map((w) => w.zIndex)) - 1;
            useAgentStore.setState({
              windows: wins.map((w) =>
                w.id === id ? { ...w, zIndex: minZ } : w,
              ),
            });
          },
        },
      ]),
    );
    return () => offs.forEach((off) => off());
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
