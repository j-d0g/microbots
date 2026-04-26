"use client";

/**
 * integration_detail window — entities, top memories, skills for one
 * integration slug.
 *
 * Backed by `GET /api/kg/integrations/{slug}`. Entity rows fan out to
 * `entity_detail`.
 */

import { useCallback, useEffect } from "react";
import { useAgentStore } from "@/lib/store";
import { useKgResource } from "@/lib/use-kg-resource";
import {
  getIntegration,
  type IntegrationDetail,
} from "@/lib/kg-client";
import { registerTools } from "@/lib/room-tools";
import { KgShell, KgHeader } from "./kg-shell";
import { cn } from "@/lib/cn";

export function IntegrationDetailWindow({
  payload,
}: {
  payload?: Record<string, unknown>;
}) {
  const userId = useAgentStore((s) => s.userId);
  const openWindow = useAgentStore((s) => s.openWindow);
  const slug = (payload?.slug as string) ?? "";
  const seed = (payload?.seed as IntegrationDetail | undefined) ?? null;

  const fetcher = useCallback(
    (signal: AbortSignal) =>
      slug
        ? getIntegration(slug, userId, signal)
        : Promise.resolve(null as unknown as IntegrationDetail),
    [slug, userId],
  );
  const { data, loading, error, refetch } = useKgResource(fetcher, seed);

  /* Register UI handlers for the orchestrator's
   * `integration_detail_*` tools. Most are pure narration hooks —
   * the data they describe (entities, top memories, skills,
   * categories, co-used) is already laid out below. The
   * `refresh_data` tool re-fetches; `set_purpose` mutates the
   * backend (no UI surface here yet) so the agent's narration
   * carries the user-facing artefact. */
  useEffect(() => {
    if (!slug) return;
    return registerTools("integration_detail", [
      {
        name: "read",
        description: "Narration hook — agent reads the current detail aloud.",
        run: () => {
          /* All fields rendered already; no mutation. */
        },
      },
      {
        name: "set_purpose",
        description:
          "Optimistic narration hook — orchestrator persists the purpose; we refetch.",
        args: { purpose: "string" },
        run: () => {
          refetch();
        },
      },
      {
        name: "read_co_used",
        description: "Narration hook — agent describes co-used integrations.",
        run: () => {
          /* No co-used UI yet on this window; agent narration is the
           * artefact. Kept registered to avoid registry warnings. */
        },
      },
      {
        name: "read_recent_activities",
        description: "Narration hook — agent describes recent integration activity.",
        args: { limit: "number?" },
        run: () => {
          /* No activity feed UI yet on this window; agent narration is the
           * artefact. Kept registered to avoid registry warnings. */
        },
      },
      {
        name: "configure",
        description:
          "Open settings for this integration. Currently routes to the settings window.",
        run: () => {
          openWindow("settings");
        },
      },
      {
        name: "disconnect",
        description: "Refetch after a disconnect (orchestrator handles the API call).",
        run: () => {
          refetch();
        },
      },
      {
        name: "refresh_data",
        description: "Refetch the integration detail.",
        run: () => {
          refetch();
        },
      },
      {
        name: "read_category",
        description: "Narration hook — agent reads category back to user.",
        run: () => {
          /* Category is in the header; pure read. */
        },
      },
    ]);
  }, [slug, refetch, openWindow]);

  if (!slug) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="font-mono text-[11px] text-ink-35">
          no integration selected
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <KgHeader
        label={`integration · ${slug}`}
        right={
          data?.category ? (
            <span className="font-mono text-[10px] text-ink-35">
              {data.category}
            </span>
          ) : null
        }
      />
      <div className="muji-scroll flex-1 min-h-0 overflow-y-auto p-3">
        <KgShell
          loading={loading}
          error={error}
          empty={!data}
          onRetry={refetch}
        >
          {data && (() => {
            /* Upstream data may arrive partial — e.g. when the agent
             * seeds the window with just `{slug, name}` before the real
             * /api/kg/integrations/{slug} response lands, or when the
             * backend returns a stub for an unknown integration. Treat
             * the nested arrays as optional here so the window renders
             * "none yet" instead of crashing. */
            const entities = data.entities ?? [];
            const topMemories = data.top_memories ?? [];
            const skills = data.skills ?? [];
            return (
            <div className="space-y-4">
              <div>
                <p className="font-mono text-[14px] text-ink-90">{data.name}</p>
                {data.description && (
                  <p className="mt-1 font-mono text-[12px] leading-relaxed text-ink-60">
                    {data.description}
                  </p>
                )}
              </div>

              <Section title={`entities · ${entities.length}`}>
                {entities.length === 0 ? (
                  <Empty>none yet</Empty>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {entities.map((e) => (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() =>
                            openWindow("entity_detail", {
                              payload: {
                                id: e.id,
                                name: e.name,
                                entity_type: e.entity_type,
                              },
                            })
                          }
                          className={cn(
                            "rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px]",
                            "text-ink-90 hover:border-accent-indigo/40 hover:text-accent-indigo",
                          )}
                        >
                          {e.name}
                          {e.entity_type && (
                            <span className="ml-1 text-ink-35">
                              · {e.entity_type}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title={`top memories · ${topMemories.length}`}>
                {topMemories.length === 0 ? (
                  <Empty>none yet</Empty>
                ) : (
                  <ul className="space-y-1.5">
                    {topMemories.map((m) => (
                      <li
                        key={m.id}
                        className="rounded border border-rule/50 bg-paper-2/30 p-2"
                      >
                        <p className="font-mono text-[11px] leading-snug text-ink-90">
                          {m.content}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="font-mono text-[9px] uppercase tracking-wider text-ink-35">
                            {m.memory_type}
                          </span>
                          <span className="font-mono text-[9px] text-ink-35">
                            {(m.confidence * 100).toFixed(0)}%
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>

              <Section title={`skills · ${skills.length}`}>
                {skills.length === 0 ? (
                  <Empty>none yet</Empty>
                ) : (
                  <ul className="space-y-1">
                    {skills.map((s) => (
                      <li
                        key={s.id}
                        className="flex items-baseline justify-between rounded border border-rule/50 bg-paper-2/30 p-2"
                      >
                        <div className="min-w-0">
                          <p className="font-mono text-[11px] text-ink-90">
                            {s.name}
                          </p>
                          <p className="truncate font-mono text-[10px] text-ink-60">
                            {s.description}
                          </p>
                        </div>
                        <span className="ml-2 shrink-0 font-mono text-[10px] text-accent-indigo">
                          ×{s.strength}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>
            );
          })()}
        </KgShell>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-35">
        {title}
      </p>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[11px] text-ink-35">{children}</p>
  );
}
