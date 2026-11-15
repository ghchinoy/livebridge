# Agent Instructions

`livebridge` provides paired Go (`github.com/ghchinoy/livebridge`) and TypeScript (`@ghchinoy/livebridge`) libraries for building real-time Gemini Live voice and talking-avatar applications without copying boilerplate across repositories.

## Issue Tracking (`bd`)

This repository uses **bd** (beads) for issue tracking. Run `bd prime` for workflow context.

```bash
bd ready              # Find unblocked work
bd show <id>          # Inspect issue & dependencies
bd update <id> --claim
bd close <id>
```

> **Git & Versioning:** `origin` points to `https://github.com/ghchinoy/livebridge.git`. Both `github.com/ghchinoy/livebridge` (`version.go`) and `@ghchinoy/livebridge` (`package.json`, `ts/index.ts`) share lockstep Semantic Versioning verified by `make check-version`.

## Architecture & Conventions

- **Root Go module (`github.com/ghchinoy/livebridge`):**
  - Core switchboard (`Bridge`, `SafeConn`, `TerminateGate`, `ClientPool`, `SessionSpec` / `BuildConnectConfig`, `NewFixedHandler`, `NewDynamicHandler`, `FuncRegistry`, `ToolRunner`, `AlertBusOf[T]` / `AlertBus`, `OriginPolicy`, `SniffMP4`, `ParseImageDimensions`).
  - Subpackage `github.com/ghchinoy/livebridge/browser` embeds `browser/dist/livebridge.esm.js` via `//go:embed` (`browser.Handler()` and `browser.JS()`) so single-binary Go apps work with zero Node/bundler dependencies. Keep `browser/dist/livebridge.esm.js` committed and verified via `make check-bundle`.
- **Root TypeScript package (`@ghchinoy/livebridge`):**
  - Core entry (`ts/index.ts` -> `dist/index.js`) has **zero runtime dependencies**.
  - Optional Lit 3 subpath (`@ghchinoy/livebridge/lit`, `ts/lit/index.ts` -> `dist/lit/index.js`) provides `ReactiveController`s with `lit` as an optional peer dependency.
- **Standalone examples (`examples/*`):**
  - Linked locally via root `go.work` and npm `workspaces` so `examples/*/go.mod` never contain relative `replace` directives and never copy `livebridge` source files.
- **Logging & Security:**
  - Use `log/slog` in Go; never log prompt or transcript text (log rune/byte counts only).
  - Every exit path in `Bridge` must funnel through idempotent `Bridge.Shutdown`.

## Quality Gates

```bash
make bundle        # Build dist/ (NPM ESM + .d.ts) and browser/dist/livebridge.esm.js
make check-bundle  # Verify committed browser/dist/livebridge.esm.js is up to date & Lit-free
make lint          # gofmt -s, go vet, golangci-lint, tsc --noEmit, prettier
make test          # Go race tests + Vitest headless Chromium + all standalone examples
make test-live     # Optional real Gemini Live API smoke test (uses quota)
```
