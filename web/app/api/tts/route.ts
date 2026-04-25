import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Proxies TTS synthesis to Cartesia (preferred) or ElevenLabs. Expects
 *  { text: string, voice?: string } and returns audio/mpeg. Returns 501
 *  when no provider is configured so the UI can fall back to silent
 *  ink-only responses. */
export async function POST(req: NextRequest) {
  const { text, voice } = (await req.json()) as {
    text: string;
    voice?: string;
  };
  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  const cartesia = process.env.CARTESIA_API_KEY;
  const cartesiaVoice = voice ?? process.env.CARTESIA_VOICE_ID;
  if (cartesia && cartesiaVoice) {
    const upstream = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-API-Key": cartesia,
        "Cartesia-Version": "2024-06-10",
      },
      body: JSON.stringify({
        model_id: "sonic-english",
        transcript: text,
        voice: { mode: "id", id: cartesiaVoice },
        output_format: {
          container: "mp3",
          encoding: "mp3",
          sample_rate: 44100,
        },
      }),
    });
    return new Response(upstream.body, {
      headers: { "content-type": "audio/mpeg" },
    });
  }

  const eleven = process.env.ELEVENLABS_API_KEY;
  const elevenVoice = voice ?? process.env.ELEVENLABS_VOICE_ID;
  if (eleven && elevenVoice) {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${elevenVoice}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "xi-api-key": eleven,
          accept: "audio/mpeg",
        },
        body: JSON.stringify({ text, model_id: "eleven_turbo_v2" }),
      },
    );
    return new Response(upstream.body, {
      headers: { "content-type": "audio/mpeg" },
    });
  }

  return NextResponse.json(
    { error: "no TTS provider configured — UI will stay silent." },
    { status: 501 },
  );
}
