import type { MockOntology, OntologyNode, OntologyEdge } from "./types";

/* ------------------------------------------------------------------
 * Maya Chen / Inkwell — "one night of overnight cron ingest" seed
 * ~150 nodes across 5 layers, realistic edge density.
 * ----------------------------------------------------------------*/

// --- helpers ---
let _id = 0;
const uid = (prefix: string) => `${prefix}-${++_id}`;

// --- integration nodes ---
const integrations: OntologyNode[] = [
  { id: "int-slack", label: "Slack", layer: "integration", integration: "slack" },
  { id: "int-github", label: "GitHub", layer: "integration", integration: "github" },
  { id: "int-linear", label: "Linear", layer: "integration", integration: "linear" },
  { id: "int-gmail", label: "Gmail", layer: "integration", integration: "gmail" },
  { id: "int-notion", label: "Notion", layer: "integration", integration: "notion" },
  { id: "int-perplexity", label: "Perplexity", layer: "integration", integration: "perplexity" },
];

// --- entity nodes (people, channels, repos, projects) ---
const entities: OntologyNode[] = [
  { id: "ent-maya", label: "Maya Chen", layer: "entity", integration: "slack", lastSeen: "2h ago" },
  { id: "ent-raj", label: "Raj Patel", layer: "entity", integration: "slack", lastSeen: "4h ago" },
  { id: "ent-sofia", label: "Sofia Ruiz", layer: "entity", integration: "slack", lastSeen: "1d ago" },
  { id: "ent-liam", label: "Liam O'Brien", layer: "entity", integration: "github", lastSeen: "6h ago" },
  { id: "ent-aisha", label: "Aisha Kamara", layer: "entity", integration: "linear", lastSeen: "3h ago" },
  { id: "ent-tom", label: "Tom Nguyen", layer: "entity", integration: "slack", lastSeen: "8h ago" },
  { id: "ent-priya", label: "Priya Sharma", layer: "entity", integration: "gmail", lastSeen: "12h ago" },
  { id: "ent-james", label: "James Liu", layer: "entity", integration: "github", lastSeen: "1d ago" },
  { id: "ent-product-bugs", label: "#product-bugs", layer: "entity", integration: "slack" },
  { id: "ent-cs-pricing", label: "#cs-pricing", layer: "entity", integration: "slack" },
  { id: "ent-general", label: "#general", layer: "entity", integration: "slack" },
  { id: "ent-eng-standup", label: "#eng-standup", layer: "entity", integration: "slack" },
  { id: "ent-inkwell-api", label: "inkwell-api", layer: "entity", integration: "github" },
  { id: "ent-inkwell-web", label: "inkwell-web", layer: "entity", integration: "github" },
  { id: "ent-inkwell-ml", label: "inkwell-ml", layer: "entity", integration: "github" },
  { id: "ent-bugs-project", label: "Bugs", layer: "entity", integration: "linear" },
  { id: "ent-roadmap", label: "Roadmap", layer: "entity", integration: "linear" },
  { id: "ent-sprint-q2", label: "Q2 Sprint", layer: "entity", integration: "linear" },
  { id: "ent-weekly-doc", label: "Weekly updates", layer: "entity", integration: "notion" },
  { id: "ent-meeting-notes", label: "Meeting notes", layer: "entity", integration: "notion" },
  { id: "ent-okr-page", label: "OKR tracker", layer: "entity", integration: "notion" },
  { id: "ent-investor-thread", label: "Investor emails", layer: "entity", integration: "gmail" },
  { id: "ent-support-inbox", label: "Support inbox", layer: "entity", integration: "gmail" },
  { id: "ent-newsletter-trail", label: "Newsletter trail", layer: "entity", integration: "gmail" },
];

// --- memory nodes ---
const memories: OntologyNode[] = [
  { id: "mem-1", label: "Maya triages bugs M-F at 9am", layer: "memory", confidence: 0.96 },
  { id: "mem-2", label: "Raj owns API infra PRs", layer: "memory", confidence: 0.92 },
  { id: "mem-3", label: "Friday update uses Linear + Notion + Gmail", layer: "memory", confidence: 0.88 },
  { id: "mem-4", label: "PRs older than 48h get nudged in Slack", layer: "memory", confidence: 0.91 },
  { id: "mem-5", label: "Sofia handles CS pricing escalations", layer: "memory", confidence: 0.85 },
  { id: "mem-6", label: "Standup posted daily from PR + Linear activity", layer: "memory", confidence: 0.90 },
  { id: "mem-7", label: "Liam reviews all ML model PRs", layer: "memory", confidence: 0.87 },
  { id: "mem-8", label: "Aisha runs sprint planning every Monday", layer: "memory", confidence: 0.93 },
  { id: "mem-9", label: "Meeting notes older than 30d never revisited", layer: "memory", confidence: 0.72 },
  { id: "mem-10", label: "Maya prefers morning brief at 8:30am", layer: "memory", confidence: 0.95 },
  { id: "mem-11", label: "Newsletter senders with 0 opens in 90d: 8 total", layer: "memory", confidence: 0.71 },
  { id: "mem-12", label: "Tom handles on-call rotation scheduling", layer: "memory", confidence: 0.82 },
  { id: "mem-13", label: "Investor update cadence: every Friday 5pm", layer: "memory", confidence: 0.89 },
  { id: "mem-14", label: "Priya manages customer success playbooks", layer: "memory", confidence: 0.84 },
  { id: "mem-15", label: "Deployment pattern: merge to main -> auto-deploy", layer: "memory", confidence: 0.94 },
  { id: "mem-16", label: "Bug severity determined by Slack message keywords", layer: "memory", confidence: 0.88 },
  { id: "mem-17", label: "Weekly OKR check happens Thursday afternoons", layer: "memory", confidence: 0.76 },
  { id: "mem-18", label: "GitHub issues labelled 'urgent' get Slack pings", layer: "memory", confidence: 0.91 },
  { id: "mem-19", label: "Notion quarterly archive runs every 90d", layer: "memory", confidence: 0.68 },
  { id: "mem-20", label: "Support inbox volume peaks Mon/Tue mornings", layer: "memory", confidence: 0.83 },
  { id: "mem-21", label: "Raj and Liam co-review infra PRs", layer: "memory", confidence: 0.86 },
  { id: "mem-22", label: "James manages CI/CD pipeline configs", layer: "memory", confidence: 0.80 },
  { id: "mem-23", label: "cs-pricing escalations need <2h response", layer: "memory", confidence: 0.87 },
  { id: "mem-24", label: "Perplexity used for competitor research weekly", layer: "memory", confidence: 0.74 },
  { id: "mem-25", label: "Sprint velocity averaging 34 pts/week", layer: "memory", confidence: 0.90 },
];

// --- skill nodes ---
const skills: OntologyNode[] = [
  { id: "skill-triage", label: "classify + assign bugs", layer: "skill" },
  { id: "skill-summarise", label: "summarise threads", layer: "skill" },
  { id: "skill-remind", label: "nudge stale items", layer: "skill" },
  { id: "skill-draft", label: "draft long-form updates", layer: "skill" },
  { id: "skill-route", label: "route messages by topic", layer: "skill" },
  { id: "skill-archive", label: "archive + clean up", layer: "skill" },
  { id: "skill-digest", label: "compile daily digests", layer: "skill" },
  { id: "skill-deploy", label: "deploy microservices", layer: "skill" },
  { id: "skill-schedule", label: "manage cron schedules", layer: "skill" },
  { id: "skill-research", label: "search + synthesise", layer: "skill" },
  { id: "skill-standup", label: "assemble standups", layer: "skill" },
  { id: "skill-okr-check", label: "check OKR progress", layer: "skill" },
];

// --- workflow nodes ---
const workflowNodes: OntologyNode[] = [
  { id: "wf-bug-triage", label: "Bug triage pipeline", layer: "workflow" },
  { id: "wf-weekly-update", label: "Weekly founders update", layer: "workflow" },
  { id: "wf-pr-reminder", label: "Stale PR reminder", layer: "workflow" },
  { id: "wf-email-router", label: "Email router", layer: "workflow" },
  { id: "wf-standup", label: "Standup assembler", layer: "workflow" },
];

// --- user node ---
const userNode: OntologyNode = { id: "user-maya", label: "Maya Chen", layer: "user" };

// --- all nodes ---
const allNodes: OntologyNode[] = [
  userNode,
  ...integrations,
  ...entities,
  ...memories,
  ...skills,
  ...workflowNodes,
];

// --- edges (realistic density) ---
const edges: OntologyEdge[] = [
  // user -> integrations
  { source: "user-maya", target: "int-slack", relation: "uses" },
  { source: "user-maya", target: "int-github", relation: "uses" },
  { source: "user-maya", target: "int-linear", relation: "uses" },
  { source: "user-maya", target: "int-gmail", relation: "uses" },
  { source: "user-maya", target: "int-notion", relation: "uses" },
  { source: "user-maya", target: "int-perplexity", relation: "uses" },

  // integrations -> entities
  { source: "int-slack", target: "ent-maya", relation: "contains" },
  { source: "int-slack", target: "ent-raj", relation: "contains" },
  { source: "int-slack", target: "ent-sofia", relation: "contains" },
  { source: "int-slack", target: "ent-tom", relation: "contains" },
  { source: "int-slack", target: "ent-product-bugs", relation: "contains" },
  { source: "int-slack", target: "ent-cs-pricing", relation: "contains" },
  { source: "int-slack", target: "ent-general", relation: "contains" },
  { source: "int-slack", target: "ent-eng-standup", relation: "contains" },
  { source: "int-github", target: "ent-liam", relation: "contains" },
  { source: "int-github", target: "ent-james", relation: "contains" },
  { source: "int-github", target: "ent-inkwell-api", relation: "contains" },
  { source: "int-github", target: "ent-inkwell-web", relation: "contains" },
  { source: "int-github", target: "ent-inkwell-ml", relation: "contains" },
  { source: "int-linear", target: "ent-aisha", relation: "contains" },
  { source: "int-linear", target: "ent-bugs-project", relation: "contains" },
  { source: "int-linear", target: "ent-roadmap", relation: "contains" },
  { source: "int-linear", target: "ent-sprint-q2", relation: "contains" },
  { source: "int-notion", target: "ent-weekly-doc", relation: "contains" },
  { source: "int-notion", target: "ent-meeting-notes", relation: "contains" },
  { source: "int-notion", target: "ent-okr-page", relation: "contains" },
  { source: "int-gmail", target: "ent-investor-thread", relation: "contains" },
  { source: "int-gmail", target: "ent-support-inbox", relation: "contains" },
  { source: "int-gmail", target: "ent-newsletter-trail", relation: "contains" },
  { source: "int-gmail", target: "ent-priya", relation: "contains" },

  // entity cross-links
  { source: "ent-maya", target: "ent-product-bugs", relation: "monitors" },
  { source: "ent-raj", target: "ent-inkwell-api", relation: "maintains" },
  { source: "ent-liam", target: "ent-inkwell-ml", relation: "maintains" },
  { source: "ent-james", target: "ent-inkwell-web", relation: "maintains" },
  { source: "ent-sofia", target: "ent-cs-pricing", relation: "monitors" },
  { source: "ent-aisha", target: "ent-sprint-q2", relation: "manages" },
  { source: "ent-tom", target: "ent-eng-standup", relation: "posts_to" },
  { source: "ent-priya", target: "ent-support-inbox", relation: "manages" },

  // entities -> memories
  { source: "ent-product-bugs", target: "mem-1", relation: "informs" },
  { source: "ent-maya", target: "mem-1", relation: "subject" },
  { source: "ent-raj", target: "mem-2", relation: "subject" },
  { source: "ent-inkwell-api", target: "mem-2", relation: "context" },
  { source: "ent-weekly-doc", target: "mem-3", relation: "informs" },
  { source: "ent-investor-thread", target: "mem-13", relation: "informs" },
  { source: "ent-inkwell-api", target: "mem-4", relation: "context" },
  { source: "ent-cs-pricing", target: "mem-5", relation: "informs" },
  { source: "ent-sofia", target: "mem-5", relation: "subject" },
  { source: "ent-eng-standup", target: "mem-6", relation: "informs" },
  { source: "ent-liam", target: "mem-7", relation: "subject" },
  { source: "ent-inkwell-ml", target: "mem-7", relation: "context" },
  { source: "ent-aisha", target: "mem-8", relation: "subject" },
  { source: "ent-sprint-q2", target: "mem-8", relation: "context" },
  { source: "ent-meeting-notes", target: "mem-9", relation: "informs" },
  { source: "ent-maya", target: "mem-10", relation: "subject" },
  { source: "ent-newsletter-trail", target: "mem-11", relation: "informs" },
  { source: "ent-tom", target: "mem-12", relation: "subject" },
  { source: "ent-priya", target: "mem-14", relation: "subject" },
  { source: "ent-inkwell-api", target: "mem-15", relation: "context" },
  { source: "ent-product-bugs", target: "mem-16", relation: "informs" },
  { source: "ent-okr-page", target: "mem-17", relation: "informs" },
  { source: "ent-inkwell-api", target: "mem-18", relation: "context" },
  { source: "ent-meeting-notes", target: "mem-19", relation: "context" },
  { source: "ent-support-inbox", target: "mem-20", relation: "informs" },
  { source: "ent-raj", target: "mem-21", relation: "subject" },
  { source: "ent-liam", target: "mem-21", relation: "subject" },
  { source: "ent-james", target: "mem-22", relation: "subject" },
  { source: "ent-cs-pricing", target: "mem-23", relation: "informs" },
  { source: "ent-sprint-q2", target: "mem-25", relation: "context" },

  // memories -> skills
  { source: "mem-1", target: "skill-triage", relation: "enables" },
  { source: "mem-16", target: "skill-triage", relation: "enables" },
  { source: "mem-3", target: "skill-draft", relation: "enables" },
  { source: "mem-13", target: "skill-draft", relation: "enables" },
  { source: "mem-4", target: "skill-remind", relation: "enables" },
  { source: "mem-5", target: "skill-route", relation: "enables" },
  { source: "mem-23", target: "skill-route", relation: "enables" },
  { source: "mem-6", target: "skill-standup", relation: "enables" },
  { source: "mem-9", target: "skill-archive", relation: "enables" },
  { source: "mem-11", target: "skill-archive", relation: "enables" },
  { source: "mem-19", target: "skill-archive", relation: "enables" },
  { source: "mem-20", target: "skill-summarise", relation: "enables" },
  { source: "mem-15", target: "skill-deploy", relation: "enables" },
  { source: "mem-12", target: "skill-schedule", relation: "enables" },
  { source: "mem-24", target: "skill-research", relation: "enables" },
  { source: "mem-17", target: "skill-okr-check", relation: "enables" },
  { source: "mem-25", target: "skill-okr-check", relation: "enables" },
  { source: "mem-7", target: "skill-summarise", relation: "enables" },

  // skills -> workflows
  { source: "skill-triage", target: "wf-bug-triage", relation: "powers" },
  { source: "skill-draft", target: "wf-weekly-update", relation: "powers" },
  { source: "skill-summarise", target: "wf-weekly-update", relation: "powers" },
  { source: "skill-remind", target: "wf-pr-reminder", relation: "powers" },
  { source: "skill-route", target: "wf-email-router", relation: "powers" },
  { source: "skill-standup", target: "wf-standup", relation: "powers" },
  { source: "skill-digest", target: "wf-standup", relation: "powers" },
];

// Pad to ~150 nodes with additional entity/memory nodes
const extraEntities: OntologyNode[] = Array.from({ length: 30 }, (_, i) => ({
  id: uid("ent-extra"),
  label: [
    "Sprint retro doc", "Hiring pipeline", "Design system", "API docs", "Changelog",
    "CI pipeline", "Deploy log", "Error tracker", "Perf dashboard", "Cost monitor",
    "Security audit", "Data pipeline", "Analytics board", "Feature flags", "A/B tests",
    "Customer feedback", "NPS scores", "Churn signals", "Revenue dash", "Usage metrics",
    "Onboarding flow", "Help center", "Status page", "Incident log", "Runbook",
    "Architecture doc", "Tech debt tracker", "Dependency audit", "License check", "Release notes",
  ][i],
  layer: "entity" as const,
  integration: ["notion", "linear", "github", "gmail", "slack"][i % 5],
}));

const extraMemories: OntologyNode[] = Array.from({ length: 25 }, (_, i) => ({
  id: uid("mem-extra"),
  label: [
    "CI builds take avg 4m 12s", "Hotfix deploys skip staging", "Design reviews happen Wednesdays",
    "API rate limits hit ~3x/week", "Changelog updated every release", "Error budget at 72%",
    "Cost alerts trigger at $500/day", "Security scan runs nightly", "Data pipeline refreshes at 2am",
    "Analytics snapshots weekly on Sunday", "Feature flags reviewed monthly", "A/B test min runtime 7d",
    "Customer feedback tagged by sentiment", "NPS survey sent quarterly", "Churn risk scored daily",
    "Revenue forecast updated Fridays", "Usage spikes on Monday mornings", "Onboarding takes avg 3.2min",
    "Help articles updated after tickets", "Status page auto-updates from PagerDuty",
    "Incident retros within 48h", "Runbooks reviewed quarterly", "Arch docs lag behind code",
    "Tech debt allocated 20% of sprint", "Deps audited before major releases",
  ][i],
  layer: "memory" as const,
  confidence: 0.65 + Math.random() * 0.30,
}));

// Extra edges for padding nodes
const extraEdges: OntologyEdge[] = [
  ...extraEntities.map((e, i) => ({
    source: ["int-notion", "int-linear", "int-github", "int-gmail", "int-slack"][i % 5],
    target: e.id,
    relation: "contains",
  })),
  ...extraMemories.map((m, i) => ({
    source: extraEntities[i % extraEntities.length].id,
    target: m.id,
    relation: "informs",
  })),
  ...extraMemories.filter((_, i) => i % 3 === 0).map((m) => ({
    source: m.id,
    target: skills[Math.floor(Math.random() * skills.length)].id,
    relation: "enables",
  })),
];

// --- fake service logs ---
function fakeLogs(service: string): string[] {
  const ts = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - Math.floor(Math.random() * 120));
    return d.toISOString().replace("T", " ").slice(0, 19);
  };
  const lines = [
    `[${ts()}] INFO  ${service}: health check passed`,
    `[${ts()}] INFO  ${service}: processing batch of 12 events`,
    `[${ts()}] DEBUG ${service}: cache hit ratio 0.87`,
    `[${ts()}] INFO  ${service}: completed batch in 234ms`,
    `[${ts()}] WARN  ${service}: retry attempt 1/3 for upstream timeout`,
    `[${ts()}] INFO  ${service}: retry succeeded`,
    `[${ts()}] INFO  ${service}: health check passed`,
    `[${ts()}] INFO  ${service}: processing batch of 8 events`,
    `[${ts()}] DEBUG ${service}: memory usage 142MB / 512MB`,
    `[${ts()}] INFO  ${service}: completed batch in 189ms`,
  ];
  return lines;
}

// ----------------------------------------------------------------
// Exported seed
// ----------------------------------------------------------------

export const seed: MockOntology = {
  persona: {
    name: "Maya Chen",
    company: "Inkwell",
    companyDescription: "B2B sales-coaching SaaS",
    teamSize: 8,
    tools: ["Slack", "GitHub", "Linear", "Gmail", "Notion", "Perplexity"],
  },

  nodes: [...allNodes, ...extraEntities, ...extraMemories],
  edges: [...edges, ...extraEdges],

  briefProposals: [
    {
      id: "bp-001",
      title: "Auto-triage Linear bugs from #product-bugs Slack channel",
      why: "Every weekday you triage 4-7 bug reports from #product-bugs, set a severity label, and assign an owner. The signal for severity is reliable; the owner comes from your last three weeks of assignment patterns.",
      integrations: ["slack", "linear"],
      confidence: 0.94,
      recipe: [
        "When a new message lands in Slack #product-bugs that looks like a bug report...",
        "classify severity (high/med/low) with the last 90 days as context,",
        "create a Linear issue in the Bugs project with that severity label,",
        "assign it to the owner who has fielded the most similar area in the last 21 days,",
        "post a Linear link back as a thread reply in Slack.",
      ],
    },
    {
      id: "bp-002",
      title: "Daily digest of overnight GitHub PRs to Maya's inbox",
      why: "You check 3 repos each morning for PRs merged overnight. A 6am digest saves 15 minutes of context-switching across tabs.",
      integrations: ["github", "gmail"],
      confidence: 0.91,
      recipe: [
        "At 06:00, scan inkwell-api, inkwell-web, inkwell-ml for PRs merged since yesterday 18:00,",
        "group by repo, summarise each PR in one line,",
        "compose a clean email digest,",
        "send to Maya's inbox with subject 'Overnight PRs'.",
      ],
    },
    {
      id: "bp-003",
      title: "Re-route customer success emails matching 'pricing' to Slack #cs-pricing",
      why: "Pricing-related support emails currently sit in the shared inbox until Sofia notices them. Routing to #cs-pricing cuts response time from ~4h to <30min.",
      integrations: ["gmail", "slack"],
      confidence: 0.78,
      recipe: [
        "Monitor the support inbox for new emails containing 'pricing', 'plan', 'upgrade', or 'downgrade',",
        "extract customer name + key sentence,",
        "post a formatted message to #cs-pricing with a link back to the email,",
        "label the original email 'routed-to-slack'.",
      ],
    },
    {
      id: "bp-004",
      title: "Auto-generate weekly investor update from Linear closed tickets",
      why: "You hand-write the founder update every Friday from three sources. A template + a scraper across the three tools would give you a 70% draft you only need to season.",
      integrations: ["notion", "linear", "gmail"],
      confidence: 0.87,
      recipe: [
        "At 17:00 Fridays, pull shipped Linear issues this week,",
        "pull investor emails sent or received this week,",
        "pull Notion edits to the weekly doc,",
        "draft the update into a new Notion page under 'Founders updates' and DM you the link.",
      ],
    },
    {
      id: "bp-005",
      title: "Summarise Notion meeting notes older than 30d into a quarterly archive",
      why: "Low-stakes housekeeping. Meeting notes older than a month pile up and nobody references them. A quarterly digest preserves the signal.",
      integrations: ["notion"],
      confidence: 0.65,
      recipe: [
        "Find all Notion meeting-note pages older than 30 days,",
        "extract key decisions and action items from each,",
        "compile into a single 'Q archive' page,",
        "move originals to an 'Archived meetings' section.",
      ],
    },
    {
      id: "bp-006",
      title: "Unsubscribe from 8 newsletters with zero opens in 90 days",
      why: "Low-stakes housekeeping. You haven't opened anything from these senders this quarter -- I can run the unsubscribe links and archive the trail.",
      integrations: ["gmail"],
      confidence: 0.71,
      recipe: [
        "Collect senders with 0 opens in the last 90 days and >=6 received,",
        "visit each unsubscribe link,",
        "archive the trail to an 'Unsubscribed' label,",
        "summarise the list back to you in the morning brief.",
      ],
    },
  ],

  yesterdayRuns: [
    { slug: "bug-triage-pipeline", triggers: 12, errors: 0, health: "ok" },
    { slug: "standup-assembler", triggers: 1, errors: 0, health: "ok" },
    { slug: "pr-reminder", triggers: 8, errors: 0, skipped: 1, health: "ok" },
    { slug: "email-router", triggers: 23, errors: 2, health: "warn" },
    { slug: "inbox-zero-sweep", triggers: 3, errors: 0, health: "ok" },
  ],

  workflows: [
    {
      slug: "bug-triage-pipeline",
      title: "Bug triage pipeline",
      trigger: "Slack #product-bugs",
      outcome: "Linear issue with severity + owner",
      runsLast7d: 34,
      integrations: ["slack", "linear"],
      confidence: 0.94,
      lastRun: "2h ago",
      steps: [
        "When a new message lands in Slack #product-bugs that looks like a bug report...",
        "classify severity (high/med/low) using the last 90 days of triage history as context,",
        "create a Linear issue in the Bugs project with that severity label,",
        "assign it to the team member who has fielded the most similar bugs in the last 21 days,",
        "post a Linear link back as a thread reply in Slack.",
      ],
    },
    {
      slug: "weekly-founders-update",
      title: "Weekly founders' update draft",
      trigger: "17:00 Friday",
      outcome: "Notion draft + DM to you",
      runsLast7d: 1,
      integrations: ["notion", "linear", "gmail"],
      confidence: 0.87,
      lastRun: "5d ago",
      steps: [
        "At 17:00 on Friday, pull all shipped Linear issues this week,",
        "collect investor-related emails sent or received this week from Gmail,",
        "pull Notion edits to the weekly-doc page,",
        "draft the founder update into a new Notion page under 'Founders updates',",
        "DM Maya the Notion link in Slack.",
      ],
    },
    {
      slug: "pr-reminder",
      title: "Stale PR reminder",
      trigger: "PR > 48h without review",
      outcome: "Nudge in Slack thread",
      runsLast7d: 12,
      integrations: ["github", "slack"],
      confidence: 0.91,
      lastRun: "6h ago",
      steps: [
        "Every 6 hours, scan open PRs across inkwell-api, inkwell-web, inkwell-ml,",
        "filter for PRs older than 48h with no review activity,",
        "post a gentle nudge as a Slack thread reply tagging the likely reviewer,",
        "skip draft PRs and PRs with 'wip' in the title.",
      ],
    },
  ],

  services: [
    {
      slug: "slack-linear-bridge",
      version: "v0.3.1",
      purpose: "Routes Slack bug reports to Linear with classification",
      runtime: "Python 3.12",
      deployedAt: "2d ago",
      health: "ok",
      column: 0,
      logs: fakeLogs("slack-linear-bridge"),
      schedule: "event-driven",
    },
    {
      slug: "gmail-router",
      version: "v0.1.0",
      purpose: "Routes support emails to Slack channels by topic",
      runtime: "Python 3.12",
      deployedAt: "4d ago",
      health: "ok",
      column: 0,
      logs: fakeLogs("gmail-router"),
      schedule: "polling 5min",
    },
    {
      slug: "pr-digest",
      version: "v0.2.0",
      purpose: "Compiles overnight PR activity into email digests",
      runtime: "Python 3.12",
      deployedAt: "1d ago",
      health: "ok",
      column: 1,
      logs: fakeLogs("pr-digest"),
      schedule: "cron 06:00 daily",
    },
    {
      slug: "standup-bot",
      version: "v0.1.2",
      purpose: "Assembles daily standup from PR + Linear activity",
      runtime: "Python 3.12",
      deployedAt: "3d ago",
      health: "ok",
      column: 1,
      logs: fakeLogs("standup-bot"),
      schedule: "cron 09:00 weekdays",
    },
    {
      slug: "notion-scribe",
      version: "v0.0.4",
      purpose: "Writes update drafts and archives to Notion",
      runtime: "Python 3.12",
      deployedAt: "6d ago",
      health: "warn",
      column: 2,
      logs: [
        ...fakeLogs("notion-scribe"),
        `[${new Date().toISOString().replace("T", " ").slice(0, 19)}] WARN  notion-scribe: Notion API rate limit approaching (80/100)`,
      ],
      schedule: "cron 17:00 Fridays",
    },
  ],

  playbooks: {
    org: [
      { title: "Investor update distiller", oneLiner: "pulls Linear + Notion, drafts weekly investor note", integrations: ["linear", "notion"], adoption: 1 },
      { title: "Hiring pipeline nudge", oneLiner: "reminds owners of stalled candidates in Ashby", integrations: ["slack"], adoption: 1 },
      { title: "Sprint retro compiler", oneLiner: "gathers retro notes from Notion + Slack into one doc", integrations: ["notion", "slack"], adoption: 1 },
      { title: "Customer win announcer", oneLiner: "posts closed-won deals to #general with context", integrations: ["slack", "gmail"], adoption: 1 },
    ],
    network: [
      { title: "Churn signal sniffer", oneLiner: "watches Slack Connect for cooling-off language", integrations: ["slack"], adoption: 12 },
      { title: "Standup assembler", oneLiner: "builds standup from yesterday's PRs + Linear moves", integrations: ["github", "linear", "slack"], adoption: 34 },
      { title: "On-call summariser", oneLiner: "turns PagerDuty incidents into a weekly digest", integrations: ["slack"], adoption: 8 },
      { title: "Competitor watch", oneLiner: "scans Perplexity + news for competitor mentions weekly", integrations: ["perplexity", "slack"], adoption: 19 },
      { title: "Expense auto-tagger", oneLiner: "categorises receipts from Gmail into a spreadsheet", integrations: ["gmail"], adoption: 7 },
      { title: "Meeting-free day enforcer", oneLiner: "blocks calendar slots and nudges reschedules", integrations: ["gmail"], adoption: 22 },
    ],
    suggested: [
      { title: "Weekly OKR check-in", oneLiner: "reads Linear progress, posts to a Notion OKR page", integrations: ["linear", "notion"] },
      { title: "Inbox zero co-pilot", oneLiner: "archives newsletters, summarises threads > 3 days old", integrations: ["gmail"] },
      { title: "Dep audit reminder", oneLiner: "flags outdated dependencies before major releases", integrations: ["github"] },
    ],
  },

  integrations: [
    { slug: "slack", status: "connected" },
    { slug: "github", status: "connected" },
    { slug: "linear", status: "connected" },
    { slug: "gmail", status: "connected" },
    { slug: "notion", status: "disconnected" },
    { slug: "perplexity", status: "disconnected" },
  ],

  members: [
    { name: "Maya Chen", email: "maya@inkwell.io", role: "owner" },
    { name: "Raj Patel", email: "raj@inkwell.io", role: "admin" },
    { name: "Sofia Ruiz", email: "sofia@inkwell.io", role: "member" },
  ],

  confidenceThreshold: 0.85,
};
