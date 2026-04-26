import { anthropic } from "@ai-sdk/anthropic";
import { streamText, tool, experimental_createMCPClient } from "ai";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 180;

const SYSTEM_PROMPT = `You are a coding agent. The user gives you a task; you decide what to do.

You have four tools, fetched live from the MCP server:

- run_code(code, args?) — execute Python in a Render Workflows runner. Cold start ~5s; warm ~3s. Returns {result, stdout, stderr, error}. Pre-imports httpx, requests, beautifulsoup4. Print values you want to see in stdout.
- find_examples(query) — substring search the template library. Returns up to 3 matches with full source. Use BEFORE writing code if you suspect a template exists.
- save_workflow(name, code) — persist a snippet, returns a stable URL. Use when the user wants to save / promote / publish.
- ask_user(question, options?) — pause and ask the user a confirmation question. Use BEFORE destructive actions. The frontend renders a UI prompt; the user's answer is returned as a string.

Style: keep responses short. Show your work briefly, then give the answer. Prefer find_examples over guessing.`;

const MCP_URL = process.env.MCP_URL || "http://localhost:8765/sse";
const MCP_API_TOKEN = process.env.MCP_API_TOKEN || "dev-token-local";

export async function POST(req: Request) {
  const { messages } = await req.json();

  // Connect to the MCP server fresh per request. Cheap (one HTTP+SSE handshake).
  // Long-term we could cache the client, but for v0 plumbing keep it simple.
  let mcpClient: Awaited<ReturnType<typeof experimental_createMCPClient>> | null = null;
  try {
    mcpClient = await experimental_createMCPClient({
      transport: {
        type: "sse",
        url: MCP_URL,
        headers: { Authorization: `Bearer ${MCP_API_TOKEN}` },
      },
      name: "harness-frontend",
    });

    const mcpTools = await mcpClient.tools();

    // ask_user is declared on the MCP server but resolved client-side.
    // The Vercel AI SDK requires the tool's `execute` to be undefined for
    // client-resolved tools, so we override it here with a tool() that has
    // no execute function.
    const tools = {
      ...mcpTools,
      ask_user: tool({
        description:
          "Pause and ask the user a confirmation question. Use BEFORE destructive actions. The user's answer is returned as a string.",
        parameters: z.object({
          question: z.string(),
          options: z.array(z.string()).optional(),
        }),
        // No execute → client-resolved.
      }),
    };

    const result = streamText({
      model: anthropic(process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6"),
      system: SYSTEM_PROMPT,
      messages,
      maxSteps: 8,
      tools,
      onFinish: async () => {
        // Close the MCP client when the stream is done.
        await mcpClient?.close().catch(() => {});
      },
      onError: ({ error }) => {
        console.error("[/api/chat] streamText error:", error);
      },
    });

    return result.toDataStreamResponse({
      getErrorMessage: (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[/api/chat] stream error:", msg);
        return msg;
      },
    });
  } catch (err) {
    // If MCP connect itself fails, close any partial client and surface a clear error.
    await mcpClient?.close().catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/chat] mcp connect failed:", msg);
    return new Response(
      JSON.stringify({ error: `MCP connect failed: ${msg}` }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
