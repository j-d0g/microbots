"use client";

/**
 * SettingsRoom — minimal scope for the live windowed UI.
 *
 *   1. user_id     — single source of truth for the Composio namespace
 *                    + X-User-Id header. Persisted to localStorage by
 *                    StoreBridge. Required before integrations or graph
 *                    can do anything useful.
 *   2. backend     — read-only health row (surreal + composio status,
 *                    last-checked timestamp + manual refresh).
 *
 * Agent tools registered via `registerTools("settings", ...)`:
 *   - set_user_id({ user_id })
 *   - clear_user_id()
 *   - refresh_health()
 *
 * Everything else from the previous dummy-data SettingsRoom (members,
 * org, schedule, voice, memory, danger zone) was scoped out — the agent
 * doesn't surface those rooms in windowed mode and the seed data was
 * misleading.
 */

import { useCallback, useEffect, useState } from "react";
import { Hairline } from "@/components/primitives/Hairline";
import { Chip } from "@/components/primitives/Chip";
import { RoomStateOverlay } from "@/components/rooms/RoomStateOverlay";
import { useAgentStore } from "@/lib/store";
import { registerTools } from "@/lib/room-tools";
import * as backend from "@/lib/api/backend";
import { cn } from "@/lib/cn";

const USER_ID_RE = /^[a-zA-Z0-9_-]+$/;
const STORAGE_KEY = "microbots:userId";

export function SettingsRoom(_props: { payload?: Record<string, unknown> }) {
  const roomState = useAgentStore((s) => s.roomStates.settings);
  const userId = useAgentStore((s) => s.userId);
  const setUserId = useAgentStore((s) => s.setUserId);
  const backendHealth = useAgentStore((s) => s.backendHealth);
  const setBackendHealth = useAgentStore((s) => s.setBackendHealth);
  const pushCard = useAgentStore((s) => s.pushCard);

  const [draft, setDraft] = useState(userId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);

  // Sync draft if userId changes from elsewhere (e.g. agent set it).
  useEffect(() => {
    setDraft(userId ?? "");
  }, [userId]);

  const persistUserId = useCallback(
    (next: string | null) => {
      setUserId(next);
      try {
        if (next) localStorage.setItem(STORAGE_KEY, next);
        else localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore — private browsing etc. */
      }
    },
    [setUserId],
  );

  const refreshHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const h = await backend.getHealth();
      setBackendHealth({
        surrealOk: !!h.surreal?.ok,
        composioOk: !!h.composio?.ok,
        checkedAt: Date.now(),
      });
    } catch {
      setBackendHealth({
        surrealOk: false,
        composioOk: false,
        checkedAt: Date.now(),
      });
    } finally {
      setHealthLoading(false);
    }
  }, [setBackendHealth]);

  const handleSave = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed.length === 0) {
      setError("user_id can't be empty");
      return;
    }
    if (trimmed.length < 3 || trimmed.length > 64) {
      setError("user_id must be 3–64 characters");
      return;
    }
    if (!USER_ID_RE.test(trimmed)) {
      setError("only letters, digits, _ and - allowed");
      return;
    }
    setError(null);
    setSaving(true);
    persistUserId(trimmed);
    pushCard({
      id: `toast-userid-${Date.now()}`,
      kind: "toast",
      data: { text: `user_id saved as ${trimmed}` },
      ttl: 4500,
    });
    window.setTimeout(() => setSaving(false), 250);
  }, [draft, persistUserId, pushCard]);

  const handleClear = useCallback(() => {
    persistUserId(null);
    setDraft("");
    setError(null);
  }, [persistUserId]);

  /* ---- agent tools ---- */
  useEffect(() => {
    return registerTools("settings", [
      {
        name: "set_user_id",
        description:
          "Persist the Composio namespace key + X-User-Id header for every backend call.",
        args: { user_id: "3–64 chars [a-zA-Z0-9_-]" },
        run: (args) => {
          const next = String(args.user_id ?? "").trim();
          if (!next) return;
          if (next.length < 3 || next.length > 64) return;
          if (!USER_ID_RE.test(next)) return;
          persistUserId(next);
          pushCard({
            id: `toast-userid-${Date.now()}`,
            kind: "toast",
            data: { text: `user_id saved as ${next}` },
            ttl: 4500,
          });
        },
      },
      {
        name: "clear_user_id",
        description: "Wipe the persisted user_id.",
        run: () => {
          persistUserId(null);
        },
      },
      {
        name: "refresh_health",
        description: "Force-refresh /api/health and update the live status row.",
        run: () => {
          void refreshHealth();
        },
      },
    ]);
  }, [persistUserId, pushCard, refreshHealth]);

  /* ---- first-load health probe ---- */
  useEffect(() => {
    if (backendHealth) return;
    void refreshHealth();
    // intentionally one-shot; the StoreBridge polls in the background.
  }, [backendHealth, refreshHealth]);

  const dirty = draft.trim() !== (userId ?? "");
  const checkedLabel = backendHealth
    ? formatRelative(Date.now() - backendHealth.checkedAt)
    : "checking…";
  const surrealOk = backendHealth?.surrealOk ?? null;
  const composioOk = backendHealth?.composioOk ?? null;

  return (
    <RoomStateOverlay room="settings" state={roomState}>
      <div className="@container/settings mx-auto w-full max-w-[640px]">
        <header className="mb-8 @[640px]/settings:mb-12">
          <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
            settings
          </p>
          <h1
            className="mt-2 font-medium leading-[1.05] tracking-tight text-ink-90"
            style={{ fontSize: "clamp(24px, 5.6cqw, 40px)" }}
          >
            identity.
          </h1>
          <p className="mt-2 max-w-[52ch] text-[13px] leading-relaxed text-ink-60">
            set your user_id once. it’s the namespace key for composio and
            the <span className="font-mono text-[12px]">X-User-Id</span> header
            on every backend call. integrations and the graph need it.
          </p>
        </header>

        {/* --- user_id --- */}
        <section
          data-testid="settings-section-user-id"
          className="rounded-md border border-rule bg-paper-1/40 px-5 py-5"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
              user_id
            </h2>
            {userId ? (
              <Chip tone="high">saved</Chip>
            ) : (
              <Chip tone="neutral">unset</Chip>
            )}
          </div>

          <div className="flex flex-col gap-3 @[480px]/settings:flex-row @[480px]/settings:items-center">
            <input
              type="text"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSave();
                }
              }}
              placeholder="e.g. user_42"
              data-testid="settings-user-id-input"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className={cn(
                "min-w-0 flex-1 rounded-sm border bg-paper-0 px-3 py-2",
                "font-mono text-[13px] text-ink-90 outline-none",
                "transition-colors",
                error
                  ? "border-confidence-low/60 focus:border-confidence-low"
                  : "border-rule focus:border-ink-90",
              )}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={!dirty || saving}
                data-testid="settings-user-id-save"
                className={cn(
                  "shrink-0 rounded-sm border px-3 py-2 font-mono text-[11px] uppercase tracking-wider",
                  "transition-colors duration-150",
                  dirty
                    ? "border-ink-90 bg-ink-90 text-paper-0 hover:bg-accent-indigo"
                    : "border-rule text-ink-35",
                  "disabled:opacity-40 disabled:pointer-events-none",
                )}
              >
                {saving ? "saving…" : "save"}
              </button>
              {userId && (
                <button
                  type="button"
                  onClick={handleClear}
                  data-testid="settings-user-id-clear"
                  className={cn(
                    "shrink-0 rounded-sm border border-rule px-3 py-2",
                    "font-mono text-[11px] uppercase tracking-wider text-ink-60",
                    "hover:border-confidence-low/40 hover:text-confidence-low",
                    "transition-colors duration-150",
                  )}
                >
                  clear
                </button>
              )}
            </div>
          </div>
          {error && (
            <p
              data-testid="settings-user-id-error"
              className="mt-2 font-mono text-[11px] text-confidence-low"
            >
              {error}
            </p>
          )}
          <p className="mt-3 font-mono text-[10px] leading-relaxed text-ink-35">
            stored locally · used as namespace for{" "}
            <span className="text-ink-60">/api/composio/*</span> + as{" "}
            <span className="text-ink-60">X-User-Id</span> on every request.
          </p>
        </section>

        <Hairline className="my-10" />

        {/* --- backend health --- */}
        <section
          data-testid="settings-section-backend"
          className="rounded-md border border-rule bg-paper-1/40 px-5 py-5"
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
              backend
            </h2>
            <button
              type="button"
              onClick={refreshHealth}
              disabled={healthLoading}
              data-testid="settings-health-refresh"
              className={cn(
                "rounded-sm border border-rule px-2 py-0.5",
                "font-mono text-[10px] uppercase tracking-wider text-ink-60",
                "transition-colors duration-150 hover:border-ink-90 hover:text-ink-90",
                "disabled:opacity-40 disabled:pointer-events-none",
              )}
            >
              {healthLoading ? "…" : "refresh"}
            </button>
          </div>

          <ul className="grid grid-cols-2 gap-3">
            <HealthRow label="surrealdb" ok={surrealOk} />
            <HealthRow label="composio" ok={composioOk} />
          </ul>

          <p className="mt-4 font-mono text-[10px] leading-relaxed text-ink-35">
            checked {checkedLabel} · base{" "}
            <span className="text-ink-60">{backend.BASE_URL}</span>
          </p>
        </section>
      </div>
    </RoomStateOverlay>
  );
}

function HealthRow({ label, ok }: { label: string; ok: boolean | null }) {
  const tone = ok === null ? "neutral" : ok ? "high" : "low";
  const text = ok === null ? "checking…" : ok ? "ok" : "down";
  return (
    <li
      data-testid={`settings-health-${label}`}
      className={cn(
        "flex items-center justify-between gap-3 rounded-sm border px-3 py-2",
        "border-rule bg-paper-0",
      )}
    >
      <span className="font-mono text-[12px] text-ink-90">{label}</span>
      <Chip
        tone={
          tone === "high" ? "high" : tone === "low" ? "low" : "neutral"
        }
      >
        {text}
      </Chip>
    </li>
  );
}

function formatRelative(deltaMs: number): string {
  if (deltaMs < 5_000) return "just now";
  if (deltaMs < 60_000) return `${Math.floor(deltaMs / 1000)}s ago`;
  if (deltaMs < 3_600_000) return `${Math.floor(deltaMs / 60_000)}m ago`;
  return `${Math.floor(deltaMs / 3_600_000)}h ago`;
}
