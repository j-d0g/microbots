"use client";

/**
 * memories window — sortable list of `Memory[]` with confidence bars.
 *
 * Backed by `GET /api/kg/memories?by=&limit=`. Quick-add form posts
 * to `POST /api/kg/memories` with optional chat / entity / integration
 * binding fields.
 */

import { useCallback, useState } from "react";
import { useAgentStore } from "@/lib/store";
import { useKgResource } from "@/lib/use-kg-resource";
import {
  addMemory,
  getMemories,
  type Memory,
} from "@/lib/kg-client";
import { KgShell, KgHeader } from "./kg-shell";
import { cn } from "@/lib/cn";

export function MemoriesWindow({
  payload,
}: {
  payload?: Record<string, unknown>;
}) {
  const userId = useAgentStore((s) => s.userId);

  const [by, setBy] = useState<"confidence" | "recency">(
    (payload?.by as "confidence" | "recency") ?? "confidence",
  );
  const [limit, setLimit] = useState<number>(
    (payload?.limit as number) ?? 20,
  );

  const seed = (payload?.memories as Memory[] | undefined) ?? null;
  const fetcher = useCallback(
    (signal: AbortSignal) => getMemories({ by, limit }, userId, signal),
    [by, limit, userId],
  );
  const { data, loading, error, refetch } = useKgResource(fetcher, seed);

  const list = data ?? [];
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <KgHeader
        label="memories"
        right={
          <span className="font-mono text-[10px] text-ink-35">
            {list.length} · by {by}
          </span>
        }
      />

      <div className="flex shrink-0 items-center gap-2 border-b border-rule/40 px-3 py-2">
        <div className="flex gap-1">
          {(["confidence", "recency"] as const).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => setBy(b)}
              className={cn(
                "rounded px-2 py-1 font-mono text-[10px] transition-colors",
                by === b
                  ? "bg-accent-indigo text-white"
                  : "bg-paper-2 text-ink-60 hover:text-ink-90",
              )}
            >
              {b}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-ink-35">limit</span>
          <input
            type="number"
            min={1}
            max={200}
            value={limit}
            onChange={(e) =>
              setLimit(
                Math.max(1, Math.min(200, Number(e.target.value) || 20)),
              )
            }
            className="w-14 rounded border border-rule/50 bg-paper-2/40 px-1.5 py-0.5 font-mono text-[10px] text-ink-90 focus:border-accent-indigo/50 focus:outline-none"
          />
        </div>
      </div>

      <div className="muji-scroll flex-1 min-h-0 overflow-y-auto p-3">
        <KgShell
          loading={loading}
          error={error}
          empty={list.length === 0}
          emptyHint="memories appear as the agent learns about you."
          onRetry={refetch}
        >
          <ul className="space-y-2">
            {list.map((m) => (
              <li
                key={m.id}
                className="rounded border border-rule/50 bg-paper-2/30 p-2.5"
              >
                <p className="font-mono text-[12px] leading-relaxed text-ink-90">
                  {m.content}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="rounded bg-accent-indigo-soft px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-accent-indigo">
                    {m.memory_type}
                  </span>
                  {m.source && (
                    <span className="font-mono text-[9px] text-ink-35">
                      from {m.source}
                    </span>
                  )}
                  {m.tags.slice(0, 4).map((t) => (
                    <span
                      key={t}
                      className="rounded bg-paper-2 px-1.5 py-0.5 font-mono text-[9px] text-ink-35"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-paper-2">
                    <div
                      className="h-full bg-accent-indigo"
                      style={{ width: `${(m.confidence * 100).toFixed(0)}%` }}
                    />
                  </div>
                  <span className="font-mono text-[10px] text-ink-60">
                    {(m.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </KgShell>
      </div>

      <div className="shrink-0 border-t border-rule/50">
        {adding ? (
          <QuickAddMemory
            userId={userId}
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              refetch();
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="w-full px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-accent-indigo hover:bg-paper-2/60"
          >
            + add memory
          </button>
        )}
      </div>
    </div>
  );
}

function QuickAddMemory({
  userId,
  onCancel,
  onSaved,
}: {
  userId: string | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [content, setContent] = useState("");
  const [type, setType] = useState("fact");
  const [confidence, setConfidence] = useState(0.7);
  const [aboutEntityId, setAboutEntityId] = useState("");
  const [aboutIntegration, setAboutIntegration] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!content.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await addMemory(
        {
          content: content.trim(),
          memory_type: type,
          confidence,
          about_entity_id: aboutEntityId.trim() || undefined,
          about_integration_slug: aboutIntegration.trim() || undefined,
        },
        userId,
      );
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5 px-3 py-2">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={2}
        placeholder="content"
        className="w-full rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 placeholder:text-ink-35 focus:border-accent-indigo/50 focus:outline-none"
      />
      <div className="flex flex-wrap gap-1.5">
        <input
          type="text"
          value={type}
          onChange={(e) => setType(e.target.value)}
          placeholder="type"
          className="w-24 rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 focus:border-accent-indigo/50 focus:outline-none"
        />
        <input
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={confidence}
          onChange={(e) => setConfidence(Number(e.target.value))}
          className="w-16 rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 focus:border-accent-indigo/50 focus:outline-none"
        />
        <input
          type="text"
          value={aboutEntityId}
          onChange={(e) => setAboutEntityId(e.target.value)}
          placeholder="about entity (id)"
          className="flex-1 min-w-[120px] rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 placeholder:text-ink-35 focus:border-accent-indigo/50 focus:outline-none"
        />
        <input
          type="text"
          value={aboutIntegration}
          onChange={(e) => setAboutIntegration(e.target.value)}
          placeholder="integration"
          className="w-28 rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 placeholder:text-ink-35 focus:border-accent-indigo/50 focus:outline-none"
        />
      </div>
      <div className="flex items-center justify-between">
        {err ? (
          <span className="font-mono text-[10px] text-confidence-low">{err}</span>
        ) : (
          <span className="font-mono text-[10px] text-ink-35">
            POST /api/kg/memories
          </span>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="font-mono text-[10px] text-ink-35 hover:text-ink-90"
          >
            cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !content.trim()}
            className="font-mono text-[10px] text-accent-indigo hover:underline disabled:opacity-40"
          >
            {busy ? "saving…" : "save"}
          </button>
        </div>
      </div>
    </div>
  );
}
