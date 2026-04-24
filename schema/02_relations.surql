-- User → Integration
DEFINE TABLE uses_integration SCHEMAFULL TYPE RELATION IN user_profile OUT integration;
DEFINE FIELD primary_use     ON uses_integration TYPE option<string>;
DEFINE FIELD frequency       ON uses_integration TYPE option<string>;
DEFINE FIELD first_used_at   ON uses_integration TYPE option<datetime>;
DEFINE FIELD last_used_at    ON uses_integration TYPE option<datetime>;

-- Entity → Integration (cross-platform identity)
DEFINE TABLE appears_in SCHEMAFULL TYPE RELATION IN entity OUT integration;
DEFINE FIELD handle          ON appears_in TYPE option<string>;
DEFINE FIELD role            ON appears_in TYPE option<string>;
DEFINE FIELD context         ON appears_in TYPE option<string>;

-- Integration ↔ Integration (co-usage)
DEFINE TABLE co_used_with SCHEMAFULL TYPE RELATION IN integration OUT integration;
DEFINE FIELD frequency       ON co_used_with TYPE option<int>;
DEFINE FIELD common_context  ON co_used_with TYPE option<string>;
DEFINE FIELD last_observed_at ON co_used_with TYPE option<datetime>;

-- Entity ↔ Entity
DEFINE TABLE related_to_entity SCHEMAFULL TYPE RELATION IN entity OUT entity;
DEFINE FIELD relationship_type ON related_to_entity TYPE option<string>;
DEFINE FIELD context          ON related_to_entity TYPE option<string>;

-- Chat → Integration
DEFINE TABLE chat_from SCHEMAFULL TYPE RELATION IN chat OUT integration;

-- Chat → Entity
DEFINE TABLE chat_mentions SCHEMAFULL TYPE RELATION IN chat OUT entity;
DEFINE FIELD mention_type    ON chat_mentions TYPE option<string>;

-- Chat → Memory
DEFINE TABLE chat_yields SCHEMAFULL TYPE RELATION IN chat OUT memory;
DEFINE FIELD confidence      ON chat_yields TYPE option<float>;
DEFINE FIELD extracted_at    ON chat_yields TYPE option<datetime>;

-- Memory → Entity | Integration (polymorphic)
DEFINE TABLE memory_about SCHEMAFULL TYPE RELATION IN memory OUT entity | integration;
DEFINE FIELD relevance       ON memory_about TYPE option<float>;

-- Skill → Chat | Workflow (provenance)
DEFINE TABLE skill_derived_from SCHEMAFULL TYPE RELATION IN skill OUT chat | workflow;

-- Skill → Integration
DEFINE TABLE skill_uses SCHEMAFULL TYPE RELATION IN skill OUT integration;

-- Workflow → Skill (composition, ordered)
DEFINE TABLE workflow_contains_skill SCHEMAFULL TYPE RELATION IN workflow OUT skill;
DEFINE FIELD step_order      ON workflow_contains_skill TYPE option<int>;
DEFINE FIELD optional        ON workflow_contains_skill TYPE bool DEFAULT false;

-- Workflow → Integration
DEFINE TABLE workflow_uses SCHEMAFULL TYPE RELATION IN workflow OUT integration;

-- Workflow → Entity
DEFINE TABLE workflow_involves SCHEMAFULL TYPE RELATION IN workflow OUT entity;
DEFINE FIELD role             ON workflow_involves TYPE option<string>;

-- Memory → Skill | Workflow
DEFINE TABLE memory_informs SCHEMAFULL TYPE RELATION IN memory OUT skill | workflow;

-- Any node → LayerIndex
DEFINE TABLE indexed_by SCHEMAFULL TYPE RELATION
    IN user_profile | integration | entity | chat | memory | skill | workflow
    OUT layer_index;

-- LayerIndex → LayerIndex (nested detail)
DEFINE TABLE drills_into SCHEMAFULL TYPE RELATION IN layer_index OUT layer_index;
DEFINE FIELD depth            ON drills_into TYPE option<int>;
DEFINE FIELD context_window_cost ON drills_into TYPE option<int>;
