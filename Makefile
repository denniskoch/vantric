# Everyday tasks. Run `make` on its own to see them.
#
# Development is native: Go and Node on your machine, both reloading.
# Docker is for running the app, not for building it.

.DEFAULT_GOAL := help
.PHONY: help dev api ui check build up rebuild down logs clean

help: ## Show this help
	@echo "vantric"
	@echo
	@grep -hE '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) \
		| awk -F':.*?## ' '{printf "  \033[1m%-8s\033[0m %s\n", $$1, $$2}'
	@echo

dev: frontend/node_modules ## Run both halves with reload — open http://localhost:5173
	@echo "api  → http://127.0.0.1:8080"
	@echo "ui   → http://localhost:5173   (this is the one to open)"
	@echo "ctrl-c stops both"
	@trap 'kill 0' EXIT INT TERM; \
		(cd backend && go run ./cmd/server) & \
		(cd frontend && npm run dev) & \
		wait

api: ## Run just the backend (:8080)
	cd backend && go run ./cmd/server

ui: frontend/node_modules ## Run just the frontend (:5173, proxies to :8080)
	cd frontend && npm run dev

check: frontend/node_modules ## Build, vet and type-check — what has to pass before a commit
	cd backend && go build ./... && go vet ./...
	cd frontend && npx tsc -b && npm run build
	@echo "ok"

build: check ## Alias for check; there is no separate build step
	@:

up: ## Build and run it in Docker (:8080, plus the tunnel)
	@[ -n "$$TUNNEL_TOKEN" ] || grep -qs '^TUNNEL_TOKEN=.' .env || { \
		echo "note: TUNNEL_TOKEN isn't set in .env, so cloudflared will"; \
		echo "      restart until it is. The app itself is unaffected."; }
	docker compose up -d --build
	@echo "→ http://localhost:8080"

rebuild: ## Rebuild the image from scratch, ignoring the cache
	docker compose build --no-cache
	docker compose up -d
	@echo "→ http://localhost:8080"

down: ## Stop it
	docker compose down

logs: ## Follow the logs
	docker compose logs -f

clean: ## Remove build output and installed packages
	rm -rf frontend/dist frontend/node_modules backend/server
	cd backend && go clean -cache -testcache

# npm install only when package.json has moved on.
frontend/node_modules: frontend/package.json
	cd frontend && npm install
	@touch $@
