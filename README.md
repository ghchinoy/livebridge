# livebridge

Paired **Go (`github.com/ghchinoy/livebridge`)** and **TypeScript (`@ghchinoy/livebridge`)** libraries for building real-time **Gemini Live** 24 kHz voice and talking-avatar (`fMP4` H.264 + AAC) applications without copying switchboard, Web Audio, or MSE boilerplate across projects.

---

## Why `livebridge`?

Connecting a browser directly to the Gemini Live Bidi API exposes cloud credentials and hits subtle operational pitfalls across audio, avatar video, and tool calling. `livebridge` packages the battle-tested server switchboard and headless browser media runtime behind clean, composable APIs:

| Problem in Raw Gemini Live Apps | How `livebridge` Solves It |
| :--- | :--- |
| **`genai.Live.Connect` ignores `ctx` after dial** | `Bridge.Shutdown` (`sync.Once`) explicitly closes both the upstream session and the mutex-serialized `SafeConn` on every exit path (`session_limit_reached`, farewell `TurnComplete`, backstop, error, disconnect). |
| **`1007` setup landmines** (`[AUDIO, VIDEO]`, square `1024x1024` avatars, `ProactiveAudio` on 3.5 Flash, empty VAD) | `SessionSpec` + `BuildConnectConfig` requests `[VIDEO]` alone for avatars, validates PNG/JPEG dimensions (`>=704x1280` or `>=1280x704`, non-square) pre-dial, gates `ProactiveAudio` by model, and omits unset VAD structs. |
| **Farewell speech cut off on barge-in** | `TerminateGate` skips an interrupted turn's `TurnComplete` and closes only on the farewell turn's own `TurnComplete` (backed by a `12s` timer). |
| **Avatar video freezes between speech turns** | `SniffMP4` extracts `avcC` codecs on the first fragment; `Fmp4Player` jumps `video.currentTime` across inter-turn PTS gaps, trims future media on barge-in, and evicts old ranges on `QuotaExceededError`. |
| **Single-binary Go apps forced to inline 450+ lines of Web Audio JS** | `github.com/ghchinoy/livebridge/browser` embeds the compiled **11.9 kB gzipped** zero-dependency `@ghchinoy/livebridge` ES module via `//go:embed` (`browser.Handler()`). |
| **Browser/WebMCP tools need visual feedback** | `WebmcpToolHost` + `ToolRunner` (`AllowPageRelay`, `SeeVisualResults`) inject `<canvas>` JPEG snapshots via `SendRealtimeInput({Video})` strictly *before* `SendToolResponse` so the model sees UI updates before speaking. |

---

## Package Entry Points

### Go (`github.com/ghchinoy/livebridge`)

- **`github.com/ghchinoy/livebridge`** — `NewFixedHandler`, `NewDynamicHandler`, `SessionSpec`, `BuildConnectConfig`, `Bridge`, `ClientPool` (Vertex AI regional/global + Gemini API key), `FuncRegistry`, `ToolRunner`, `DeclarationsFromPageTools`, `AlertBusOf[T]` / `AlertBus`, `FormatUntrustedAlert`, `OriginPolicy`, `NewHTTPServer`, `SniffMP4`, `ParseImageDimensions`.
- **`github.com/ghchinoy/livebridge/browser`** — `browser.Handler()` and `browser.JS()` serving the embedded `@ghchinoy/livebridge` ES module with SHA-256 `ETag` support.

### TypeScript (`@ghchinoy/livebridge`)

- **`@ghchinoy/livebridge`** *(0 runtime dependencies)* — `LiveSession`, `LiveSocketClient`, `PcmMic`, `PcmPlayer`, `Fmp4Player`, `VisionCapture` (1 FPS camera & screen share), `prepareAvatarImage` (`704x1280` / `1280x704` auto-cropper), `WebmcpToolHost`, `TranscriptAssembler`, `ChimeSynth`.
- **`@ghchinoy/livebridge/lit`** *(optional `lit ^3.0.0` peer dependency)* — `LiveSessionController`, `LiveSocketController`, `PcmMicController`, `PcmPlayerController`, `Fmp4PlayerController`, `VisionCaptureController`.

---

## 60-Second Quickstart (Zero-Node Go Binary)

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

```html
<script type="module">
  import { LiveSession } from '/livebridge.js';

  const session = new LiveSession({ mode: 'audio' });
  session.addEventListener('change', () => console.log(session.status, session.transcript));
  document.getElementById('start').onclick = () => session.connect({ endpoint: '/ws/live' });
  document.getElementById('stop').onclick = () => session.terminate();
</script>
```

---

## Stand-Alone Validation Examples (`examples/*`)

Every example under [`examples/`](examples/) is an independent Go module (and optional Vite frontend) linked via root `go.work` with **zero copied library files**:

| Example | Stack | What It Proves |
| :--- | :--- | :--- |
| **[`01-minimal-voice`](examples/01-minimal-voice/)** | Go + `livebridge/browser` (Zero Node) | Full 24 kHz voice assistant, `AudioWorklet` RMS meter, barge-in, streaming transcripts, and graceful farewell in ~75 LOC Go. |
| **[`02-avatar-desk`](examples/02-avatar-desk/)** | Go (`NewDynamicHandler`) + Vite TS (`@ghchinoy/livebridge`) | Talking `fMP4` preset & custom `704x1280` / `1280x704` uploaded avatars (`prepareAvatarImage`), `Fmp4Player`, and 1 FPS camera/screen `VisionCapture`. |
| **[`03-code-assistant`](examples/03-code-assistant/)** | Go (`FuncRegistry` + `GoogleSearch`) + `livebridge/browser` | Direct port of `local-code-assistant` (`list_directory`, `read_file`, `generate_diagram`, voice/avatar toggle) shrinking **~3,100+ LOC (18 files) -> ~360 LOC (3 files)**. |
| **[`04-ops-watchtower`](examples/04-ops-watchtower/)** | Go + Vite Lit 3 (`@ghchinoy/livebridge/lit`) | `LiveSessionController`, `WebmcpToolHost` canvas tools with `SeeVisualResults` JPEG snapshots, and multi-tab `AlertBus` + `FormatUntrustedAlert` + `ChimeSynth`. |

---

## Documentation

- **[Recipes & How-To Guide](docs/recipes.md)** — Voice, Talking Avatars, Server Tools, WebMCP Visual Snapshots, Proactive `AlertBus`, and Lit Controllers.
- **[Wire Protocol & API Reference](docs/wire-protocol.md)** — JSON control frames, binary PCM / fMP4 framing, RFC 6455 close codes, and Go/TS symbol tables.

---

## Development & Quality Gates

```bash
make bundle        # Build dist/ (ESM + .d.ts) and browser/dist/livebridge.esm.js
make check-bundle  # Verify embedded browser bundle is fresh and framework-free
make lint          # gofmt -s, go vet, golangci-lint, tsc --noEmit, prettier, license-check
make test          # Go race tests + Vitest headless Chromium + all 4 standalone examples
make test-live     # Optional real Gemini Live API smoke test (uses quota)
```

## License

Apache-2.0 — see [LICENSE](LICENSE).
