"use client";

import { useCallback, useEffect, useState } from "react";
import { getToday, updateCandidateStatus, type AutomationCandidate, type TodayResponse } from "@/lib/api/backend";
import { useAgentStore, type ChatCard } from "@/lib/store";

const EMPTY_TODAY: TodayResponse = { needs_you: [], suggestions: [], recent: [] };
type TodayFocus = "all" | "needs_you" | "suggestions";

export function todaySectionsForFocus(
  today: TodayResponse,
  focus: TodayFocus,
): TodayResponse {
  return {
    needs_you: focus === "suggestions" ? [] : today.needs_you,
    suggestions: focus === "needs_you" ? [] : today.suggestions,
    recent: focus === "all" ? today.recent : [],
  };
}

export function replaceCandidate(
  today: TodayResponse,
  id: string,
  update: Partial<AutomationCandidate>,
): TodayResponse {
  return {
    ...today,
    needs_you: today.needs_you.map((candidate) =>
      candidate.id === id ? { ...candidate, ...update } : candidate,
    ),
    suggestions: today.suggestions.map((candidate) =>
      candidate.id === id ? { ...candidate, ...update } : candidate,
    ),
  };
}

export async function setCandidateStatus(
  today: TodayResponse,
  id: string,
  status: "open" | "accepted" | "dismissed",
  userId: string,
  onChange: (value: TodayResponse) => void,
): Promise<TodayResponse> {
  const optimistic = replaceCandidate(today, id, { status });
  onChange(optimistic);
  try {
    const saved = await updateCandidateStatus(id, status, userId);
    return replaceCandidate(optimistic, id, saved);
  } catch {
    onChange(today);
    return today;
  }
}

export function TodayCard({ card }: { card: ChatCard }) {
  return <TodayContent payload={card.payload} />;
}

export function TodayWindow({ payload }: { payload?: Record<string, unknown> }) {
  return <TodayContent payload={payload} expanded />;
}

function TodayContent({
  payload,
  expanded = false,
}: {
  payload?: Record<string, unknown>;
  expanded?: boolean;
}) {
  const userId = useAgentStore((state) => state.userId);
  const hasPayload =
    Array.isArray(payload?.needs_you) &&
    Array.isArray(payload?.suggestions) &&
    Array.isArray(payload?.recent);
  const [today, setToday] = useState<TodayResponse>(() =>
    hasPayload ? payload as unknown as TodayResponse : EMPTY_TODAY,
  );
  const [loading, setLoading] = useState(!hasPayload);
  const [loadError, setLoadError] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const focus =
    payload?.focus === "suggestions" || payload?.focus === "needs_you"
      ? payload.focus
      : "all";

  useEffect(() => {
    if (hasPayload) return;
    let active = true;
    void getToday(userId).then((data) => {
      if (active) setToday(data);
    }).catch(() => {
      if (active) setLoadError(true);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [hasPayload, userId]);

  const decide = useCallback(async (
    candidate: AutomationCandidate,
    status: "accepted" | "dismissed" | "open",
  ) => {
    const before = today;
    setErrors((current) => ({ ...current, [candidate.id]: "" }));
    const updated = await setCandidateStatus(
      before,
      candidate.id,
      status,
      userId,
      setToday,
    );
    setToday(updated);
    if (updated === before) {
      setErrors((current) => ({
        ...current,
        [candidate.id]: "could not save · try again",
      }));
    }
  }, [today, userId]);

  const { needs_you: needsYou, suggestions, recent } =
    todaySectionsForFocus(today, focus);
  const empty = !needsYou.length && !suggestions.length && !recent.length;

  if (loading) {
    return <p className="p-4 font-mono text-[10px] text-ink-35">loading…</p>;
  }

  return (
    <div className={expanded ? "space-y-5 p-4" : "space-y-4"}>
      {loadError && <p role="alert" className="font-mono text-[11px] text-ink-35">could not load Today right now</p>}
      {empty && !loadError && <p className="font-mono text-[11px] text-ink-35">nothing needs you</p>}
      {needsYou.length > 0 && (
        <section>
          <h2 className="mb-2 font-mono text-[9px] uppercase tracking-wider text-ink-35">Needs you</h2>
          <ul className="space-y-2">
            {needsYou.map((candidate) => (
              <li key={candidate.id} className="border-l border-confidence-low/40 pl-2">
                <h3 className="text-[12px] font-medium text-ink-90">{candidate.title}</h3>
                <p className="text-[10px] leading-relaxed text-ink-60">{candidate.story}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {suggestions.length > 0 && (
        <section>
          <h2 className="mb-2 font-mono text-[9px] uppercase tracking-wider text-ink-35">Suggested automations</h2>
          <ul className="space-y-3">
            {suggestions.map((candidate) => (
              <li key={candidate.id} className="border-b border-rule/60 pb-3 last:border-0">
                {candidate.status === "accepted" || candidate.status === "dismissed" ? (
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] text-ink-60">{candidate.title}</span>
                    <span className="flex shrink-0 items-center gap-2 font-mono text-[9px] uppercase text-ink-35">
                      {candidate.status}
                      <button type="button" onClick={() => void decide(candidate, "open")} className="text-accent-indigo hover:underline">
                        undo
                      </button>
                    </span>
                  </div>
                ) : (
                  <>
                    <h3 className="text-[12px] font-medium text-ink-90">{candidate.title}</h3>
                    <p className="mt-0.5 truncate text-[10px] leading-relaxed text-ink-60" title={candidate.story}>{candidate.story}</p>
                    <p className="mt-1 font-mono text-[9px] text-ink-35">based on {candidate.evidence.length} {candidate.evidence.length === 1 ? "signal" : "signals"}</p>
                    <details className="mt-1">
                      <summary className="cursor-pointer font-mono text-[9px] text-ink-35">evidence</summary>
                      <ul className="mt-1 space-y-1 pl-2">
                        {candidate.evidence.map((item) => (
                          <li key={`${item.type}-${item.id}`} className="text-[10px] leading-relaxed text-ink-60">{item.text}</li>
                        ))}
                      </ul>
                    </details>
                    <div className="mt-2 flex items-center gap-3">
                      <button type="button" onClick={() => void decide(candidate, "accepted")} className="font-mono text-[9px] uppercase text-accent-indigo hover:underline">accept</button>
                      <button type="button" onClick={() => void decide(candidate, "dismissed")} className="font-mono text-[9px] uppercase text-ink-35 hover:underline">dismiss</button>
                    </div>
                  </>
                )}
                {errors[candidate.id] && <p role="alert" className="mt-1 font-mono text-[9px] text-confidence-low">{errors[candidate.id]}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {recent.length > 0 && (
        <section>
          <h2 className="mb-2 font-mono text-[9px] uppercase tracking-wider text-ink-35">Recent</h2>
          <ul className="space-y-1">
            {recent.slice(0, 5).map((chat) => (
              <li key={chat.id} className="flex items-baseline justify-between gap-2 text-[10px]">
                <span className="truncate text-ink-60">{chat.title}</span>
                <span className="shrink-0 font-mono text-[8px] text-ink-35">{chat.source_type}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
