-- user_profile: Root actor, single user
DEFINE TABLE OVERWRITE user_profile SCHEMAFULL;
DEFINE FIELD OVERWRITE name            ON user_profile TYPE string;
DEFINE FIELD OVERWRITE role            ON user_profile TYPE option<string>;
DEFINE FIELD OVERWRITE goals           ON user_profile TYPE option<array<string>>;
DEFINE FIELD OVERWRITE preferences     ON user_profile TYPE option<object>;
DEFINE FIELD OVERWRITE context_window  ON user_profile TYPE int DEFAULT 4000;
DEFINE FIELD OVERWRITE created_at      ON user_profile TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE updated_at      ON user_profile TYPE datetime DEFAULT time::now();

-- integration: One node per tool (Slack, GitHub, Linear, Gmail, Notion)
DEFINE TABLE OVERWRITE integration SCHEMAFULL;
DEFINE FIELD OVERWRITE name            ON integration TYPE string;
DEFINE FIELD OVERWRITE slug            ON integration TYPE string;
DEFINE FIELD OVERWRITE category        ON integration TYPE option<string>;
DEFINE FIELD OVERWRITE description     ON integration TYPE option<string>;
DEFINE FIELD OVERWRITE user_purpose    ON integration TYPE option<string>;
DEFINE FIELD OVERWRITE usage_patterns  ON integration TYPE option<array<string>>;
DEFINE FIELD OVERWRITE navigation_tips ON integration TYPE option<array<string>>;
DEFINE FIELD OVERWRITE frequency       ON integration TYPE option<string>;
DEFINE FIELD OVERWRITE composio_tool   ON integration TYPE option<string>;
DEFINE FIELD OVERWRITE created_at      ON integration TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE updated_at      ON integration TYPE datetime DEFAULT time::now();

-- entity: First-class cross-integration node
DEFINE TABLE OVERWRITE entity SCHEMAFULL;
DEFINE FIELD OVERWRITE name            ON entity TYPE string;
DEFINE FIELD OVERWRITE entity_type     ON entity TYPE string;
DEFINE FIELD OVERWRITE description     ON entity TYPE option<string>;
DEFINE FIELD OVERWRITE aliases         ON entity TYPE option<array<string>>;
DEFINE FIELD OVERWRITE tags            ON entity TYPE option<array<string>>;
DEFINE FIELD OVERWRITE embedding       ON entity TYPE option<array<float>>;
DEFINE FIELD OVERWRITE created_at      ON entity TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE updated_at      ON entity TYPE datetime DEFAULT time::now();

-- chat: Scraped/touched data from integrations
DEFINE TABLE OVERWRITE chat SCHEMAFULL;
DEFINE FIELD OVERWRITE title           ON chat TYPE option<string>;
DEFINE FIELD OVERWRITE content         ON chat TYPE string;
DEFINE FIELD OVERWRITE source_type     ON chat TYPE string;
DEFINE FIELD OVERWRITE source_id       ON chat TYPE option<string>;
DEFINE FIELD OVERWRITE signal_level    ON chat TYPE option<string>;
DEFINE FIELD OVERWRITE summary         ON chat TYPE option<string>;
DEFINE FIELD OVERWRITE embedding       ON chat TYPE option<array<float>>;
DEFINE FIELD OVERWRITE occurred_at     ON chat TYPE option<datetime>;
DEFINE FIELD OVERWRITE created_at      ON chat TYPE datetime DEFAULT time::now();

-- memory: High-signal distilled knowledge
DEFINE TABLE OVERWRITE memory SCHEMAFULL;
DEFINE FIELD OVERWRITE content         ON memory TYPE string;
DEFINE FIELD OVERWRITE memory_type     ON memory TYPE string;
DEFINE FIELD OVERWRITE confidence      ON memory TYPE float DEFAULT 0.5;
DEFINE FIELD OVERWRITE source          ON memory TYPE option<string>;
DEFINE FIELD OVERWRITE tags            ON memory TYPE option<array<string>>;
DEFINE FIELD OVERWRITE embedding       ON memory TYPE option<array<float>>;
DEFINE FIELD OVERWRITE last_validated  ON memory TYPE option<datetime>;
DEFINE FIELD OVERWRITE created_at      ON memory TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE updated_at      ON memory TYPE datetime DEFAULT time::now();

-- skill: Repeatable atomic behavior
DEFINE TABLE OVERWRITE skill SCHEMAFULL;
DEFINE FIELD OVERWRITE name            ON skill TYPE string;
DEFINE FIELD OVERWRITE slug            ON skill TYPE string;
DEFINE FIELD OVERWRITE description     ON skill TYPE string;
DEFINE FIELD OVERWRITE steps           ON skill TYPE option<array<string>>;
DEFINE FIELD OVERWRITE frequency       ON skill TYPE option<string>;
DEFINE FIELD OVERWRITE tags            ON skill TYPE option<array<string>>;
DEFINE FIELD OVERWRITE embedding       ON skill TYPE option<array<float>>;
DEFINE FIELD OVERWRITE created_at      ON skill TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE updated_at      ON skill TYPE datetime DEFAULT time::now();

-- workflow: Multi-step process composed of linked skills
DEFINE TABLE OVERWRITE workflow SCHEMAFULL;
DEFINE FIELD OVERWRITE name            ON workflow TYPE string;
DEFINE FIELD OVERWRITE slug            ON workflow TYPE string;
DEFINE FIELD OVERWRITE description     ON workflow TYPE string;
DEFINE FIELD OVERWRITE trigger         ON workflow TYPE option<string>;
DEFINE FIELD OVERWRITE outcome         ON workflow TYPE option<string>;
DEFINE FIELD OVERWRITE frequency       ON workflow TYPE option<string>;
DEFINE FIELD OVERWRITE tags            ON workflow TYPE option<array<string>>;
DEFINE FIELD OVERWRITE embedding       ON workflow TYPE option<array<float>>;
DEFINE FIELD OVERWRITE created_at      ON workflow TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE updated_at      ON workflow TYPE datetime DEFAULT time::now();

-- layer_index: Maps graph layers to markdown navigation artifacts
DEFINE TABLE OVERWRITE layer_index SCHEMAFULL;
DEFINE FIELD OVERWRITE name              ON layer_index TYPE string;
DEFINE FIELD OVERWRITE layer             ON layer_index TYPE string;
DEFINE FIELD OVERWRITE depth             ON layer_index TYPE int DEFAULT 0;
DEFINE FIELD OVERWRITE description       ON layer_index TYPE option<string>;
DEFINE FIELD OVERWRITE markdown_path     ON layer_index TYPE option<string>;
DEFINE FIELD OVERWRITE context_window_cost ON layer_index TYPE option<int>;
DEFINE FIELD OVERWRITE last_generated_at ON layer_index TYPE option<datetime>;
DEFINE FIELD OVERWRITE created_at        ON layer_index TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE updated_at        ON layer_index TYPE datetime DEFAULT time::now();
