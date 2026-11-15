# 02 · Avatar Desk (Vite + TypeScript + Talking Video Avatar + 1 FPS Vision)

Demonstrates **`livebridge.NewDynamicHandler`** paired with **`@ghchinoy/livebridge`** in a standalone Vite + TypeScript frontend:

- **Talking Video Avatars (`ModeAvatar`) & Audio (`ModeAudio`):** Streams muxed fMP4 (`avc1.*, mp4a.40.2`) through `SniffMP4` + `Fmp4Player` with automatic inter-turn PTS gap jumping and barge-in buffer trimming.
- **Custom Avatar Upload (`prepareAvatarImage`):** Automatically center-crops uploaded portrait, square, or landscape images to `704x1280` or `1280x704` on the client, backed by `ValidateCustomAvatarDimensions` pre-dial `1007` checks on the server.
- **1 FPS Live Vision (`VisionCapture`):** Toggle webcam or screen share during a conversation with smooth native-framerate PiP preview and 1 FPS JPEG upstream sampling.

## Quickstart

```bash
# Terminal 1: Go backend (:8082)
export GOOGLE_CLOUD_PROJECT="your-gcp-project"
go run .

# Terminal 2: Vite dev server (:5174, proxies /ws & /api to :8082)
cd frontend && npm run dev
```

## Verify

```bash
go test -race -v ./...
cd frontend && npm run build
```
