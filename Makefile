include .env
export

PYTHON := uv run python

.PHONY: install db-up db-down db-schema db-seed db-reset db-query db-export

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

db-export:
	docker exec microbots-surrealdb surreal export \
		--endpoint http://localhost:8000 \
		--username $(SURREAL_USER) \
		--password $(SURREAL_PASS) \
		--namespace $(SURREAL_NS) \
		--database $(SURREAL_DB) \
		- > backup_$(shell date +%Y%m%d_%H%M%S).surql
	@echo "Export complete."
