# Pydantic AI Migration Checklist

Tracking the migration of vanilla-LLM phases to Pydantic AI agents.

## Status

| Phase | Module | Vanilla LLM | Pydantic AI | Notes |
|---|---|---|---|---|
| Triage | `ingest/triage.py` | ✅ current | ⬜ pending | Uses `call_llm` + manual JSON parse |
| Memory extraction | `enrich/memory_extractor.py` | ~~old~~ | ✅ migrated | `MemoryExtractionResult` agent w/ typed output |
| Entity resolution | `enrich/entity_resolver.py` | ~~old~~ | ✅ migrated | `EntityResolutionResult` agent w/ typed output |
| Skill detection (pass 1) | `enrich/skill_detector.py` | ~~old~~ | ✅ migrated | `SkillPass1Result` agent w/ typed output |
| Skill detection (pass 2) | `enrich/skill_detector.py` | ~~old~~ | ✅ migrated | `SkillSynthesisResult` agent w/ typed output |
| Workflow composition | `enrich/workflow_composer.py` | ~~old~~ | ✅ migrated | `WorkflowCompositionResult` agent w/ typed output |
| Wiki agent | `wiki/agent.py` | — | ✅ Pydantic AI | Phase 4 — already uses Pydantic AI |

## Migration Plan

1. ~~Wrap each phase in `pydantic_ai.Agent` with **same prompt text** and **same Pydantic model** as today's manual `json.loads` target — behaviour-preserving.~~ ✅ Done
2. Run regression suite (`make test`) to confirm parity.
3. Then start iterating prompts via `make eval` self-improvement loop.

## Migration Notes

- `call_llm_json` in `enrich/llm.py` is preserved for backward compatibility but enrichment phases now use `pydantic_ai.Agent` directly.
- `resolve_enrich_model` in `enrich/llm.py` resolves the pydantic_ai model string (OPENROUTER → ANTHROPIC → OpenAI fallback).
- Each phase defines typed Pydantic output models matching the JSON schema in the corresponding prompt module.
- Public function signatures (`extract_memories`, `resolve_entities`, `detect_skills`, `compose_workflows`) are unchanged — the orchestrator requires no changes.
- `ingest/llm.py`'s `call_llm` function is also used by triage — will need similar wrapping (pending).
- Message history and usage accounting come for free from Pydantic AI once migrated.
