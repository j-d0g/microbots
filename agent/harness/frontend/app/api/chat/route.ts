import { StreamingTextResponse } from "ai";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { messages } = await req.json();
  const last = messages?.at(-1)?.content ?? "";

  // Phase 0 stub: echo the last message as a streaming response.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`echo: ${last}`));
      controller.close();
    },
  });

  return new StreamingTextResponse(stream);
}
