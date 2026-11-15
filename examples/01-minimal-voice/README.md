# 01 · Minimal Voice (Zero-Node Single-Binary Go)

Smallest production-grade Gemini Live 24 kHz voice switchboard built on **`github.com/ghchinoy/livebridge`** and **`github.com/ghchinoy/livebridge/browser`**.

- **Zero frontend toolchain:** No `package.json`, no `node_modules`, no bundler, and zero copied `livebridge` source files.
- **Full capabilities in ~75 lines of Go:** Credential-isolated `ClientPool` (`GOOGLE_CLOUD_PROJECT` or `GEMINI_API_KEY`), `OriginPolicy`, `NewFixedHandler` (`ModeAudio`), `9m55s` session cap, barge-in buffer flush, live microphone `AudioWorklet` RMS meter, streaming transcripts, and `TerminateGate` graceful farewells.

## Quickstart

```bash
export GOOGLE_CLOUD_PROJECT="your-gcp-project"   # or export GEMINI_API_KEY="..."
go run .
```

Open <http://localhost:8081>, click **Start Voice**, and try saying:
- *"Give me a 20-second mental model for how WebSockets differ from HTTP/2 streams."*
- Interrupt mid-sentence to observe instant barge-in buffer flushing, then click **End Session** to hear a graceful spoken farewell.

## Verify

```bash
go test -race -v .
```
