"use client";

/**
 * IntegrationRoom — one window per Composio toolkit slug.
 *
 * Receives `payload: { slug }`. Lifecycle:
 *
 *   1. user_id missing → empty state pointing at settings.
 *   2. status not yet loaded → skeleton.
 *   3. status `ACTIVE` → KG slice (top entities, top memories, top
 *      skills) from /api/kg/integrations/{slug}.
 *   4. status `INITIATED` → "waiting for consent…" + cancel.
 *   5. otherwise → connect button. Pick the right flow based on
 *      `auth_scheme` from the discovered toolkit list:
 *        - OAUTH2 → popup OAuth flow (existing)
 *        - API_KEY → inline form for the user to paste their key
 *
 * Each mounted IntegrationRoom registers room-tools under the shared
 * `kind="integration"` registry. Calls are routed by `args.slug`, so
 * multiple windows can coexist and only the matching one fires.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chip } from "@/components/primitives/Chip";
import { Hairline } from "@/components/primitives/Hairline";
import { RoomStateOverlay } from "@/components/rooms/RoomStateOverlay";
import { useAgentStore, type ConnectionStatus } from "@/lib/store";
import { registerTools } from "@/lib/room-tools";
import * as backend from "@/lib/api/backend";
import { cn } from "@/lib/cn";

const KNOWN_SLUGS: Readonly<Record<string, { name: string; blurb: string }>> = {
  slack: {
    name: "Slack",
    blurb: "Channels, threads, and DMs — the agent reads what people are talking about.",
  },
  github: {
    name: "GitHub",
    blurb: "Repos, PRs, and issues — the agent learns your code review patterns.",
  },
  gmail: {
    name: "Gmail",
    blurb: "Inbox triage, drafts, and threads the agent should know about.",
  },
  linear: {
    name: "Linear",
    blurb: "Tickets, projects, and cycles — the agent watches what you ship.",
  },
  notion: {
    name: "Notion",
    blurb: "Pages and databases — the agent reads decisions and meeting notes.",
  },
  perplexityai: {
    name: "Perplexity",
    blurb: "Research queries and answers the agent can pull from.",
  },
};

const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 60_000;

export function IntegrationRoom({
  payload,
}: {
  payload?: Record<string, unknown>;
}) {
  const slug = (payload?.slug as string | undefined) ?? "";
  const meta = KNOWN_SLUGS[slug] ?? {
    name: slug || "integration",
    blurb: "Composio-managed toolkit.",
  };

  const userId = useAgentStore((s) => s.userId);
  const connections = useAgentStore((s) => s.connections);
  const setConnections = useAgentStore((s) => s.setConnections);
  const toolkits = useAgentStore((s) => s.toolkits);
  const pushCard = useAgentStore((s) => s.pushCard);
  const setRoomState = useAgentStore((s) => s.setRoomState);
  const openWindow = useAgentStore((s) => s.openWindow);

  const status: ConnectionStatus | "not-connected" = useMemo(() => {
    const hit = connections.find((c) => c.slug === slug);
    return hit?.status ?? "not-connected";
  }, [connections, slug]);

  const tkInfo = useMemo(() => toolkits.find((t) => t.slug === slug), [toolkits, slug]);
  const isApiKey = tkInfo?.auth_scheme === "API_KEY";
  const inputFields = tkInfo?.expected_input_fields ?? [];

  const [detail, setDetail] = useState<backend.IntegrationDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // API-key form state
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [keyError, setKeyError] = useState<string | null>(null);

  // Polling controls
  const pollTimerRef = useRef<number | null>(null);

  /* ---------------------------- helpers ---------------------------- */

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const refreshConnections = useCallback(async () => {
    if (!userId) return [];
    try {
      const list = await backend.getConnections(userId);
      setConnections(
        list.map((c) => ({
          slug: c.toolkit,
          status: c.status,
        })),
      );
      return list;
    } catch {
      return [];
    }
  }, [userId, setConnections]);

  const refreshDetail = useCallback(async () => {
    if (!slug || !userId) return;
    try {
      setDetailError(null);
      const d = await backend.getKgIntegration(slug, userId);
      setDetail(d);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "load failed");
      setDetail(null);
    }
  }, [slug, userId]);

  /* ---- connect flows ---- */

  const requireUserId = useCallback(() => {
    if (!userId) {
      pushCard({
        id: `toast-no-user-${Date.now()}`,
        kind: "toast",
        data: { text: "set your user_id in settings first." },
        ttl: 4500,
      });
      openWindow("settings");
      return false;
    }
    return true;
  }, [userId, pushCard, openWindow]);

  const OAUTH_PENDING_KEY = `oauth_pending_${slug}`;

  /** OAuth same-tab flow — for OAUTH2 toolkits. */
  const beginOAuth = useCallback(async () => {
    if (!requireUserId()) return;
    if (pending) return;
    setPending(true);
    setRoomState("settings", "loading");
    try {
      const callback = `${window.location.origin}/oauth/return`;
      const r = await backend.connectToolkit(userId!, slug, callback);
      // Store pending state so we can resume after OAuth return
      sessionStorage.setItem(
        OAUTH_PENDING_KEY,
        JSON.stringify({
          connectionId: r.connection_id,
          startedAt: Date.now(),
          slug,
        })
      );
      // Optimistic mirror — the snapshot agent sees INITIATED right away.
      setConnections([
        ...connections.filter((c) => c.slug !== slug),
        { slug, status: "INITIATED" },
      ]);
      // Navigate to OAuth in same tab
      window.location.href = r.redirect_url;
    } catch (err) {
      setPending(false);
      sessionStorage.removeItem(OAUTH_PENDING_KEY);
      pushCard({
        id: `toast-err-${slug}-${Date.now()}`,
        kind: "toast",
        data: {
          text: `connect failed: ${err instanceof Error ? err.message : "unknown error"}`,
        },
        ttl: 6500,
      });
      setRoomState("settings", "ready");
    }
  }, [
    requireUserId,
    userId,
    pending,
    slug,
    connections,
    setConnections,
    OAUTH_PENDING_KEY,
    pushCard,
    setRoomState,
  ]);

  /** Check for pending OAuth on mount (user returned from OAuth flow) */
  useEffect(() => {
    const pendingRaw = sessionStorage.getItem(OAUTH_PENDING_KEY);
    if (!pendingRaw) return;

    try {
      const pending = JSON.parse(pendingRaw);
      if (pending.slug !== slug) return;

      // Clear the pending state
      sessionStorage.removeItem(OAUTH_PENDING_KEY);

      // Check if we're within timeout window
      const elapsed = Date.now() - pending.startedAt;
      if (elapsed > POLL_TIMEOUT_MS) {
        pushCard({
          id: `toast-timeout-${slug}-${Date.now()}`,
          kind: "toast",
          data: { text: `${meta.name.toLowerCase()} oauth timed out — try again.` },
          ttl: 6000,
        });
        return;
      }

      // Resume polling for ACTIVE status
      setPending(true);
      const checkStatus = async () => {
        const list = await refreshConnections();
        const me = list.find((c) => c.toolkit === slug);

        if (me?.status === "ACTIVE") {
          await refreshDetail();
          pushCard({
            id: `toast-conn-${slug}-${Date.now()}`,
            kind: "toast",
            data: { text: `${meta.name.toLowerCase()} connected.` },
            ttl: 4500,
          });
          setPending(false);
        } else if (me?.status === "FAILED") {
          pushCard({
            id: `toast-fail-${slug}-${Date.now()}`,
            kind: "toast",
            data: { text: `${meta.name.toLowerCase()} connection failed — try again.` },
            ttl: 6000,
          });
          setPending(false);
        } else {
          // Still INITIATED or unknown, poll again
          setTimeout(checkStatus, POLL_INTERVAL_MS);
        }
      };

      // Start polling
      setTimeout(checkStatus, 1000); // Small delay to let backend propagate
    } catch {
      sessionStorage.removeItem(OAUTH_PENDING_KEY);
    }
  }, [slug, OAUTH_PENDING_KEY, refreshConnections, refreshDetail, pushCard, meta.name]);

  /** API-key flow — for API_KEY toolkits. */
  const submitApiKey = useCallback(async () => {
    if (!requireUserId()) return;
    if (pending) return;

    // Validate all required fields are filled.
    const missing = inputFields
      .filter((f) => f.required && !fieldValues[f.name]?.trim());
    if (missing.length > 0) {
      setKeyError(`${missing.map((f) => f.display_name || f.name).join(", ")} required.`);
      return;
    }

    setPending(true);
    setKeyError(null);
    setRoomState("settings", "loading");
    try {
      const r = await backend.connectToolkitKey(userId!, slug, fieldValues);
      // Refresh connections to confirm ACTIVE.
      await refreshConnections();
      await refreshDetail();
      pushCard({
        id: `toast-conn-${slug}-${Date.now()}`,
        kind: "toast",
        data: { text: `${meta.name.toLowerCase()} connected.` },
        ttl: 4500,
      });
    } catch (err) {
      pushCard({
        id: `toast-err-${slug}-${Date.now()}`,
        kind: "toast",
        data: {
          text: `connect failed: ${err instanceof Error ? err.message : "unknown error"}`,
        },
        ttl: 6500,
      });
    } finally {
      setPending(false);
      setRoomState("settings", "ready");
    }
  }, [
    requireUserId,
    userId,
    pending,
    slug,
    fieldValues,
    inputFields,
    refreshConnections,
    refreshDetail,
    pushCard,
    meta.name,
    setRoomState,
  ]);

  const cancelConnect = useCallback(() => {
    stopPolling();
    sessionStorage.removeItem(OAUTH_PENDING_KEY);
    setPending(false);
  }, [stopPolling, OAUTH_PENDING_KEY]);

  /* ---------------------------- effects ---------------------------- */

  // Initial: refresh connections + KG slice when user_id present.
  useEffect(() => {
    if (!userId || !slug) return;
    void refreshConnections();
  }, [userId, slug, refreshConnections]);

  useEffect(() => {
    if (status === "ACTIVE" && !detail) void refreshDetail();
  }, [status, detail, refreshDetail]);

  // Cleanup polling on unmount.
  useEffect(() => stopPolling, [stopPolling]);

  /* ---------------------------- agent tools ---------------------------- */

  useEffect(() => {
    if (!slug) return;
    return registerTools("integration", [
      {
        name: "connect",
        description:
          "Kick off the connect flow for this integration window. For OAuth toolkits navigates to auth in same tab; for API-key toolkits the user must enter their key in the form. No-op when called for a different slug than this window.",
        args: { slug: "toolkit slug" },
        run: (args) => {
          if ((args.slug as string | undefined) !== slug) return;
          if (isApiKey) return; // user must fill the form manually
          void beginOAuth();
        },
      },
      {
        name: "refresh",
        description:
          "Refetch composio status + KG slice for this integration window.",
        args: { slug: "toolkit slug" },
        run: async (args) => {
          if ((args.slug as string | undefined) !== slug) return;
          await refreshConnections();
          await refreshDetail();
        },
      },
      {
        name: "cancel",
        description: "Abort an in-flight oauth attempt for this window.",
        args: { slug: "toolkit slug" },
        run: (args) => {
          if ((args.slug as string | undefined) !== slug) return;
          cancelConnect();
        },
      },
    ]);
  }, [slug, isApiKey, beginOAuth, refreshConnections, refreshDetail, cancelConnect]);

  /* ---------------------------- render ---------------------------- */

  const noUserId = !userId;

  return (
    <RoomStateOverlay room="settings" state={undefined}>
      <div className="@container/integration mx-auto flex w-full max-w-[560px] flex-col gap-5 py-1">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
              integration · {slug || "?"}
            </p>
            <h1
              className="mt-1 truncate font-medium leading-tight tracking-tight text-ink-90"
              style={{ fontSize: "clamp(20px, 4cqw, 28px)" }}
            >
              {meta.name}
            </h1>
            <p className="mt-1 max-w-[42ch] text-[12px] leading-relaxed text-ink-60">
              {meta.blurb}
            </p>
          </div>
          <StatusChip status={status} pending={pending} />
        </header>

        <Hairline />

        {noUserId ? (
          <NoUserIdState onOpenSettings={() => openWindow("settings")} />
        ) : status === "ACTIVE" ? (
          <ActiveState
            detail={detail}
            error={detailError}
            onRefresh={refreshDetail}
          />
        ) : isApiKey ? (
          <ApiKeyConnectState
            slug={slug}
            name={meta.name}
            status={status}
            pending={pending}
            fields={inputFields}
            fieldValues={fieldValues}
            setFieldValues={setFieldValues}
            error={keyError}
            onSubmit={submitApiKey}
            onCancel={cancelConnect}
          />
        ) : (
          <OAuthConnectState
            slug={slug}
            name={meta.name}
            status={status}
            pending={pending}
            onConnect={beginOAuth}
            onCancel={cancelConnect}
          />
        )}
      </div>
    </RoomStateOverlay>
  );
}

/* ----------------------------- pieces ----------------------------- */

function StatusChip({
  status,
  pending,
}: {
  status: ConnectionStatus | "not-connected";
  pending: boolean;
}) {
  if (pending) return <Chip tone="accent">connecting…</Chip>;
  switch (status) {
    case "ACTIVE":
      return <Chip tone="high">active</Chip>;
    case "INITIATED":
      return <Chip tone="accent">awaiting consent</Chip>;
    case "EXPIRED":
      return <Chip tone="med">expired</Chip>;
    case "FAILED":
      return <Chip tone="low">failed</Chip>;
    default:
      return <Chip tone="neutral">not connected</Chip>;
  }
}

function NoUserIdState({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div
      data-testid="integration-no-user"
      className="rounded-md border border-rule bg-paper-1/40 px-5 py-6 text-center"
    >
      <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
        not yet
      </p>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-90">
        set your <span className="font-mono text-[12px]">user_id</span> in
        settings first.
      </p>
      <button
        type="button"
        onClick={onOpenSettings}
        data-testid="integration-open-settings"
        className={cn(
          "mt-4 inline-flex items-center rounded-sm border border-ink-90 bg-ink-90 px-3 py-1.5",
          "font-mono text-[11px] uppercase tracking-wider text-paper-0",
          "transition-colors duration-150 hover:bg-accent-indigo",
        )}
      >
        open settings →
      </button>
    </div>
  );
}

function OAuthConnectState({
  slug,
  name,
  status,
  pending,
  onConnect,
  onCancel,
}: {
  slug: string;
  name: string;
  status: ConnectionStatus | "not-connected";
  pending: boolean;
  onConnect: () => void;
  onCancel: () => void;
}) {
  const isReconnect = status === "EXPIRED" || status === "FAILED";
  const isInitiated = status === "INITIATED" || pending;

  return (
    <section className="rounded-md border border-rule bg-paper-1/40 px-5 py-6">
      {isInitiated ? (
        <div data-testid={`integration-${slug}-initiated`}>
          <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
            awaiting consent
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-90">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent-indigo align-middle breathing" />
            complete authentication on composio. you'll return here automatically.
          </p>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={onConnect}
              data-testid={`integration-${slug}-retry`}
              className={cn(
                "inline-flex items-center rounded-sm border border-ink-90 bg-ink-90 px-3 py-1.5",
                "font-mono text-[11px] uppercase tracking-wider text-paper-0",
                "transition-colors duration-150 hover:bg-accent-indigo",
              )}
            >
              try again
            </button>
            <button
              type="button"
              onClick={onCancel}
              data-testid={`integration-${slug}-cancel`}
              className={cn(
                "inline-flex items-center rounded-sm border border-rule px-3 py-1.5",
                "font-mono text-[11px] uppercase tracking-wider text-ink-60",
                "hover:border-ink-90 hover:text-ink-90 transition-colors duration-150",
              )}
            >
              cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
            {isReconnect ? "reconnect" : "connect"}
          </p>
          <p className="mt-2 max-w-[44ch] text-[13px] leading-relaxed text-ink-60">
            you'll be redirected to composio to authorize access, then return here.
          </p>
          <button
            type="button"
            onClick={onConnect}
            data-testid={`integration-${slug}-connect`}
            className={cn(
              "mt-4 inline-flex items-center rounded-sm border border-ink-90 bg-ink-90 px-3 py-1.5",
              "font-mono text-[11px] uppercase tracking-wider text-paper-0",
              "transition-colors duration-150 hover:bg-accent-indigo",
            )}
          >
            {isReconnect ? `reconnect ${name.toLowerCase()}` : `connect ${name.toLowerCase()}`}
          </button>
        </>
      )}
    </section>
  );
}

function ApiKeyConnectState({
  slug,
  name,
  status,
  pending,
  fields,
  fieldValues,
  setFieldValues,
  error,
  onSubmit,
  onCancel,
}: {
  slug: string;
  name: string;
  status: ConnectionStatus | "not-connected";
  pending: boolean;
  fields: { name: string; display_name: string; description: string; type: string; required: boolean }[];
  fieldValues: Record<string, string>;
  setFieldValues: (v: Record<string, string>) => void;
  error: string | null;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const isReconnect = status === "EXPIRED" || status === "FAILED";

  return (
    <section className="rounded-md border border-rule bg-paper-1/40 px-5 py-6">
      <p className="font-mono text-[11px] uppercase tracking-wider text-ink-35">
        {isReconnect ? "reconnect" : "connect"}
      </p>
      <p className="mt-2 max-w-[44ch] text-[13px] leading-relaxed text-ink-60">
        {name} requires an API key. Paste it below and we'll store it securely.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {fields.map((f) => (
          <label key={f.name} className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-35">
              {f.display_name || f.name}
              {f.required && <span className="text-accent-indigo ml-0.5">*</span>}
            </span>
            <input
              type={f.type === "password" ? "password" : "text"}
              placeholder={f.description || f.display_name || f.name}
              value={fieldValues[f.name] ?? ""}
              onChange={(e) =>
                setFieldValues({ ...fieldValues, [f.name]: e.target.value })
              }
              disabled={pending}
              data-testid={`integration-${slug}-field-${f.name}`}
              className={cn(
                "rounded-sm border border-rule bg-paper-0 px-2.5 py-1.5",
                "font-mono text-[12px] text-ink-90 placeholder:text-ink-35",
                "focus:border-accent-indigo focus:outline-none",
                "transition-colors duration-150",
              )}
            />
          </label>
        ))}
      </div>

      {error && (
        <p className="mt-2 font-mono text-[11px] text-confidence-low">{error}</p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={onSubmit}
          disabled={pending}
          data-testid={`integration-${slug}-connect-key`}
          className={cn(
            "inline-flex items-center rounded-sm border border-ink-90 bg-ink-90 px-3 py-1.5",
            "font-mono text-[11px] uppercase tracking-wider text-paper-0",
            "transition-colors duration-150 hover:bg-accent-indigo",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {pending ? "connecting…" : isReconnect ? `reconnect ${name.toLowerCase()}` : `connect ${name.toLowerCase()}`}
        </button>
        {pending && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center rounded-sm border border-rule px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-ink-60 hover:border-ink-90 hover:text-ink-90 transition-colors duration-150"
          >
            cancel
          </button>
        )}
      </div>
    </section>
  );
}

function ActiveState({
  detail,
  error,
  onRefresh,
}: {
  detail: backend.IntegrationDetail | null;
  error: string | null;
  onRefresh: () => void;
}) {
  if (error) {
    return (
      <section
        data-testid="integration-active-error"
        className="rounded-md border border-confidence-low/30 bg-confidence-low/5 px-5 py-5"
      >
        <p className="font-mono text-[11px] uppercase tracking-wider text-confidence-low">
          load failed
        </p>
        <p className="mt-2 text-[13px] text-ink-90">{error}</p>
        <button
          type="button"
          onClick={onRefresh}
          className="mt-3 inline-flex items-center rounded-sm border border-rule px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-ink-60 hover:border-ink-90 hover:text-ink-90 transition-colors"
        >
          retry
        </button>
      </section>
    );
  }
  if (!detail) {
    return (
      <section className="rounded-md border border-rule bg-paper-1/40 px-5 py-6 font-mono text-[11px] text-ink-35">
        loading slice…
      </section>
    );
  }

  const entities = detail.entities ?? [];
  const memories = detail.top_memories ?? [];
  const skills = detail.skills ?? [];

  return (
    <section className="flex flex-col gap-4" data-testid="integration-active">
      <SliceList
        title="entities"
        empty="no entities yet"
        items={entities.slice(0, 3).map((e) => ({
          key: e.id,
          primary: e.name,
          secondary: e.entity_type,
        }))}
      />
      <SliceList
        title="top memories"
        empty="no memories yet"
        items={memories.slice(0, 3).map((m) => ({
          key: m.id,
          primary: m.content,
          secondary: `${m.memory_type} · ${m.confidence.toFixed(2)}`,
        }))}
      />
      <SliceList
        title="skills"
        empty="no skills yet"
        items={skills.slice(0, 3).map((s) => ({
          key: s.id,
          primary: s.name,
          secondary: `strength ${s.strength}`,
        }))}
      />
      <button
        type="button"
        onClick={onRefresh}
        className="self-start font-mono text-[10px] uppercase tracking-wider text-ink-35 hover:text-ink-90 transition-colors"
      >
        refresh slice
      </button>
    </section>
  );
}

function SliceList({
  title,
  items,
  empty,
}: {
  title: string;
  items: Array<{ key: string; primary: string; secondary?: string }>;
  empty: string;
}) {
  return (
    <div className="rounded-md border border-rule bg-paper-1/40 px-4 py-3">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-35">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="font-mono text-[11px] text-ink-35">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((it) => (
            <li key={it.key} className="flex items-start justify-between gap-3">
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink-90">
                {it.primary}
              </span>
              {it.secondary && (
                <span className="shrink-0 font-mono text-[10px] text-ink-35">
                  {it.secondary}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
