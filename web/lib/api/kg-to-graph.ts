/**
 * Map raw KG REST responses into the existing GraphNode/GraphLink shape
 * the GraphCanvas force-sim consumes.
 *
 * Layers (mirrored from the seed ontology shape):
 *   user        — one node, top of the graph
 *   integration — one per Composio toolkit, attribute = slug
 *   entity      — KG entities (person/organisation/project/...)
 *   memory      — confidence-ranked memory rows
 *   skill       — atomic behaviours
 *   workflow    — multi-step skill chains
 *
 * Edges:
 *   user                          → integration   (uses)
 *   integration ↔ integration     (co_used_with_slugs)
 *   entity → integration          (appears_in_edges)
 *   memory → integration          (memory.source where it matches a slug)
 *   skill → integration           (skill.integrations)
 *   workflow → skill (ordered)    (skill_chain)
 */

import type {
  Connection,
  EntityRow,
  IntegrationSummary,
  Memory,
  Skill,
  UserProfile,
  Workflow,
} from "./backend";
import type {
  GraphLink,
  GraphNode,
} from "@/components/graph/types";
import type { NodeLayer } from "@/lib/seed/types";

export interface KgBundle {
  user: UserProfile | null;
  integrations: IntegrationSummary[];
  entities: EntityRow[];
  memories: Memory[];
  skills: Skill[];
  workflows: Workflow[];
  connections: Connection[];
}

interface NodeAcc {
  byId: Map<string, GraphNode>;
  links: GraphLink[];
}

function pushNode(acc: NodeAcc, node: GraphNode) {
  if (!acc.byId.has(node.id)) acc.byId.set(node.id, node);
}
function pushLink(acc: NodeAcc, source: string, target: string, relation?: string) {
  // Only add edges where both endpoints exist.
  if (!acc.byId.has(source) || !acc.byId.has(target)) return;
  acc.links.push({ source, target, relation });
}

const integrationId = (slug: string) => `int-${slug}`;
const userId = () => "user-self";

function safeLayer(layer: NodeLayer): NodeLayer {
  return layer;
}

export function toGraph(bundle: KgBundle): {
  nodes: GraphNode[];
  links: GraphLink[];
} {
  const acc: NodeAcc = { byId: new Map(), links: [] };

  /* user */
  if (bundle.user) {
    pushNode(acc, {
      id: userId(),
      label: bundle.user.name || "you",
      layer: safeLayer("user"),
    });
  }

  /* integrations */
  for (const i of bundle.integrations) {
    const id = integrationId(i.slug);
    pushNode(acc, {
      id,
      label: i.name || i.slug,
      layer: safeLayer("integration"),
      integration: i.slug,
    });
    if (bundle.user) pushLink(acc, userId(), id, "uses");
  }
  // co_used_with edges (integration ↔ integration)
  for (const i of bundle.integrations) {
    const a = integrationId(i.slug);
    for (const co of i.co_used_with_slugs ?? []) {
      const b = integrationId(co.out.slug);
      pushLink(acc, a, b, "co_used_with");
    }
  }

  /* entities */
  for (const e of bundle.entities) {
    pushNode(acc, {
      id: e.id,
      label: e.name,
      layer: safeLayer("entity"),
    });
  }

  /* memories */
  for (const m of bundle.memories) {
    pushNode(acc, {
      id: m.id,
      label:
        m.content.length > 60
          ? m.content.slice(0, 57).trimEnd() + "…"
          : m.content,
      layer: safeLayer("memory"),
      confidence: m.confidence,
      integration:
        m.source && bundle.integrations.some((i) => i.slug === m.source)
          ? m.source
          : undefined,
    });
    // memory → integration edge if source matches
    if (m.source) {
      const intId = integrationId(m.source);
      pushLink(acc, m.id, intId, "from");
    }
  }

  /* skills */
  for (const s of bundle.skills) {
    pushNode(acc, {
      id: s.id,
      label: s.name,
      layer: safeLayer("skill"),
    });
    for (const integSlug of s.integrations ?? []) {
      pushLink(acc, s.id, integrationId(integSlug), "uses");
    }
  }

  /* workflows */
  for (const w of bundle.workflows) {
    pushNode(acc, {
      id: w.id,
      label: w.name,
      layer: safeLayer("workflow"),
    });
    for (const step of w.skill_chain ?? []) {
      // KG REST returns flat { skill_slug, step_order }; defend
      // against legacy { out: { skill_slug } } shape just in case
      // a stale snapshot is still in flight.
      const slug =
        (step as { skill_slug?: string }).skill_slug ??
        (step as { out?: { skill_slug?: string } }).out?.skill_slug;
      if (!slug) continue;
      const skillId = `skill:${slug}`;
      pushLink(acc, w.id, skillId, `step ${step.step_order}`);
    }
  }

  return {
    nodes: [...acc.byId.values()],
    links: acc.links,
  };
}
