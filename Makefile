include .env
export

PYTHON := PYTHONPATH=$(PWD):$(PWD)/knowledge_graph uv run python
KG     := knowledge_graph

.PHONY: install db-up db-down db-schema db-seed db-reset dev ingest ingest-demo wiki wiki-cat test e2e synth-corpus surface

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

dev: db-up db-schema db-seed
	@trap 'kill 0' EXIT; \
		uv run uvicorn app.main:app --port 8001 & \
		(cd web && npm run dev) & \
		wait

db-reset:
	docker compose down -v
	$(MAKE) db-up
	$(MAKE) db-schema
	$(MAKE) db-seed

# Live ingestion: Composio connected accounts + OpenRouter or Anthropic.
ingest: install
	$(PYTHON) -m ingest $(ARGS)

# Explicit offline/demo path; does not seed or reset existing graph data.
ingest-demo: db-schema
	$(PYTHON) -m ingest --from-fixtures --offline $(ARGS)

# KG_LLM_MODE=offline make wiki also runs without keys.
wiki:
	$(PYTHON) -m wiki

# P=tree lists pages; P=user.md prints the root page.
wiki-cat:
	$(PYTHON) $(KG)/seed/wiki_cat.py $(P)

test:
	uv run pytest $(KG)/tests/unit $(KG)/tests/golden -v

e2e:
	uv run pytest $(KG)/tests/e2e -v

# Deterministically regenerate train/holdout fixtures; no API keys.
synth-corpus:
	$(PYTHON) $(KG)/tests/synth/generate_corpus.py

# Deterministic candidate detection over the current graph.
surface:
	$(PYTHON) -m candidates.surface
