import { NextRequest, NextResponse } from "next/server";
import { OPENAI_BASE, notConfigured } from "../voice/openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

export async function POST(req: NextRequest) {
  const contentLength = Number(req.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_AUDIO_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
  ) {
    return NextResponse.json(
      { error: "audio exceeds 25 MB limit" },
      { status: 413 },
    );
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) return notConfigured();

  const inForm = await req.formData();
  const audio = inForm.get("audio");
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "audio field required" }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "audio exceeds 25 MB limit" },
      { status: 413 },
    );
  }
  const filename =
    typeof (audio as { name?: unknown }).name === "string"
      ? (audio as { name: string }).name
      : "speech.webm";

  const out = new FormData();
  out.append("model", "gpt-4o-mini-transcribe");
  out.append("file", audio, filename);

  const upstream = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: out,
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return NextResponse.json(
      { error: `openai stt ${upstream.status}: ${errText.slice(0, 200)}` },
      { status: 502 },
    );
  }

  const data = (await upstream.json()) as { text?: string };
  return NextResponse.json({ text: (data.text ?? "").trim() });
}
