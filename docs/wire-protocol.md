# Live Wire Protocol & API Reference

Specification for the WebSocket wire protocol shared between **`github.com/ghchinoy/livebridge`** and **`@ghchinoy/livebridge`**.

---

## 1. Transport & Security Envelope

| Control | Constant / Default | Purpose |
| :--- | :--- | :--- |
| Origin check | `OriginPolicy` (`ALLOWED_ORIGINS` + loopback dev) | Blocks cross-site HTTP & WebSocket upgrades (`403 Forbidden`) while allowing local Vite dev (`localhost:5173 -> localhost:8080`) |
| Setup frame cap | `16 MiB` (`MaxInitialConfigBytes`) | Accommodates a 2K `9:16` base64 custom avatar data URL + persona/grounding text in `NewDynamicHandler` |
| Runtime frame cap | `8 MiB` (`MaxClientMessageBytes`) | Bounds 16 kHz PCM chunks, 1 FPS JPEG vision frames, and browser tool results |
| Session cap | `9m55s` (`DefaultSessionCap`) + `2s` grace | Emits `session_limit_reached` status and closes cleanly with `1000` before the 10-minute upstream cap |
| Goodbye backstop | `12s` (`DefaultGoodbyeBackstop`) | Bounds graceful farewell turns if `TurnComplete` never arrives |
| Tool timeout | `2m` (`DefaultToolTimeout`) | Bounds async server-side and page-relayed tool executions |
| HTTP server | `10s` `ReadHeaderTimeout`, `120s` `IdleTimeout` | Protects HTTP endpoints while leaving stream read/write timeouts unset for long-lived WebSockets |

### RFC 6455 WebSocket Close Codes

| Code | Reason | Meaning |
| :--- | :--- | :--- |
| `1000` | `"Session terminated"` | Clean user-requested end of session (`TerminateGate` farewell complete or backstop) |
| `1000` | `"Session limit reached"` | Proactive `9m55s` session cap reached |
| `1007` | `"Invalid session config"` | Malformed setup JSON, unknown avatar preset, or square/undersized custom avatar (closed pre-dial) |
| `1009` | *(message too big)* | Frame exceeded `SetReadLimit` (`16 MiB` setup / `8 MiB` runtime) |
| `1011` | `"Failed to connect"` / `"Session disconnected"` | Upstream Gemini Live API dial or stream error |

---

## 2. Client-to-Server Frames

### Initial Setup Frame (`NewDynamicHandler` only)

When connecting to an endpoint backed by `NewDynamicHandler`, the client sends one JSON `SessionSpec` object on `WebSocket.onopen` (handled automatically via `LiveSession.connect({ initialPayload, advertisePageTools })`):

```json
{
  "mode": "avatar",
  "avatarType": "preset",
  "avatarData": "Kira",
  "voiceName": "Kore",
  "languageCode": "en-US",
  "systemInstruction": "You are an architecture advisor.",
  "enableGoogleSearch": true,
  "proactiveAudio": true,
  "tools": [
    {
      "name": "set_node_status",
      "description": "Updates a node on the canvas.",
      "inputSchema": { "type": "object", "properties": { "node": { "type": "string" } } }
    }
  ]
}
```

### Runtime Frames (`livebridge.ClientMessage`)

| `type` | Fields | Switchboard Action |
| :--- | :--- | :--- |
| `"audio"` | `mimeType` (`"audio/pcm;rate=16000"`), `data` (base64 Int16 LE) | Validates MIME, decodes base64, calls `SendRealtimeInput({Audio: Blob})` |
| `"video"` | `mimeType` (`"image/jpeg"` \| `"image/png"`), `data` (base64) | Validates MIME, decodes base64, calls `SendRealtimeInput({Video: Blob})` |
| `"text"` | `data` (UTF-8 string) | Optional rune cap (`MaxClientTextRunes`), calls `SendRealtimeInput({Text})` |
| `"control"` | `action: "terminate"` | Arms `TerminateGate`, sends `GoodbyePrompt`, starts `GoodbyeBackstop` timer |
| `"tool_result"` / `"tool_response"` | `id`, `name`, `result` / `response`, optional `image` (PNG/JPEG data URL), `execMs` | Injects `{Video: Blob}` when `SeeVisualResults: true`, then calls `SendToolResponse` |
| `"ping"` | — | Replies `{"type": "pong"}` |

---

## 3. Server-to-Client Frames

### Binary Media Frames

Preceded once by `{"type": "media_config", ...}`, media streams down as raw binary WebSocket frames:

- **Audio (`ModeAudio`):** Signed 16-bit little-endian mono PCM at `sampleRate` (default `24000` Hz).
- **Avatar (`ModeAvatar`):** ISO BMFF fragmented MP4 (`ftyp`/`moov` + `moof`/`mdat`) with muxed H.264 video and AAC audio (`avc1.*, mp4a.40.2`).

### JSON Control Frames

| `type` | Fields | Description |
| :--- | :--- | :--- |
| `"session_info"` | `mode`, `model`, `location` | Emitted when `Bridge.Run()` starts (`EmitSessionInfo: true`) |
| `"media_config"` | `mimeType` (`"audio/pcm"` \| `"video/mp4"`), `sampleRate` or `codecs` | Emitted once before binary media; fMP4 `codecs` are sniffed via `SniffMP4` |
| `"input_transcript"` | `text`, `finished` (`bool`) | User speech transcription (partials replace active user bubble) |
| `"output_transcript"` | `text`, `finished` (`bool`) | Model speech transcription (partials concatenate onto active assistant bubble) |
| `"transcript"` | `text` | Complete text part from `ModelTurn.Parts` |
| `"interrupted"` | — | User barged in; client flushes PCM/MSE buffers and marks partial turn `—` |
| `"turn_complete"` | — | Model turn finished (`EmitTurnComplete: true`) |
| `"tool_call"` | `id`, `name`, `args`, optional `result` | Server tool completion (`result` set) or browser-relayed invocation (`result` omitted) |
| `"tool_call_cancellation"` | `ids` (`string[]`), optional `reason` | Cancels in-flight server or browser tool calls on barge-in or timeout |
| `"tool_timing"` | `id`, `name`, `roundTripMs`, `execMs` | Emitted after page-relayed tools complete (`EmitTiming: true`) |
| `"tools_rejected"` | `tools` (`string[]`) | Reports any browser-advertised tools dropped by `PageToolPolicy` |
| `"proactive_alert"` | Application-defined (`id`, `source`, `summary`, ...) | Browser payload returned by `FormatAlert` alongside an upstream alert prompt |
| `"status"` | `error: "session_limit_reached"`, `message: "session_limit_reached"` | Announces impending `9m55s` session cap closure |
| `"pong"` | — | Heartbeat response to `"ping"` |
