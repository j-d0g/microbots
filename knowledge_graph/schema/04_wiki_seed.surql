-- ----------------------------------------------------------------------
-- Skeleton seed: 18 empty wiki_page rows + parent edges.
-- Run after schema/02_wiki.surql. Idempotent.
-- See plan: wiki_in_surrealdb_v1 §2.4
-- ----------------------------------------------------------------------

-- Reset wiki tables to a clean skeleton. Revisions and previous content drop here.
DELETE wiki_parent;
DELETE wiki_page_revision;
DELETE wiki_page;

-- ---- depth 1: root ----
CREATE wiki_page:user_md SET
    path="user.md", layer="root", depth=1,
    title="User", token_budget=4000;

-- ---- depth 2: layer summaries ----
CREATE wiki_page:integrations_agents_md SET
    path="integrations/agents.md", layer="integrations", depth=2,
    title="Integrations", token_budget=600;
CREATE wiki_page:entities_agents_md SET
    path="entities/agents.md",     layer="entities",     depth=2,
    title="Entities",     token_budget=600;
CREATE wiki_page:chats_agents_md SET
    path="chats/agents.md",        layer="chats",        depth=2,
    title="Chats",        token_budget=600;
CREATE wiki_page:memories_agents_md SET
    path="memories/agents.md",     layer="memories",     depth=2,
    title="Memories",     token_budget=600;
CREATE wiki_page:skills_agents_md SET
    path="skills/agents.md",       layer="skills",       depth=2,
    title="Skills",       token_budget=600;
CREATE wiki_page:workflows_agents_md SET
    path="workflows/agents.md",    layer="workflows",    depth=2,
    title="Workflows",    token_budget=600;

-- ---- depth 3: integration sub-pages ----
CREATE wiki_page:integrations_github_agents_md SET
    path="integrations/github/agents.md",     layer="integrations", depth=3,
    title="GitHub",     token_budget=300;
CREATE wiki_page:integrations_gmail_agents_md SET
    path="integrations/gmail/agents.md",      layer="integrations", depth=3,
    title="Gmail",      token_budget=300;
CREATE wiki_page:integrations_linear_agents_md SET
    path="integrations/linear/agents.md",     layer="integrations", depth=3,
    title="Linear",     token_budget=300;
CREATE wiki_page:integrations_notion_agents_md SET
    path="integrations/notion/agents.md",     layer="integrations", depth=3,
    title="Notion",     token_budget=300;
CREATE wiki_page:integrations_perplexity_agents_md SET
    path="integrations/perplexity/agents.md", layer="integrations", depth=3,
    title="Perplexity", token_budget=300;
CREATE wiki_page:integrations_slack_agents_md SET
    path="integrations/slack/agents.md",      layer="integrations", depth=3,
    title="Slack",      token_budget=300;

-- ---- depth 3: entity-type sub-pages ----
CREATE wiki_page:entities_person_agents_md SET
    path="entities/person/agents.md",  layer="entities", depth=3,
    title="People",   token_budget=300;
CREATE wiki_page:entities_channel_agents_md SET
    path="entities/channel/agents.md", layer="entities", depth=3,
    title="Channels", token_budget=300;
CREATE wiki_page:entities_repo_agents_md SET
    path="entities/repo/agents.md",    layer="entities", depth=3,
    title="Repos",    token_budget=300;
CREATE wiki_page:entities_project_agents_md SET
    path="entities/project/agents.md", layer="entities", depth=3,
    title="Projects", token_budget=300;
CREATE wiki_page:entities_team_agents_md SET
    path="entities/team/agents.md",    layer="entities", depth=3,
    title="Teams",    token_budget=300;

-- ---- parent edges: depth-3 → depth-2 → depth-1 ----
-- depth-2 pages → user.md
RELATE wiki_page:integrations_agents_md->wiki_parent->wiki_page:user_md;
RELATE wiki_page:entities_agents_md->wiki_parent->wiki_page:user_md;
RELATE wiki_page:chats_agents_md->wiki_parent->wiki_page:user_md;
RELATE wiki_page:memories_agents_md->wiki_parent->wiki_page:user_md;
RELATE wiki_page:skills_agents_md->wiki_parent->wiki_page:user_md;
RELATE wiki_page:workflows_agents_md->wiki_parent->wiki_page:user_md;

-- integration sub-pages → integrations/agents.md
RELATE wiki_page:integrations_github_agents_md->wiki_parent->wiki_page:integrations_agents_md;
RELATE wiki_page:integrations_gmail_agents_md->wiki_parent->wiki_page:integrations_agents_md;
RELATE wiki_page:integrations_linear_agents_md->wiki_parent->wiki_page:integrations_agents_md;
RELATE wiki_page:integrations_notion_agents_md->wiki_parent->wiki_page:integrations_agents_md;
RELATE wiki_page:integrations_perplexity_agents_md->wiki_parent->wiki_page:integrations_agents_md;
RELATE wiki_page:integrations_slack_agents_md->wiki_parent->wiki_page:integrations_agents_md;

-- entity-type sub-pages → entities/agents.md
RELATE wiki_page:entities_person_agents_md->wiki_parent->wiki_page:entities_agents_md;
RELATE wiki_page:entities_channel_agents_md->wiki_parent->wiki_page:entities_agents_md;
RELATE wiki_page:entities_repo_agents_md->wiki_parent->wiki_page:entities_agents_md;
RELATE wiki_page:entities_project_agents_md->wiki_parent->wiki_page:entities_agents_md;
RELATE wiki_page:entities_team_agents_md->wiki_parent->wiki_page:entities_agents_md;
