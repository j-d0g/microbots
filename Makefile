SHELL := /bin/bash
.DEFAULT_GOAL := help

-include .env
export

PYTHON := PYTHONPATH=$(CURDIR):$(CURDIR)/knowledge_graph uv run python
KG := knowledge_graph
SURREAL_PORT ?= 8000
SURREAL_USER ?= root
SURREAL_PASS ?= root

.PHONY: install dev db-up db-down db-reset test ingest-demo surface help

install:
	uv sync && (cd web && npm ci)

db-up:
	@if command -v surreal >/dev/null 2>&1; then \
		if ! curl -fsS --max-time 2 http://localhost:$(SURREAL_PORT)/health >/dev/null 2>&1; then \
			nohup surreal start --bind 127.0.0.1:$(SURREAL_PORT) \
				--user "$(SURREAL_USER)" --pass "$(SURREAL_PASS)" memory >.surrealdb.log 2>&1 & \
			echo $$! >.surrealdb.pid; \
		fi; \
	else \
		docker compose up -d || exit $$?; \
	fi; \
	echo "Waiting for SurrealDB to accept connections..."; \
	for ((i=0; i<30; i++)); do \
		if curl -fsS --max-time 2 http://localhost:$(SURREAL_PORT)/health >/dev/null 2>&1; then \
			echo "SurrealDB is ready."; exit 0; \
		fi; \
		sleep 1; \
	done; \
	echo "SurrealDB did not become ready; check .surrealdb.log or docker compose logs." >&2; exit 1

db-down:
	@if [ -f .surrealdb.pid ]; then \
		kill "$$(cat .surrealdb.pid)" 2>/dev/null || true; \
		rm -f .surrealdb.pid; \
	elif ! command -v surreal >/dev/null 2>&1; then \
		docker compose down; \
	fi

dev: install db-up
	$(PYTHON) $(KG)/schema/apply.py
	$(PYTHON) $(KG)/seed/seed.py
	$(PYTHON) -m candidates.surface
	@set -m; \
		uv run uvicorn app.main:app --port 8001 & api=$$!; \
		(cd web && npm run dev) & web=$$!; \
		trap 'kill -- -$$api -$$web 2>/dev/null || true; wait || true' EXIT; \
		trap 'exit 130' INT; trap 'exit 143' TERM; \
		wait -n $$api $$web; status=$$?; \
		echo "A dev server exited (status $$status); stopping API and web." >&2; \
		exit $$status

db-reset: db-down
	@if ! command -v surreal >/dev/null 2>&1; then docker compose down -v; fi
	$(MAKE) db-up
	$(PYTHON) $(KG)/schema/apply.py
	$(PYTHON) $(KG)/seed/seed.py

# Explicit offline/demo path; does not seed or reset existing graph data.
ingest-demo: SURREAL_DB ?= memory_demo
ingest-demo: db-up
	$(PYTHON) $(KG)/schema/apply.py
	$(PYTHON) -m ingest --from-fixtures --offline $(ARGS)

test:
	uv run pytest -q
	cd web && npx tsc --noEmit && npx vitest run

# Deterministic candidate detection over the current graph.
surface:
	$(PYTHON) -m candidates.surface

help:
	@printf '%s\n' \
		'install      Install Python and web dependencies' \
		'dev          Install, start DB, apply schema/seed, and run API :8001 + web :3000' \
		'db-up        Start SurrealDB (binary on PATH, otherwise Docker)' \
		'db-down      Stop the local database' \
		'db-reset     Delete local database data and restore the seeded demo' \
		'test         Run pytest, TypeScript checks, and Vitest (requires db-up + install)' \
		'ingest-demo  Ingest fixtures offline into memory_demo by default' \
		'surface      Detect automation candidates in the current graph' \
		'help         Show these commands'
