"use client";

/**
 * Composio OAuth callback target.
 *
 * Composio redirects the user here after they consent (or cancel).
 * Two flows:
 *
 *   1. Popup flow (default): the IntegrationRoom opened a popup and is
 *      polling /api/composio/connections. We just close ourselves so
 *      the user lands back on the canvas; the polling loop sees the
 *      ACTIVE status and finishes the round-trip.
 *
 *   2. Full-page redirect (popup blocked): no `window.opener` exists.
 *      We render a tiny "all set, return to the app" link.
 *
 * Optional: post the status back to the opener via postMessage so the
 * IntegrationRoom can react instantly without waiting for the next
 * poll tick.
 */

import { useEffect, useState } from "react";
import Link from "next/link";

export default function OAuthReturnPage() {
  const [hasOpener, setHasOpener] = useState<boolean | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const s = url.searchParams.get("status");
    setStatus(s);

    const opener = window.opener as Window | null;
    if (opener) {
      try {
        opener.postMessage(
          { kind: "composio-oauth", status: s ?? "unknown" },
          window.location.origin,
        );
      } catch {
        /* swallow — postMessage failures shouldn't block close */
      }
      setHasOpener(true);
      // Give the parent a beat to receive the message before closing.
      window.setTimeout(() => window.close(), 200);
    } else {
      setHasOpener(false);
    }
  }, []);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-paper-0 p-8 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-35">
        composio · oauth
      </p>
      <h1 className="text-[20px] font-medium leading-snug tracking-tight text-ink-90">
        {status === "success"
          ? "connected."
          : status === "error" || status === "failed"
            ? "connection failed."
            : "all set."}
      </h1>
      {hasOpener ? (
        <p className="max-w-[34ch] font-mono text-[12px] leading-relaxed text-ink-60">
          you can close this window — your previous tab is updating now.
        </p>
      ) : hasOpener === false ? (
        <p className="max-w-[34ch] font-mono text-[12px] leading-relaxed text-ink-60">
          back to the app to finish setting up.
        </p>
      ) : null}
      {hasOpener === false && (
        <Link
          href="/"
          className="mt-2 font-mono text-[12px] text-accent-indigo underline-offset-4 hover:underline"
        >
          return to microbots →
        </Link>
      )}
    </div>
  );
}
