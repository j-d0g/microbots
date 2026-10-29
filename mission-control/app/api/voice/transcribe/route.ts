import { openai } from "@ai-sdk/openai";
import { transcribe } from "ai";
import { ensureBooted } from "@/lib/server/boot";
import { voiceAvailable } from "@/lib/server/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  ensureBooted();
  if (!voiceAvailable()) return Response.json({ error: "Voice is unavailable without an OpenAI API key." }, { status: 501 });
  try {
    const form = await request.formData();
    const file = form.get("audio");
    if (!(file instanceof File)) return Response.json({ error: "Upload an audio file in the audio field." }, { status: 400 });
    if (file.size > 20 * 1024 * 1024) return Response.json({ error: "Audio files must be 20 MB or smaller." }, { status: 413 });
    const result = await transcribe({
      model: openai.transcription("gpt-4o-mini-transcribe"),
      audio: new Uint8Array(await file.arrayBuffer()),
    });
    return Response.json({ text: result.text });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transcription failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
