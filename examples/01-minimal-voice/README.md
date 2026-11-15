# 01 · Minimal Voice (Zero-Node Single-Binary Go)

Proves the smallest possible production-grade Gemini Live 24 kHz voice switchboard built on **`github.com/ghchinoy/livebridge`** and **`github.com/ghchinoy/livebridge/browser`**.

- **Zero frontend toolchain:** No `package.json`, no `node_modules`, no bundler, and zero copied `livebridge` source files.
- **Full capabilities in ~75 lines of Go:** Credential-isolated Vertex AI / Gemini API `ClientPool`, `OriginPolicy`, `NewFixedHandler` (`ModeAudio`), `9m55s` session cap, barge-in buffer flush, live microphone `AudioWorklet` RMS meter, streaming transcripts, and `TerminateGate` graceful farewells.

## Quickstart

```bash
export GOOGLE_CLOUD_PROJECT="your-gcp-project"   # or GEMINI_API_KEY="..."
go run .
```

Open <http://localhost:8081> and click **Start Voice**.

## Test

```bash
go test -race -v ./...
```
