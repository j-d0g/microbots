import { z } from "zod";
import { answerAsk } from "@/lib/server/arms";
import { ensureBooted } from "@/lib/server/boot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  ensureBooted();
  try {
    const { id } = await context.params;
    const body = z.object({ answer: z.string().min(1).max(1_000) }).parse(await request.json());
    const answered = await answerAsk(id, body.answer);
    if (!answered) return Response.json({ error: "Task has no unanswered question." }, { status: 409 });
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "Invalid request.";
    return Response.json({ error: message }, { status: 400 });
  }
}
