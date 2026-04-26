"use client";

/**
 * Composio Connect window — integration management UI.
 *
 * Lists all available toolkits (slack, github, gmail, linear, notion, perplexity)
 * with their connection status. Supports OAuth popup flow for OAuth2 toolkits
 * and API-key forms for key-based auth (e.g., Perplexity).
 *
 * Backed by store.connections and store.toolkits, hydrated by StoreBridge.
 * OAuth callbacks handled via postMessage from /oauth/return page.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgentStore } from "@/lib/store";
import type { ConnectionStatus } from "@/lib/api/backend";
import { KgShell, KgHeader } from "./kg-shell";
import * as backend from "@/lib/api/backend";
import { cn } from "@/lib/cn";
import { RefreshCw, Link2, KeyRound, Loader2, CheckCircle2, Plug } from "lucide-react";

const POLL_MS = 3_000;

const STATUS_COLORS: Record<ConnectionStatus, string> = {
  ACTIVE: "bg-confidence-high",
  INITIATED: "bg-yellow-400",
  EXPIRED: "bg-confidence-low",
  FAILED: "bg-confidence-low",
};

const STATUS_LABELS: Record<ConnectionStatus, string> = {
  ACTIVE: "connected",
  INITIATED: "connecting…",
  EXPIRED: "expired",
  FAILED: "failed",
};

const TOOLKIT_DISPLAY_NAMES: Record<string, string> = {
  slack: "Slack",
  github: "GitHub",
  gmail: "Gmail",
  linear: "Linear",
  notion: "Notion",
  perplexityai: "Perplexity",
};

const TOOLKIT_ICONS: Record<string, string> = {
  slack: "🔷",
  github: "⚙️",
  gmail: "✉️",
  linear: "📋",
  notion: "📝",
  perplexityai: "🔍",
};

export function ComposioConnectWindow({
  payload: _payload,
}: {
  payload?: Record<string, unknown>;
}) {
  const userId = useAgentStore((s) => s.userId);
  const connections = useAgentStore((s) => s.connections);
  const setConnections = useAgentStore((s) => s.setConnections);
  const toolkits = useAgentStore((s) => s.toolkits);
  const setToolkits = useAgentStore((s) => s.setToolkits);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<backend.BackendError | null>(null);
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null);
  const [keyForms, setKeyForms] = useState<Record<string, Record<string, string>>>({});
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);

  const statusMap = useMemo(() => {
    const map = new Map<string, ConnectionStatus>();
    for (const c of connections) map.set(c.slug, c.status);
    return map;
  }, [connections]);

  const fetchToolkits = useCallback(async () => {
    if (toolkits.length > 0) return;
    try {
      const tks = await backend.listToolkits();
      setToolkits(
        tks.map((t) => ({
          slug: t.slug,
          name: t.name,
          auth_scheme: t.auth_scheme,
          expected_input_fields: t.expected_input_fields,
        })),
      );
    } catch {
      /* swallow — StoreBridge already polls this */
    }
  }, [toolkits.length, setToolkits]);

  const pollConnections = useCallback(async () => {
    if (!userId) {
      setConnections([]);
      return;
    }
    setLoading(true);
    try {
      const list = await backend.getConnections(userId);
      setConnections(list.map((c) => ({ slug: c.toolkit, status: c.status })));
      setError(null);
    } catch (e) {
      setError(
        e instanceof backend.BackendError
          ? e
          : new backend.BackendError("fetch failed", 0),
      );
    } finally {
      setLoading(false);
    }
  }, [userId, setConnections]);

  // Initial load
  useEffect(() => {
    void fetchToolkits();
    void pollConnections();
  }, [fetchToolkits, pollConnections]);

  // Fast poll while a connection is in progress
  useEffect(() => {
    if (!userId || !connectingSlug) return;
    const tid = window.setInterval(() => void pollConnections(), POLL_MS);
    return () => window.clearInterval(tid);
  }, [userId, connectingSlug, pollConnections]);

  // Listen for postMessage from /oauth/return popup
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      if (ev.data?.kind === "composio-oauth") {
        void pollConnections();
        setConnectingSlug(null);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [pollConnections]);

  const handleConnect = async (slug: string) => {
    if (!userId) {
      setError(new backend.BackendError("Set user_id in settings first", 400));
      return;
    }
    setConnectingSlug(slug);
    try {
      const callbackUrl = `${window.location.origin}/oauth/return`;
      const res = await backend.connectToolkit(userId, slug, callbackUrl);
      if (res.redirect_url) {
        window.open(res.redirect_url, "_blank", "width=600,height=700,noopener");
      }
    } catch (e) {
      setError(
        e instanceof backend.BackendError
          ? e
          : new backend.BackendError("connect failed", 0),
      );
      setConnectingSlug(null);
    }
  };

  const handleKeySubmit = async (slug: string) => {
    if (!userId) return;
    const values = keyForms[slug] ?? {};
    const toolkit = toolkits.find((t) => t.slug === slug);
    if (!toolkit) return;

    const required = toolkit.expected_input_fields.filter((f) => f.required);
    for (const field of required) {
      if (!values[field.name]?.trim()) {
        setError(new backend.BackendError(`${field.display_name} is required`, 400));
        return;
      }
    }

    setSubmittingKey(slug);
    try {
      await backend.connectToolkitKey(userId, slug, values);
      setKeyForms((prev) => ({ ...prev, [slug]: {} }));
      await pollConnections();
    } catch (e) {
      setError(
        e instanceof backend.BackendError
          ? e
          : new backend.BackendError("key auth failed", 0),
      );
    } finally {
      setSubmittingKey(null);
    }
  };

  const orderedToolkits = useMemo(() => {
    const order = ["slack", "github", "gmail", "linear", "notion", "perplexityai"];
    const result: typeof toolkits = [];
    for (const slug of order) {
      const tk = toolkits.find((t) => t.slug === slug);
      if (tk) result.push(tk);
    }
    for (const tk of toolkits) {
      if (!order.includes(tk.slug)) result.push(tk);
    }
    return result;
  }, [toolkits]);

  const activeCount = connections.filter((c) => c.status === "ACTIVE").length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <KgHeader
        label="connect integrations"
        right={
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-ink-35">
              {activeCount}/{orderedToolkits.length} active
            </span>
            <button
              type="button"
              onClick={() => void pollConnections()}
              disabled={loading}
              className={cn(
                "flex items-center gap-1 rounded border border-rule/50 px-2 py-0.5 font-mono text-[10px] text-ink-60 transition-colors hover:border-ink-60 hover:text-ink-90 disabled:opacity-40",
              )}
            >
              <RefreshCw size={10} className={cn(loading && "animate-spin")} />
              refresh
            </button>
          </div>
        }
      />

      <div className="muji-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {!userId ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <Plug size={18} strokeWidth={1.25} className="text-ink-35" />
            <p className="max-w-[280px] font-mono text-[12px] text-ink-60">
              set a user_id in settings to connect integrations.
            </p>
          </div>
        ) : (
          <KgShell
            loading={loading && toolkits.length === 0}
            error={error}
            empty={orderedToolkits.length === 0}
            emptyHint="No toolkits available. Check backend health."
            onRetry={pollConnections}
          >
            <div className="space-y-2">
              {orderedToolkits.map((tk) => {
                const status = statusMap.get(tk.slug);
                const isOAuth = tk.auth_scheme === "OAUTH2";
                const isApiKey = tk.auth_scheme === "API_KEY";
                const displayName = TOOLKIT_DISPLAY_NAMES[tk.slug] ?? tk.name ?? tk.slug;
                const icon = TOOLKIT_ICONS[tk.slug] ?? "🔧";

                return (
                  <div
                    key={tk.slug}
                    className={cn(
                      "rounded border p-3 transition-colors",
                      status === "ACTIVE"
                        ? "border-confidence-high/30 bg-confidence-high/5"
                        : "border-rule/50 bg-paper-2/30 hover:border-accent-indigo/30",
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="text-base" aria-hidden>
                          {icon}
                        </span>
                        <div>
                          <p className="font-mono text-[12px] text-ink-90">
                            {displayName}
                          </p>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            {status ? (
                              <>
                                <span
                                  className={cn(
                                    "h-1.5 w-1.5 rounded-full",
                                    STATUS_COLORS[status],
                                  )}
                                />
                                <span
                                  className={cn(
                                    "font-mono text-[9px] uppercase tracking-wider",
                                    status === "ACTIVE"
                                      ? "text-confidence-high"
                                      : status === "INITIATED"
                                        ? "text-yellow-500"
                                        : "text-confidence-low",
                                  )}
                                >
                                  {STATUS_LABELS[status]}
                                </span>
                              </>
                            ) : (
                              <span className="font-mono text-[9px] uppercase tracking-wider text-ink-35">
                                not connected
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {isOAuth && (
                        <OAuthButton
                          status={status}
                          connecting={connectingSlug === tk.slug}
                          onConnect={() => void handleConnect(tk.slug)}
                        />
                      )}
                    </div>

                    {/* API key form */}
                    {isApiKey &&
                      tk.expected_input_fields.length > 0 &&
                      status !== "ACTIVE" && (
                        <div className="mt-3 space-y-2 border-t border-rule/30 pt-3">
                          <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-35">
                            <KeyRound size={10} />
                            api key required
                          </div>
                          <div className="grid gap-2">
                            {tk.expected_input_fields.map((field) => (
                              <div key={field.name} className="flex flex-col gap-1">
                                <label className="font-mono text-[9px] uppercase tracking-wider text-ink-60">
                                  {field.display_name}
                                  {field.required && (
                                    <span className="text-confidence-low">*</span>
                                  )}
                                </label>
                                <input
                                  type={
                                    field.name.toLowerCase().includes("key") ||
                                    field.name.toLowerCase().includes("secret") ||
                                    field.name.toLowerCase().includes("token")
                                      ? "password"
                                      : "text"
                                  }
                                  value={keyForms[tk.slug]?.[field.name] ?? ""}
                                  onChange={(e) =>
                                    setKeyForms((prev) => ({
                                      ...prev,
                                      [tk.slug]: {
                                        ...(prev[tk.slug] ?? {}),
                                        [field.name]: e.target.value,
                                      },
                                    }))
                                  }
                                  placeholder={field.description}
                                  className="w-full rounded border border-rule/50 bg-paper-0 px-2 py-1.5 font-mono text-[11px] text-ink-90 placeholder:text-ink-35 focus:border-accent-indigo/50 focus:outline-none"
                                />
                              </div>
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleKeySubmit(tk.slug)}
                            disabled={submittingKey === tk.slug}
                            className="mt-1 flex w-full items-center justify-center gap-1.5 rounded bg-accent-indigo px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-white transition-colors hover:bg-accent-indigo/90 disabled:opacity-40"
                          >
                            {submittingKey === tk.slug ? (
                              <>
                                <Loader2 size={10} className="animate-spin" />
                                connecting…
                              </>
                            ) : (
                              <>
                                <CheckCircle2 size={10} />
                                connect
                              </>
                            )}
                          </button>
                        </div>
                      )}
                  </div>
                );
              })}
            </div>
          </KgShell>
        )}
      </div>
    </div>
  );
}

function OAuthButton({
  status,
  connecting,
  onConnect,
}: {
  status: ConnectionStatus | undefined;
  connecting: boolean;
  onConnect: () => void;
}) {
  if (status === "ACTIVE") {
    return (
      <div className="flex items-center gap-1.5 rounded bg-confidence-high/10 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-confidence-high">
        <CheckCircle2 size={11} />
        active
      </div>
    );
  }

  if (status === "INITIATED" || connecting) {
    return (
      <button
        type="button"
        disabled
        className="flex items-center gap-1.5 rounded bg-paper-2 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-ink-35"
      >
        <Loader2 size={11} className="animate-spin" />
        connecting…
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onConnect}
      className="flex items-center gap-1.5 rounded border border-accent-indigo px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-accent-indigo transition-colors hover:bg-accent-indigo hover:text-white"
    >
      <Link2 size={11} />
      connect
    </button>
  );
}
