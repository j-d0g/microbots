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
      "save_workflow", "save it", "workflow", "how does deploy work",
    ],
    content: `## deploying a workflow
Use save_workflow(name, code) to persist a named workflow. The workflows card
shows saved workflows; do not claim that saving executes or deploys one.`,
  },
  {
    triggers: [
      "settings", "oauth", "connect", "disconnect", "credentials",
      "re-auth", "link", "my integrations", "token", "api key",
    ],
    content: `## composio credentials
- "connect X" → open the integrations card and use its connect flow.
- System health and user identity are available at /settings.
- OAuth: popup flow. API-key: inline form. tokens managed server-side by Composio.
- snapshot.integrations shows live status — agent can check without a tool call.
- if a connection drops, direct the user to the integrations card.`,
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
