import { z } from "zod";
import { runShepherdTurn } from "@/lib/server/shepherd";
import { ensureBooted } from "@/lib/server/boot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  ensureBooted();
  try {
    const body = z.object({ text: z.string().min(1).max(4_000) }).parse(await request.json());
    return Response.json(await runShepherdTurn(body.text));
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "Invalid request.";
    return Response.json({ error: message }, { status: 400 });
  }
}
