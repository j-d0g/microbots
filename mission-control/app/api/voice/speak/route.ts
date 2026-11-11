import { openai } from "@ai-sdk/openai";
import { generateSpeech } from "ai";
import { z } from "zod";
import { ensureBooted } from "@/lib/server/boot";
import { voiceAvailable } from "@/lib/server/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  ensureBooted();
  if (!voiceAvailable()) return Response.json({ error: "Voice is unavailable without an OpenAI API key." }, { status: 501 });
  try {
    const body = z.object({
      text: z.string().min(1).max(4_000),
      voice: z.string().optional(),
      fast: z.boolean().optional(),
    }).parse(await request.json());
    const result = await generateSpeech({
      model: openai.speech("gpt-4o-mini-tts"),
      text: body.text,
      voice: body.voice ?? "verse",
      speed: body.fast ? 1.25 : 1.05,
      outputFormat: "mp3",
    });
    return new Response(Buffer.from(result.audio.uint8Array), {
      headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "Speech generation failed.";
    return Response.json({ error: message }, { status: 400 });
  }
}
