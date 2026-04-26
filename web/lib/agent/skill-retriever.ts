/**
 * Skill retriever — matches user query + active tool names against
 * skill trigger keywords and returns the relevant skill content.
 *
 * Skills are retrieved, not resident. At most 2 skills per turn
 * (~400 tokens budget). See `skills/INDEX.md` for the catalogue.
 */

interface SkillEntry {
  triggers: string[];
  content: string;
}

const SKILLS: SkillEntry[] = [
  {
    triggers: [
      "save_workflow", "run_workflow", "deploy", "shadow", "promote",
      "save it", "run it", "deploy it", "how does deploy work",
    ],
    content: `## deploying a workflow
1. save_workflow(name, code) — stages confirm gate. voice: "yes"/"save" → confirm, "no"/"hold" → cancel.
2. run_workflow(name, args?) — also confirm-gated. streams stdout/stderr.
3. shadow deploy (future): after save confirms, service spins up in shadow mode.
rules: never execute save_workflow or run_workflow without a confirm gate. 60s timeout → auto-cancel.`,
  },
  {
    triggers: [
      "settings", "oauth", "connect", "disconnect", "credentials",
      "re-auth", "link", "my integrations", "token", "api key",
    ],
    content: `## composio credentials
- "connect X" → open_window(kind="settings"). settings shows integrations with status badges.
- OAuth: popup flow. API-key: inline form. tokens managed server-side by Composio.
- snapshot.integrations shows live status — agent can check without a tool call.
- if connection drops, agent can suggest "want me to open settings?"`,
  },
];

/**
 * Returns up to 2 skill content blocks matching the query or active tools.
 */
export function retrieveSkills(query: string, activeTools: string[]): string[] {
  const q = query.toLowerCase();
  const matched: string[] = [];

  for (const skill of SKILLS) {
    if (matched.length >= 2) break;

    const hit = skill.triggers.some(
      (t) =>
        q.includes(t.toLowerCase()) ||
        activeTools.some((tool) => t.toLowerCase() === tool.toLowerCase()),
    );

    if (hit) {
      matched.push(skill.content);
    }
  }

  return matched;
}
