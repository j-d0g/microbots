"use client";

import type { AgentEvent } from "./agent-client";
import type { RoomName } from "./store";

/** Dummy intent router. Pattern-matches a typed query and yields a
 *  scripted AgentEvent timeline that mirrors what a real Pydantic AI
 *  agent would emit: navigate the canvas, push generative UI cards,
 *  and stream a text reply.
 *
 *  Everything is local + deterministic so the end-to-end flow can be
 *  demoed without any API keys. */

type Step = { delay: number; event: AgentEvent };

interface Script {
  match: (q: string) => boolean;
  build: (q: string) => Step[];
}

const word = (q: string, ...keys: string[]) =>
  keys.some((k) => q.toLowerCase().includes(k));

/** Stream a reply string out as char-by-char chunks, fast but visible. */
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

function nav(room: RoomName, slug?: string): Step {
  return { delay: 80, event: { type: "ui.room", room, slug } };
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
  // -----------------------------------------------------------------
  // brief / morning
  {
    match: (q) => word(q, "morning", "brief", "today", "what's new", "whats new"),
    build: (q) => [
      dock("thinking"),
      status("reading last night's signal…"),
      nav("brief"),
      { delay: 600, event: { type: "reply.start", query: q } },
      dock("speaking"),
      ...streamReply(
        "morning. three for you today — bug triage, the friday update, and a short housekeeping pass. press / again if you want me to walk through one.",
      ),
      { delay: 200, event: { type: "reply.done" } },
      status("", 0),
      dock("idle"),
    ],
  },

  // -----------------------------------------------------------------
  // bug triage walkthrough
  {
    match: (q) => word(q, "bug triage", "triage", "show me how", "bug pipeline"),
    build: (q) => [
      dock("thinking"),
      status("opening the bug triage workflow…"),
      nav("workflow", "bug-triage-pipeline"),
      { delay: 200, event: { type: "reply.start", query: q } },
      dock("speaking"),
      ...streamReply(
        "here's the bug triage pipeline, top to bottom. five steps; the assignment is the only one with a confidence threshold below 0.9, so it'll defer to you when it's not sure.",
      ),
      card(
        `mem-${Date.now()}`,
        "memory",
        {
          text: "You triage Slack #product-bugs into Linear every weekday morning.",
          confidence: 0.94,
        },
        6500,
      ),
      { delay: 200, event: { type: "reply.done" } },
      dock("idle"),
      status("", 0),
    ],
  },

  // -----------------------------------------------------------------
  // graph
  {
    match: (q) => word(q, "graph", "remember", "memory", "ontology"),
    build: (q) => [
      dock("thinking"),
      status("plotting what i know…"),
      nav("graph"),
      { delay: 500, event: { type: "reply.start", query: q } },
      dock("speaking"),
      ...streamReply(
        "this is what i remember about your work. five integrations, a handful of entities, three memories i'm confident about, and two workflows that touch them. ask me to highlight anything.",
      ),
      { delay: 200, event: { type: "reply.done" } },
      dock("idle"),
      status("", 0),
    ],
  },

  // -----------------------------------------------------------------
  // stack
  {
    match: (q) => word(q, "stack", "service", "microservice", "deploy"),
    build: (q) => [
      dock("thinking"),
      status("listing services…"),
      nav("stack"),
      { delay: 400, event: { type: "reply.start", query: q } },
      dock("speaking"),
      ...streamReply(
        "five python microservices running. gmail-distiller is in warning — its input volume tripled overnight. the rest are green.",
      ),
      card(
        `toast-${Date.now()}`,
        "toast",
        { text: "gmail-distiller is in warn." },
        4500,
      ),
      { delay: 200, event: { type: "reply.done" } },
      dock("idle"),
      status("", 0),
    ],
  },

  // -----------------------------------------------------------------
  // playbooks
  {
    match: (q) => word(q, "playbook", "borrow", "ideas", "suggest"),
    build: (q) => [
      dock("thinking"),
      status("scanning the network…"),
      nav("playbooks"),
      { delay: 400, event: { type: "reply.start", query: q } },
      dock("speaking"),
      ...streamReply(
        "from your org and the curated network — seven candidates. the suggested column is the closest match to your graph; try one and i'll queue it for tonight's proposer.",
      ),
      { delay: 200, event: { type: "reply.done" } },
      dock("idle"),
      status("", 0),
    ],
  },

  // -----------------------------------------------------------------
  // settings
  {
    match: (q) => word(q, "settings", "integration", "members", "preferences"),
    build: (q) => [
      dock("thinking"),
      nav("settings"),
      { delay: 350, event: { type: "reply.start", query: q } },
      dock("speaking"),
      ...streamReply(
        "five integrations connected, perplexity is still pending. confidence threshold is 0.80 — say 'raise my threshold to 0.9' if you'd like a quieter morning.",
      ),
      { delay: 200, event: { type: "reply.done" } },
      dock("idle"),
      status("", 0),
    ],
  },

  // -----------------------------------------------------------------
  // workflows index
  {
    match: (q) => word(q, "workflow", "automation", "what's running", "whats running"),
    build: (q) => [
      dock("thinking"),
      nav("workflow"),
      { delay: 350, event: { type: "reply.start", query: q } },
      dock("speaking"),
      ...streamReply(
        "three live workflows. bug triage is running every weekday, the friday update fires once a week, and the stale PR reminder runs on demand. say 'show me the bug triage one' to open it.",
      ),
      { delay: 200, event: { type: "reply.done" } },
      dock("idle"),
      status("", 0),
    ],
  },

  // -----------------------------------------------------------------
  // waffle
  {
    match: (q) => word(q, "waffle", "vent", "rant", "i hate", "annoying"),
    build: (q) => [
      dock("thinking"),
      nav("waffle"),
      { delay: 300, event: { type: "reply.start", query: q } },
      dock("speaking"),
      ...streamReply(
        "got it. tell me the boring part — i'll write the memory and propose something tonight. nothing leaves until you approve.",
      ),
      card(
        `mem-${Date.now()}`,
        "memory",
        {
          text: `Recurring frustration · "${q.slice(0, 80)}"`,
          confidence: 0.74,
        },
        6500,
      ),
      { delay: 200, event: { type: "reply.done" } },
      dock("idle"),
      status("", 0),
    ],
  },

  // -----------------------------------------------------------------
  // explain (generic)
  {
    match: (q) => word(q, "explain", "why", "what is"),
    build: (q) => [
      dock("thinking"),
      { delay: 250, event: { type: "reply.start", query: q } },
      dock("speaking"),
      ...streamReply(
        `here's how i'd explain that, in one breath: it's the smallest unit of work i can do for you that pays its keep. if i'm wrong, say "not yet" and i'll defer.`,
      ),
      card(
        `entity-${Date.now()}`,
        "entity",
        {
          text: `Concept · ${q.slice(0, 60)}`,
          confidence: 0.81,
        },
        5500,
      ),
      { delay: 200, event: { type: "reply.done" } },
      dock("idle"),
    ],
  },

  // -----------------------------------------------------------------
  // draft (generic)
  {
    match: (q) => word(q, "draft", "write", "compose"),
    build: (q) => [
      dock("thinking"),
      { delay: 300, event: { type: "reply.start", query: q } },
      dock("speaking"),
      ...streamReply(
        "drafted. i kept it short, in your voice, and i flagged the two facts i wasn't 100% sure on so you can sweep them.",
      ),
      card(
        `diff-${Date.now()}`,
        "diff",
        {
          text: `Draft ready · ${q.slice(0, 60)}`,
          confidence: 0.86,
        },
        6500,
      ),
      { delay: 200, event: { type: "reply.done" } },
      dock("idle"),
    ],
  },
];

const FALLBACK: Script = {
  match: () => true,
  build: (q) => [
    dock("thinking"),
    { delay: 300, event: { type: "reply.start", query: q } },
    dock("speaking"),
    ...streamReply(
      "i haven't learned that one yet. try 'morning', 'show me the graph', 'open the bug triage workflow', 'list services', or 'draft the friday update'.",
    ),
    { delay: 200, event: { type: "reply.done" } },
    dock("idle"),
  ],
};

function chooseScript(query: string): Script {
  for (const s of SCRIPTS) if (s.match(query)) return s;
  return FALLBACK;
}

export async function* routeIntent(
  query: string,
): AsyncGenerator<AgentEvent> {
  const script = chooseScript(query.trim());
  const steps = script.build(query.trim());
  for (const step of steps) {
    if (step.delay > 0) {
      await new Promise((r) => setTimeout(r, step.delay));
    }
    yield step.event;
  }
}
