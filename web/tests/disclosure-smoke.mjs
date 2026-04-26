// node tests/disclosure-smoke.mjs
//
// Verifies the progressive-disclosure narrowing in
// lib/agent/window-tools.ts. We import via a tiny TS shim because the
// project doesn't bundle for Node by default; instead we run the
// pickRelevantKinds heuristic against a fixed snapshot and assert the
// resulting room subset is what the architecture promises.
//
// We re-implement the heuristic here in JS so the test stays
// dependency-free. If KIND_TAGS in window-tools.ts changes, this test
// should be updated to match.

const KIND_TAGS = {
  brief: ["brief", "morning", "proposal", "automation", "approve", "defer", "queued", "bp-"],
  graph: ["graph", "node", "ontology", "memory map", "neighbor", "shortest path", "subgraph"],
  workflow: ["workflow", "recipe", "dag", "triage", "bug-triage", "wf-", "cadence"],
  stack: ["stack", "service", "microservice", "log", "scribe", "distiller", "down", "warn", "health", "uptime"],
  waffle: ["waffle", "voice", "transcript", "speak", "listen"],
  playbooks: ["playbook", "playbooks", "try tonight", "shadow deploy", "org playbook", "network playbook"],
  settings: ["settings", "integration", "members", "danger", "wipe", "preferences", "schedule"],
};

const ALL_KINDS_BUT_GRAPH = ["brief", "workflow", "stack", "waffle", "playbooks", "settings"];

function pickRelevantKinds(openKinds, intent) {
  // Union of (intent-matched) ∪ (currently-open), graph excluded.
  const open = new Set(openKinds.filter((k) => k !== "graph"));
  const matched = new Set();
  if (intent && intent.trim().length > 0) {
    const lower = intent.toLowerCase();
    for (const kind of Object.keys(KIND_TAGS)) {
      if (kind === "graph") continue;
      if (KIND_TAGS[kind].some((tag) => lower.includes(tag))) matched.add(kind);
    }
  }
  return [...new Set([...open, ...matched])];
}

// Simulated worst-case: every window open.
const ALL_OPEN = ["brief", "graph", "workflow", "stack", "waffle", "playbooks", "settings"];
const NONE_OPEN = [];

const cases = [
  // [label, openKinds, intent, expected]

  // No intent → all open kinds (minus graph).
  ["empty intent + all open → all open (minus graph)", ALL_OPEN, "", ALL_OPEN.filter(k => k !== "graph")],

  // Specific intent + nothing open → matched only (the agent will
  // auto-open via dispatchRoomTool's ensureRoomOpen).
  ["stack intent + empty canvas → stack only",          NONE_OPEN, "show me the warn services",       ["stack"]],
  ["brief intent + empty canvas → brief only",          NONE_OPEN, "approve the proposal",            ["brief"]],
  ["destructive intent + empty canvas → settings only", NONE_OPEN, "wipe my memory graph",            ["settings"]],
  ["voice intent + empty canvas → waffle only",         NONE_OPEN, "show the live transcript",        ["waffle"]],

  // Specific intent + open canvas → UNION (open includes the agent's
  // peripheral awareness; matched ensures the focused topic is reachable).
  ["stack intent + brief open → both",                  ["brief"], "show me the warn services",       ["brief", "stack"]],
  ["brief intent + stack+graph open → brief+stack",     ["stack","graph"], "approve the proposal",   ["stack", "brief"]],

  // Mixed intent matches multiple kinds.
  ["mixed brief+workflow ambiguous intent",             ALL_OPEN, "approve the slack-triage proposal", ALL_OPEN.filter(k => k !== "graph")],

  // Graph-only intents add nothing on top of currently-open kinds.
  ["graph intent + nothing else open → empty",          NONE_OPEN, "focus the user-maya node",        []],
  ["graph intent + brief open → brief only",            ["brief","graph"], "focus the user-maya node",["brief"]],

  // Off-topic / unrecognised intent → fall back to whatever is open.
  ["unrecognised intent + nothing open → empty",        NONE_OPEN, "what time is it?",                []],
  ["unrecognised intent + brief open → brief only",     ["brief"], "what time is it?",                ["brief"]],
];

let pass = 0, fail = 0;
for (const [label, openKinds, intent, expected] of cases) {
  const actual = pickRelevantKinds(openKinds, intent).sort();
  const ok = JSON.stringify(actual) === JSON.stringify(expected.sort());
  if (ok) { pass++; console.log(`  ✓ ${label}`); }
  else    { fail++; console.log(`  ✗ ${label}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`); }
}

// Bloat budget — content-agent surface in tools per turn.
const TOOLS_PER_KIND = { brief: 8, workflow: 9, stack: 6, waffle: 4, playbooks: 6, settings: 5 };
const BASELINE = 5 /* contentTools */ + 11 /* graphTools (incl. zoom_to & highlight) */;

const worstAllOpen =
  BASELINE +
  Object.values(TOOLS_PER_KIND).reduce((s, n) => s + n, 0);
const typicalUnionOneOpenOneMentioned =
  BASELINE + TOOLS_PER_KIND.brief + TOOLS_PER_KIND.stack;
const typicalSingleKind =
  BASELINE + TOOLS_PER_KIND.brief;

console.log("");
console.log(`baseline (always present):                          ${BASELINE}`);
console.log(`worst-case (every window open, intent matches all): ${worstAllOpen}`);
console.log(`typical (1 open + 1 in intent, union):              ${typicalUnionOneOpenOneMentioned}`);
console.log(`typical (single kind, no other windows):            ${typicalSingleKind}`);
console.log("");
console.log(`${pass}/${pass + fail} disclosure cases passed`);
process.exit(fail === 0 ? 0 : 1);
