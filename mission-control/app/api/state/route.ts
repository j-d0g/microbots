import { ensureBooted } from "@/lib/server/boot";
import { snapshot } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  ensureBooted();
  return Response.json(snapshot());
}
