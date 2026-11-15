# Building with `livebridge`: Recipes

Task-oriented recipes pairing **`github.com/ghchinoy/livebridge`** on the server with **`@ghchinoy/livebridge`** in the browser.

> **Diátaxis navigation**
>
> - **Tutorial (First 60 Seconds):** [Quickstart](../README.md#quickstart)
> - **Explanation & Decision Guide:** [Developer Guide](developers-guide.md)
> - **How-To Guides (Copy-Paste Patterns):** *You are here*
> - **Reference (Framing & Close Codes):** [Wire Protocol & API Reference](wire-protocol.md)

---

## 1. Fixed-Persona Voice Server + Embedded Browser Bundle (Zero Node)

Use `NewFixedHandler` + `browser.Handler()` when you want a single self-contained Go binary (`go build`) with zero npm/Vite build step:

```go
clients, _ := livebridge.NewClientPoolFromEnv()

mux := http.NewServeMux()
mux.Handle("GET /livebridge.js", browser.Handler())
mux.Handle("GET /ws/live", livebridge.NewFixedHandler(livebridge.FixedHandlerConfig{
  Connector: clients,
  Spec: livebridge.SessionSpec{
    Mode:                     livebridge.ModeAudio,
    VoiceName:                "Puck",
    WelcomeMessage:           "Hi! How can I help?",
    SystemInstruction:        "You are a concise voice assistant.",
    ProactiveAudio:           livebridge.Bool(true),
    ContextWindowCompression: livebridge.Bool(true),
  },
}))
```

See [`examples/01-minimal-voice/`](../examples/01-minimal-voice/).

---

## 2. Talking Video Avatars (Preset & Custom Uploaded Images) + 1 FPS Vision

### Backend (`NewDynamicHandler`)

`BuildConnectConfig` automatically sets `ResponseModalities: [VIDEO]` (never `[AUDIO, VIDEO]`) and validates custom avatar dimensions (`>=704x1280` portrait or `>=1280x704` landscape, non-square) before dialing:

```go
mux.Handle("GET /ws", livebridge.NewDynamicHandler(livebridge.DynamicHandlerConfig{
  Connector:     clients,
  AllowedModels: []string{livebridge.DefaultModel},
  Defaults: livebridge.SessionSpec{
    Mode:       livebridge.ModeAvatar,
    AvatarType: "preset",
    AvatarData: "Kira",
    VoiceName:  "Kore",
  },
}))
```

### Browser (`prepareAvatarImage` + `LiveSession`)

```ts
import { LiveSession, prepareAvatarImage } from '@ghchinoy/livebridge';

const session = new LiveSession({ mode: 'avatar' });

// Optional: crop any user-selected image to 704x1280 or 1280x704 JPEG
const customAvatar = await prepareAvatarImage(rawFileDataUrl);

await session.connect({
  mode: 'avatar',
  endpoint: '/ws',
  videoElement: document.querySelector<HTMLVideoElement>('#avatar')!,
  initialPayload: {
    mode: 'avatar',
    avatarData: customAvatar, // auto-detected as "custom" by MergeSessionSpec
  },
});

// Toggle 1 FPS webcam or screen-share vision with smooth native-FPS PiP preview:
await session.toggleCamera(() => document.querySelector<HTMLVideoElement>('#pip'));
```

See [`examples/02-avatar-desk/`](../examples/02-avatar-desk/).

---

## 3. Server-Side Function Calling (`FuncRegistry`)

Every tool registered on `FuncRegistry` runs off the `Session.Receive()` loop with its own cancelable `context.Context`. If the user barges in mid-call, `ToolRunner` cancels `ctx` and drops stale responses automatically:

```go
reg := livebridge.NewFuncRegistry()
reg.Register(
  &genai.FunctionDeclaration{
    Name:        "lookup_build",
    Description: "Fetches CI build status for a branch.",
    Parameters: &genai.Schema{
      Type: genai.TypeObject,
      Properties: map[string]*genai.Schema{
        "branch": {Type: genai.TypeString},
      },
      Required: []string{"branch"},
    },
  },
  func(ctx context.Context, args map[string]any) (map[string]any, error) {
    branch, _ := args["branch"].(string)
    return map[string]any{"branch": branch, "status": "passing"}, nil
  },
)

mux.Handle("GET /ws", livebridge.NewFixedHandler(livebridge.FixedHandlerConfig{
  Connector: clients,
  Registry:  reg,
  Spec: livebridge.SessionSpec{
    Mode:               livebridge.ModeAudio,
    EnableGoogleSearch: livebridge.Bool(true),
  },
}))
```

See [`examples/03-code-assistant/`](../examples/03-code-assistant/).

---

## 4. Browser WebMCP Page Tools with Visual Snapshots + Lit 3

When tools mutate browser UI state (such as an HTML5 `<canvas>`) or register on Chrome's `document.modelContext` WebMCP API, attach a `WebmcpToolHost` to `LiveSession` / `LiveSessionController` and enable `AllowPageTools` + `SeeVisualResults` on `NewDynamicHandler`:

```ts
import { WebmcpToolHost } from '@ghchinoy/livebridge';
import { LiveSessionController } from '@ghchinoy/livebridge/lit';
import { LitElement, html } from 'lit';

export class StudioElement extends LitElement {
  private readonly toolHost = new WebmcpToolHost();
  private readonly live = new LiveSessionController(this, {
    mode: 'audio',
    toolHost: this.toolHost,
  });

  override async connectedCallback(): Promise<void> {
    super.connectedCallback();
    await this.toolHost.register([
      {
        name: 'paint_badge',
        description: 'Draws a status badge on the canvas.',
        inputSchema: {
          type: 'object',
          properties: { label: { type: 'string' } },
          required: ['label'],
        },
        coalesceInFlight: true,
        execute: async (args) => ({
          result: { drawn: args.label },
          imageDataUrl: this.drawAndCaptureCanvasJpeg(String(args.label)),
        }),
      },
    ]);
  }

  private start() {
    return this.live.connect({
      endpoint: '/ws/live',
      advertisePageTools: true,
    });
  }

  protected override render() {
    return html`<button @click=${this.start}>${this.live.status}</button>`;
  }
}
```

---

## 5. Multi-Tab Proactive Alerts (`AlertBus` + `FormatUntrustedAlert`)

`AlertBus` buffers up to `maxBacklog` alerts while zero tabs are connected, waits for `SetupComplete` (and the greeting turn) before flushing to the first subscriber, and fans out live events across all open tabs without blocking:

```go
alerts := livebridge.NewAlertBus(16)

// Background webhook / watcher goroutine:
alerts.Publish(livebridge.Alert{
  ID:     "inc-9",
  Source: "payments-db",
  Title:  "Replica lag > 4s",
  Text:   untrustedLogSnippet,
})

// Attach to NewFixedHandler or NewDynamicHandler:
FormatAlert: func(a livebridge.Alert) (string, any) {
  prompt := livebridge.FormatUntrustedAlert(
    "Summarize this alert in one calm sentence.",
    map[string]string{"service": a.Source, "title": a.Title},
    a.Text,
    600,
  )
  card := map[string]any{"type": "proactive_alert", "id": a.ID, "summary": a.Title}
  return prompt, card
}
```

On the browser side, `LiveSession` automatically plays a warm procedural Web Audio cue via `ChimeSynth` and calls `PcmPlayer.deferPlayback(cueSeconds)` so spoken audio never overlaps the notification tone. See [`examples/04-ops-watchtower/`](../examples/04-ops-watchtower/).
