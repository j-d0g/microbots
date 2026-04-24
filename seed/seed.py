"""Seed the SurrealDB memory graph with realistic data for an AI engineer at a startup."""
import asyncio
import os
import random
from datetime import datetime, timezone

from dotenv import load_dotenv
from surrealdb import AsyncSurreal

load_dotenv()

SURREAL_URL = os.getenv("SURREAL_URL", "ws://localhost:8000/rpc")
SURREAL_USER = os.getenv("SURREAL_USER", "root")
SURREAL_PASS = os.getenv("SURREAL_PASS", "root")
SURREAL_NS = os.getenv("SURREAL_NS", "microbots")
SURREAL_DB = os.getenv("SURREAL_DB", "memory")


def placeholder_embedding(dim: int = 1536) -> list[float]:
    """Generate a random unit-normalized vector as a placeholder embedding."""
    vec = [random.gauss(0, 1) for _ in range(dim)]
    mag = sum(x**2 for x in vec) ** 0.5
    return [x / mag for x in vec]


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def seed(db: AsyncSurreal):
    print("Seeding user_profile...")
    await db.query("""
        UPSERT user_profile:default CONTENT {
            name: "Desmond",
            role: "AI engineer",
            goals: [
                "Build agent memory infrastructure",
                "Automate triage and context management across integrations",
                "Ship microbots as a reusable memory layer for AI agents"
            ],
            preferences: {
                communication: "async-first",
                code_review: "thorough, prefer small PRs",
                deploy: "always notify #deployments before pushing to prod",
                linear_before_pr: true
            },
            context_window: 4000,
            created_at: time::now(),
            updated_at: time::now()
        };
    """)

    print("Seeding integrations...")
    integrations = [
        {
            "id": "integration:slack",
            "name": "Slack",
            "slug": "slack",
            "category": "communication",
            "description": "Team messaging platform used for real-time communication and async updates.",
            "user_purpose": "Primary async communication hub. Used for team coordination, deploy notifications, incident discussions, and quick decisions.",
            "usage_patterns": [
                "Monitor #ai-engineering for project updates",
                "Post deploy notifications to #deployments before and after",
                "Use threads for in-depth discussions, keep top-level messages brief",
                "DM Alice for infrastructure questions, Bob for code review requests"
            ],
            "navigation_tips": [
                "Start in #ai-engineering for AI project context",
                "#deployments has the full deploy history",
                "#general for company-wide announcements"
            ],
            "frequency": "daily",
        },
        {
            "id": "integration:github",
            "name": "GitHub",
            "slug": "github",
            "category": "code",
            "description": "Code hosting, PR reviews, and CI/CD pipelines.",
            "user_purpose": "Code collaboration, PR reviews, and CI pipeline management. Repos: microbots, taro-api, infra.",
            "usage_patterns": [
                "Open PRs from feature branches, request review from Bob",
                "Check CI status before merging",
                "Use PR descriptions to summarize changes and link Linear tickets",
                "Tag Alice on infra-related PRs"
            ],
            "navigation_tips": [
                "microbots repo is the primary active project",
                "taro-api is the backend API service",
                "infra repo contains Terraform and Docker configs"
            ],
            "frequency": "daily",
        },
        {
            "id": "integration:linear",
            "name": "Linear",
            "slug": "linear",
            "category": "project_mgmt",
            "description": "Issue tracker for engineering tasks and project planning.",
            "user_purpose": "Task management and sprint planning. Projects: Agent Memory, Platform.",
            "usage_patterns": [
                "Create ticket before starting any PR work",
                "Link Linear tickets in PR descriptions",
                "Move tickets to In Progress when starting, Done when merging",
                "Use 'Agent Memory' project for microbots work"
            ],
            "navigation_tips": [
                "'Agent Memory' project tracks all microbots tasks",
                "'Platform' project tracks taro-api and infra work",
                "Use priority levels: Urgent for blockers, High for sprint goals"
            ],
            "frequency": "daily",
        },
        {
            "id": "integration:gmail",
            "name": "Gmail",
            "slug": "gmail",
            "category": "communication",
            "description": "Email for external communications, investor updates, and vendor coordination.",
            "user_purpose": "External comms only. Investor updates, vendor contracts, and legal correspondence.",
            "usage_patterns": [
                "Check once daily, not real-time",
                "Investor updates go out monthly",
                "Vendor coordination for cloud services (AWS, Anthropic)"
            ],
            "navigation_tips": [
                "Labels: Investors, Vendors, Legal",
                "Priority inbox filters out newsletters automatically"
            ],
            "frequency": "daily",
        },
        {
            "id": "integration:notion",
            "name": "Notion",
            "slug": "notion",
            "category": "knowledge",
            "description": "Documentation, specs, meeting notes, and knowledge base.",
            "user_purpose": "Long-form docs and specs. Architecture decisions, meeting notes, product specs.",
            "usage_patterns": [
                "Write architecture docs before implementation",
                "Meeting notes go in the 'Meetings' database",
                "Link Notion specs in Linear tickets for context"
            ],
            "navigation_tips": [
                "Engineering workspace has all technical docs",
                "ADR (Architecture Decision Records) page for past decisions",
                "Product specs live under 'Product' workspace"
            ],
            "frequency": "weekly",
        },
    ]

    for intg in integrations:
        record_id = intg.pop("id")
        await db.query(f"""
            UPSERT {record_id} CONTENT {{
                name: "{intg['name']}",
                slug: "{intg['slug']}",
                category: "{intg['category']}",
                description: "{intg['description']}",
                user_purpose: "{intg['user_purpose']}",
                usage_patterns: {intg['usage_patterns']},
                navigation_tips: {intg['navigation_tips']},
                frequency: "{intg['frequency']}",
                created_at: time::now(),
                updated_at: time::now()
            }};
        """)

    print("Seeding entities...")
    entities = [
        {
            "id": "entity:alice",
            "name": "Alice Chen",
            "entity_type": "person",
            "description": "Co-founder and infrastructure lead. Go-to for all infra decisions, cloud architecture, and deploy pipelines. Very responsive on Slack.",
            "aliases": ["@alice", "alice-chen", "alice@company.com"],
            "tags": ["co-founder", "infrastructure", "decision-maker"],
        },
        {
            "id": "entity:bob",
            "name": "Bob Kim",
            "entity_type": "person",
            "description": "Senior AI engineer. Primary code reviewer for microbots and taro-api. Strong opinions on code quality and test coverage.",
            "aliases": ["@bob", "bob-kim", "bob@company.com"],
            "tags": ["engineer", "reviewer", "ai"],
        },
        {
            "id": "entity:carol",
            "name": "Carol Diaz",
            "entity_type": "person",
            "description": "Product designer. Handles UI/UX for the platform. Coordinates design tasks in Linear.",
            "aliases": ["@carol", "carol-diaz", "carol@company.com"],
            "tags": ["designer", "product"],
        },
        {
            "id": "entity:channel_ai_eng",
            "name": "#ai-engineering",
            "entity_type": "channel",
            "description": "Primary Slack channel for AI project discussions, microbots updates, and agent-related work.",
            "aliases": ["#ai-eng", "#ai-engineering"],
            "tags": ["slack", "ai", "microbots"],
        },
        {
            "id": "entity:channel_deployments",
            "name": "#deployments",
            "entity_type": "channel",
            "description": "Slack channel for deploy notifications. Convention: post before and after every production deploy.",
            "aliases": ["#deployments", "#deploys"],
            "tags": ["slack", "deploy", "ops"],
        },
        {
            "id": "entity:repo_microbots",
            "name": "microbots",
            "entity_type": "repo",
            "description": "Primary repo for the agent memory infrastructure project. Python + SurrealDB.",
            "aliases": ["microbots", "github.com/org/microbots"],
            "tags": ["github", "primary", "ai", "surrealdb"],
        },
        {
            "id": "entity:repo_taro_api",
            "name": "taro-api",
            "entity_type": "repo",
            "description": "Backend API service. FastAPI + PostgreSQL. Powers the frontend dashboard.",
            "aliases": ["taro-api", "github.com/org/taro-api"],
            "tags": ["github", "backend", "api"],
        },
        {
            "id": "entity:project_agent_memory",
            "name": "Agent Memory",
            "entity_type": "project",
            "description": "Linear project tracking all microbots development tasks. Current sprint: SurrealDB graph bootstrap.",
            "aliases": ["Agent Memory", "agent-memory"],
            "tags": ["linear", "microbots", "ai"],
        },
        {
            "id": "entity:project_platform",
            "name": "Platform",
            "entity_type": "project",
            "description": "Linear project for taro-api and infra work. Shared platform team.",
            "aliases": ["Platform", "platform"],
            "tags": ["linear", "platform", "infra"],
        },
        {
            "id": "entity:team_engineering",
            "name": "Engineering",
            "entity_type": "team",
            "description": "Full engineering team spanning Slack, GitHub, and Linear. Alice, Bob, Carol, and Desmond.",
            "aliases": ["Engineering", "eng-team"],
            "tags": ["team", "slack", "github", "linear"],
        },
    ]

    for ent in entities:
        record_id = ent.pop("id")
        embedding = placeholder_embedding()
        await db.query(f"""
            UPSERT {record_id} CONTENT {{
                name: "{ent['name']}",
                entity_type: "{ent['entity_type']}",
                description: "{ent['description']}",
                aliases: {ent['aliases']},
                tags: {ent['tags']},
                embedding: {embedding},
                created_at: time::now(),
                updated_at: time::now()
            }};
        """)

    print("Seeding chats...")
    chat_records = [
        {
            "id": "chat:slack_deploy_incident",
            "title": "Deploy failure discussion - microbots staging",
            "content": "Alice: heads up, staging deploy failed. Bob: checking CI logs now. Alice: looks like the SurrealDB connection string wasn't updated in .env. Bob: fixed, re-running. Alice: all green now. Let's add a pre-deploy checklist to the runbook.",
            "source_type": "slack_thread",
            "source_id": "slack-thread-001",
            "signal_level": "high",
            "summary": "Staging deploy failed due to stale .env config. Resolved by updating SurrealDB connection string. Action: add pre-deploy checklist.",
        },
        {
            "id": "chat:github_pr_schema",
            "title": "PR #42: Add SurrealDB schema for memory graph",
            "content": "Bob: good structure overall. Couple of notes: 1) The HNSW indexes look correct but make sure DIMENSION matches your embedding model. 2) Prefer SCHEMAFULL everywhere for type safety. 3) Add a comment explaining why layer_index exists - it's not obvious. Desmond: good points, updating now. Bob: LGTM, merging.",
            "source_type": "github_pr",
            "source_id": "pr-42",
            "signal_level": "high",
            "summary": "PR review for SurrealDB schema. Bob flagged HNSW dimension check, SCHEMAFULL preference, and layer_index documentation needs.",
        },
        {
            "id": "chat:linear_ticket_triage",
            "title": "Bug: memory graph not persisting between sessions",
            "content": "Carol: assigning this to Desmond, priority High. Desmond: root cause is the Docker volume not mounting correctly on restart. Alice: confirm, I've seen this before - add named volume to docker-compose. Desmond: fixed in #43. Carol: verified, closing ticket.",
            "source_type": "linear_ticket",
            "source_id": "linear-001",
            "signal_level": "curated",
            "summary": "Docker volume mount issue caused memory graph data loss on restart. Fixed by adding named volume.",
        },
        {
            "id": "chat:slack_code_style",
            "title": "Code review preferences discussion",
            "content": "Bob: quick note for the team - please add type hints to all Python functions going forward. Also, docstrings only where the WHY isn't obvious from the name. Desmond: agreed, I'll add a pre-commit hook for mypy. Alice: +1, let's also enforce black formatting.",
            "source_type": "slack_thread",
            "source_id": "slack-thread-002",
            "signal_level": "high",
            "summary": "Team agreed on Python code standards: type hints required, mypy + black enforced via pre-commit hooks.",
        },
        {
            "id": "chat:notion_deploy_runbook",
            "title": "Deploy Runbook v2 - Notion page edit",
            "content": "Updated the deploy runbook to include: 1) Create Linear ticket for the deploy. 2) Post to #deployments with ticket link. 3) Run smoke tests on staging. 4) Get +1 from Alice for infra-touching deploys. 5) Merge and post completion to #deployments.",
            "source_type": "notion_page",
            "source_id": "notion-deploy-runbook",
            "signal_level": "high",
            "summary": "Deploy runbook updated with 5-step process including Linear ticket, Slack notifications, smoke tests, and Alice approval for infra changes.",
        },
    ]

    for chat in chat_records:
        record_id = chat.pop("id")
        embedding = placeholder_embedding()
        await db.query(f"""
            UPSERT {record_id} CONTENT {{
                title: "{chat['title']}",
                content: "{chat['content']}",
                source_type: "{chat['source_type']}",
                source_id: "{chat['source_id']}",
                signal_level: "{chat['signal_level']}",
                summary: "{chat['summary']}",
                embedding: {embedding},
                occurred_at: time::now(),
                created_at: time::now()
            }};
        """)

    print("Seeding memories...")
    memory_records = [
        {
            "id": "memory:notify_deployments",
            "content": "User always posts a notification to #deployments on Slack before and after every production deploy. This is a non-negotiable team convention.",
            "memory_type": "preference",
            "confidence": 0.95,
            "source": "deploy runbook + repeated Slack behavior",
            "tags": ["deploy", "slack", "convention"],
        },
        {
            "id": "memory:alice_infra",
            "content": "Alice Chen is the go-to decision-maker for all infrastructure questions. DM her on Slack or tag in GitHub PRs for infra-touching changes. She's highly responsive.",
            "memory_type": "fact",
            "confidence": 0.98,
            "source": "deploy incident chat + team structure",
            "tags": ["alice", "infra", "decision-maker"],
        },
        {
            "id": "memory:linear_before_pr",
            "content": "User always creates a Linear ticket before opening a GitHub PR. Tickets are linked in the PR description. This is a personal workflow convention.",
            "memory_type": "action_pattern",
            "confidence": 0.92,
            "source": "GitHub PR history + Bob's review comments",
            "tags": ["linear", "github", "workflow", "convention"],
        },
        {
            "id": "memory:python_type_hints",
            "content": "Team convention: all Python functions must have type hints. mypy and black are enforced via pre-commit hooks. Docstrings only where WHY isn't obvious from the name.",
            "memory_type": "preference",
            "confidence": 0.90,
            "source": "Slack code style discussion",
            "tags": ["python", "code-style", "convention"],
        },
        {
            "id": "memory:bob_reviewer",
            "content": "Bob Kim is the primary code reviewer for microbots and taro-api. He prioritizes type safety, SCHEMAFULL tables in SurrealDB, and always checks HNSW dimension correctness.",
            "memory_type": "fact",
            "confidence": 0.88,
            "source": "GitHub PR #42 review",
            "tags": ["bob", "reviewer", "surrealdb", "github"],
        },
        {
            "id": "memory:surrealdb_hnsw",
            "content": "When defining HNSW vector indexes in SurrealDB, always verify the DIMENSION matches the embedding model (1536 for OpenAI/compatible). Mismatch causes silent failures.",
            "memory_type": "fact",
            "confidence": 0.95,
            "source": "Bob's PR review comment on PR #42",
            "tags": ["surrealdb", "hnsw", "embedding", "gotcha"],
        },
    ]

    for mem in memory_records:
        record_id = mem.pop("id")
        embedding = placeholder_embedding()
        await db.query(f"""
            UPSERT {record_id} CONTENT {{
                content: "{mem['content']}",
                memory_type: "{mem['memory_type']}",
                confidence: {mem['confidence']},
                source: "{mem['source']}",
                tags: {mem['tags']},
                embedding: {embedding},
                created_at: time::now(),
                updated_at: time::now()
            }};
        """)

    print("Seeding skills...")
    skill_records = [
        {
            "id": "skill:create_linear_from_slack",
            "name": "Create Linear ticket from Slack message",
            "slug": "create_linear_from_slack",
            "description": "When a bug or task is raised in Slack, create a corresponding Linear ticket with context, assign appropriately, and reply in Slack with the ticket link.",
            "steps": [
                "Read Slack message and extract task/bug description",
                "Open Linear and select appropriate project (Agent Memory or Platform)",
                "Create ticket with descriptive title and full context in description",
                "Set priority based on urgency (Urgent for blockers, High for sprint goals)",
                "Assign to self or appropriate team member",
                "Reply in Slack thread with Linear ticket link"
            ],
            "frequency": "daily",
            "tags": ["linear", "slack", "triage"],
        },
        {
            "id": "skill:deploy_to_staging",
            "name": "Deploy to staging",
            "slug": "deploy_to_staging",
            "description": "Deploy a branch to the staging environment, run smoke tests, and notify the team.",
            "steps": [
                "Post to #deployments: 'Deploying [branch] to staging - [Linear ticket link]'",
                "Push branch and trigger CI",
                "Wait for CI green",
                "Run smoke tests against staging",
                "Post to #deployments: 'Staging deploy complete - [status]'"
            ],
            "frequency": "daily",
            "tags": ["deploy", "staging", "slack", "github"],
        },
        {
            "id": "skill:triage_incoming_bug",
            "name": "Triage incoming bug",
            "slug": "triage_incoming_bug",
            "description": "Process a reported bug from Slack or Linear: investigate, classify severity, assign, and track to resolution.",
            "steps": [
                "Read bug report in Slack or Linear",
                "Check recent logs or error traces",
                "Classify severity: P0 (prod down), P1 (major feature broken), P2 (minor issue)",
                "Create or update Linear ticket with findings",
                "Assign to appropriate engineer",
                "Post update to #ai-engineering or #deployments as appropriate"
            ],
            "frequency": "weekly",
            "tags": ["bug", "linear", "slack", "triage"],
        },
        {
            "id": "skill:review_pr_checklist",
            "name": "Review PR with checklist",
            "slug": "review_pr_checklist",
            "description": "Conduct a thorough PR review following team standards: type hints, tests, schema correctness, and Linear ticket linkage.",
            "steps": [
                "Check PR description links to a Linear ticket",
                "Verify all Python functions have type hints",
                "Check tests exist for new functionality",
                "For SurrealDB changes: verify SCHEMAFULL, HNSW dimensions, index correctness",
                "Run CI and confirm all checks pass",
                "Approve or request changes with specific, actionable comments"
            ],
            "frequency": "daily",
            "tags": ["github", "review", "code-quality"],
        },
    ]

    for skill in skill_records:
        record_id = skill.pop("id")
        embedding = placeholder_embedding()
        await db.query(f"""
            UPSERT {record_id} CONTENT {{
                name: "{skill['name']}",
                slug: "{skill['slug']}",
                description: "{skill['description']}",
                steps: {skill['steps']},
                frequency: "{skill['frequency']}",
                tags: {skill['tags']},
                embedding: {embedding},
                created_at: time::now(),
                updated_at: time::now()
            }};
        """)

    print("Seeding workflows...")
    workflow_records = [
        {
            "id": "workflow:deploy_pipeline",
            "name": "Deploy Pipeline",
            "slug": "deploy_pipeline",
            "description": "Full deploy cycle from code-ready to production: Linear ticket, staging deploy, smoke tests, production deploy, and Slack notifications.",
            "trigger": "Feature branch is ready to merge to main",
            "outcome": "Code is live in production, team notified in #deployments, Linear ticket closed",
            "frequency": "daily",
            "tags": ["deploy", "production", "github", "slack", "linear"],
        },
        {
            "id": "workflow:bug_triage",
            "name": "Bug Triage",
            "slug": "bug_triage",
            "description": "End-to-end bug handling: from report to resolution. Covers Slack report, Linear ticket creation, investigation, fix, and deploy.",
            "trigger": "Bug reported in Slack or Linear",
            "outcome": "Bug fixed and deployed, Linear ticket closed, team updated in Slack",
            "frequency": "weekly",
            "tags": ["bug", "triage", "linear", "slack", "github"],
        },
        {
            "id": "workflow:pr_review_cycle",
            "name": "PR Review Cycle",
            "slug": "pr_review_cycle",
            "description": "Standard PR lifecycle: Linear ticket creation, branch, PR open, review by Bob, address feedback, merge.",
            "trigger": "Starting work on a new feature or bug fix",
            "outcome": "Feature merged to main, Linear ticket closed, PR linked",
            "frequency": "daily",
            "tags": ["github", "linear", "review", "workflow"],
        },
    ]

    for wf in workflow_records:
        record_id = wf.pop("id")
        embedding = placeholder_embedding()
        await db.query(f"""
            UPSERT {record_id} CONTENT {{
                name: "{wf['name']}",
                slug: "{wf['slug']}",
                description: "{wf['description']}",
                trigger: "{wf['trigger']}",
                outcome: "{wf['outcome']}",
                frequency: "{wf['frequency']}",
                tags: {wf['tags']},
                embedding: {embedding},
                created_at: time::now(),
                updated_at: time::now()
            }};
        """)

    print("Seeding layer_index nodes...")
    layer_indexes = [
        ("layer_index:user", "user", "user", 0, "memory/user.md", "Root navigation index. Entry point for all agent memory.", 800),
        ("layer_index:integrations", "integrations", "integrations", 1, "memory/integrations/agents.md", "Index of all 5 integrations with behavioral metadata.", 600),
        ("layer_index:entities", "entities", "entities", 1, "memory/entities/agents.md", "Index of all cross-integration entities (people, channels, repos, projects, teams).", 700),
        ("layer_index:chats", "chats", "chats", 1, "memory/chats/agents.md", "Index of all chat data by source integration.", 500),
        ("layer_index:memories", "memories", "memories", 1, "memory/memories/agents.md", "Index of distilled high-signal memories.", 400),
        ("layer_index:skills", "skills", "skills", 1, "memory/skills/agents.md", "Index of all learned skills.", 450),
        ("layer_index:workflows", "workflows", "workflows", 1, "memory/workflows/agents.md", "Index of all discovered workflows.", 350),
        ("layer_index:integrations_slack", "integrations/slack", "integrations", 2, "memory/integrations/slack/agents.md", "Slack-specific behavioral detail.", 300),
        ("layer_index:integrations_github", "integrations/github", "integrations", 2, "memory/integrations/github/agents.md", "GitHub-specific behavioral detail.", 300),
        ("layer_index:integrations_linear", "integrations/linear", "integrations", 2, "memory/integrations/linear/agents.md", "Linear-specific behavioral detail.", 300),
        ("layer_index:integrations_gmail", "integrations/gmail", "integrations", 2, "memory/integrations/gmail/agents.md", "Gmail-specific behavioral detail.", 200),
        ("layer_index:integrations_notion", "integrations/notion", "integrations", 2, "memory/integrations/notion/agents.md", "Notion-specific behavioral detail.", 200),
    ]

    for li_id, name, layer, depth, md_path, desc, cost in layer_indexes:
        await db.query(f"""
            UPSERT {li_id} CONTENT {{
                name: "{name}",
                layer: "{layer}",
                depth: {depth},
                description: "{desc}",
                markdown_path: "{md_path}",
                context_window_cost: {cost},
                created_at: time::now(),
                updated_at: time::now()
            }};
        """)

    print("Seeding edges...")

    # uses_integration: user → integrations
    for slug in ["slack", "github", "linear", "gmail", "notion"]:
        primary_uses = {
            "slack": "async team communication and deploy coordination",
            "github": "code collaboration and PR reviews",
            "linear": "task tracking and sprint management",
            "gmail": "external communications and investor updates",
            "notion": "documentation and architecture specs",
        }
        await db.query(f"""
            RELATE user_profile:default->uses_integration->integration:{slug} CONTENT {{
                primary_use: "{primary_uses[slug]}",
                frequency: "daily",
                first_used_at: time::now(),
                last_used_at: time::now()
            }};
        """)

    # appears_in: entities → integrations
    appears_in_edges = [
        ("entity:alice", "integration:slack", "@alice", "co-founder", "Primary infra contact on Slack"),
        ("entity:alice", "integration:github", "alice-chen", "maintainer", "Tags on infra PRs"),
        ("entity:alice", "integration:linear", "alice@company.com", "co-founder", "Reviews infra tickets"),
        ("entity:bob", "integration:slack", "@bob", "senior engineer", "Primary code reviewer"),
        ("entity:bob", "integration:github", "bob-kim", "reviewer", "Assigned reviewer for microbots and taro-api"),
        ("entity:bob", "integration:linear", "bob@company.com", "engineer", "Owns engineering tickets"),
        ("entity:carol", "integration:slack", "@carol", "designer", "Design coordination"),
        ("entity:carol", "integration:linear", "carol@company.com", "designer", "Owns design tickets"),
        ("entity:channel_ai_eng", "integration:slack", "#ai-engineering", "channel", "AI project discussions"),
        ("entity:channel_deployments", "integration:slack", "#deployments", "channel", "Deploy notifications"),
        ("entity:repo_microbots", "integration:github", "microbots", "repo", "Primary active repo"),
        ("entity:repo_taro_api", "integration:github", "taro-api", "repo", "Backend API repo"),
        ("entity:project_agent_memory", "integration:linear", "Agent Memory", "project", "Microbots tasks"),
        ("entity:project_platform", "integration:linear", "Platform", "project", "Infra and API tasks"),
        ("entity:team_engineering", "integration:slack", "Engineering", "team", "Eng team Slack presence"),
        ("entity:team_engineering", "integration:github", "Engineering", "team", "GitHub org team"),
        ("entity:team_engineering", "integration:linear", "Engineering", "team", "Linear team"),
    ]
    for entity_id, intg_id, handle, role, context in appears_in_edges:
        await db.query(f"""
            RELATE {entity_id}->appears_in->{intg_id} CONTENT {{
                handle: "{handle}",
                role: "{role}",
                context: "{context}"
            }};
        """)

    # co_used_with: integrations frequently used together
    co_used_edges = [
        ("integration:slack", "integration:linear", 150, "triage", "Bug reports in Slack become Linear tickets"),
        ("integration:slack", "integration:github", 120, "deploy", "Deploy notifications and PR review pings"),
        ("integration:github", "integration:linear", 200, "pr_workflow", "Every PR links to a Linear ticket"),
        ("integration:slack", "integration:notion", 40, "documentation", "Notion links shared in Slack for context"),
        ("integration:linear", "integration:notion", 30, "specs", "Linear tickets link to Notion specs"),
    ]
    for from_id, to_id, freq, context, desc in co_used_edges:
        await db.query(f"""
            RELATE {from_id}->co_used_with->{to_id} CONTENT {{
                frequency: {freq},
                common_context: "{context}",
                last_observed_at: time::now()
            }};
        """)

    # related_to_entity: entity relationships
    related_edges = [
        ("entity:alice", "entity:team_engineering", "member_of", "Alice is a founding member of the engineering team"),
        ("entity:bob", "entity:team_engineering", "member_of", "Bob is a senior member of the engineering team"),
        ("entity:carol", "entity:team_engineering", "member_of", "Carol is the design member of the team"),
        ("entity:alice", "entity:repo_microbots", "maintains", "Alice reviews infra-related microbots changes"),
        ("entity:bob", "entity:repo_microbots", "maintains", "Bob is primary reviewer for microbots"),
        ("entity:bob", "entity:repo_taro_api", "maintains", "Bob is primary reviewer for taro-api"),
        ("entity:project_agent_memory", "entity:repo_microbots", "tracks", "Agent Memory project tracks microbots repo work"),
    ]
    for from_id, to_id, rel_type, context in related_edges:
        await db.query(f"""
            RELATE {from_id}->related_to_entity->{to_id} CONTENT {{
                relationship_type: "{rel_type}",
                context: "{context}"
            }};
        """)

    # chat_from: chat → integration
    chat_from_edges = [
        ("chat:slack_deploy_incident", "integration:slack"),
        ("chat:github_pr_schema", "integration:github"),
        ("chat:linear_ticket_triage", "integration:linear"),
        ("chat:slack_code_style", "integration:slack"),
        ("chat:notion_deploy_runbook", "integration:notion"),
    ]
    for chat_id, intg_id in chat_from_edges:
        await db.query(f"RELATE {chat_id}->chat_from->{intg_id};")

    # chat_mentions: chat → entity
    chat_mention_edges = [
        ("chat:slack_deploy_incident", "entity:alice", "author"),
        ("chat:slack_deploy_incident", "entity:bob", "mentioned"),
        ("chat:slack_deploy_incident", "entity:channel_deployments", "mentioned"),
        ("chat:github_pr_schema", "entity:bob", "reviewer"),
        ("chat:github_pr_schema", "entity:repo_microbots", "mentioned"),
        ("chat:linear_ticket_triage", "entity:carol", "assignee"),
        ("chat:linear_ticket_triage", "entity:alice", "mentioned"),
        ("chat:linear_ticket_triage", "entity:project_agent_memory", "mentioned"),
        ("chat:slack_code_style", "entity:bob", "author"),
        ("chat:slack_code_style", "entity:alice", "mentioned"),
        ("chat:notion_deploy_runbook", "entity:channel_deployments", "mentioned"),
        ("chat:notion_deploy_runbook", "entity:alice", "mentioned"),
    ]
    for chat_id, entity_id, mention_type in chat_mention_edges:
        await db.query(f"""
            RELATE {chat_id}->chat_mentions->{entity_id} CONTENT {{
                mention_type: "{mention_type}"
            }};
        """)

    # chat_yields: chat → memory
    chat_yields_edges = [
        ("chat:slack_deploy_incident", "memory:notify_deployments", 0.95),
        ("chat:slack_deploy_incident", "memory:alice_infra", 0.88),
        ("chat:github_pr_schema", "memory:bob_reviewer", 0.90),
        ("chat:github_pr_schema", "memory:surrealdb_hnsw", 0.95),
        ("chat:slack_code_style", "memory:python_type_hints", 0.90),
        ("chat:notion_deploy_runbook", "memory:notify_deployments", 0.92),
        ("chat:linear_ticket_triage", "memory:linear_before_pr", 0.85),
    ]
    for chat_id, mem_id, confidence in chat_yields_edges:
        await db.query(f"""
            RELATE {chat_id}->chat_yields->{mem_id} CONTENT {{
                confidence: {confidence},
                extracted_at: time::now()
            }};
        """)

    # memory_about: memory → entity | integration
    memory_about_edges = [
        ("memory:notify_deployments", "integration:slack", 0.95),
        ("memory:alice_infra", "entity:alice", 0.98),
        ("memory:linear_before_pr", "integration:linear", 0.90),
        ("memory:linear_before_pr", "integration:github", 0.85),
        ("memory:python_type_hints", "entity:bob", 0.80),
        ("memory:bob_reviewer", "entity:bob", 0.98),
        ("memory:surrealdb_hnsw", "integration:github", 0.70),
    ]
    for mem_id, target_id, relevance in memory_about_edges:
        await db.query(f"""
            RELATE {mem_id}->memory_about->{target_id} CONTENT {{
                relevance: {relevance}
            }};
        """)

    # skill_derived_from: skill → chat
    skill_derived_edges = [
        ("skill:create_linear_from_slack", "chat:slack_deploy_incident"),
        ("skill:create_linear_from_slack", "chat:linear_ticket_triage"),
        ("skill:deploy_to_staging", "chat:slack_deploy_incident"),
        ("skill:deploy_to_staging", "chat:notion_deploy_runbook"),
        ("skill:triage_incoming_bug", "chat:linear_ticket_triage"),
        ("skill:review_pr_checklist", "chat:github_pr_schema"),
        ("skill:review_pr_checklist", "chat:slack_code_style"),
    ]
    for skill_id, chat_id in skill_derived_edges:
        await db.query(f"RELATE {skill_id}->skill_derived_from->{chat_id};")

    # skill_uses: skill → integration
    skill_uses_edges = [
        ("skill:create_linear_from_slack", "integration:slack"),
        ("skill:create_linear_from_slack", "integration:linear"),
        ("skill:deploy_to_staging", "integration:slack"),
        ("skill:deploy_to_staging", "integration:github"),
        ("skill:triage_incoming_bug", "integration:slack"),
        ("skill:triage_incoming_bug", "integration:linear"),
        ("skill:review_pr_checklist", "integration:github"),
        ("skill:review_pr_checklist", "integration:linear"),
    ]
    for skill_id, intg_id in skill_uses_edges:
        await db.query(f"RELATE {skill_id}->skill_uses->{intg_id};")

    # workflow_contains_skill: workflow → skill (ordered)
    workflow_skill_edges = [
        ("workflow:deploy_pipeline", "skill:deploy_to_staging", 1, False),
        ("workflow:deploy_pipeline", "skill:create_linear_from_slack", 2, True),
        ("workflow:bug_triage", "skill:triage_incoming_bug", 1, False),
        ("workflow:bug_triage", "skill:create_linear_from_slack", 2, False),
        ("workflow:bug_triage", "skill:deploy_to_staging", 3, True),
        ("workflow:pr_review_cycle", "skill:review_pr_checklist", 1, False),
        ("workflow:pr_review_cycle", "skill:create_linear_from_slack", 2, False),
    ]
    for wf_id, skill_id, step, optional in workflow_skill_edges:
        await db.query(f"""
            RELATE {wf_id}->workflow_contains_skill->{skill_id} CONTENT {{
                step_order: {step},
                optional: {str(optional).lower()}
            }};
        """)

    # workflow_uses: workflow → integration
    workflow_uses_edges = [
        ("workflow:deploy_pipeline", "integration:slack"),
        ("workflow:deploy_pipeline", "integration:github"),
        ("workflow:deploy_pipeline", "integration:linear"),
        ("workflow:bug_triage", "integration:slack"),
        ("workflow:bug_triage", "integration:linear"),
        ("workflow:bug_triage", "integration:github"),
        ("workflow:pr_review_cycle", "integration:github"),
        ("workflow:pr_review_cycle", "integration:linear"),
    ]
    for wf_id, intg_id in workflow_uses_edges:
        await db.query(f"RELATE {wf_id}->workflow_uses->{intg_id};")

    # workflow_involves: workflow → entity
    workflow_involves_edges = [
        ("workflow:deploy_pipeline", "entity:channel_deployments", "notification_target"),
        ("workflow:deploy_pipeline", "entity:alice", "approver"),
        ("workflow:deploy_pipeline", "entity:repo_microbots", "target_repo"),
        ("workflow:bug_triage", "entity:alice", "escalation_contact"),
        ("workflow:bug_triage", "entity:channel_ai_eng", "notification_target"),
        ("workflow:pr_review_cycle", "entity:bob", "reviewer"),
        ("workflow:pr_review_cycle", "entity:repo_microbots", "target_repo"),
    ]
    for wf_id, entity_id, role in workflow_involves_edges:
        await db.query(f"""
            RELATE {wf_id}->workflow_involves->{entity_id} CONTENT {{
                role: "{role}"
            }};
        """)

    # memory_informs: memory → skill | workflow
    memory_informs_edges = [
        ("memory:notify_deployments", "workflow:deploy_pipeline"),
        ("memory:notify_deployments", "skill:deploy_to_staging"),
        ("memory:alice_infra", "workflow:deploy_pipeline"),
        ("memory:linear_before_pr", "workflow:pr_review_cycle"),
        ("memory:linear_before_pr", "skill:create_linear_from_slack"),
        ("memory:bob_reviewer", "workflow:pr_review_cycle"),
        ("memory:surrealdb_hnsw", "skill:review_pr_checklist"),
    ]
    for mem_id, target_id in memory_informs_edges:
        await db.query(f"RELATE {mem_id}->memory_informs->{target_id};")

    # indexed_by: nodes → layer_index
    indexed_by_edges = [
        ("user_profile:default", "layer_index:user"),
        ("integration:slack", "layer_index:integrations"),
        ("integration:slack", "layer_index:integrations_slack"),
        ("integration:github", "layer_index:integrations"),
        ("integration:github", "layer_index:integrations_github"),
        ("integration:linear", "layer_index:integrations"),
        ("integration:linear", "layer_index:integrations_linear"),
        ("integration:gmail", "layer_index:integrations"),
        ("integration:gmail", "layer_index:integrations_gmail"),
        ("integration:notion", "layer_index:integrations"),
        ("integration:notion", "layer_index:integrations_notion"),
        ("entity:alice", "layer_index:entities"),
        ("entity:bob", "layer_index:entities"),
        ("entity:carol", "layer_index:entities"),
        ("entity:channel_ai_eng", "layer_index:entities"),
        ("entity:channel_deployments", "layer_index:entities"),
        ("entity:repo_microbots", "layer_index:entities"),
        ("entity:repo_taro_api", "layer_index:entities"),
        ("entity:project_agent_memory", "layer_index:entities"),
        ("entity:project_platform", "layer_index:entities"),
        ("entity:team_engineering", "layer_index:entities"),
        ("chat:slack_deploy_incident", "layer_index:chats"),
        ("chat:github_pr_schema", "layer_index:chats"),
        ("chat:linear_ticket_triage", "layer_index:chats"),
        ("chat:slack_code_style", "layer_index:chats"),
        ("chat:notion_deploy_runbook", "layer_index:chats"),
        ("memory:notify_deployments", "layer_index:memories"),
        ("memory:alice_infra", "layer_index:memories"),
        ("memory:linear_before_pr", "layer_index:memories"),
        ("memory:python_type_hints", "layer_index:memories"),
        ("memory:bob_reviewer", "layer_index:memories"),
        ("memory:surrealdb_hnsw", "layer_index:memories"),
        ("skill:create_linear_from_slack", "layer_index:skills"),
        ("skill:deploy_to_staging", "layer_index:skills"),
        ("skill:triage_incoming_bug", "layer_index:skills"),
        ("skill:review_pr_checklist", "layer_index:skills"),
        ("workflow:deploy_pipeline", "layer_index:workflows"),
        ("workflow:bug_triage", "layer_index:workflows"),
        ("workflow:pr_review_cycle", "layer_index:workflows"),
    ]
    for node_id, li_id in indexed_by_edges:
        await db.query(f"RELATE {node_id}->indexed_by->{li_id};")

    # drills_into: layer_index hierarchy
    drills_into_edges = [
        ("layer_index:user", "layer_index:integrations", 1, 600),
        ("layer_index:user", "layer_index:entities", 1, 700),
        ("layer_index:user", "layer_index:chats", 1, 500),
        ("layer_index:user", "layer_index:memories", 1, 400),
        ("layer_index:user", "layer_index:skills", 1, 450),
        ("layer_index:user", "layer_index:workflows", 1, 350),
        ("layer_index:integrations", "layer_index:integrations_slack", 2, 300),
        ("layer_index:integrations", "layer_index:integrations_github", 2, 300),
        ("layer_index:integrations", "layer_index:integrations_linear", 2, 300),
        ("layer_index:integrations", "layer_index:integrations_gmail", 2, 200),
        ("layer_index:integrations", "layer_index:integrations_notion", 2, 200),
    ]
    for from_li, to_li, depth, cost in drills_into_edges:
        await db.query(f"""
            RELATE {from_li}->drills_into->{to_li} CONTENT {{
                depth: {depth},
                context_window_cost: {cost}
            }};
        """)

    print("\nSeed complete. Verifying record counts...")
    tables = ["user_profile", "integration", "entity", "chat", "memory", "skill", "workflow", "layer_index"]
    for table in tables:
        result = await db.query(f"SELECT count() FROM {table} GROUP ALL;")
        count = result[0][0].get("count", 0) if result and result[0] else 0
        print(f"  {table}: {count}")

    edge_tables = [
        "uses_integration", "appears_in", "co_used_with", "related_to_entity",
        "chat_from", "chat_mentions", "chat_yields", "memory_about",
        "skill_derived_from", "skill_uses", "workflow_contains_skill",
        "workflow_uses", "workflow_involves", "memory_informs", "indexed_by", "drills_into"
    ]
    print("\nEdge counts:")
    for table in edge_tables:
        result = await db.query(f"SELECT count() FROM {table} GROUP ALL;")
        count = result[0][0].get("count", 0) if result and result[0] else 0
        print(f"  {table}: {count}")


async def main():
    async with AsyncSurreal(SURREAL_URL) as db:
        await db.signin({"username": SURREAL_USER, "password": SURREAL_PASS})
        await db.use(SURREAL_NS, SURREAL_DB)
        await seed(db)


if __name__ == "__main__":
    asyncio.run(main())
