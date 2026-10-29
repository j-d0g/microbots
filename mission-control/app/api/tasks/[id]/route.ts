import { z } from "zod";
import { startTask } from "@/lib/server/arms";
import { ensureBooted } from "@/lib/server/boot";
import { deleteTask, getAgent, getTask, patchTask } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  status: z.enum(["backlog", "todo", "doing", "review", "done"]).optional(),
  priority: z.enum(["p0", "p1", "p2", "p3"]).optional(),
  agentId: z.string().nullable().optional(),
  title: z.string().min(1).max(240).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required.");

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  ensureBooted();
  try {
    const { id } = await context.params;
    const patch = patchSchema.parse(await request.json());
    const task = patchTask(id, patch);
    if (!task) return Response.json({ error: "Task not found." }, { status: 404 });
    if (task.status === "doing" && task.agentId && getAgent(task.agentId)?.status !== "running") startTask(task.id);
    return Response.json(task);
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "Invalid request.";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  ensureBooted();
  const { id } = await context.params;
  if (!getTask(id)) return Response.json({ error: "Task not found." }, { status: 404 });
  deleteTask(id);
  return new Response(null, { status: 204 });
}
