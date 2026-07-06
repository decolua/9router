.DEFAULT_GOAL := help
SHELL := /bin/bash

.PHONY: help bootstrap install-hooks

bootstrap:
	@if [ -f .prototools ]; then echo "==> proto install"; proto install; fi
	@if [ -d .githooks ]; then \
		echo "==> git config core.hooksPath .githooks"; \
		git config core.hooksPath .githooks; \
		chmod +x .githooks/* 2>/dev/null || true; \
	fi
	@if [ -f package.json ]; then echo "==> pnpm install"; pnpm install; fi
	@echo "==> bootstrap complete"

install-hooks:
	@if [ -d .githooks ]; then \
		git config core.hooksPath .githooks; \
		chmod +x .githooks/* 2>/dev/null || true; \
		echo "Git hooks installed (core.hooksPath = .githooks)."; \
	else \
		echo "No .githooks/ directory found." >&2; exit 1; \
	fi

help:
	@echo ""
	@echo "9router"
	@echo "======="
	@echo ""
	@echo "Setup:"
	@echo "  make bootstrap  - proto install + git hooks (.githooks) + pnpm install"
	@echo ""
