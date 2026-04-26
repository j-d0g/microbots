-- automation_candidate: derived "agent could do this for the user" suggestions
-- Each row is a first-class node with evidence edges back to chats, entities, memories.
DEFINE TABLE automation_candidate SCHEMAFULL;
DEFINE FIELD title ON automation_candidate TYPE string;
DEFINE FIELD story ON automation_candidate TYPE string;
DEFINE FIELD suggested_action ON automation_candidate TYPE string;
DEFINE FIELD signal_axes ON automation_candidate FLEXIBLE TYPE object DEFAULT {};
DEFINE FIELD status ON automation_candidate TYPE string DEFAULT 'open' ASSERT $value INSIDE ['open','suggested','accepted','dismissed','done'];
DEFINE FIELD time_sensitive_until ON automation_candidate TYPE option<datetime>;
DEFINE FIELD created_at ON automation_candidate TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at ON automation_candidate TYPE datetime DEFAULT time::now();

DEFINE INDEX idx_automation_candidate_status ON automation_candidate FIELDS status;
DEFINE INDEX idx_automation_candidate_time ON automation_candidate FIELDS time_sensitive_until;

DEFINE TABLE candidate_evidence_chat TYPE RELATION FROM automation_candidate TO chat;
DEFINE TABLE candidate_evidence_entity TYPE RELATION FROM automation_candidate TO entity;
DEFINE TABLE candidate_evidence_memory TYPE RELATION FROM automation_candidate TO memory;
