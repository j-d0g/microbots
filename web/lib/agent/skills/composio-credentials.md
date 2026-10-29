# skill: composio credentials & integrations

## trigger keywords
OAuth, connect, disconnect, credentials, re-auth, "link X",
"connect X", "my integrations", token, API key

## overview

Composio manages third-party integrations (Slack, Gmail, Linear, Notion,
GitHub, etc.) via OAuth or API-key flows. The integrations card is the
surface for managing these connections.

## connection flow

1. user says "connect slack" or "link my github"
2. agent opens the integrations card: `open_window(kind="integrations")`
3. the card shows available integrations with status badges:
   - green "connected" — OAuth token valid
   - yellow "expiring" — token expires within 24h
   - red "disconnected" — no token or revoked
4. user clicks the integration → OAuth popup (for OAuth-scheme integrations)
   or inline API-key form (for key-scheme integrations)
5. on success: connection status updates in store, snapshot reflects new status

## re-authentication

- tokens expire — Composio handles refresh automatically for most OAuth providers
- if refresh fails: status flips to "disconnected", agent can open the
  integrations card to help the user reconnect.
- user re-authenticates via the same flow

## agent snapshot surface

The `integrations` field in the canvas snapshot shows live connection status:
```json
{ "integrations": [{ "slug": "slack", "status": "connected" }] }
```

The agent can check this without burning a tool call. If a user asks
"is slack connected?" the agent reads the snapshot and answers directly.

## token locations

- OAuth tokens: managed by Composio server-side, never exposed to frontend
- API keys: entered in the integrations UI, sent to `/api/composio/connect` which
  stores them server-side
- the frontend never stores credentials in localStorage or state
