"use client";

/**
 * profile window — schema-backed user profile.
 *
 * Backed by `GET /api/kg/user`; edits flow through `PATCH /api/kg/user`.
 * The aggregate counters (chat / memory / skill / workflow / entity /
 * integration) are computed server-side and shown read-only.
 */

import { useCallback, useEffect, useState } from "react";
import { useAgentStore } from "@/lib/store";
import { useKgResource } from "@/lib/use-kg-resource";
import {
  getUser,
  updateUser,
  type UserProfile,
} from "@/lib/kg-client";
import { registerTools } from "@/lib/room-tools";
import { KgShell, KgHeader } from "./kg-shell";

export function ProfileWindow({
  payload,
}: {
  payload?: Record<string, unknown>;
}) {
  const userId = useAgentStore((s) => s.userId);
  const seed = (payload?.profile as UserProfile | undefined) ?? null;

  const fetcher = useCallback(
    (signal: AbortSignal) => getUser(userId, signal),
    [userId],
  );
  const { data, loading, error, refetch } = useKgResource(fetcher, seed);

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [goalsText, setGoalsText] = useState("");
  const [contextWindow, setContextWindow] = useState<number>(8192);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(0);

  // Hydrate the form when the server payload lands.
  useEffect(() => {
    if (!data) return;
    setName(data.name ?? "");
    setRole(data.role ?? "");
    setGoalsText((data.goals ?? []).join("\n"));
    setContextWindow(data.context_window ?? 8192);
  }, [data]);

  /* Register UI handlers so `profile_read_all` doesn't warn-and-noop
   * when the agent narrates the user's profile aloud. */
  useEffect(() => {
    return registerTools("profile", [
      {
        name: "read_all",
        description: "Narration hook — agent reads the profile fields aloud.",
        run: () => {
          /* All fields rendered already; pure read. Refresh in case
           * another surface mutated the user. */
          refetch();
        },
      },
    ]);
  }, [refetch]);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await updateUser(
        {
          name: name.trim() || undefined,
          role: role.trim() || undefined,
          goals: goalsText
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
          context_window: contextWindow,
        },
        userId,
      );
      setSavedTick((n) => n + 1);
      refetch();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <KgHeader
        label="profile"
        right={
          savedTick > 0 ? (
            <span className="font-mono text-[10px] text-confidence-high">
              saved
            </span>
          ) : null
        }
      />
      <div className="muji-scroll flex-1 min-h-0 overflow-y-auto p-3">
        <KgShell
          loading={loading && !data}
          error={error}
          empty={!data}
          onRetry={refetch}
        >
          {data && (
            <div className="space-y-4">
              {/* counters */}
              <section>
                <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-35">
                  graph footprint
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  <Counter label="chats" value={data.chat_count} />
                  <Counter label="memories" value={data.memory_count} />
                  <Counter label="skills" value={data.skill_count} />
                  <Counter label="workflows" value={data.workflow_count} />
                  <Counter label="entities" value={data.entity_count} />
                  <Counter
                    label="integrations"
                    value={data.integration_count}
                  />
                </div>
              </section>

              {/* editable */}
              <section className="space-y-2">
                <Field label="name">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 focus:border-accent-indigo/50 focus:outline-none"
                  />
                </Field>
                <Field label="role">
                  <input
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 focus:border-accent-indigo/50 focus:outline-none"
                  />
                </Field>
                <Field label="goals · one per line">
                  <textarea
                    value={goalsText}
                    onChange={(e) => setGoalsText(e.target.value)}
                    rows={4}
                    className="w-full rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 focus:border-accent-indigo/50 focus:outline-none"
                  />
                </Field>
                <Field label="context window (512..200000)">
                  <input
                    type="number"
                    min={512}
                    max={200000}
                    value={contextWindow}
                    onChange={(e) =>
                      setContextWindow(
                        Math.max(
                          512,
                          Math.min(200000, Number(e.target.value) || 8192),
                        ),
                      )
                    }
                    className="w-32 rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 focus:border-accent-indigo/50 focus:outline-none"
                  />
                </Field>

                <div className="flex items-center justify-between pt-1">
                  {err ? (
                    <span className="font-mono text-[10px] text-confidence-low">
                      {err}
                    </span>
                  ) : (
                    <span className="font-mono text-[10px] text-ink-35">
                      PATCH /api/kg/user
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={submit}
                    disabled={busy}
                    className="font-mono text-[10px] uppercase tracking-wider text-accent-indigo hover:underline disabled:opacity-40"
                  >
                    {busy ? "saving…" : "save"}
                  </button>
                </div>
              </section>
            </div>
          )}
        </KgShell>
      </div>
    </div>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-rule/50 bg-paper-2/30 px-2 py-1.5">
      <p className="font-mono text-[16px] text-ink-90">{value}</p>
      <p className="font-mono text-[9px] uppercase tracking-wider text-ink-35">
        {label}
      </p>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-0.5 block font-mono text-[10px] uppercase tracking-wider text-ink-35">
        {label}
      </span>
      {children}
    </label>
  );
}
