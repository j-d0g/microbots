import { z } from "zod";
import type { Agent } from "@/lib/types";
import { ensureBooted } from "@/lib/server/boot";
import { shortId } from "@/lib/server/ids";
import { listAgents, upsertAgent } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  name: z.string().min(1).max(80),
  role: z.string().min(1).max(120),
  goal: z.string().min(1).max(800),
  voice: z.string().optional(),
});

export async function POST(request: Request): Promise<Response> {
  ensureBooted();
  try {
    const input = bodySchema.parse(await request.json());
    const palette = ["#34d399", "#fb7185", "#fbbf24", "#818cf8", "#2dd4bf", "#c084fc"];
    const usedColors = new Set(listAgents().map((agent) => agent.color.toLowerCase()));
    const now = Date.now();
    const agent: Agent = {
      id: shortId("agent"),
      name: input.name,
      role: input.role,
      goal: input.goal,
      voice: input.voice ?? "sage",
      color: palette.find((color) => !usedColors.has(color.toLowerCase())) ?? palette[listAgents().length % palette.length],
      status: "idle",
      currentTaskId: null,
      lastLine: "Ready for a focused assignment.",
      tokens: 0,
      costUsd: 0,
      createdAt: now,
      updatedAt: now,
    };
    return Response.json(upsertAgent(agent), { status: 201 });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "Invalid request.";
    return Response.json({ error: message }, { status: 400 });
  }
}
