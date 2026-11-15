# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# livebridge: Paired Go (github.com/ghchinoy/livebridge) & TypeScript
# (@ghchinoy/livebridge) libraries + standalone examples for Gemini Live.

.PHONY: help build bundle check-bundle check-version diagrams lint license license-check \
	test test-go test-ts test-examples test-live

LUMINOUS_THEME ?= ../graphviz-style/theme/luminous.gvpr
DOT_SOURCES := $(wildcard docs/assets/*.dot)

EXAMPLES_GO := examples/01-minimal-voice examples/02-avatar-desk \
	examples/03-code-assistant examples/04-ops-watchtower
EXAMPLES_FE := examples/02-avatar-desk/frontend examples/04-ops-watchtower/frontend

LICENSE_IGNORES := -ignore '**/node_modules/**' -ignore '**/dist/**' \
	-ignore '.beads/**' -ignore '.dolt/**' -ignore '**/*.json' \
	-ignore '**/*.yaml' -ignore '**/*.yml' -ignore '**/*.md' \
	-ignore '**/*.webp' -ignore '**/*.dot' \
	-ignore 'go.work*' -ignore 'LICENSE'

help:
	@echo "livebridge — Makefile Commands"
	@echo "------------------------------"
	@echo "Build & Bundle:"
	@echo "  make bundle        - Compile TS ESM (dist/) + embedded browser bundle (browser/dist/)"
	@echo "  make check-bundle  - Verify browser/dist/livebridge.esm.js is fresh & framework-free"
	@echo "  make check-version - Verify version.go, ts/index.ts, and package.json match"
	@echo "  make diagrams      - Render docs/assets/*.dot to light/dark .webp (needs graphviz-style)"
	@echo "  make build         - Build root libraries and all 4 standalone examples"
	@echo ""
	@echo "Quality Gates:"
	@echo "  make lint          - gofmt -s, go vet, golangci-lint, tsc --noEmit, prettier, license-check"
	@echo "  make test          - Go race tests + Vitest headless Chromium + all 4 examples"
	@echo "  make test-go       - Root Go library + browser subpackage race tests"
	@echo "  make test-ts       - Vitest headless Chromium tests"
	@echo "  make test-examples - Go race tests + Vite builds across examples/*"
	@echo "  make test-live     - Live API smoke test (ModeAudio + ModeAvatar; uses quota)"

bundle:
	@npm run build

diagrams:
	@for f in $(DOT_SOURCES); do \
		base="$${f%.dot}"; \
		gvpr -c -f "$(LUMINOUS_THEME)" -a light "$$f" | dot -Twebp -o "$${base}-light.webp"; \
		gvpr -c -f "$(LUMINOUS_THEME)" -a dark  "$$f" | dot -Twebp -o "$${base}-dark.webp"; \
	done

check-bundle:
	@before="$$(shasum -a 256 browser/dist/livebridge.esm.js)"; \
		npm run --silent build:browser >/dev/null && \
		after="$$(shasum -a 256 browser/dist/livebridge.esm.js)"; \
		test "$$before" = "$$after" || { echo "browser/dist/livebridge.esm.js was stale; re-built"; exit 1; }
	@go test ./browser/...

check-version:
	@node -e 'const fs=require("node:fs"); const pkg=JSON.parse(fs.readFileSync("package.json","utf8")).version; const go=(fs.readFileSync("version.go","utf8").match(/Version\s*=\s*"([^"]+)"/)||[])[1]; const ts=(fs.readFileSync("ts/index.ts","utf8").match(/VERSION\s*=\s*\x27([^\x27]+)\x27/)||[])[1]; if(!pkg||pkg!==go||pkg!==ts){console.error("Version mismatch:",{pkg,go,ts});process.exit(1);} console.log("Lockstep version verified:",pkg);'

build: bundle
	@go build . ./browser/...
	@for d in $(EXAMPLES_GO); do (cd $$d && go build -o /dev/null .) || exit 1; done
	@for fe in $(EXAMPLES_FE); do (cd $$fe && npm run build) || exit 1; done

lint: check-version check-bundle
	@test -f dist/index.d.ts || npm run --silent build:esm
	@unformatted="$$(gofmt -s -l $$(find . -name '*.go' -not -path '*/node_modules/*' -not -path './.dolt/*'))"; \
		test -z "$$unformatted" || { echo "gofmt -s needed:"; echo "$$unformatted"; exit 1; }
	@go vet . ./browser/...
	@for d in $(EXAMPLES_GO); do (cd $$d && go vet .) || exit 1; done
	@if command -v golangci-lint >/dev/null; then \
		golangci-lint run . ./browser/... && \
		for d in $(EXAMPLES_GO); do (cd $$d && golangci-lint run .) || exit 1; done; \
	fi
	@if command -v addlicense >/dev/null; then \
		$(MAKE) license-check; \
	fi
	@npm run lint
	@for fe in $(EXAMPLES_FE); do (cd $$fe && npm run typecheck) || exit 1; done

license-check:
	@files="$$(git ls-files)"; \
		if [ -n "$$files" ]; then addlicense -check -c "Google LLC" -l apache $(LICENSE_IGNORES) $$files; fi

license:
	@files="$$(git ls-files)"; \
		if [ -n "$$files" ]; then addlicense -c "Google LLC" -l apache -y $$(date +%Y) $(LICENSE_IGNORES) $$files; fi

test: test-go test-ts test-examples

test-go:
	@go test -race . ./browser/...

test-ts:
	@npm test

test-examples:
	@for d in $(EXAMPLES_GO); do (cd $$d && go test -race .) || exit 1; done
	@for fe in $(EXAMPLES_FE); do (cd $$fe && npm run build) || exit 1; done

test-live:
	@GEMINI_LIVE_SMOKE=1 GOOGLE_CLOUD_PROJECT="$${GOOGLE_CLOUD_PROJECT:-$$(gcloud config get project 2>/dev/null)}" \
		go test -run 'TestLiveSmoke' -v -count=1 .
