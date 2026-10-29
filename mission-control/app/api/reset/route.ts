import { ensureBooted } from "@/lib/server/boot";
import { publish } from "@/lib/server/bus";
import { clearDb } from "@/lib/server/db";
import { snapshot } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  clearDb();
  ensureBooted();
  const fresh = snapshot();
  publish({ type: "snapshot", snapshot: fresh });
  return Response.json(fresh);
}
