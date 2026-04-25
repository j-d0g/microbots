/** Seed data types for the in-memory ontology.
 *  Represents "one night of overnight cron ingest" for a startup operator. */

export type NodeLayer =
  | "user"
  | "integration"
  | "entity"
  | "memory"
  | "skill"
  | "workflow";

export interface OntologyNode {
  id: string;
  label: string;
  layer: NodeLayer;
  integration?: string;
  lastSeen?: string;
  confidence?: number;
}

export interface OntologyEdge {
  source: string;
  target: string;
  relation?: string;
}

export interface BriefProposal {
  id: string;
  title: string;
  why: string;
  integrations: string[];
  confidence: number;
  recipe: string[];
}

export interface YesterdayRun {
  slug: string;
  triggers: number;
  errors: number;
  skipped?: number;
  health: "ok" | "warn" | "down";
}

export interface WorkflowDef {
  slug: string;
  title: string;
  trigger: string;
  outcome: string;
  runsLast7d: number;
  integrations: string[];
  confidence: number;
  lastRun: string;
  steps: string[];
}

export interface ServiceDef {
  slug: string;
  version: string;
  purpose: string;
  runtime: string;
  deployedAt: string;
  health: "ok" | "warn" | "down";
  column: number;
  logs: string[];
  schedule?: string;
}

export interface PlaybookDef {
  title: string;
  oneLiner: string;
  integrations: string[];
  adoption?: number;
}

export interface IntegrationDef {
  slug: string;
  status: "connected" | "disconnected";
}

export interface MemberDef {
  name: string;
  email: string;
  role: "owner" | "admin" | "member";
}

export interface SparklinePoint {
  day: number;
  count: number;
}

export interface MockOntology {
  persona: {
    name: string;
    company: string;
    companyDescription: string;
    teamSize: number;
    tools: string[];
  };
  nodes: OntologyNode[];
  edges: OntologyEdge[];
  briefProposals: BriefProposal[];
  yesterdayRuns: YesterdayRun[];
  workflows: WorkflowDef[];
  services: ServiceDef[];
  playbooks: {
    org: PlaybookDef[];
    network: PlaybookDef[];
    suggested: PlaybookDef[];
  };
  integrations: IntegrationDef[];
  members: MemberDef[];
  confidenceThreshold: number;
}
