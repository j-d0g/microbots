include .env
export

PYTHON := uv run python
KG     := knowledge_graph

.PHONY: install db-up db-down db-schema db-seed db-reset db-query db-export ingest-seed memory-reset ingest composio-ingest composio-auth wiki test e2e synth-corpus rerecord-goldens eval eval-report

install:
	uv sync

db-up: install
	docker compose up -d
	@echo "Waiting for SurrealDB to accept connections..."
	@until curl -sf http://localhost:$(SURREAL_PORT)/health > /dev/null 2>&1; do \
		sleep 1; \
	done
	@echo "SurrealDB is ready."

db-down:
	docker compose down

db-schema:
	$(PYTHON) $(KG)/schema/apply.py

db-seed:
	$(PYTHON) $(KG)/seed/seed.py

db-reset:
	docker compose down -v
	$(MAKE) db-up
	$(MAKE) db-schema
	$(MAKE) db-seed
	$(MAKE) memory-reset
	$(MAKE) wiki

# Wipe and regenerate all memory/ markdown files from seed data (no Composio, no LLM triage needed)
ingest-seed: install
	$(PYTHON) $(KG)/seed/wiki_from_seed.py

# Remove all generated memory/ markdown files (preserves directory structure)
memory-reset:
	@echo "Clearing generated memory/ markdown files..."
	@find $(KG)/memory/ -name "*.md" -delete 2>/dev/null || true
	@echo "memory/ cleared."

db-query:
	docker exec -it microbots-surrealdb surreal sql \
		--endpoint http://localhost:8000 \
		--username $(SURREAL_USER) \
		--password $(SURREAL_PASS) \
		--namespace $(SURREAL_NS) \
		--database $(SURREAL_DB)

# Composio → triage → SurrealDB (requires .env + CLI-connected apps; see README "Prerequisite")
ingest composio-ingest: install
	cd $(KG) && $(PYTHON) -m ingest

# One-time: print Composio CLI connection steps (run in your shell before first ingest)
composio-auth:
	@echo "Run once per machine (or for your COMPOSIO_USER_ID) before make ingest / composio-ingest."
	@echo "Per https://docs.composio.dev/docs/cli use \`composio link\` (not \`composio add\`):"
	@echo "  composio login"
	@echo "  composio link slack   # then: github, gmail, linear, notion, perplexityai as needed"
	@echo "  composio whoami"
	@echo "Discovery: composio tools list github   |   composio search \"...\" --toolkits github"
	@echo "See README → Composio ingestion → Prerequisite"

wiki:
	cd $(KG) && $(PYTHON) -m wiki

test:
	uv run pytest $(KG)/tests/unit $(KG)/tests/golden -v

e2e:
	uv run pytest $(KG)/tests/e2e -v

synth-corpus:
	$(PYTHON) $(KG)/tests/synth/generate_corpus.py

rerecord-goldens:
	LLM_MODE=record uv run pytest $(KG)/tests/golden -v

eval:
	$(PYTHON) $(KG)/tests/eval/apply_and_run.py

eval-report:
	$(PYTHON) $(KG)/tests/eval/judge.py --report

db-export:
	docker exec microbots-surrealdb surreal export \
		--endpoint http://localhost:8000 \
		--username $(SURREAL_USER) \
		--password $(SURREAL_PASS) \
		--namespace $(SURREAL_NS) \
		--database $(SURREAL_DB) \
		- > backup_$(shell date +%Y%m%d_%H%M%S).surql
	@echo "Export complete."
