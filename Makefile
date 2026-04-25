include .env
export

PYTHON := uv run python

.PHONY: install db-up db-down db-schema db-seed db-reset db-query db-export ingest composio-ingest composio-auth wiki test e2e synth-corpus rerecord-goldens eval eval-report

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
	$(PYTHON) schema/apply.py

db-seed:
	$(PYTHON) seed/seed.py

db-reset:
	docker compose down -v
	$(MAKE) db-up
	$(MAKE) db-schema
	$(MAKE) db-seed

db-query:
	docker exec -it microbots-surrealdb surreal sql \
		--endpoint http://localhost:8000 \
		--username $(SURREAL_USER) \
		--password $(SURREAL_PASS) \
		--namespace $(SURREAL_NS) \
		--database $(SURREAL_DB)

# Composio → triage → SurrealDB (requires .env + CLI-connected apps; see README "Prerequisite")
ingest composio-ingest: install
	$(PYTHON) -m ingest

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
	$(PYTHON) -m wiki

test:
	uv run pytest tests/unit tests/golden -v

e2e:
	uv run pytest tests/e2e -v

synth-corpus:
	$(PYTHON) tests/synth/generate_corpus.py

rerecord-goldens:
	LLM_MODE=record uv run pytest tests/golden -v

eval:
	$(PYTHON) tests/eval/apply_and_run.py

eval-report:
	$(PYTHON) tests/eval/judge.py --report

db-export:
	docker exec microbots-surrealdb surreal export \
		--endpoint http://localhost:8000 \
		--username $(SURREAL_USER) \
		--password $(SURREAL_PASS) \
		--namespace $(SURREAL_NS) \
		--database $(SURREAL_DB) \
		- > backup_$(shell date +%Y%m%d_%H%M%S).surql
	@echo "Export complete."
