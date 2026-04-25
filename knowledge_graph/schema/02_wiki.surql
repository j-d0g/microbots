-- ----------------------------------------------------------------------
-- Wiki tables: markdown navigation pages live alongside graph nodes.
-- See plan: wiki_in_surrealdb_v1
-- ----------------------------------------------------------------------

-- wiki_page: current state of one navigation page (one row per path).
DEFINE TABLE OVERWRITE wiki_page SCHEMAFULL;
DEFINE FIELD OVERWRITE path           ON wiki_page TYPE string  ASSERT $value != NONE;
DEFINE FIELD OVERWRITE layer          ON wiki_page TYPE string  ASSERT $value INSIDE ["root","integrations","entities","chats","memories","skills","workflows"];
DEFINE FIELD OVERWRITE depth          ON wiki_page TYPE int     ASSERT $value INSIDE [1,2,3];
DEFINE FIELD OVERWRITE title          ON wiki_page TYPE string  DEFAULT "";
DEFINE FIELD OVERWRITE content        ON wiki_page TYPE string  DEFAULT "";
DEFINE FIELD OVERWRITE token_estimate ON wiki_page TYPE int     DEFAULT 0;
DEFINE FIELD OVERWRITE token_budget   ON wiki_page TYPE int     ASSERT $value > 0;
DEFINE FIELD OVERWRITE content_hash   ON wiki_page TYPE string  DEFAULT "";
DEFINE FIELD OVERWRITE updated_at     ON wiki_page TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE updated_by     ON wiki_page TYPE string   DEFAULT "seed";
DEFINE FIELD OVERWRITE revision       ON wiki_page TYPE int      DEFAULT 0;

DEFINE INDEX OVERWRITE wiki_page_path  ON wiki_page FIELDS path  UNIQUE;
DEFINE INDEX OVERWRITE wiki_page_depth ON wiki_page FIELDS depth;
DEFINE INDEX OVERWRITE wiki_page_layer ON wiki_page FIELDS layer;

-- wiki_parent: edge from a page to its parent page (for tree traversal).
-- Depth-3 → depth-2 → depth-1 (user.md). Root (user.md) has no parent edge.
DEFINE TABLE OVERWRITE wiki_parent TYPE RELATION FROM wiki_page TO wiki_page SCHEMAFULL;

-- wiki_page_revision: history of writes to a page. Keeps last N revisions.
DEFINE TABLE OVERWRITE wiki_page_revision SCHEMAFULL;
DEFINE FIELD OVERWRITE page           ON wiki_page_revision TYPE record<wiki_page>;
DEFINE FIELD OVERWRITE revision       ON wiki_page_revision TYPE int;
DEFINE FIELD OVERWRITE content        ON wiki_page_revision TYPE string;
DEFINE FIELD OVERWRITE content_hash   ON wiki_page_revision TYPE string;
DEFINE FIELD OVERWRITE token_estimate ON wiki_page_revision TYPE int      DEFAULT 0;
DEFINE FIELD OVERWRITE written_by     ON wiki_page_revision TYPE string   DEFAULT "wiki_agent";
DEFINE FIELD OVERWRITE written_at     ON wiki_page_revision TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE rationale      ON wiki_page_revision TYPE option<string>;

DEFINE INDEX OVERWRITE wiki_rev_page_rev ON wiki_page_revision FIELDS page, revision UNIQUE;
DEFINE INDEX OVERWRITE wiki_rev_written_at ON wiki_page_revision FIELDS written_at;
