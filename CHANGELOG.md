# Changelog

All notable changes to `livebridge` (`github.com/ghchinoy/livebridge` and `@ghchinoy/livebridge`) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and both the Go module and TypeScript package follow lockstep [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.1]: https://github.com/ghchinoy/livebridge/releases/tag/v0.1.1
[0.1.0]: https://github.com/ghchinoy/livebridge/releases/tag/v0.1.0
