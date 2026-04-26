import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns a short-lived signed WebSocket URL for ElevenLabs
 * Conversational AI, scoped to the configured agent.
 *
 *   GET /api/elevenlabs/signed-url
 *     → 200 { signed_url, agent_id }             // private agent
 *     → 200 { signed_url: null, agent_id, public: true }
 *                                                // public agent
 *     → 503 { error: "not configured" }
 *
 * The browser connects directly to `signed_url` (a `wss://` URL with
 * auth baked into query params). The server-held ELEVENLABS_API_KEY
 * is never returned.
 *
 * For public agents no signed URL is needed — the caller connects to
 *   wss://api.elevenlabs.io/v1/convai/conversation?agent_id={id}
 * directly.
 */
export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId =
    process.env.ELEVENLABS_CONVAI_AGENT_ID ||
    process.env.NEXT_PUBLIC_ELEVENLABS_CONVAI_AGENT_ID;

  if (!agentId) {
    return NextResponse.json(
      { error: "ELEVENLABS_CONVAI_AGENT_ID not configured" },
      { status: 503 },
    );
  }

  // Without an API key we can only use public agents — surface that
  // to the client so it knows to use the unauth'd endpoint.
  if (!apiKey) {
    return NextResponse.json({
      signed_url: null,
      agent_id: agentId,
      public: true,
    });
  }

  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${encodeURIComponent(
        agentId,
      )}`,
      {
        method: "GET",
        headers: { "xi-api-key": apiKey },
        cache: "no-store",
      },
    );

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => "");
      // A 404 / 400 here usually means the agent is public — ElevenLabs
      // only issues signed URLs for private agents. Fall through so the
      // client uses the public endpoint.
      if (upstream.status === 400 || upstream.status === 404) {
        return NextResponse.json({
          signed_url: null,
          agent_id: agentId,
          public: true,
          note: `elevenlabs ${upstream.status}: ${body.slice(0, 180)}`,
        });
      }
      return NextResponse.json(
        { error: `elevenlabs ${upstream.status}: ${body.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const data = (await upstream.json()) as { signed_url?: string };
    if (!data.signed_url) {
      return NextResponse.json(
        { error: "elevenlabs response missing signed_url" },
        { status: 502 },
      );
    }

    return NextResponse.json({
      signed_url: data.signed_url,
      agent_id: agentId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `failed to fetch signed url: ${message}` },
      { status: 500 },
    );
  }
}
