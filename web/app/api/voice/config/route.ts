import { NextResponse } from "next/server";
import { voiceProviders } from "../openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports the configured voice providers without exposing keys. */
export async function GET() {
  return NextResponse.json(voiceProviders());
}
