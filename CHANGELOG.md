# Changelog

All notable changes to `livebridge` (`github.com/ghchinoy/livebridge` and `@ghchinoy/livebridge`) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and both the Go module and TypeScript package follow lockstep [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3] - 2026-11-22

### Security & Dependencies

- **Go Stdlib Floor & Transitive Vulnerability Remediation (`go.mod`, `go.work`):**
  - Raised minimum `go` directive from `1.26.1` to `1.26.10` so `GOTOOLCHAIN=auto` and CI builds receive patched Go 1.26 standard-library security fixes without requiring Go 1.27.
  - Upgraded `google.golang.org/genai` (`v1.77.0` → `v1.79.1`), `github.com/google/go-cmp` (`v0.6.0` → `v0.7.0`), and transitive networking/crypto modules (`golang.org/x/net` → `v0.63.0`, `google.golang.org/grpc` → `v1.85.0`, `golang.org/x/text` → `v0.44.0`, `golang.org/x/crypto` → `v0.59.0`, `cloud.google.com/go/auth` → `v0.24.4`), eliminating all 10 reachable `govulncheck` advisories (`GO-2026-4918` through `GO-2026-6617`).
- **CI, Node Floor & Test Tooling (`.github/workflows/ci.yml`, `Makefile`, `package.json`):**
  - Pinned CI Node.js to `22.23.4`, declared `engines.node >= 22.23.4` in example frontends, added `make vulncheck`, and bumped `vitest` / `@vitest/browser-playwright` to `^5.1.1`.

## [0.1.2] - 2026-11-22

### Fixed

- **Sticky `LiveSocketClient.isTerminating` After Graceful Close / Timeout (`ts/live-socket.ts`, `browser/dist/livebridge.esm.js`):**
  - Reset `isTerminating` (and `upstreamReady`) inside `LiveSocketClient.cleanup()`, and invoke `cleanup()` immediately after `describeCloseEvent()` in `ws.onclose` so post-close `onWarning`, `onStateChange`, and `onDisconnected` callbacks (and Lit `LiveSessionController` / `LiveSocketController` renders) observe `isTerminating === false` while preserving abnormal-close warning suppression during termination.
  - Set `status = 'Disconnected'` in `terminate()`'s fallback timeout and non-OPEN branches so controls disabled by `isConnected || isTerminating` re-enable reliably after graceful close, timeout, `disconnect()`, or calling `terminate()` when not open.

## [0.1.1] - 2026-11-15

### Added

- **Built-in Avatar & Voice Registries (`presets.go`, `ts/presets.ts`):** Exported `PresetAvatars` / `PRESET_AVATARS` (11 built-in avatars), `PrebuiltVoices` / `PREBUILT_VOICES` (30 voices), `PresetAvatarVoices` / `PRESET_AVATAR_VOICES`, `DefaultVoiceForAvatar` / `defaultVoiceForAvatar`, and `PresetAvatarImageURL` / `presetAvatarImageUrl`.
- **Pre-Dial Voice/Avatar Guardrail (`BuildConnectConfig`):** Passing a `PrebuiltVoice` name (such as `"Aoede"` or `"Puck"`) as a preset `AvatarData` now fails immediately in Go before dialing with a descriptive `1007` diagnostic, and preset avatars automatically default `VoiceName` to their companion voice when unset.

### Fixed

- **Vite Dev Proxy `Socket.writeAfterFIN` & Upstream `1007` Diagnostics (`conn.go`, `handler.go`, `ts/live-socket.ts`):**
  - `LiveSocketClient` gates outbound `sendAudioChunk` and `sendVideoFrame` frames until the server's first frame (`session_info` / `media_config`) confirms upstream session readiness.
  - `NewFixedHandler` and `NewDynamicHandler` extract and forward upstream `close 1007` reasons to the browser and drain inbound frames briefly (`SafeConn.WriteCloseAndDrain`) before closing the TCP socket.

## [0.1.0] - 2026-11-15

### Added

- **Go Switchboard & Handlers (`github.com/ghchinoy/livebridge`):**
  - `Bridge`, `SafeConn`, and `TerminateGate` providing serialized WebSocket framing, `9m55s` session caps, race-free interrupted farewell turns, and idempotent dual-socket teardown (`Bridge.Shutdown`).
  - `ClientPool` supporting both Google Cloud Vertex AI (`GOOGLE_CLOUD_PROJECT` with regional & `global` `BaseURLForLocation` rewriting) and Gemini Developer API (`GEMINI_API_KEY`).
  - `SessionSpec`, `MergeSessionSpec`, and `BuildConnectConfig` enforcing `[VIDEO]`-only avatar modality, pre-dial PNG/JPEG dimension checks (`ValidateCustomAvatarDimensions`), model-gated `ProactiveAudio`, `ReplicatedVoice`, transcriptions, and `SlidingWindow` context compression.
  - `NewFixedHandler` and `NewDynamicHandler` (`16 MiB` setup -> `8 MiB` runtime read limits, allowlists, `1007`/`1011` close codes), `OriginPolicy`, and `NewHTTPServer`.
  - `FuncRegistry`, `ToolRunner` (`AllowPageRelay`, `SeeVisualResults` injecting `{Video}` snapshots before `SendToolResponse`), `DeclarationsFromPageTools`, `AlertBusOf[T]` / `AlertBus`, `FormatUntrustedAlert`, and `SniffMP4`.
- **Go Embedded Browser Subpackage (`github.com/ghchinoy/livebridge/browser`):**
  - `browser.Handler()` and `browser.JS()` embedding the compiled `11.9 kB` gzipped zero-dependency `@ghchinoy/livebridge` ES module with SHA-256 `ETag` (`304 Not Modified`) caching.
- **TypeScript Client Kit (`@ghchinoy/livebridge` & `@ghchinoy/livebridge/lit`):**
  - Framework-free `LiveSession`, `LiveSocketClient`, `PcmMic` (`AudioWorklet`), `PcmPlayer` (`AnalyserNode -> GainNode` mute graph), `Fmp4Player` (MSE `SourceBuffer` PTS gap jump & barge-in trim), `VisionCapture` (1 FPS camera & screen share), `prepareAvatarImage` (`704x1280` / `1280x704`), `WebmcpToolHost`, `TranscriptAssembler`, and `ChimeSynth`.
  - Optional Lit 3 subpath (`@ghchinoy/livebridge/lit`) with `LiveSessionController` and granular `ReactiveController`s.
- **Stand-Alone Validation Examples & Documentation:**
  - `01-minimal-voice`, `02-avatar-desk`, `03-code-assistant`, and `04-ops-watchtower` plus full Diátaxis documentation (`README.md`, `docs/developers-guide.md`, `docs/recipes.md`, `docs/wire-protocol.md`).

[0.1.3]: https://github.com/ghchinoy/livebridge/releases/tag/v0.1.3
[0.1.2]: https://github.com/ghchinoy/livebridge/releases/tag/v0.1.2
[0.1.1]: https://github.com/ghchinoy/livebridge/releases/tag/v0.1.1
[0.1.0]: https://github.com/ghchinoy/livebridge/releases/tag/v0.1.0
