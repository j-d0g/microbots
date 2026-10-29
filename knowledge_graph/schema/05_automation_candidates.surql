-- automation_candidate: derived "agent could do this for the user" suggestions
-- Each row is a first-class node with evidence edges back to chats, entities, memories.
DEFINE TABLE OVERWRITE automation_candidate SCHEMAFULL;
DEFINE FIELD OVERWRITE title ON automation_candidate TYPE string;
DEFINE FIELD OVERWRITE story ON automation_candidate TYPE string;
DEFINE FIELD OVERWRITE suggested_action ON automation_candidate TYPE string;
DEFINE FIELD OVERWRITE signal_axes ON automation_candidate FLEXIBLE TYPE object DEFAULT {};
DEFINE FIELD OVERWRITE status ON automation_candidate TYPE string DEFAULT 'open' ASSERT $value INSIDE ['open','suggested','accepted','dismissed','done'];
DEFINE FIELD OVERWRITE time_sensitive_until ON automation_candidate TYPE option<datetime>;
DEFINE FIELD OVERWRITE created_at ON automation_candidate TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE updated_at ON automation_candidate TYPE datetime DEFAULT time::now();

DEFINE INDEX OVERWRITE idx_automation_candidate_status ON automation_candidate FIELDS status;
DEFINE INDEX OVERWRITE idx_automation_candidate_time ON automation_candidate FIELDS time_sensitive_until;

DEFINE TABLE OVERWRITE candidate_evidence_chat TYPE RELATION FROM automation_candidate TO chat;
DEFINE TABLE OVERWRITE candidate_evidence_entity TYPE RELATION FROM automation_candidate TO entity;
DEFINE TABLE OVERWRITE candidate_evidence_memory TYPE RELATION FROM automation_candidate TO memory;
