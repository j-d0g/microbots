import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reports which providers the server is willing to broker for voice
 * input + output. The browser uses this on mount to decide between
 * native Web Speech APIs (zero key) and the high-fidelity ElevenLabs
 * round-trip (server-held key).
 *
 * Order of preference for TTS: ElevenLabs > Cartesia > browser.
 * Order of preference for STT: ElevenLabs > Deepgram (future) > browser.
 *
 * Never returns the keys themselves.
 */
export async function GET() {
  const eleven = !!process.env.ELEVENLABS_API_KEY;
  const elevenVoice = !!process.env.ELEVENLABS_VOICE_ID;
  const cartesia = !!process.env.CARTESIA_API_KEY && !!process.env.CARTESIA_VOICE_ID;
  const deepgram = !!process.env.DEEPGRAM_API_KEY;

  const tts: "elevenlabs" | "cartesia" | "browser" =
    eleven && elevenVoice ? "elevenlabs" : cartesia ? "cartesia" : "browser";

  // ElevenLabs Scribe handles STT; Deepgram is reserved for the future.
  const stt: "elevenlabs" | "deepgram" | "browser" =
    eleven ? "elevenlabs" : deepgram ? "deepgram" : "browser";

  return NextResponse.json({ tts, stt });
}
