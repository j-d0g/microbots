-- integration indexes
DEFINE INDEX OVERWRITE idx_integration_slug ON integration FIELDS slug UNIQUE;

-- entity indexes
DEFINE INDEX OVERWRITE idx_entity_type ON entity FIELDS entity_type;
DEFINE INDEX OVERWRITE idx_entity_embedding ON entity FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

-- chat indexes
DEFINE INDEX OVERWRITE idx_chat_source ON chat FIELDS source_type, source_id;
DEFINE INDEX OVERWRITE idx_chat_embedding ON chat FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;
DEFINE INDEX OVERWRITE idx_chat_content ON chat FIELDS content SEARCH ANALYZER chat_analyzer BM25;

-- memory indexes
DEFINE INDEX OVERWRITE idx_memory_type ON memory FIELDS memory_type;
DEFINE INDEX OVERWRITE idx_memory_embedding ON memory FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;
DEFINE INDEX OVERWRITE idx_memory_content ON memory FIELDS content SEARCH ANALYZER memory_analyzer BM25;

-- skill indexes
DEFINE INDEX OVERWRITE idx_skill_slug ON skill FIELDS slug UNIQUE;
DEFINE INDEX OVERWRITE idx_skill_embedding ON skill FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

-- workflow indexes
DEFINE INDEX OVERWRITE idx_workflow_slug ON workflow FIELDS slug UNIQUE;
DEFINE INDEX OVERWRITE idx_workflow_embedding ON workflow FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

-- layer_index indexes
DEFINE INDEX OVERWRITE idx_layer_index_name ON layer_index FIELDS name UNIQUE;
