import { NextRequest } from "next/server";
import { mockTimeline } from "@/lib/mock-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sseEncode(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "open_brief",
      description: "Open the morning brief room showing automation proposals and yesterday's runs.",
      parameters: { type: "object", properties: { date: { type: "string", description: "ISO date string, defaults to today" } }, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "open_graph",
      description: "Open the memory ontology graph room. Optional filters.",
      parameters: { type: "object", properties: { filter: { type: "object", properties: { layer: { type: "string" }, integration: { type: "string" }, since: { type: "string" }, query: { type: "string" } } } }, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "open_workflow",
      description: "Open a specific workflow by ID, or the workflow list if no ID.",
      parameters: { type: "object", properties: { id: { type: "string" } }, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "open_stack",
      description: "Open the microservice stack room. Optionally focus a specific service.",
      parameters: { type: "object", properties: { service_id: { type: "string" } }, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "open_waffle",
      description: "Open the voice waffle room for free-form voice input.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "open_playbook_hub",
      description: "Open the playbook hub showing org, network, and suggested playbooks.",
      parameters: { type: "object", properties: { scope: { type: "string", enum: ["org", "network", "suggested"] } }, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "open_settings",
      description: "Open settings. Optionally jump to a section.",
      parameters: { type: "object", properties: { section: { type: "string" } }, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "highlight",
      description: "Spotlight a node or element in the current room.",
      parameters: { type: "object", properties: { node_id: { type: "string" }, element_id: { type: "string" } }, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "explain",
      description: "Drop an inline explanation card next to a target element.",
      parameters: { type: "object", properties: { target: { type: "string" }, depth: { type: "string", enum: ["brief", "detailed"] } }, required: ["target"] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "show_card",
      description: "Show a transient card overlay (memory, entity, source, diff, or toast).",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["memory", "entity", "source", "diff", "toast"] },
          data: { type: "object", properties: { text: { type: "string" }, confidence: { type: "number" } } },
          ttl: { type: "number", description: "Auto-dismiss after ms" },
        },
        required: ["kind", "data"],
      },
    },
  },
];

const SYSTEM_PROMPT = `You are the microbots agent -- a calm, minimal AI assistant for Maya Chen, founder of Inkwell (B2B sales-coaching SaaS, 8-person team).

You have access to Maya's memory ontology (150+ nodes across integrations, entities, memories, skills, workflows) from overnight ingestion of Slack, GitHub, Linear, Gmail, Notion, and Perplexity.

Your job: help Maya navigate her automations, approve proposals, explore her memory graph, and manage her stack. You speak in short, warm, lowercase sentences. No emojis. No exclamation marks. Think MUJI catalog copy.

Tools available:
- open_brief, open_graph, open_workflow, open_stack, open_waffle, open_playbook_hub, open_settings: navigate rooms
- highlight, explain: act on current room content
- show_card: show transient overlays (toast for status, memory for recalled facts, entity for references)

Always use tools to navigate. Never just describe what you could do -- do it. If the user says "morning" or "brief", open the brief. If they mention a workflow, open it. If they ask about memory, open the graph.

Keep text replies under 2 sentences. Use tools aggressively.`;

interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

function toolCallToEvents(name: string, args: Record<string, unknown>): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];

  if (name.startsWith("open_")) {
    const roomMap: Record<string, string> = {
      open_brief: "brief",
      open_graph: "graph",
      open_workflow: "workflow",
      open_stack: "stack",
      open_waffle: "waffle",
      open_playbook_hub: "playbooks",
      open_settings: "settings",
    };
    const room = roomMap[name];
    if (room) {
      events.push({ type: "ui.room", room, payload: args });
    }
  } else if (name === "highlight") {
    events.push({ type: "ui.verb", verb: "highlight", args });
  } else if (name === "explain") {
    events.push({ type: "ui.verb", verb: "explain", args });
  } else if (name === "show_card") {
    events.push({
      type: "ui.card",
      card: {
        id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: args.kind ?? "toast",
        data: (args.data as Record<string, unknown>) ?? { text: "" },
        ttl: args.ttl,
      },
    });
  }

  return events;
}

async function streamRealAgent(
  query: string,
  currentRoom: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  enc: TextEncoder,
) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    controller.enqueue(enc.encode(sseEncode({ type: "agent.status", status: "no API key configured" })));
    return;
  }

  const messages: OpenRouterMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `[current room: ${currentRoom}] ${query}` },
  ];

  controller.enqueue(enc.encode(sseEncode({ type: "dock", state: "thinking" })));
  controller.enqueue(enc.encode(sseEncode({ type: "agent.status", status: "thinking..." })));

  // Allow up to 3 rounds of tool calls
  for (let round = 0; round < 3; round++) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://microbots.dev",
        "X-Title": "microbots",
      },
      body: JSON.stringify({
        model: "openai/gpt-4.1-mini",
        messages,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.3,
        max_tokens: 1024,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      controller.enqueue(enc.encode(sseEncode({
        type: "ui.card",
        card: { id: `err-${Date.now()}`, kind: "toast", data: { text: `agent error: ${res.status}` }, ttl: 5000 },
      })));
      console.error("OpenRouter error:", errText);
      break;
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice) break;

    const msg = choice.message;

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      // Process tool calls
      messages.push({
        role: "assistant",
        content: msg.content ?? null,
        tool_calls: msg.tool_calls,
      });

      for (const tc of msg.tool_calls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* empty */ }

        const events = toolCallToEvents(tc.function.name, args);
        for (const evt of events) {
          controller.enqueue(enc.encode(sseEncode(evt)));
        }

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ status: "ok", tool: tc.function.name }),
        });
      }

      // If there's also text content, stream it
      if (msg.content) {
        controller.enqueue(enc.encode(sseEncode({ type: "reply.start", query })));
        controller.enqueue(enc.encode(sseEncode({ type: "dock", state: "speaking" })));
        for (const ch of msg.content) {
          controller.enqueue(enc.encode(sseEncode({ type: "reply.chunk", text: ch })));
        }
        controller.enqueue(enc.encode(sseEncode({ type: "reply.done" })));
      }

      // Continue to next round if the model wants to make more tool calls
      if (choice.finish_reason === "tool_calls") continue;
      break;
    }

    // No tool calls, just text
    if (msg.content) {
      controller.enqueue(enc.encode(sseEncode({ type: "reply.start", query })));
      controller.enqueue(enc.encode(sseEncode({ type: "dock", state: "speaking" })));
      controller.enqueue(enc.encode(sseEncode({ type: "agent.status", status: msg.content.slice(0, 60) })));
      for (const ch of msg.content) {
        controller.enqueue(enc.encode(sseEncode({ type: "reply.chunk", text: ch })));
      }
      controller.enqueue(enc.encode(sseEncode({ type: "reply.done" })));
    }
    break;
  }

  controller.enqueue(enc.encode(sseEncode({ type: "dock", state: "idle" })));
  controller.enqueue(enc.encode(sseEncode({ type: "agent.status", status: "" })));
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const query = typeof body.query === "string" ? body.query : "";
  const currentRoom = typeof body.room === "string" ? body.room : "brief";

  const apiKey = process.env.OPENROUTER_API_KEY;
  const useMock = !apiKey || (!query && process.env.NEXT_PUBLIC_MOCK_AGENT === "true");

  if (useMock && !query) {
    // Mock timeline for initial connection
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        const t0 = Date.now();
        for (const step of mockTimeline) {
          const wait = step.at - (Date.now() - t0);
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
          controller.enqueue(enc.encode(sseEncode(step.event)));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      },
    });
  }

  // Real agent with OpenRouter
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      try {
        await streamRealAgent(query, currentRoom, controller, enc);
      } catch (err) {
        console.error("Agent stream error:", err);
        controller.enqueue(enc.encode(sseEncode({
          type: "ui.card",
          card: { id: `err-${Date.now()}`, kind: "toast", data: { text: "agent connection error" }, ttl: 5000 },
        })));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
