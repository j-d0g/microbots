import { NextResponse } from "next/server";

export const OPENAI_BASE = "https://api.openai.com/v1";

export type VoiceProvider = "openai" | "browser";

export function voiceProviders(): {
  stt: VoiceProvider;
  tts: VoiceProvider;
  live: boolean;
} {
  const provider = process.env.OPENAI_API_KEY ? "openai" : "browser";
  return {
    stt: provider,
    tts: provider,
    live: !!process.env.OPENAI_API_KEY,
  };
}

export function notConfigured() {
  return NextResponse.json(
    { error: "OPENAI_API_KEY not set; using browser voice." },
    { status: 503 },
  );
}
