# 04 · Ops Watchtower (Lit 3 + WebMCP Visual Canvas Relay + AlertBus)

Showcases the full agentic surface of **`github.com/ghchinoy/livebridge`** and **`@ghchinoy/livebridge/lit`**:

1. **Lit 3 Reactive Controller (`LiveSessionController`):** Declarative `<ops-watchtower-app>` component from `@ghchinoy/livebridge/lit`.
2. **Browser WebMCP Page Tools with Pre-Response Vision (`SeeVisualResults: true`):** `inspect_topology` and `set_node_status` repaint an HTML5 `<canvas>` and return a JPEG snapshot (`imageDataUrl`). `livebridge.ToolRunner` injects that JPEG via `SendRealtimeInput({Video})` strictly *before* `SendToolResponse` so Gemini inspects the updated diagram before speaking.
3. **Proactive Multi-Tab Operational Alerts (`AlertBus` + `FormatUntrustedAlert` + `ChimeSynth`):** `POST /api/incident` buffers pre-session alerts and fans out live alerts across all open tabs with prompt-injection delimiters and non-overlapping Web Audio chimes (`deferPlayback`).

## Quickstart

```bash
# Terminal 1: Go backend (:8084)
export GOOGLE_CLOUD_PROJECT="your-gcp-project"
go run .

# Terminal 2: Vite dev server (:5175)
cd frontend && npm run dev
```

## Verify

```bash
go test -race -v .
cd frontend && npm run build
```
