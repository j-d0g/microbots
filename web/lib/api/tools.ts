/**
 * V1 harness tool adapters — mock-first.
 *
 * Each function matches the exact input/output schema from Jordan's
 * MCP server (agent/harness/mcp/server.py). Deterministic mocks now;
 * one-line URL swap to live endpoints later.
 *
 * Contract source: agent/scratchpad/p1-harness-mvp/notes/05-tool-schemas.md
 */

/* ============================== config ============================== */

/** When set, adapters call the live harness instead of returning mocks. */
export const TOOL_BASE_URL: string | null =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_HARNESS_BASE_URL) ||
  null;

/* ============================== types ============================== */

export interface RunCodeInput {
  code: string;
  args?: Record<string, unknown>;
}

export interface RunCodeOutput {
  result: unknown | null;
  stdout: string;
  stderr: string;
  error: string | null;
}

export interface FindExamplesInput {
  query: string;
}

export interface ExampleMatch {
  id: string;
  title: string;
  description: string;
  tags: string[];
  code: string;
}

export interface FindExamplesOutput {
  matches: ExampleMatch[];
  count: number;
}

export interface SaveWorkflowInput {
  name: string;
  code: string;
  overwrite?: boolean;
}

export type SaveWorkflowOutput =
  | { url: string; saved_to: string; bytes: number; overwritten?: boolean }
  | { error: "exists"; slug: string; existing_bytes: number; hint: string }
  | { error: "code too large"; bytes: number; max_bytes: number }
  | { error: string };

export interface ViewWorkflowInput {
  name: string;
}

export type ViewWorkflowOutput =
  | { name: string; slug: string; code: string; bytes: number; modified_at: string }
  | { error: "not found"; slug: string; available?: string[] };

export interface RunWorkflowInput {
  name: string;
  args?: Record<string, unknown>;
}

export type RunWorkflowOutput =
  | { result: unknown | null; stdout: string; stderr: string; error: string | null }
  | { error: "not found"; slug: string; available?: string[] };

export interface ListWorkflowsOutput {
  count: number;
  workflows: Array<{
    slug: string;
    summary: string;
    bytes: number;
    modified_at: string;
  }>;
}

export interface SearchMemoryInput {
  query: string;
  scope?: "kg" | "recent_chats" | "all";
}

export interface SearchMemoryResult {
  source: string;
  scope: "kg" | "recent_chats";
  snippet: string;
  score: number;
}

export interface SearchMemoryOutput {
  results: SearchMemoryResult[];
  count: number;
  scope: string;
}

export interface AskUserInput {
  question: string;
  options?: string[];
}

/* ============================== mock data ========================== */

const MOCK_WORKFLOWS = [
  {
    slug: "bug-triage",
    summary: "Triage new Slack bug reports into Linear with confidence note in Notion",
    bytes: 842,
    modified_at: "2026-04-25T14:32:00Z",
    code: `"""Triage new Slack bug reports into Linear with a confidence note in Notion."""
import httpx

def triage(messages):
    issues = []
    for msg in messages:
        if "bug" in msg.lower() or "error" in msg.lower():
            issues.append({"title": msg[:80], "confidence": 0.85})
    return issues

result = triage(args.get("messages", []))
print(f"Triaged {len(result)} issues")`,
  },
  {
    slug: "notion-summary",
    summary: "Summarise a Notion doc and post to Slack",
    bytes: 614,
    modified_at: "2026-04-24T09:15:00Z",
    code: `"""Summarise a Notion doc and post the summary to Slack."""
import httpx

doc_id = args.get("doc_id", "sample-doc")
# fetch doc content
content = f"Sample content for doc {doc_id}"
summary = content[:200] + "..."
print(f"Summary: {summary}")`,
  },
  {
    slug: "daily-digest",
    summary: "Compile a daily digest from Gmail, Slack, and Linear",
    bytes: 1203,
    modified_at: "2026-04-23T18:45:00Z",
    code: `"""Compile a daily digest from Gmail, Slack, and Linear."""
from datetime import datetime

digest = {
    "date": datetime.now().isoformat(),
    "gmail": ["3 unread from team"],
    "slack": ["12 messages in #engineering"],
    "linear": ["2 issues assigned"],
}
print(f"Digest for {digest['date']}: {len(digest['gmail'])} gmail, {len(digest['slack'])} slack, {len(digest['linear'])} linear")`,
  },
];

const MOCK_EXAMPLES: ExampleMatch[] = [
  {
    id: "ex-slack-triage",
    title: "Slack Bug Triage",
    description: "Monitors a Slack channel for bug reports and creates Linear issues automatically",
    tags: ["slack", "linear", "triage", "automation"],
    code: `"""Monitor Slack channel for bugs, create Linear issues."""
import httpx
# ... template code ...`,
  },
  {
    id: "ex-notion-sync",
    title: "Notion Doc Sync",
    description: "Sync meeting notes from Notion to a shared Slack channel",
    tags: ["notion", "slack", "sync", "meetings"],
    code: `"""Sync Notion meeting notes to Slack."""
import httpx
# ... template code ...`,
  },
  {
    id: "ex-gmail-digest",
    title: "Gmail Daily Digest",
    description: "Compile important emails into a daily summary posted to Slack",
    tags: ["gmail", "slack", "digest", "daily"],
    code: `"""Daily email digest to Slack."""
import httpx
# ... template code ...`,
  },
];

const MOCK_MEMORIES: SearchMemoryResult[] = [
  {
    source: "kg:memory-001",
    scope: "kg",
    snippet: "Desmond mentioned auth should use OAuth2 with PKCE flow for the mobile app. Discussed during the architecture review on 2026-04-18.",
    score: 0.92,
  },
  {
    source: "kg:memory-002",
    scope: "kg",
    snippet: "Bug triage workflow was updated to include confidence scoring. Linear labels now auto-applied based on severity.",
    score: 0.87,
  },
  {
    source: "kg:memory-003",
    scope: "kg",
    snippet: "Notion integration requires workspace-level OAuth. Token refresh handled by Composio automatically.",
    score: 0.81,
  },
  {
    source: "kg:memory-004",
    scope: "kg",
    snippet: "Slack bot permissions need channels:history and chat:write scopes for the triage workflow to read and respond.",
    score: 0.76,
  },
  {
    source: "kg:memory-005",
    scope: "kg",
    snippet: "Gmail API rate limit is 250 quota units per user per second. Daily digest should batch requests.",
    score: 0.71,
  },
];

/* ============================== adapters =========================== */

/** Simulate ~2s execution delay for realistic mock behavior. */
function delay(ms = 800): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runCode(input: RunCodeInput): Promise<RunCodeOutput> {
  if (TOOL_BASE_URL) {
    const res = await fetch(`${TOOL_BASE_URL}/api/tools/run_code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return res.json();
  }

  await delay(1200);
  // Mock: evaluate simple print statements
  const hasError = input.code.includes("raise") || input.code.includes("1/0");
  if (hasError) {
    return {
      result: null,
      stdout: "",
      stderr: "Traceback (most recent call last):\n  ZeroDivisionError: division by zero",
      error: "ZeroDivisionError: division by zero",
    };
  }
  return {
    result: null,
    stdout: `[mock] executed ${input.code.split("\n").length} lines\nok\n`,
    stderr: "",
    error: null,
  };
}

export async function findExamples(input: FindExamplesInput): Promise<FindExamplesOutput> {
  if (TOOL_BASE_URL) {
    const res = await fetch(`${TOOL_BASE_URL}/api/tools/find_examples?query=${encodeURIComponent(input.query)}`);
    return res.json();
  }

  await delay(400);
  const q = input.query.toLowerCase();
  const matches = MOCK_EXAMPLES.filter(
    (e) =>
      e.title.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      e.tags.some((t) => t.includes(q)),
  ).slice(0, 3);
  return { matches, count: matches.length };
}

export async function saveWorkflow(input: SaveWorkflowInput): Promise<SaveWorkflowOutput> {
  if (TOOL_BASE_URL) {
    const res = await fetch(`${TOOL_BASE_URL}/api/tools/save_workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return res.json();
  }

  await delay(600);
  const slug = input.name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  if (!slug) return { error: "invalid name (must produce a non-empty slug)" };

  const bytes = new TextEncoder().encode(input.code).length;
  if (bytes > 1_000_000) {
    return { error: "code too large", bytes, max_bytes: 1_000_000 };
  }

  const existing = MOCK_WORKFLOWS.find((w) => w.slug === slug);
  if (existing && !input.overwrite) {
    return {
      error: "exists",
      slug,
      existing_bytes: existing.bytes,
      hint: "pass overwrite=true to replace, or pick a different name",
    };
  }

  return {
    url: `https://harness.microbots.dev/workflows/${slug}`,
    saved_to: `saved/${slug}.py`,
    bytes,
  };
}

export async function viewWorkflow(input: ViewWorkflowInput): Promise<ViewWorkflowOutput> {
  if (TOOL_BASE_URL) {
    const res = await fetch(
      `${TOOL_BASE_URL}/api/tools/view_workflow?name=${encodeURIComponent(input.name)}`,
    );
    return res.json();
  }

  await delay(300);
  const slug = input.name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "");
  const wf = MOCK_WORKFLOWS.find((w) => w.slug === slug);
  if (!wf) {
    return {
      error: "not found",
      slug,
      available: MOCK_WORKFLOWS.map((w) => w.slug),
    };
  }
  return {
    name: input.name,
    slug: wf.slug,
    code: wf.code,
    bytes: wf.bytes,
    modified_at: wf.modified_at,
  };
}

export async function runWorkflow(input: RunWorkflowInput): Promise<RunWorkflowOutput> {
  if (TOOL_BASE_URL) {
    const res = await fetch(`${TOOL_BASE_URL}/api/tools/run_workflow`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return res.json();
  }

  await delay(1500);
  const slug = input.name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "");
  const wf = MOCK_WORKFLOWS.find((w) => w.slug === slug);
  if (!wf) {
    return {
      error: "not found",
      slug,
      available: MOCK_WORKFLOWS.map((w) => w.slug),
    };
  }
  return {
    result: { issues_triaged: 3, notes_created: 3 },
    stdout: `[mock] running ${wf.slug}...\nTriaged 3 issues\nCreated 3 Notion notes\nDone.\n`,
    stderr: "",
    error: null,
  };
}

export async function listWorkflows(): Promise<ListWorkflowsOutput> {
  if (TOOL_BASE_URL) {
    const res = await fetch(`${TOOL_BASE_URL}/api/tools/list_workflows`);
    return res.json();
  }

  await delay(200);
  return {
    count: MOCK_WORKFLOWS.length,
    workflows: MOCK_WORKFLOWS.map(({ slug, summary, bytes, modified_at }) => ({
      slug,
      summary,
      bytes,
      modified_at,
    })),
  };
}

export async function searchMemory(input: SearchMemoryInput): Promise<SearchMemoryOutput> {
  if (TOOL_BASE_URL) {
    const res = await fetch(`${TOOL_BASE_URL}/api/tools/search_memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    return res.json();
  }

  await delay(500);
  const scope = input.scope ?? "all";

  if (scope === "recent_chats") {
    return { results: [], count: 0, scope, };
  }

  const q = input.query.toLowerCase();
  const filtered = MOCK_MEMORIES.filter(
    (m) => !q || m.snippet.toLowerCase().includes(q),
  );
  return { results: filtered.slice(0, 10), count: filtered.length, scope };
}

// ask_user is client-resolved — no adapter needed. The tool call is
// intercepted by the frontend and rendered as a UI prompt. The user's
// answer flows back as the tool result.
