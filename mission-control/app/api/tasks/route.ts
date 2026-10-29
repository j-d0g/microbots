import { z } from "zod";
import { ensureBooted } from "@/lib/server/boot";
import { createTask } from "@/lib/server/store";
import { startTask } from "@/lib/server/arms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  title: z.string().min(1).max(240),
  description: z.string().max(2_000).optional(),
  priority: z.enum(["p0", "p1", "p2", "p3"]).optional(),
  agentId: z.string().optional(),
});

export async function POST(request: Request): Promise<Response> {
  ensureBooted();
  try {
    const body = bodySchema.parse(await request.json());
    const task = createTask(body);
    if (task.agentId) startTask(task.id);
    return Response.json(task, { status: 201 });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "Invalid request.";
    return Response.json({ error: message }, { status: 400 });
  }
}
