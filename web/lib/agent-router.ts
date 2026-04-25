"use client";

import type { AgentEvent } from "./agent-client";
import type { RoomKind } from "./store";

/** Intent router. When OpenRouter API key is available, delegates to
 *  the real LLM agent via sendQuery. Otherwise falls back to the
 *  deterministic pattern-matching scripts below. */

type Step = { delay: number; event: AgentEvent };

interface Script {
  match: (q: string) => boolean;
  build: (q: string) => Step[];
}

const word = (q: string, ...keys: string[]) =>
  keys.some((k) => q.toLowerCase().includes(k));

function streamReply(text: string, baseDelay = 22): Step[] {
  const out: Step[] = [];
  let i = 0;
  for (const ch of text) {
    out.push({
      delay: i === 0 ? 80 : baseDelay,
      event: { type: "reply.chunk", text: ch },
    });
    i += 1;
  }
  return out;
}

function nav(room: RoomKind, slug?: string): Step {
  return { delay: 80, event: { type: "ui.room", room, slug } };
}

function arrange(layout: "focus" | "split" | "grid" | "stack-right"): Step {
  return { delay: 100, event: { type: "ui.arrange", layout } };
}

function status(s: string, delay = 60): Step {
  return { delay, event: { type: "agent.status", status: s } };
}

function dock(state: "idle" | "thinking" | "speaking"): Step {
  return { delay: 0, event: { type: "dock", state } };
}

function card(
  id: string,
  kind: "memory" | "entity" | "source" | "diff" | "toast",
  data: Record<string, unknown>,
  ttl?: number,
): Step {
  return {
    delay: 120,
    event: { type: "ui.card", card: { id, kind, data, ttl } },
  };
}

const SCRIPTS: Script[] = [
  {
    match: (q) => word(q, "morning", "brief", "today", "what's new", "whats new"),
    build: (q) => [
      dock("thinking"),
      status("reading last night's signal..."),
      nav("brief"),
      { delay: 600, event: { type: "reply.start", query: q } },
      dock("speaking"),
      ...streamReply(
        "morning. six proposals for you today -- bug triage, PR digest, email routing, investor update, meeting archive, and newsletter cleanup.",
      ),
      { delay: 200, event: { type: "reply.done" } },
      status("", 0),
      dock("idle"),
    ],
  },
  {
    match: (q) => word(q, "bug triage", "triage", "show me how", "bug pipeline"),
    build: (q) => [
      dock("thinking"),
      status("opening the bug triage workflow..."),
      nav("workflow"),
      { delay: 200, event: { type: "reply.start", query: q } },
      dock("speaking"),
      ...streamReply(
        "here is the bug triage pipeline, top to bottom. five steps; the assignment is the only one with a confidence threshold below 0.9.",
      ),
      card(
        `mem-${Date.now()}`,
        "memory",
        { text: "Maya triages Slack #product-bugs into Linear every weekday morning.", confidence: 0.94 },
        6500,
      ),
      { delay: 200, event: { type: "reply.done" } },
      dock("idle"),
      status("", 0),
    ],
  },
  {
    match: (q) => word(q, "graph", "remember", "memory", "ontology"),
    build: (q) => [
      dock("thinking"),
      status("plotting what i know..."),
      nav("graph"),
      arrange("focus"),
      { delay: 500, event: { type: "reply.start", query: q } },
      dock("speaking"),
      ...streamReply(
        "this is what i remember about your work. six integrations, dozens of entities, twenty-five confident memories, and five live workflows.",
      ),
      { delay: 200, event: { type: "reply.done" } },
      dock("idle"),
      status("", 0),
    ],
  },
  {
    match: (q) => word(q, "stack", "service", "microservice", "deploy"),
    build: (q) => [
      dock("thinking"),
      status("listing services..."),
      nav("stack"),
      { delay: 400, event: { type: "reply.start", query: q } },
      dock("speaking"),
      ...streamReply(
        "five python microservices running. notion-scribe is approaching Notion API rate limits. the rest are green.",
      ),
      card(`toast-${Date.now()}`, "toast", { text: "notion-scribe is in warn." }, 4500),
      { delay: 200, event: { type: "reply.done" } },
      dock("idle"),
      status("", 0),
    ],
  },
  {
    match: (q) => word(q, "playbook", "borrow", "ideas", "suggest"),
    build: (q) => [
      dock("thinking"),
      status("scanning the network..."),
      nav("playbooks"),
      { delay: 400, event: { type: "reply.start", query: q } },
      dock("speaking"),
      ...streamReply(
        "thirteen playbooks across your org, the network, and my suggestions. standup assembler is trending -- 34 orgs use it.",
      ),
      { delay: 200, event: { type: "reply.done" } },
      dock("idle"),
      status("", 0),
    ],
  },
  {
    match: (q) => word(q, "setting", "config", "threshold", "integration", "member"),
    build: (q) => [
      dock("thinking"),
      nav("settings"),
      { delay: 200, event: { type: "reply.start", query: q } },
      dock("speaking"),
      ...streamReply("here are your settings. four integrations connected, two pending."),
      { delay: 200, event: { type: "reply.done" } },
      dock("idle"),
      status("", 0),
    ],
  },
  {
    match: (q) => word(q, "workflow", "automation", "recipe"),
    build: (q) => [
      dock("thinking"),
      status("loading workflows..."),
      nav("workflow"),
      { delay: 400, event: { type: "reply.start", query: q } },
      dock("speaking"),
      ...streamReply("three live workflows. bug triage runs most often -- 34 times this week."),
      { delay: 200, event: { type: "reply.done" } },
      dock("idle"),
      status("", 0),
    ],
  },
  {
    match: (q) => word(q, "waffle", "talk", "voice", "tell you"),
    build: (q) => [
      dock("thinking"),
      nav("waffle"),
      { delay: 200, event: { type: "reply.start", query: q } },
      dock("speaking"),
      ...streamReply("ready to listen. hold the dot and tell me what is on your mind."),
      { delay: 200, event: { type: "reply.done" } },
      dock("idle"),
      status("", 0),
    ],
  },
];

const FALLBACK: Script = {
  match: () => true,
  build: (q) => [
    dock("thinking"),
    { delay: 400, event: { type: "reply.start", query: q } },
    dock("speaking"),
    ...streamReply(
      "i am not sure what you mean. try asking about your morning brief, workflows, graph, stack, playbooks, or settings.",
    ),
    { delay: 200, event: { type: "reply.done" } },
    dock("idle"),
    status("", 0),
  ],
};

export async function* routeIntent(q: string): AsyncGenerator<AgentEvent> {
  const script = SCRIPTS.find((s) => s.match(q)) ?? FALLBACK;
  const steps = script.build(q);
  const t0 = Date.now();
  let accDelay = 0;
  for (const step of steps) {
    accDelay += step.delay;
    const wait = accDelay - (Date.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    yield step.event;
  }
}
