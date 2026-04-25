import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Speech-to-text proxy. Accepts a multipart upload with an `audio`
 * field (any browser-recordable mime), forwards to ElevenLabs Scribe,
 * and returns `{ transcript: string }`.
 *
 * Returns 501 with a friendly note when no provider is configured so
 * the browser falls back to the native Web Speech API.
 */
export async function POST(req: NextRequest) {
  const eleven = process.env.ELEVENLABS_API_KEY;
  if (!eleven) {
    return NextResponse.json(
      { error: "no STT provider configured — UI falls back to Web Speech." },
      { status: 501 },
    );
  }

  const inForm = await req.formData();
  const audio = inForm.get("audio");
  // `File extends Blob` in both DOM and Node ≥ 18; checking Blob covers
  // both. The `name` property only exists on File — duck-type for it
  // when re-packaging so we keep the original filename if available.
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "audio field required" }, { status: 400 });
  }
  const filename =
    typeof (audio as { name?: unknown }).name === "string"
      ? (audio as { name: string }).name
      : "speech.webm";

  // Re-package as a multipart for ElevenLabs. Their /v1/speech-to-text
  // accepts model_id + file; the Scribe model is `scribe_v1`.
  const out = new FormData();
  out.append("model_id", "scribe_v1");
  out.append("file", audio, filename);

  const upstream = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": eleven },
    body: out,
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return NextResponse.json(
      { error: `elevenlabs error ${upstream.status}: ${errText.slice(0, 200)}` },
      { status: 502 },
    );
  }

  const data = (await upstream.json()) as { text?: string };
  return NextResponse.json({ transcript: (data.text ?? "").trim() });
}
