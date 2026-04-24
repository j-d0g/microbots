-- user_profile: Root actor, single user
DEFINE TABLE user_profile SCHEMAFULL;
DEFINE FIELD name            ON user_profile TYPE string;
DEFINE FIELD role            ON user_profile TYPE option<string>;
DEFINE FIELD goals           ON user_profile TYPE option<array<string>>;
DEFINE FIELD preferences     ON user_profile TYPE option<object>;
DEFINE FIELD context_window  ON user_profile TYPE int DEFAULT 4000;
DEFINE FIELD created_at      ON user_profile TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at      ON user_profile TYPE datetime DEFAULT time::now();

-- integration: One node per tool (Slack, GitHub, Linear, Gmail, Notion)
DEFINE TABLE integration SCHEMAFULL;
DEFINE FIELD name            ON integration TYPE string;
DEFINE FIELD slug            ON integration TYPE string;
DEFINE FIELD category        ON integration TYPE option<string>;
DEFINE FIELD description     ON integration TYPE option<string>;
DEFINE FIELD user_purpose    ON integration TYPE option<string>;
DEFINE FIELD usage_patterns  ON integration TYPE option<array<string>>;
DEFINE FIELD navigation_tips ON integration TYPE option<array<string>>;
DEFINE FIELD frequency       ON integration TYPE option<string>;
DEFINE FIELD composio_tool   ON integration TYPE option<string>;
DEFINE FIELD created_at      ON integration TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at      ON integration TYPE datetime DEFAULT time::now();

-- entity: First-class cross-integration node
DEFINE TABLE entity SCHEMAFULL;
DEFINE FIELD name            ON entity TYPE string;
DEFINE FIELD entity_type     ON entity TYPE string;
DEFINE FIELD description     ON entity TYPE option<string>;
DEFINE FIELD aliases         ON entity TYPE option<array<string>>;
DEFINE FIELD tags            ON entity TYPE option<array<string>>;
DEFINE FIELD embedding       ON entity TYPE option<array<float>>;
DEFINE FIELD created_at      ON entity TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at      ON entity TYPE datetime DEFAULT time::now();

-- chat: Scraped/touched data from integrations
DEFINE TABLE chat SCHEMAFULL;
DEFINE FIELD title           ON chat TYPE option<string>;
DEFINE FIELD content         ON chat TYPE string;
DEFINE FIELD source_type     ON chat TYPE string;
DEFINE FIELD source_id       ON chat TYPE option<string>;
DEFINE FIELD signal_level    ON chat TYPE option<string>;
DEFINE FIELD summary         ON chat TYPE option<string>;
DEFINE FIELD embedding       ON chat TYPE option<array<float>>;
DEFINE FIELD occurred_at     ON chat TYPE option<datetime>;
DEFINE FIELD created_at      ON chat TYPE datetime DEFAULT time::now();

-- memory: High-signal distilled knowledge
DEFINE TABLE memory SCHEMAFULL;
DEFINE FIELD content         ON memory TYPE string;
DEFINE FIELD memory_type     ON memory TYPE string;
DEFINE FIELD confidence      ON memory TYPE float DEFAULT 0.5;
DEFINE FIELD source          ON memory TYPE option<string>;
DEFINE FIELD tags            ON memory TYPE option<array<string>>;
DEFINE FIELD embedding       ON memory TYPE option<array<float>>;
DEFINE FIELD last_validated  ON memory TYPE option<datetime>;
DEFINE FIELD created_at      ON memory TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at      ON memory TYPE datetime DEFAULT time::now();

-- skill: Repeatable atomic behavior
DEFINE TABLE skill SCHEMAFULL;
DEFINE FIELD name            ON skill TYPE string;
DEFINE FIELD slug            ON skill TYPE string;
DEFINE FIELD description     ON skill TYPE string;
DEFINE FIELD steps           ON skill TYPE option<array<string>>;
DEFINE FIELD frequency       ON skill TYPE option<string>;
DEFINE FIELD tags            ON skill TYPE option<array<string>>;
DEFINE FIELD embedding       ON skill TYPE option<array<float>>;
DEFINE FIELD created_at      ON skill TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at      ON skill TYPE datetime DEFAULT time::now();

-- workflow: Multi-step process composed of linked skills
DEFINE TABLE workflow SCHEMAFULL;
DEFINE FIELD name            ON workflow TYPE string;
DEFINE FIELD slug            ON workflow TYPE string;
DEFINE FIELD description     ON workflow TYPE string;
DEFINE FIELD trigger         ON workflow TYPE option<string>;
DEFINE FIELD outcome         ON workflow TYPE option<string>;
DEFINE FIELD frequency       ON workflow TYPE option<string>;
DEFINE FIELD tags            ON workflow TYPE option<array<string>>;
DEFINE FIELD embedding       ON workflow TYPE option<array<float>>;
DEFINE FIELD created_at      ON workflow TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at      ON workflow TYPE datetime DEFAULT time::now();

-- layer_index: Maps graph layers to markdown navigation artifacts
DEFINE TABLE layer_index SCHEMAFULL;
DEFINE FIELD name              ON layer_index TYPE string;
DEFINE FIELD layer             ON layer_index TYPE string;
DEFINE FIELD depth             ON layer_index TYPE int DEFAULT 0;
DEFINE FIELD description       ON layer_index TYPE option<string>;
DEFINE FIELD markdown_path     ON layer_index TYPE option<string>;
DEFINE FIELD context_window_cost ON layer_index TYPE option<int>;
DEFINE FIELD last_generated_at ON layer_index TYPE option<datetime>;
DEFINE FIELD created_at        ON layer_index TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at        ON layer_index TYPE datetime DEFAULT time::now();
