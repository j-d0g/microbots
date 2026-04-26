"use client";

/**
 * chats_summary window — heatmap of chat counts grouped by integration
 * × signal_level.
 *
 * Backed by `GET /api/kg/chats/summary`. No write surface.
 */

import { useCallback, useEffect, useMemo } from "react";
import { useAgentStore } from "@/lib/store";
import { useKgResource } from "@/lib/use-kg-resource";
import {
  getChatsSummary,
  type ChatSummaryRow,
} from "@/lib/kg-client";
import { registerTools } from "@/lib/room-tools";
import { KgShell, KgHeader } from "./kg-shell";
import { cn } from "@/lib/cn";

const LEVELS = ["low", "mid", "high"] as const;
type Level = (typeof LEVELS)[number];

export function ChatsSummaryWindow({
  payload,
}: {
  payload?: Record<string, unknown>;
}) {
  const userId = useAgentStore((s) => s.userId);
  const seed = (payload?.rows as ChatSummaryRow[] | undefined) ?? null;

  const fetcher = useCallback(
    (signal: AbortSignal) => getChatsSummary(userId, signal),
    [userId],
  );
  const { data, loading, error, refetch } = useKgResource(fetcher, seed);
  const rows = data ?? [];
  const openWindow = useAgentStore((s) => s.openWindow);
  const setChatRoom = useAgentStore((s) => s.setChatRoom);

  /* Register UI handlers for the orchestrator's `chats_summary_*`
   * tools. `focus_chat` opens the chat window with the requested
   * id; `set_query` is forwarded to the chat window via the same
   * payload mechanism. */
  useEffect(() => {
    return registerTools("chats_summary", [
      {
        name: "focus_chat",
        description:
          "Open the chat window focused on the given chat_id (defers query to chat room).",
        args: { chat_id: "string" },
        run: (args) => {
          const id = typeof args.chat_id === "string" ? args.chat_id : "";
          openWindow("chat", id ? { payload: { chat_id: id } } : undefined);
          setChatRoom("chat");
        },
      },
      {
        name: "set_query",
        description:
          "Forward the search query to the chat window via payload; opens chat if needed.",
        args: { query: "string" },
        run: (args) => {
          const query = typeof args.query === "string" ? args.query : "";
          openWindow("chat", query ? { payload: { query } } : undefined);
          setChatRoom("chat");
        },
      },
    ]);
  }, [openWindow, setChatRoom]);

  const { integrations, max, lookup, total } = useMemo(() => {
    const set = new Set<string>();
    const map = new Map<string, number>();
    let mx = 0;
    let tot = 0;
    for (const r of rows) {
      set.add(r.integration);
      const key = `${r.integration}|${r.signal_level}`;
      map.set(key, r.count);
      mx = Math.max(mx, r.count);
      tot += r.count;
    }
    return {
      integrations: [...set].sort(),
      max: mx,
      lookup: map,
      total: tot,
    };
  }, [rows]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <KgHeader
        label="chats · signal heatmap"
        right={
          <span className="font-mono text-[10px] text-ink-35">
            {total} signals
          </span>
        }
      />
      <div className="muji-scroll flex-1 min-h-0 overflow-y-auto p-3">
        <KgShell
          loading={loading}
          error={error}
          empty={rows.length === 0}
          emptyHint="no chat signal recorded yet."
          onRetry={refetch}
        >
          <div className="grid grid-cols-[120px_repeat(3,1fr)] items-stretch gap-1">
            <div />
            {LEVELS.map((l) => (
              <div
                key={l}
                className="px-2 py-1 text-center font-mono text-[9px] uppercase tracking-wider text-ink-35"
              >
                {l}
              </div>
            ))}
            {integrations.map((slug) => (
              <Row
                key={slug}
                slug={slug}
                lookup={lookup}
                max={max}
              />
            ))}
          </div>
        </KgShell>
      </div>
    </div>
  );
}

function Row({
  slug,
  lookup,
  max,
}: {
  slug: string;
  lookup: Map<string, number>;
  max: number;
}) {
  return (
    <>
      <div className="flex items-center px-2 font-mono text-[11px] text-ink-90">
        {slug}
      </div>
      {LEVELS.map((l) => {
        const count = lookup.get(`${slug}|${l}`) ?? 0;
        const intensity = max > 0 ? count / max : 0;
        return (
          <div
            key={l}
            className={cn(
              "flex h-10 items-center justify-center rounded font-mono text-[11px]",
              count === 0 ? "bg-paper-2/40 text-ink-35" : "text-white",
            )}
            style={{
              backgroundColor:
                count === 0
                  ? undefined
                  : `rgba(46, 58, 140, ${0.2 + intensity * 0.8})`,
            }}
            title={`${slug} · ${l} · ${count}`}
          >
            {count}
          </div>
        );
      })}
    </>
  );
}
