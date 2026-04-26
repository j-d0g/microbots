import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns the configured ElevenLabs Conversational AI agent ID and voice ID.
 * The client uses this to initialize the conversational AI widget.
 *
 * GET /api/elevenlabs/agent → { agent_id: string, voice_id: string }
 *
 * Returns 503 if ElevenLabs Conversational AI is not configured.
 */
export async function GET() {
  const agentId = process.env.ELEVENLABS_CONVAI_AGENT_ID;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!apiKey || !agentId) {
    return NextResponse.json(
      { error: "ElevenLabs Conversational AI not configured" },
      { status: 503 }
    );
  }

  return NextResponse.json({
    agent_id: agentId,
    voice_id: voiceId || "",
  });
}
