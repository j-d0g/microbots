-- User → Integration
DEFINE TABLE OVERWRITE uses_integration SCHEMAFULL TYPE RELATION IN user_profile OUT integration;
DEFINE FIELD OVERWRITE primary_use     ON uses_integration TYPE option<string>;
DEFINE FIELD OVERWRITE frequency       ON uses_integration TYPE option<string>;
DEFINE FIELD OVERWRITE first_used_at   ON uses_integration TYPE option<datetime>;
DEFINE FIELD OVERWRITE last_used_at    ON uses_integration TYPE option<datetime>;

-- Entity → Integration (cross-platform identity)
DEFINE TABLE OVERWRITE appears_in SCHEMAFULL TYPE RELATION IN entity OUT integration;
DEFINE FIELD OVERWRITE handle          ON appears_in TYPE option<string>;
DEFINE FIELD OVERWRITE role            ON appears_in TYPE option<string>;
DEFINE FIELD OVERWRITE context         ON appears_in TYPE option<string>;

-- Integration ↔ Integration (co-usage)
DEFINE TABLE OVERWRITE co_used_with SCHEMAFULL TYPE RELATION IN integration OUT integration;
DEFINE FIELD OVERWRITE frequency       ON co_used_with TYPE option<int>;
DEFINE FIELD OVERWRITE common_context  ON co_used_with TYPE option<string>;
DEFINE FIELD OVERWRITE last_observed_at ON co_used_with TYPE option<datetime>;

-- Entity ↔ Entity
DEFINE TABLE OVERWRITE related_to_entity SCHEMAFULL TYPE RELATION IN entity OUT entity;
DEFINE FIELD OVERWRITE relationship_type ON related_to_entity TYPE option<string>;
DEFINE FIELD OVERWRITE context          ON related_to_entity TYPE option<string>;

-- Chat → Integration
DEFINE TABLE OVERWRITE chat_from SCHEMAFULL TYPE RELATION IN chat OUT integration;

-- Chat → Entity
DEFINE TABLE OVERWRITE chat_mentions SCHEMAFULL TYPE RELATION IN chat OUT entity;
DEFINE FIELD OVERWRITE mention_type    ON chat_mentions TYPE option<string>;

-- Chat → Memory
DEFINE TABLE OVERWRITE chat_yields SCHEMAFULL TYPE RELATION IN chat OUT memory;
DEFINE FIELD OVERWRITE confidence      ON chat_yields TYPE option<float>;
DEFINE FIELD OVERWRITE extracted_at    ON chat_yields TYPE option<datetime>;

-- Memory → Entity | Integration (polymorphic)
DEFINE TABLE OVERWRITE memory_about SCHEMAFULL TYPE RELATION IN memory OUT entity | integration;
DEFINE FIELD OVERWRITE relevance       ON memory_about TYPE option<float>;

-- Skill → Chat | Memory | Workflow (provenance)
DEFINE TABLE OVERWRITE skill_derived_from SCHEMAFULL TYPE RELATION IN skill OUT chat | memory | workflow;

-- Skill → Integration
DEFINE TABLE OVERWRITE skill_uses SCHEMAFULL TYPE RELATION IN skill OUT integration;

-- Workflow → Skill (composition, ordered)
DEFINE TABLE OVERWRITE workflow_contains_skill SCHEMAFULL TYPE RELATION IN workflow OUT skill;
DEFINE FIELD OVERWRITE step_order      ON workflow_contains_skill TYPE option<int>;
DEFINE FIELD OVERWRITE optional        ON workflow_contains_skill TYPE bool DEFAULT false;

-- Workflow → Integration
DEFINE TABLE OVERWRITE workflow_uses SCHEMAFULL TYPE RELATION IN workflow OUT integration;

-- Workflow → Entity
DEFINE TABLE OVERWRITE workflow_involves SCHEMAFULL TYPE RELATION IN workflow OUT entity;
DEFINE FIELD OVERWRITE role             ON workflow_involves TYPE option<string>;

-- Memory → Skill | Workflow
DEFINE TABLE OVERWRITE memory_informs SCHEMAFULL TYPE RELATION IN memory OUT skill | workflow;

-- Any node → LayerIndex
DEFINE TABLE OVERWRITE indexed_by SCHEMAFULL TYPE RELATION
    IN user_profile | integration | entity | chat | memory | skill | workflow
    OUT layer_index;

-- LayerIndex → LayerIndex (nested detail)
DEFINE TABLE OVERWRITE drills_into SCHEMAFULL TYPE RELATION IN layer_index OUT layer_index;
DEFINE FIELD OVERWRITE depth            ON drills_into TYPE option<int>;
DEFINE FIELD OVERWRITE context_window_cost ON drills_into TYPE option<int>;
