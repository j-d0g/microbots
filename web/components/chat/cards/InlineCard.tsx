"use client";

import { useCallback, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { AskUserCard } from "@/components/windows/AskUserCard";
import { GraphRoom } from "@/components/rooms/GraphRoom";
import { WINDOW_REGISTRY } from "@/components/stage/window-registry";
import {
  getEntities,
  getIntegrations,
  getMemories,
  getSkills,
  getWorkflows,
  type Integration,
  type Skill,
  type Workflow,
} from "@/lib/kg-client";
import { useAgentStore, type ChatCard } from "@/lib/store";
import { useKgResource } from "@/lib/use-kg-resource";
import { cn } from "@/lib/cn";
import { memoryCardSearchDisplay } from "./memory-card-data";

export function InlineCard({ card }: { card: ChatCard }) {
  switch (card.kind) {
    case "graph":
      return <GraphCard card={card} />;
    case "memories":
      return <MemoryCard card={card} />;
    case "workflows":
      return <WorkflowCard card={card} />;
    case "entities":
    case "entity_detail":
      return <EntityCard card={card} />;
    case "integrations":
      return <IntegrationCard card={card} />;
    case "skills":
      return <SkillCard card={card} />;
    case "ask_user":
      return <AskUserInlineCard card={card} />;
    default:
      return <GenericCard card={card} />;
  }
}

function CardShell({
  card,
  title,
  children,
}: {
  card: ChatCard;
  title: string;
  children: ReactNode;
}) {
  const openChatCanvas = useAgentStore((state) => state.openChatCanvas);
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      data-testid={`inline-card-${card.kind}`}
      className="overflow-hidden rounded-md border border-rule bg-paper-0"
    >
      <header className="flex h-9 items-center justify-between border-b border-rule/70 bg-paper-1/70 px-3">
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-60">
          {title}
        </span>
        <button
          type="button"
          onClick={() => openChatCanvas(card.kind, card.payload)}
          className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-ink-35 transition-colors hover:text-accent-indigo"
          aria-label={`expand ${title}`}
        >
          expand <ArrowUpRight size={11} />
        </button>
      </header>
      <div className="p-3">{children}</div>
    </motion.section>
  );
}

function GraphCard({ card }: { card: ChatCard }) {
  return (
    <CardShell card={card} title="knowledge graph">
      <div className="h-[320px] overflow-hidden rounded-sm bg-paper-1">
        <GraphRoom payload={{ ...card.payload, compact: true }} />
      </div>
    </CardShell>
  );
}

function MemoryCard({ card }: { card: ChatCard }) {
  const search = memoryCardSearchDisplay(card.payload);
  return (
    <CardShell card={card} title="memories">
      {search ? (
        <>
          <p className="mb-2 font-mono text-[10px] text-ink-35">
            “{search.query}” · {search.count} matches
          </p>
          {search.snippets.length ? (
            <ul className="space-y-2">
              {search.snippets.map((snippet, index) => (
                <li
                  key={`${index}-${snippet}`}
                  className="border-l border-accent-indigo/30 pl-2 text-[12px] leading-relaxed text-ink-60"
                >
                  {snippet}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyResource label={`No memories match “${search.query}”.`} />
          )}
        </>
      ) : (
        <TopMemories />
      )}
    </CardShell>
  );
}

function TopMemories() {
  const userId = useAgentStore((state) => state.userId);
  const fetcher = useCallback(
    (signal: AbortSignal) => getMemories({ by: "confidence", limit: 3 }, userId, signal),
    [userId],
  );
  const { data, loading } = useKgResource(fetcher);
  return (
    loading && !data ? <Loading /> : (
      <ul className="space-y-2">
        {(data ?? []).slice(0, 3).map((memory) => (
          <li key={memory.id} className="border-l border-accent-indigo/30 pl-2 text-[12px] leading-relaxed text-ink-60">
            {memory.content}
          </li>
        ))}
        {!data?.length && <EmptyResource label="No memories to show." />}
      </ul>
    )
  );
}

function WorkflowCard({ card }: { card: ChatCard }) {
  const userId = useAgentStore((state) => state.userId);
  const fetcher = useCallback((signal: AbortSignal) => getWorkflows(userId, signal), [userId]);
  const { data, loading } = useKgResource(fetcher);
  const focus = stringValue(card.payload?.focus).toLowerCase();
  const workflows = data ?? [];
  const selected = workflows.find(
    (workflow) =>
      workflow.slug.toLowerCase() === focus ||
      workflow.name.toLowerCase() === focus,
  );
  const list = selected ? [selected] : workflows.slice(0, 3);
  return (
    <CardShell card={card} title="workflows">
      {loading && !data ? <Loading /> : (
        <ul className="space-y-3">
          {list.map((workflow) => <WorkflowSummary key={workflow.id} workflow={workflow} />)}
          {!workflows.length && <EmptyResource label="No workflows to show." />}
          {focus && !selected && <p className="font-mono text-[10px] text-ink-35">No exact match for “{stringValue(card.payload?.focus)}”.</p>}
        </ul>
      )}
    </CardShell>
  );
}

function WorkflowSummary({ workflow }: { workflow: Workflow }) {
  return (
    <li>
      <h3 className="text-[13px] font-medium text-ink-90">{workflow.name}</h3>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-60">
        {workflow.description}
      </p>
      {workflow.skill_chain.length > 0 && (
        <ol className="mt-2 space-y-1 border-l border-rule pl-3">
          {[...workflow.skill_chain]
            .sort((a, b) => a.step_order - b.step_order)
            .slice(0, 4)
            .map((step) => (
              <li key={`${step.step_order}-${step.skill_slug}`} className="font-mono text-[9px] text-ink-35">
                {step.step_order}. {step.skill_slug.replaceAll("_", " ")}
              </li>
            ))}
        </ol>
      )}
    </li>
  );
}

function EntityCard({ card }: { card: ChatCard }) {
  const userId = useAgentStore((state) => state.userId);
  const fetcher = useCallback(
    (signal: AbortSignal) => getEntities(undefined, userId, signal),
    [userId],
  );
  const { data, loading } = useKgResource(fetcher);
  const focus = stringValue(card.payload?.focus).toLowerCase();
  const entities = data ?? [];
  const selected = entities.find(
    (entity) =>
      entity.name.toLowerCase() === focus ||
      entity.id.toString().toLowerCase() === focus,
  );
  const list = card.kind === "entity_detail" && selected
    ? [selected]
    : entities.slice(0, 3);
  return (
    <CardShell card={card} title={card.kind === "entity_detail" ? "entity detail" : "entities"}>
      {loading && !data ? <Loading /> : (
        <ul className="space-y-2">
          {list.map((entity) => (
            <li key={entity.id}>
              <h3 className="text-[12px] font-medium text-ink-90">{entity.name}</h3>
              <p className="mt-0.5 text-[10px] leading-relaxed text-ink-60">{entity.description}</p>
              {entity.tags?.length > 0 && (
                <p className="mt-1 font-mono text-[9px] text-ink-35">{entity.tags.slice(0, 3).join(" · ")}</p>
              )}
            </li>
          ))}
          {!entities.length && <EmptyResource label="No entities to show." />}
          {focus && !selected && <EmptyResource label={`No match for “${stringValue(card.payload?.focus)}”.`} />}
        </ul>
      )}
    </CardShell>
  );
}

function IntegrationCard({ card }: { card: ChatCard }) {
  const userId = useAgentStore((state) => state.userId);
  const connections = useAgentStore((state) => state.connections);
  const fetcher = useCallback((signal: AbortSignal) => getIntegrations(userId, signal), [userId]);
  const { data, loading } = useKgResource(fetcher);
  return (
    <CardShell card={card} title="integrations">
      {loading && !data ? <Loading /> : (
        <ul className="space-y-2">
          {(data ?? []).slice(0, 4).map((integration: Integration) => {
            const status = connections.find((item) => item.slug === integration.slug)?.status ?? "available";
            return (
              <li key={integration.slug} className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-ink-90">{integration.name}</span>
                <span className={cn(
                  "rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide",
                  status === "ACTIVE"
                    ? "border-confidence-high/30 bg-confidence-high/5 text-confidence-high"
                    : "border-rule text-ink-35",
                )}>
                  {status}
                </span>
              </li>
            );
          })}
          {!data?.length && <EmptyResource label="No integrations to show." />}
        </ul>
      )}
    </CardShell>
  );
}

function SkillCard({ card }: { card: ChatCard }) {
  const userId = useAgentStore((state) => state.userId);
  const fetcher = useCallback((signal: AbortSignal) => getSkills({}, userId, signal), [userId]);
  const { data, loading } = useKgResource(fetcher);
  return (
    <CardShell card={card} title="skills">
      {loading && !data ? <Loading /> : (
        <ul className="space-y-2">
          {(data ?? []).slice(0, 3).map((skill: Skill) => (
            <li key={skill.slug}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-medium text-ink-90">{skill.name}</span>
                <span className="font-mono text-[9px] tabular-nums text-ink-35">{skill.strength}/5</span>
              </div>
              <p className="mt-0.5 text-[10px] leading-relaxed text-ink-60">{skill.description}</p>
            </li>
          ))}
          {!data?.length && <EmptyResource label="No skills to show." />}
        </ul>
      )}
    </CardShell>
  );
}

function AskUserInlineCard({ card }: { card: ChatCard }) {
  return (
    <CardShell card={card} title="one question">
      <AskUserCard payload={card.payload} />
    </CardShell>
  );
}

function GenericCard({ card }: { card: ChatCard }) {
  const summary = useAgentStore((state) => WINDOW_REGISTRY[card.kind].summary(state));
  return (
    <CardShell card={card} title={WINDOW_REGISTRY[card.kind].title}>
      <p className="text-[12px] leading-relaxed text-ink-60">{summary}</p>
    </CardShell>
  );
}

function Loading() {
  return <p className="font-mono text-[10px] text-ink-35">loading…</p>;
}

function EmptyResource({ label }: { label: string }) {
  return <p className="font-mono text-[10px] text-ink-35">{label}</p>;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
