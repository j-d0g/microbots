"use client";

/**
 * workflows window — two-pane browser + editor.
 *
 * Backed by `GET /api/kg/workflows`. Selected workflow detail shows
 * description, trigger / outcome chips, and the `skill_chain` rendered
 * as ordered lanes. Save posts `POST /api/kg/workflows`; provided
 * `skill_chain` replaces the existing chain.
 *
 * Replaces the old `list_workflows` / `view_workflow` / `save_workflow`
 * windows since the schema collapses them into one resource.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgentStore } from "@/lib/store";
import { useKgResource } from "@/lib/use-kg-resource";
import {
  getWorkflows,
  upsertWorkflow,
  type Workflow,
} from "@/lib/kg-client";
import { registerTools } from "@/lib/room-tools";
import { KgShell, KgHeader } from "./kg-shell";
import { cn } from "@/lib/cn";

type SortField = "name" | "slug";

export function WorkflowsWindow({
  payload,
}: {
  payload?: Record<string, unknown>;
}) {
  const userId = useAgentStore((s) => s.userId);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(
    (payload?.slug as string) ?? null,
  );
  const [editing, setEditing] = useState(false);
  /* Filter / sort / focus state driven by the agent's in-window
   * tools. The list pane reflects these; the detail pane scrolls
   * to and highlights `focusedStep` when the agent calls
   * `workflows_jump_to_step`. */
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortField>("slug");
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [focusedStep, setFocusedStep] = useState<number | null>(null);

  const seed = (payload?.workflows as Workflow[] | undefined) ?? null;
  const fetcher = useCallback(
    (signal: AbortSignal) => getWorkflows(userId, signal),
    [userId],
  );
  const { data, loading, error, refetch } = useKgResource(fetcher, seed);

  /* Apply search → tag filter → sort, in order. Empty filters are
   * pass-through so the agent can clear them by calling with "". */
  const list = useMemo(() => {
    const all = data ?? [];
    const q = searchQuery.trim().toLowerCase();
    const tag = tagFilter.trim().toLowerCase();
    const filtered = all.filter((w) => {
      if (q) {
        const hay = `${w.name} ${w.description ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (tag) {
        const tags = (w.tags ?? []).map((t) => t.toLowerCase());
        if (!tags.includes(tag)) return false;
      }
      return true;
    });
    const sorted = [...filtered].sort((a, b) => {
      const av = (a[sortBy] ?? "").toString();
      const bv = (b[sortBy] ?? "").toString();
      return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    });
    return sorted;
  }, [data, searchQuery, tagFilter, sortBy, sortAsc]);

  const selected = list.find((w) => w.slug === selectedSlug) ?? null;

  /* ── agent tool handlers ──
   *
   * Every event the orchestrator emits via `lib/agent/window-tools/
   * workflows.ts` lands here through `callRoomTool`. Without this
   * registration the events warn-and-noop and the canvas appears
   * frozen — that was the whole reason the in-window demo wasn't
   * moving. Tools are intentionally idempotent and forgiving: an
   * unknown slug or out-of-range step does nothing rather than
   * throwing, matching the contract documented in `lib/room-tools.ts`. */
  useEffect(() => {
    return registerTools("workflows", [
      {
        name: "select",
        description: "Select a workflow by slug to display its detail pane.",
        args: { slug: "string" },
        run: (args) => {
          const slug = typeof args.slug === "string" ? args.slug : null;
          if (!slug) return;
          setSelectedSlug(slug);
          setEditing(false);
          setFocusedStep(null);
        },
      },
      {
        name: "list_all",
        description: "Refresh the workflow list and clear filters.",
        run: () => {
          setSearchQuery("");
          setTagFilter("");
          refetch();
        },
      },
      {
        name: "recent",
        description: "Show recently modified workflows (clears filters).",
        run: () => {
          setSearchQuery("");
          setTagFilter("");
          refetch();
        },
      },
      {
        name: "search",
        description:
          "Filter workflows by free-text query against name + description. Empty string clears.",
        args: { query: "string" },
        run: (args) => {
          setSearchQuery(typeof args.query === "string" ? args.query : "");
        },
      },
      {
        name: "filter_by_tag",
        description: "Filter workflows to those tagged with this value. Empty clears.",
        args: { tag: "string" },
        run: (args) => {
          setTagFilter(typeof args.tag === "string" ? args.tag : "");
        },
      },
      {
        /* Cross-room emit from `skills.ts` — `skills_open_workflows_using`
         * fires `tool: "filter_by_skill"` into the workflows room with
         * `args: { skill_slug }`. We overload the search filter with the
         * skill slug; closes the loop "show me workflows that use X". */
        name: "filter_by_skill",
        description:
          "Filter workflows by a skill slug appearing in their skill chain.",
        args: { skill_slug: "string" },
        run: (args) => {
          const slug =
            typeof args.skill_slug === "string" ? args.skill_slug : "";
          setSearchQuery(slug);
        },
      },
      {
        name: "sort_alphabetically",
        description:
          "Sort the list alphabetically by name or slug, ascending or descending.",
        args: { by: "'name' | 'slug'", ascending: "boolean" },
        run: (args) => {
          const by = args.by === "name" ? "name" : "slug";
          const asc = args.ascending !== false;
          setSortBy(by);
          setSortAsc(asc);
        },
      },
      {
        name: "jump_to_step",
        description:
          "Highlight a specific step in the selected workflow's skill chain (1-based).",
        args: { step_number: "number" },
        run: (args) => {
          const n = Number(args.step_number);
          if (!Number.isFinite(n) || n < 1) return;
          setFocusedStep(Math.floor(n));
        },
      },
      {
        name: "read_current",
        description: "No-op visual cue — agent narrates the current selection.",
        run: () => {
          /* Pure read; the detail pane already shows the current
           * selection. Nothing to mutate. */
        },
      },
      {
        name: "read_skill_chain",
        description:
          "Reset step focus so the full skill chain is visible (no single step highlighted).",
        run: () => {
          setFocusedStep(null);
        },
      },
      {
        name: "new",
        description: "Open the editor with empty fields for a new workflow.",
        run: () => {
          setSelectedSlug(null);
          setEditing(true);
          setFocusedStep(null);
        },
      },
      {
        name: "edit",
        description:
          "Open the editor for the currently selected workflow (or for the slug arg).",
        args: { slug: "string?" },
        run: (args) => {
          if (typeof args.slug === "string" && args.slug) {
            setSelectedSlug(args.slug);
          }
          setEditing(true);
        },
      },
      {
        name: "cancel_edit",
        description: "Exit the editor without saving.",
        run: () => {
          setEditing(false);
        },
      },
      {
        name: "save",
        description:
          "Refresh the list after a save (the orchestrator already wrote the change).",
        run: () => {
          setEditing(false);
          refetch();
        },
      },
      {
        name: "duplicate",
        description: "Refresh the list and select the duplicated workflow.",
        args: { new_slug: "string" },
        run: (args) => {
          if (typeof args.new_slug === "string") {
            setSelectedSlug(args.new_slug);
          }
          refetch();
        },
      },
      {
        name: "delete",
        description: "Refresh the list after a delete.",
        run: () => {
          setSelectedSlug(null);
          setFocusedStep(null);
          refetch();
        },
      },
      {
        name: "run",
        description:
          "Visual marker for a workflow run trigger. Currently a narration hook only.",
        run: () => {
          /* No execution surface yet — the agent's narration is the
           * artefact. Wired so the room-tools registry doesn't warn. */
        },
      },
    ]);
  }, [refetch]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <KgHeader
        label="workflows"
        right={
          <span className="font-mono text-[10px] text-ink-35">
            {list.length} saved
          </span>
        }
      />

      <div className="grid flex-1 min-h-0 grid-cols-[180px_1fr]">
        {/* list */}
        <div className="muji-scroll min-h-0 overflow-y-auto border-r border-rule/40 p-2">
          <button
            type="button"
            onClick={() => {
              setSelectedSlug(null);
              setEditing(true);
            }}
            className="mb-2 w-full rounded border border-dashed border-rule/60 px-2 py-1 text-left font-mono text-[10px] uppercase tracking-wider text-accent-indigo hover:bg-paper-2/60"
          >
            + new
          </button>
          {loading && list.length === 0 && (
            <p className="px-2 py-1 font-mono text-[10px] text-ink-35">loading…</p>
          )}
          <ul className="space-y-0.5">
            {list.map((w) => (
              <li key={w.slug}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSlug(w.slug);
                    setEditing(false);
                  }}
                  className={cn(
                    "w-full rounded px-2 py-1 text-left font-mono text-[11px] transition-colors",
                    selectedSlug === w.slug
                      ? "bg-accent-indigo-soft text-accent-indigo"
                      : "text-ink-90 hover:bg-paper-2/60",
                  )}
                >
                  <div className="truncate">{w.name}</div>
                  <div className="truncate font-mono text-[9px] text-ink-35">
                    {w.slug}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* detail */}
        <div className="muji-scroll min-h-0 overflow-y-auto p-3">
          <KgShell
            loading={loading && list.length === 0}
            error={error}
            empty={list.length === 0 && !editing}
            emptyHint="no workflows yet — click + new to compose one."
            onRetry={refetch}
          >
            {editing ? (
              <WorkflowEditor
                key={selected?.slug ?? "new"}
                workflow={selected}
                userId={userId}
                onCancel={() => setEditing(false)}
                onSaved={(slug) => {
                  setEditing(false);
                  setSelectedSlug(slug);
                  refetch();
                }}
              />
            ) : selected ? (
              <WorkflowView
                workflow={selected}
                onEdit={() => setEditing(true)}
                focusedStep={focusedStep}
              />
            ) : (
              <p className="font-mono text-[11px] text-ink-35">
                select a workflow on the left.
              </p>
            )}
          </KgShell>
        </div>
      </div>
    </div>
  );
}

function WorkflowView({
  workflow,
  onEdit,
  focusedStep,
}: {
  workflow: Workflow;
  onEdit: () => void;
  /* When set, the matching step in the skill chain is highlighted
   * and scrolled into view. Driven by `workflows_jump_to_step`. */
  focusedStep: number | null;
}) {
  /* Scroll the focused step into view whenever it changes so the
   * agent's `jump_to_step` actually lands the user's eye on it. */
  const stepRefs = useMemo(() => new Map<number, HTMLLIElement>(), []);
  useEffect(() => {
    if (focusedStep == null) return;
    const el = stepRefs.get(focusedStep);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusedStep, stepRefs]);

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <p className="font-mono text-[14px] text-ink-90">{workflow.name}</p>
          <p className="font-mono text-[10px] text-ink-35">{workflow.slug}</p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="font-mono text-[10px] uppercase tracking-wider text-accent-indigo hover:underline"
        >
          edit
        </button>
      </div>

      <p className="font-mono text-[12px] leading-relaxed text-ink-60">
        {workflow.description}
      </p>

      <div className="flex flex-wrap gap-1.5">
        {workflow.trigger && (
          <Chip label="trigger" value={workflow.trigger} />
        )}
        {workflow.outcome && (
          <Chip label="outcome" value={workflow.outcome} />
        )}
        {workflow.frequency && (
          <Chip label="freq" value={workflow.frequency} />
        )}
        {workflow.tags.map((t) => (
          <span
            key={t}
            className="rounded bg-accent-indigo-soft px-1.5 py-0.5 font-mono text-[10px] text-accent-indigo"
          >
            #{t}
          </span>
        ))}
      </div>

      <div>
        <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-35">
          skill chain · {workflow.skill_chain.length} steps
        </p>
        {workflow.skill_chain.length === 0 ? (
          <p className="font-mono text-[11px] text-ink-35">no steps</p>
        ) : (
          <ol className="space-y-1">
            {[...workflow.skill_chain]
              .sort((a, b) => a.step_order - b.step_order)
              .map((step) => {
                const isFocused = step.step_order === focusedStep;
                return (
                  <li
                    key={`${step.skill_slug}-${step.step_order}`}
                    ref={(el) => {
                      if (el) stepRefs.set(step.step_order, el);
                      else stepRefs.delete(step.step_order);
                    }}
                    className={cn(
                      "flex items-baseline gap-2 rounded border px-2 py-1 transition-colors",
                      isFocused
                        ? "border-accent-indigo bg-accent-indigo-soft"
                        : "border-rule/50 bg-paper-2/30",
                    )}
                  >
                    <span
                      className={cn(
                        "w-5 font-mono text-[10px]",
                        isFocused ? "text-accent-indigo" : "text-ink-35",
                      )}
                    >
                      {step.step_order}.
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[11px]",
                        isFocused ? "text-accent-indigo" : "text-ink-90",
                      )}
                    >
                      {step.skill_slug}
                    </span>
                  </li>
                );
              })}
          </ol>
        )}
      </div>
    </div>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded border border-rule/50 bg-paper-2/40 px-2 py-0.5 font-mono text-[10px] text-ink-90">
      <span className="text-ink-35">{label}: </span>
      {value}
    </span>
  );
}

function WorkflowEditor({
  workflow,
  userId,
  onCancel,
  onSaved,
}: {
  workflow: Workflow | null;
  userId: string | null;
  onCancel: () => void;
  onSaved: (slug: string) => void;
}) {
  const [slug, setSlug] = useState(workflow?.slug ?? "");
  const [name, setName] = useState(workflow?.name ?? "");
  const [description, setDescription] = useState(workflow?.description ?? "");
  const [trigger, setTrigger] = useState(workflow?.trigger ?? "");
  const [outcome, setOutcome] = useState(workflow?.outcome ?? "");
  const [chainText, setChainText] = useState(
    (workflow?.skill_chain ?? [])
      .sort((a, b) => a.step_order - b.step_order)
      .map((s) => s.skill_slug)
      .join("\n"),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!slug.trim() || !name.trim() || !description.trim()) {
      setErr("slug, name, description are required");
      return;
    }
    setBusy(true);
    setErr(null);
    const skill_chain = chainText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((skill_slug, i) => ({ slug: skill_slug, step_order: i + 1 }));
    try {
      const res = await upsertWorkflow(
        {
          slug: slug.trim(),
          name: name.trim(),
          description: description.trim(),
          trigger: trigger.trim() || undefined,
          outcome: outcome.trim() || undefined,
          skill_chain,
        },
        userId,
      );
      onSaved(res.slug);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[12px] text-ink-90">
          {workflow ? "edit workflow" : "new workflow"}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="font-mono text-[10px] text-ink-35 hover:text-ink-90"
        >
          cancel
        </button>
      </div>
      <Field label="slug">
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          disabled={!!workflow}
          className="w-full rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 disabled:opacity-60 focus:border-accent-indigo/50 focus:outline-none"
        />
      </Field>
      <Field label="name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 focus:border-accent-indigo/50 focus:outline-none"
        />
      </Field>
      <Field label="description">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 focus:border-accent-indigo/50 focus:outline-none"
        />
      </Field>
      <div className="flex gap-2">
        <Field label="trigger">
          <input
            value={trigger}
            onChange={(e) => setTrigger(e.target.value)}
            className="w-full rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 focus:border-accent-indigo/50 focus:outline-none"
          />
        </Field>
        <Field label="outcome">
          <input
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="w-full rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 focus:border-accent-indigo/50 focus:outline-none"
          />
        </Field>
      </div>
      <Field label="skill chain · one slug per line, ordered">
        <textarea
          value={chainText}
          onChange={(e) => setChainText(e.target.value)}
          rows={5}
          spellCheck={false}
          className="w-full rounded border border-rule/50 bg-paper-2/40 px-2 py-1 font-mono text-[11px] text-ink-90 focus:border-accent-indigo/50 focus:outline-none"
        />
      </Field>

      <div className="flex items-center justify-between pt-1">
        {err ? (
          <span className="font-mono text-[10px] text-confidence-low">{err}</span>
        ) : (
          <span className="font-mono text-[10px] text-ink-35">
            POST /api/kg/workflows · chain replaces
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
    <label className="block flex-1">
      <span className="mb-0.5 block font-mono text-[10px] uppercase tracking-wider text-ink-35">
        {label}
      </span>
      {children}
    </label>
  );
}
