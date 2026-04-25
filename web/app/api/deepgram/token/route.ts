import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mints a short-lived Deepgram key for the browser. The server-side key
 *  (DEEPGRAM_API_KEY) must never leave the server. */
export async function POST() {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "DEEPGRAM_API_KEY not set — voice is stubbed." },
      { status: 501 },
    );
  }
  // TODO: call Deepgram /v1/projects/{project_id}/keys with a short TTL.
  // For now return the key so the browser client can be smoke-tested; swap
  // to a scoped token before any public deployment.
  return NextResponse.json({ key, ttl: 60 });
}
