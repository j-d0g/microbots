import type { WindowKind } from "./store";

const INTENTS: ReadonlyArray<{
  keywords: readonly string[];
  kinds: readonly WindowKind[];
}> = [
  { keywords: ["graph", "map", "knowledge"], kinds: ["graph"] },
  { keywords: ["memor"], kinds: ["memories"] },
  {
    keywords: ["workflow", "playbook", "automation", "bug triage", "deploy", "pr review"],
    kinds: ["workflows"],
  },
  { keywords: ["skill"], kinds: ["skills"] },
  {
    keywords: ["integration", "connect", "stack", "slack", "github", "linear", "gmail", "notion"],
    kinds: ["integrations"],
  },
  {
    keywords: ["entit", "people", "contact", "team", "members"],
    kinds: ["entities"],
  },
  {
    keywords: ["brief", "today", "morning"],
    kinds: ["memories", "workflows"],
  },
];

export function matchLocalIntent(query: string): WindowKind[] {
  const normalized = query.toLowerCase();
  const kinds = new Set<WindowKind>();
  for (const intent of INTENTS) {
    if (intent.keywords.some((keyword) => normalized.includes(keyword))) {
      for (const kind of intent.kinds) kinds.add(kind);
    }
  }
  return [...kinds];
}
