/**
 * Thin client for the Python harness MCP server (run_code, save_workflow,
 * etc.). Lives behind `HARNESS_MCP_URL` + `HARNESS_MCP_TOKEN` env vars
 * so Vercel deploys can opt in by pointing at the Render-hosted harness
 * instance (`microbot-harness-mcp.onrender.com/sse`). When the env is
 * unset we behave as a no-op and the orchestrator surfaces a graceful
 * "harness not configured" envelope to the UI.
 *
 * Implementation notes:
 *   - Uses the AI SDK MCP client (`@ai-sdk/mcp`) with the SSE transport
 *     to match the FastMCP server in `agent/harness/mcp/server.py`.
 *   - The client is cached per-process. SSE keeps the session warm.
 *   - Errors bubble up to the caller; tools.ts converts them into
 *     window envelopes so users still see what happened.
 */

import { experimental_createMCPClient as createMCPClient } from "@ai-sdk/mcp";

type HarnessClient = Awaited<ReturnType<typeof createMCPClient>>;

let cached: Promise<HarnessClient> | null = null;

function readEnv(): { url: string; token: string | undefined } | null {
  const url = process.env.HARNESS_MCP_URL;
  if (!url) return null;
  const token = process.env.HARNESS_MCP_TOKEN || undefined;
  return { url, token };
}

export function hasHarnessMcpConfig(): boolean {
  return Boolean(readEnv());
}

async function getClient(): Promise<HarnessClient> {
  if (cached) return cached;
  const cfg = readEnv();
  if (!cfg) throw new Error("HARNESS_MCP_URL not set");
  const headers: Record<string, string> = {};
  if (cfg.token) headers["Authorization"] = `Bearer ${cfg.token}`;
  // SSE matches FastMCP's default streamable transport. The /sse path
  // is part of the URL value the user supplies, e.g.
  //   https://microbot-harness-mcp.onrender.com/sse
  cached = createMCPClient({
    transport: { type: "sse", url: cfg.url, headers },
  }).catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}

/**
 * Invoke a harness tool by name and return its raw result envelope.
 * The harness server returns `{ result, stdout, stderr, error }` for
 * `run_code`; other tools return whatever shape `agent/harness/mcp`
 * defines. tools.ts narrows the result before forwarding to the UI.
 */
export async function callHarnessTool(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const client = await getClient();
  const tools = (await client.tools()) as unknown as Record<
    string,
    { execute?: (a: unknown, opts?: unknown) => Promise<unknown> } | undefined
  >;
  const fn = tools[name];
  if (!fn || typeof fn.execute !== "function") {
    throw new Error(`harness tool not available: ${name}`);
  }
  const out = await fn.execute(args, { toolCallId: name, messages: [] });
  if (out && typeof out === "object") return out as Record<string, unknown>;
  return { result: out };
}
