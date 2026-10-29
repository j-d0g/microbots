import { NextRequest, NextResponse } from "next/server";
import { OPENAI_BASE, notConfigured } from "../voice/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return notConfigured();

  const body = (await req.json()) as { text?: unknown };
  const text = typeof body.text === "string" ? body.text : "";
  if (!text.trim()) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  const upstream = await fetch(`${OPENAI_BASE}/audio/speech`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      input: text.slice(0, 4096),
      voice: process.env.OPENAI_TTS_VOICE || "alloy",
      response_format: "mp3",
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const error = upstream.ok
      ? "openai tts response body is empty"
      : `openai tts ${upstream.status}: ${(await upstream.text()).slice(0, 200)}`;
    return NextResponse.json({ error }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: { "content-type": "audio/mpeg" },
  });
}
