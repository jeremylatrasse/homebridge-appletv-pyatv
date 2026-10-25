# Makefile for homebridge-appletv-pyatv TypeScript build

SHELL := /bin/zsh

ENV_SETUP := \
	setopt +o nomatch 2>/dev/null || true; \
	export PATH="/opt/homebrew/bin:/usr/local/bin:$$HOME/.volta/bin:$$HOME/.fnm/current/bin:$$HOME/.local/share/fnm/aliases/default/bin:$$HOME/.asdf/shims:/opt/local/bin:$$PATH"; \
	for d in $$HOME/.nvm/versions/node/*/bin(N) /opt/homebrew/opt/node*/bin(N) /usr/local/opt/node*/bin(N); do \
		[ -d "$$d" ] && export PATH="$$d:$$PATH"; \
	done; \
	[ -s "$$HOME/.zprofile" ] && source "$$HOME/.zprofile" >/dev/null 2>&1 || true; \
	[ -s "$$HOME/.zshrc" ] && source "$$HOME/.zshrc" >/dev/null 2>&1 || true

TSC := ./node_modules/.bin/tsc
SRC_DIR := src
DIST_DIR := dist
GIT_HOOK := .git/hooks/pre-commit
APPLETV_HOST ?= 127.0.0.1
TARGET_HOST ?= 127.0.0.1

.PHONY: all build compile check typecheck watch test clean distclean rebuild install hooks bump release

all: build

$(TSC):
	@$(ENV_SETUP); \
	if [ ! -f "$(TSC)" ]; then \
		npm install; \
	fi

hooks:
	@if [ -d ".git" ] && [ -f "scripts/pre-commit" ]; then \
		cp scripts/pre-commit $(GIT_HOOK) && chmod +x $(GIT_HOOK); \
	fi

install:
	@$(ENV_SETUP); npm install

build: $(TSC) hooks
	@echo "Building TypeScript sources..."
	@rm -rf $(DIST_DIR)
	@$(ENV_SETUP); node $(TSC) -p tsconfig.json --pretty false
	@echo "TypeScript build complete -> $(DIST_DIR)/"

compile: build

bump:
	@$(ENV_SETUP); \
	NEW_VER=$$(npm run -s bump); \
	echo "Bumped plugin version to $$NEW_VER"

release: bump build test

check: $(TSC)
	@$(ENV_SETUP); node $(TSC) -p tsconfig.json --noEmit --pretty false

typecheck: check

watch: $(TSC)
	@$(ENV_SETUP); node $(TSC) -p tsconfig.json --watch

test: build
	@$(ENV_SETUP); node test-pyatv.mjs --appletv-host "$(APPLETV_HOST)" --target-host "$(TARGET_HOST)"

clean:
	@echo "Cleaning $(DIST_DIR)/..."
	rm -rf $(DIST_DIR) *.tsbuildinfo

distclean: clean
	rm -rf node_modules

rebuild: clean build
