/**
 * OpenRouter via the OpenAI-compatible adapter from the Vercel AI SDK.
 *
 * Why this layer exists:
 *   - One key (`OPENROUTER_API_KEY`) covers any model OpenRouter routes
 *     to. We can swap the orchestrator's model with one env-var change.
 *   - The Vercel AI SDK's tool-call & streaming machinery work
 *     identically against an OpenAI-compatible endpoint — no adapter
 *     code on our side, just `streamText({ model, tools })`.
 *   - When teammates want to test against Anthropic/OpenAI/Groq directly
 *     they can replace this single file without touching the agents.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";

let _client: ReturnType<typeof createOpenAICompatible> | null = null;

/** Lazy singleton — instantiated only when the orchestrate route runs,
 *  so import-time graphs at build time never need the API key. */
function client() {
  if (!_client) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENROUTER_API_KEY is not set. The orchestrate route should " +
          "have short-circuited before calling this. See plan §12.",
      );
    }
    _client = createOpenAICompatible({
      name: "openrouter",
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      // OpenRouter optionally identifies callers via these headers — they
      // surface the app on the OpenRouter dashboard but are not required.
      headers: {
        "HTTP-Referer": "https://microbots.dev",
        "X-Title": "microbots",
      },
    });
  }
  return _client;
}

/** Returns a model handle for a given OpenRouter model slug. Falls back
 *  to env override or `google/gemini-2.5-flash`.
 *
 *  Use `||` (not `??`): `.env` files coerce unset values to `""`, and
 *  the empty string is a valid-looking slug that OpenRouter rejects
 *  with `{"error":"No models provided","code":400}`. We treat any
 *  empty string as absent. */
export function chatModel(slug?: string) {
  const id = slug || process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  return client().chatModel(id);
}

/** True iff the orchestrate route can actually call the LLM. The route
 *  uses this to short-circuit to a 503 + fallback header. */
export function hasOpenRouterKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

/** The model slug we'll ship to the OpenRouter dashboard / logs. */
export function activeModelSlug(): string {
  return process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
}
