# Pydantic AI Migration Checklist

Tracking the migration of vanilla-LLM phases to Pydantic AI agents.

## Status

| Phase | Module | Vanilla LLM | Pydantic AI | Notes |
|---|---|---|---|---|
| Triage | `ingest/triage.py` | ✅ current | ⬜ pending | Uses `call_llm` + manual JSON parse |
| Memory extraction | `enrich/memory_extractor.py` | ✅ current | ⬜ pending | Uses `call_llm_json` |
| Entity resolution | `enrich/entity_resolver.py` | ✅ current | ⬜ pending | Uses `call_llm_json` |
| Skill detection (pass 1) | `enrich/skill_detector.py` | ✅ current | ⬜ pending | Uses `call_llm_json` |
| Skill detection (pass 2) | `enrich/skill_detector.py` | ✅ current | ⬜ pending | Uses `call_llm_json` |
| Workflow composition | `enrich/workflow_composer.py` | ✅ current | ⬜ pending | Uses `call_llm_json` |
| Wiki agent | `wiki/agent.py` | — | ✅ Pydantic AI | Phase 4 — already uses Pydantic AI |

## Migration Plan

1. Wrap each phase in `pydantic_ai.Agent` with **same prompt text** and **same Pydantic model** as today's manual `json.loads` target — behaviour-preserving.
2. Run regression suite (`make test`) to confirm parity.
3. Then start iterating prompts via `make eval` self-improvement loop.

## Migration Notes

- `call_llm_json` in `enrich/llm.py` is the main abstraction to replace.
- Each phase should get a `pydantic_ai.Agent` with a typed `output_type` matching the existing dict structure.
- `ingest/llm.py`'s `call_llm` function is also used by triage — will need similar wrapping.
- Message history and usage accounting come for free from Pydantic AI once migrated.
