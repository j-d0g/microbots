import { NextRequest, NextResponse } from "next/server";
import { buildLiveSessionRequest } from "../live-session";
import { OPENAI_BASE } from "../openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SDP_BYTES = 64 * 1024;

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost ?? req.headers.get("host");
  let allowedOrigin = false;
  if (origin) {
    if (origin === req.nextUrl.origin) {
      allowedOrigin = true;
    } else if (host) {
      try {
        allowedOrigin = new URL(origin).host === host;
      } catch {
        allowedOrigin = false;
      }
    }
  }
  if (!allowedOrigin) {
    return NextResponse.json({ error: "Unexpected request origin" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "An SDP offer is required" }, { status: 400 });
  }

  const sdp =
    typeof body === "object" && body !== null && "sdp" in body
      ? (body as { sdp?: unknown }).sdp
      : undefined;
  if (typeof sdp !== "string" || !sdp.trim()) {
    return NextResponse.json({ error: "An SDP offer is required" }, { status: 400 });
  }
  if (new TextEncoder().encode(sdp).byteLength > MAX_SDP_BYTES) {
    return NextResponse.json({ error: "An SDP offer is required" }, { status: 400 });
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not set; live voice unavailable." },
      { status: 503 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${OPENAI_BASE}/live/sessions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildLiveSessionRequest(sdp)),
    });
  } catch {
    return NextResponse.json(
      { error: "Live session creation failed" },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    console.error("[voice/live] session creation failed", upstream.status);
    const status = upstream.status >= 400 && upstream.status <= 599
      ? upstream.status
      : 502;
    return NextResponse.json(
      { error: "Live session creation failed" },
      { status },
    );
  }

  let result: {
    session?: { id?: unknown } | null;
    transport?: { sdp?: unknown } | null;
  };
  try {
    result = await upstream.json();
  } catch {
    return NextResponse.json(
      { error: "Live session creation failed" },
      { status: 502 },
    );
  }
  if (typeof result?.transport?.sdp !== "string") {
    return NextResponse.json(
      { error: "Live session creation failed" },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      session: { id: result.session?.id ?? null },
      transport: { type: "webrtc", sdp: result.transport.sdp },
    },
    { status: 201 },
  );
}
