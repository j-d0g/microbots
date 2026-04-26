import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the ElevenLabs Conversational AI agent configuration.
 * The API key stays server-side; only the agent ID is exposed to the client.
 *
 * Response: { enabled: boolean; agentId?: string; error?: string }
 */
export async function GET() {
  const agentId = process.env.ELEVENLABS_CONVAI_AGENT_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { enabled: false, error: "ElevenLabs API key not configured" },
      { status: 200 }
    );
  }

  if (!agentId) {
    return NextResponse.json(
      { enabled: false, error: "ElevenLabs Conversational AI agent ID not configured" },
      { status: 200 }
    );
  }

  return NextResponse.json({
    enabled: true,
    agentId,
  });
}
