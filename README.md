# livebridge

[![Go 1.26+](https://img.shields.io/badge/Go-1.26%2B-00ADD8?logo=go&logoColor=white)](go.mod)
[![npm @ghchinoy/livebridge](https://img.shields.io/npm/v/@ghchinoy/livebridge?logo=npm&color=CB3837)](https://www.npmjs.com/package/@ghchinoy/livebridge)
[![TypeScript](https://img.shields.io/badge/TypeScript-ESM%20%7C%200%20Deps-3178C6?logo=typescript&logoColor=white)](package.json)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

Paired Go (`github.com/ghchinoy/livebridge`) and TypeScript (`@ghchinoy/livebridge`) libraries that bridge browser Web Audio, MSE avatar video, 1 FPS vision, and WebMCP page tools to the Gemini Live Bidi API through a credential-isolated WebSocket switchboard.

## Contents

- [Installation](#installation)
- [Quickstart](#quickstart)
- [Architecture](#architecture)
- [Why `livebridge`?](#why-livebridge)
- [Stand-Alone Examples](#stand-alone-examples)
- [Local Development Setup](#local-development-setup)
- [Releasing & Publishing](#releasing--publishing)
- [Troubleshooting](#troubleshooting)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## Installation

### Go Backend (`go.mod`)

```bash
go get github.com/ghchinoy/livebridge@latest
```

### Browser Client (choose one)

- **Vite / Bundler TypeScript (0 runtime dependencies):**

  ```bash
  npm install @ghchinoy/livebridge
  # Optional: install lit ^3.0.0 if using @ghchinoy/livebridge/lit ReactiveControllers
  npm install lit
  ```

- **Zero-Node Single-Binary Go (`//go:embed`):** Import `github.com/ghchinoy/livebridge/browser` and mount `browser.Handler()`—no `package.json`, `node_modules`, or bundler required.

---

## Quickstart

Spin up a complete 24 kHz Gemini Live voice server with barge-in, streaming transcripts, and graceful farewells in a single Go file:

```go
package main

import (
  "log"
  "net/http"

  "github.com/ghchinoy/livebridge"
  "github.com/ghchinoy/livebridge/browser"
)

func main() {
  clients, err := livebridge.NewClientPoolFromEnv() // GOOGLE_CLOUD_PROJECT or GEMINI_API_KEY
  if err != nil {
    log.Fatal(err)
  }

  mux := http.NewServeMux()
  mux.Handle("GET /livebridge.js", browser.Handler())
  mux.Handle("GET /ws/live", livebridge.NewFixedHandler(livebridge.FixedHandlerConfig{
    Connector: clients,
    Spec: livebridge.SessionSpec{
      Mode:              livebridge.ModeAudio,
      VoiceName:         "Puck",
      WelcomeMessage:    "Hello! Ready when you are.",
      SystemInstruction: "You are a concise, helpful voice assistant.",
      ProactiveAudio:    livebridge.Bool(true),
    },
  }))

  log.Fatal(livebridge.NewHTTPServer(":8080", mux).ListenAndServe())
}
```

Connect from plain HTML (via `/livebridge.js`) or TypeScript (`import { LiveSession } from '@ghchinoy/livebridge'`):

```ts
import { LiveSession } from '@ghchinoy/livebridge'; // or '/livebridge.js'

const session = new LiveSession({ mode: 'audio' });
session.addEventListener('change', () => {
  console.log(session.status, session.transcript);
});

await session.connect({ endpoint: '/ws/live' });
// Later, trigger a spoken farewell via TerminateGate before closing with 1000:
// session.terminate();
```

Run it locally:

```bash
export GOOGLE_CLOUD_PROJECT="your-gcp-project"   # or export GEMINI_API_KEY="..."
go run .
```

---

## Architecture

```text
┌──────────────────────────────────────────┐          ┌──────────────────────────────────────────┐
│ Browser (@ghchinoy/livebridge · 11.9 kB) │          │ Go Server (github.com/ghchinoy/livebridge│
│                                          │  WS JSON │                                          │
│  LiveSession / LiveSessionController     │◄────────►│  OriginPolicy + SafeConn (16M -> 8M cap) │
│   ├─ PcmMic (16 kHz AudioWorklet + RMS)  │  + Raw   │  NewFixedHandler / NewDynamicHandler     │
│   ├─ PcmPlayer (24 kHz + AnalyserNode)   │  Binary  │  SessionSpec -> BuildConnectConfig       │
│   ├─ Fmp4Player (MSE PTS jump + trim)    │ PCM/fMP4 │  Bridge (TerminateGate + 9m55s cap)      │
│   ├─ VisionCapture (1 FPS cam / screen)  │          │   ├─ ToolRunner (Go + WebMCP visual)     │
│   └─ WebmcpToolHost + ChimeSynth         │          │   └─ AlertBus + FormatUntrustedAlert     │
└──────────────────────────────────────────┘          └────────────────────┬─────────────────────┘
                                                                           │ Bidi gRPC / WS
                                                                           ▼ (ADC or API Key)
                                                              ┌─────────────────────────┐
                                                              │   Gemini Live Bidi API  │
                                                              │ (Audio & Avatar Video)  │
                                                              └─────────────────────────┘
```

### Package Entry Points

- **`github.com/ghchinoy/livebridge`** — `NewFixedHandler`, `NewDynamicHandler`, `SessionSpec`, `BuildConnectConfig`, `Bridge`, `ClientPool`, `FuncRegistry`, `ToolRunner`, `DeclarationsFromPageTools`, `AlertBusOf[T]` / `AlertBus`, `FormatUntrustedAlert`, `OriginPolicy`, `NewHTTPServer`, `SniffMP4`, `ParseImageDimensions`.
- **`github.com/ghchinoy/livebridge/browser`** — `browser.Handler()` and `browser.JS()` serving the embedded `@ghchinoy/livebridge` ES module with SHA-256 `ETag` (`304 Not Modified`) caching.
- **`@ghchinoy/livebridge`** *(0 runtime dependencies)* — `LiveSession`, `LiveSocketClient`, `PcmMic`, `PcmPlayer`, `Fmp4Player`, `VisionCapture`, `prepareAvatarImage`, `WebmcpToolHost`, `TranscriptAssembler`, `ChimeSynth`.
- **`@ghchinoy/livebridge/lit`** *(optional `lit ^3.0.0` peer dependency)* — `LiveSessionController`, `LiveSocketController`, `PcmMicController`, `PcmPlayerController`, `Fmp4PlayerController`, `VisionCaptureController`.

---

## Why `livebridge`?

| Raw Gemini Live Failure Mode | How `livebridge` Solves It |
| :--- | :--- |
| **`genai.Live.Connect` ignores `ctx` after dial** | `Bridge.Shutdown` (`sync.Once`) explicitly closes both the upstream session and `SafeConn` on every exit path (`session_limit_reached`, farewell `TurnComplete`, backstop, error, client disconnect). |
| **`1007` setup errors** (`[AUDIO, VIDEO]`, square `1024x1024` avatars, `ProactiveAudio` on 3.5 Flash, zeroed VAD) | `BuildConnectConfig` requests `[VIDEO]` alone for avatars, checks PNG/JPEG dimensions (`>=704x1280` or `>=1280x704`, non-square) pre-dial, gates `ProactiveAudio` to `3.8`/`lite`, and omits empty VAD structs. |
| **Farewell speech cut off on barge-in** | `TerminateGate` skips an interrupted turn's `TurnComplete` and closes only on the farewell turn's own `TurnComplete` (backed by a `12s` timer). |
| **Avatar video freezes between speech turns** | `SniffMP4` extracts `avcC` codecs on the first fragment; `Fmp4Player` jumps `video.currentTime` across inter-turn PTS gaps, trims buffered future media on barge-in, and evicts old ranges on `QuotaExceededError`. |
| **Browser tools lack visual grounding** | `WebmcpToolHost` + `ToolRunner` (`SeeVisualResults: true`) inject `<canvas>` JPEG snapshots via `SendRealtimeInput({Video})` strictly *before* `SendToolResponse`. |

In [`examples/03-code-assistant`](examples/03-code-assistant/), replacing copy-pasted switchboard files and inline Web Audio/MSE scripts with `livebridge` + `livebridge/browser` reduced total application code from **~3,100+ lines (18 files) to ~360 lines (3 files)**.

---

## Stand-Alone Examples

Examples are split across two complementary repositories so core CI stays fast and zero-bloat while full multi-framework apps validate published Go and npm releases:

### 1. In-Repo API Reference Recipes ([`examples/`](examples/))

Minimal, single-concept modules wired into [`go.work`](go.work) and verified on every CI run:

| Example | Ports | Stack & Capabilities Proven |
| :--- | :--- | :--- |
| **[`01-minimal-voice`](examples/01-minimal-voice/)** | `:8081` | Zero-Node Go binary (`NewFixedHandler` + `livebridge/browser` + `LiveSession`); 24 kHz PCM, `AudioWorklet` RMS meter, barge-in, farewells. |
| **[`02-avatar-desk`](examples/02-avatar-desk/)** | `:8082` / Vite `:5174` | `NewDynamicHandler` + Vite TS (`@ghchinoy/livebridge`); preset & custom `704x1280` / `1280x704` avatars (`prepareAvatarImage`), `Fmp4Player`, 1 FPS camera & screen `VisionCapture`. |
| **[`03-code-assistant`](examples/03-code-assistant/)** | `:8083` | `FuncRegistry` (`list_directory`, `read_file`, `generate_diagram`) + `GoogleSearch` + `livebridge/browser`; voice or `?avatar=Kira` video mode. |
| **[`04-ops-watchtower`](examples/04-ops-watchtower/)** | `:8084` / Vite `:5175` | Lit 3 (`@ghchinoy/livebridge/lit` `LiveSessionController`), `WebmcpToolHost` `<canvas>` tools (`SeeVisualResults`), `AlertBus` + `FormatUntrustedAlert` + `ChimeSynth`. |

### 2. Companion Multi-Framework Showcase ([`ghchinoy/livebridge-examples`](https://github.com/ghchinoy/livebridge-examples))

Full external applications consuming published `github.com/ghchinoy/livebridge` and [`@ghchinoy/livebridge`](https://www.npmjs.com/package/@ghchinoy/livebridge) releases (with zero `go.work` or `replace` directives):

- **`visual-concierge` (Lit 3 + `/lit`):** Talking video avatar (`PRESET_AVATARS` + `prepareAvatarImage`), 1 FPS webcam/screen `VisionCapture`, and a live `upsert_checklist` drawer.
- **`whiteboard-architect` (Vanilla TypeScript):** Shared `640x400` `<canvas>` combining freehand pointer drawing, WebMCP diagram tools (`SeeVisualResults`), and a 60 FPS `PcmPlayer.analyser` spectrum visualizer.
- **`bilingual-coach` (React 19):** Idiomatic `useLiveSession` hook exercising multilingual `LanguageCode`, `AdaptationPhrases`, tunable VAD `SilenceDurationMs` pause patience, and live `score_turn` rubric cards.
- **`pocket-briefing` (Zero-Node Go):** Single-binary CLI voice briefing desk (`livebridge/browser`) watching `./inbox/*.{md,txt}` and `POST /api/memo` webhooks via `AlertBus` + `ChimeSynth`.

### 3. Full Studio Reference Application ([Gemini Live Studio](https://github.com/GoogleCloudPlatform/generative-ai/tree/main/gemini/multimodal-live-api/gemini-live-studio))

For a complete, end-to-end production reference application—including persona management, custom avatar image synthesis, settings persistence, and WCAG-audited components—see **[Gemini Live Studio in `GoogleCloudPlatform/generative-ai`](https://github.com/GoogleCloudPlatform/generative-ai/tree/main/gemini/multimodal-live-api/gemini-live-studio)**, where `livebridge`'s switchboard and browser media architecture originated.

---

## Local Development Setup

### Prerequisites

- **Go** `1.26` or newer (`go version`)
- **Node.js** `22.23.4` or newer and **npm** `10+` (`node -v`)
- **Authentication** (to run examples or `make test-live`):
  - **Google Cloud ([Gemini 3.8 Live Guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-live); recommended, required for video avatars):** `gcloud auth application-default login` and `export GOOGLE_CLOUD_PROJECT="your-project-id"`
  - **Gemini Developer API ([AI Studio `gemini-3.8-live` Docs](https://aistudio.google.com/docs/models/gemini-3.8-live); audio & tool sessions):** `export GEMINI_API_KEY="your-api-key"`

### Clone, Install, Test & Run

```bash
git clone https://github.com/ghchinoy/livebridge.git
cd livebridge

# Install TypeScript dependencies and workspace links
npm install

# Build dist/ + embedded browser/dist/livebridge.esm.js
make bundle

# Run Go race tests, Vitest headless Chromium tests, and all 4 example builds
make lint
make test

# Run an example locally (e.g. Zero-Node Minimal Voice on http://localhost:8081)
cd examples/01-minimal-voice
GOOGLE_CLOUD_PROJECT="your-project-id" go run .
```

### Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `GOOGLE_CLOUD_PROJECT` | — | GCP project ID for Vertex AI Live Bidi sessions (`us-central1`). |
| `GEMINI_API_KEY` | — | Gemini Developer API key (used when `GOOGLE_CLOUD_PROJECT` is unset or `GOOGLE_GENAI_USE_VERTEXAI=false`). |
| `GEMINI_LIVE_MODEL` | `gemini-3.8-live` | Default Live model (`gemini-3.8-live`, `gemini-3.5-flash-lite-live-preview`). |
| `ALLOWED_ORIGINS` | *(same-origin + loopback)* | Comma-separated `scheme://host[:port]` origins allowed by `OriginPolicy`. |
| `CHROMIUM_PATH` | *(Playwright cache)* | Optional path to a local Chrome/Chromium binary for `make test-ts`. |

---

## Releasing & Publishing

Maintainers release synchronized Go module tags and `@ghchinoy/livebridge` npm versions from a clean `main` branch:

```bash
# 1. Rebuild ESM + embedded browser bundle and run all quality gates
make bundle
make lint
make test

# 2. Tag and push the Go module release (browser/dist/livebridge.esm.js is committed)
git tag v0.1.0
git push origin main --tags

# 3. Publish @ghchinoy/livebridge to npm (prepublishOnly runs npm run build)
npm publish --access public
```

---

## Troubleshooting

- **WebSocket closes immediately with `1007 Invalid session config` on custom avatars:**
  Custom avatar images must be PNG or JPEG in portrait (`>=704x1280`) or landscape (`>=1280x704`) aspect ratio—square (`1024x1024`) images are rejected. Use `prepareAvatarImage(dataUrl)` in `@ghchinoy/livebridge` to auto-crop uploads on the client. Note that `CustomizedAvatar` also requires an allowlisted GCP project.
- **HTTP `403 Origin not allowed` when upgrading `/ws`:**
  `OriginPolicy` allows same-origin requests and loopback dev servers (`localhost:5173 -> localhost:8080`). When hosting the frontend on a separate non-loopback domain, set `ALLOWED_ORIGINS="https://app.example.com"`.
- **`make test-ts` cannot find a browser binary:**
  Run `npx playwright install chromium` once, or point `CHROMIUM_PATH` at an installed browser (for example, `CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" make test-ts`).
- **Real API smoke verification:**
  Run `GOOGLE_CLOUD_PROJECT="your-project-id" make test-live` to test both `ModeAudio` and `ModeAvatar` (`Kira`) end-to-end against `gemini-3.8-live`.

---

## Documentation

### `livebridge` Guides & Specs

- **[Developer Guide (Architecture & Implementor Walkthrough)](docs/developers-guide.md)** — Decision matrix (`NewFixedHandler` vs `NewDynamicHandler`, `livebridge/browser` vs `@ghchinoy/livebridge` vs `/lit`), step-by-step build walkthrough, the 7 under-the-hood invariants, hermetic testing without quota, and Cloud Run deployment settings.
- **[Recipes & How-To Guide](docs/recipes.md)** — Voice, Talking Avatars, Server Tools, WebMCP Visual Snapshots, Proactive `AlertBus`, and Lit 3 `ReactiveController`s.
- **[Wire Protocol & API Reference](docs/wire-protocol.md)** — JSON control frames, binary PCM / fMP4 framing, and RFC 6455 close codes.

### Official Gemini 3.8 Live & Reference Application Resources

- **[Gemini 3.8 Live Developer Guide (Google Cloud)](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-live)** — Bidi streaming, talking video avatars, custom avatars, replicated voice, and proactivity on Google Cloud.
- **[Gemini 3.8 Live Model Card & Specifications (Google Cloud)](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-live)** — Regional availability (`us-central1`), supported modalities, and token/session limits.
- **[Gemini 3.8 Live Documentation (Google AI Studio)](https://aistudio.google.com/docs/models/gemini-3.8-live)** — Gemini Developer API (`GEMINI_API_KEY`) usage for real-time voice and tool sessions.
- **[Gemini Live Studio (`GoogleCloudPlatform/generative-ai`)](https://github.com/GoogleCloudPlatform/generative-ai/tree/main/gemini/multimodal-live-api/gemini-live-studio)** — Full Google Cloud reference studio application from which `livebridge` was extracted.

---

## Contributing

Pull requests are welcome! For breaking changes to the WebSocket wire protocol or exported Go/TypeScript signatures, please open an issue first to discuss the design.

Before submitting a PR, ensure `make lint` and `make test` pass cleanly (including `make check-bundle` whenever files under `ts/` change).

---

## License

Apache License 2.0 — see [LICENSE](LICENSE).
