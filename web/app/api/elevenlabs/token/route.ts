import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Generates a signed token for client-side ElevenLabs Conversational AI
 * WebSocket authentication. The token is short-lived and scoped to the
 * configured agent ID.
 *
 * POST /api/elevenlabs/token → { token: string, agent_id: string }
 *
 * Returns 503 if ElevenLabs Conversational AI is not configured.
 */
export async function POST(_req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_CONVAI_AGENT_ID;

  if (!apiKey || !agentId) {
    return NextResponse.json(
      { error: "ElevenLabs Conversational AI not configured" },
      { status: 503 }
    );
  }

  try {
    // Request a signed token from ElevenLabs for client-side auth
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/convai/agents/${agentId}/token`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      }
    );

    if (!upstream.ok) {
      const errText = await upstream.text();
      return NextResponse.json(
        { error: `elevenlabs error ${upstream.status}: ${errText.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const data = (await upstream.json()) as { token?: string };

    if (!data.token) {
      return NextResponse.json(
        { error: "invalid response from ElevenLabs: missing token" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      token: data.token,
      agent_id: agentId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `failed to generate token: ${message}` },
      { status: 500 }
    );
  }
}
