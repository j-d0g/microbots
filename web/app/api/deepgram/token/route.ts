import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mints a short-lived Deepgram key for the browser.
 *  The server-side key (DEEPGRAM_API_KEY) must never leave the server.
 *
 *  This iteration uses Web Speech API for voice — Deepgram integration is
 *  deferred. The endpoint always returns 501 so no secret is ever exposed. */
export async function POST() {
  // TODO: when Deepgram is wired in, call /v1/projects/{project_id}/keys
  // with a short TTL and return only the scoped temporary key.
  return NextResponse.json(
    { error: "Deepgram not configured — using Web Speech API fallback." },
    { status: 501 },
  );
}
