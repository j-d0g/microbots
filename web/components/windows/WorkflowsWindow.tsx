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

import { useCallback, useMemo, useState } from "react";
import { useAgentStore } from "@/lib/store";
import { useKgResource } from "@/lib/use-kg-resource";
import {
  getWorkflows,
  upsertWorkflow,
  type Workflow,
} from "@/lib/kg-client";
import { KgShell, KgHeader } from "./kg-shell";
import { cn } from "@/lib/cn";

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

  const seed = (payload?.workflows as Workflow[] | undefined) ?? null;
  const fetcher = useCallback(
    (signal: AbortSignal) => getWorkflows(userId, signal),
    [userId],
  );
  const { data, loading, error, refetch } = useKgResource(fetcher, seed);
  const list = useMemo(
    () => [...(data ?? [])].sort((a, b) => a.slug.localeCompare(b.slug)),
    [data],
  );
  const selected = list.find((w) => w.slug === selectedSlug) ?? null;

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
}: {
  workflow: Workflow;
  onEdit: () => void;
}) {
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
              .map((step) => (
                <li
                  key={`${step.skill_slug}-${step.step_order}`}
                  className="flex items-baseline gap-2 rounded border border-rule/50 bg-paper-2/30 px-2 py-1"
                >
                  <span className="w-5 font-mono text-[10px] text-ink-35">
                    {step.step_order}.
                  </span>
                  <span className="font-mono text-[11px] text-ink-90">
                    {step.skill_slug}
                  </span>
                </li>
              ))}
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
