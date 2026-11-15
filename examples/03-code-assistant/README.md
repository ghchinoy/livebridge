# 03 · Code Assistant (Zero-Copy Port of `local-code-assistant`)

Rebuilds `gemini-live-avatar/examples/local-code-assistant` directly on **`github.com/ghchinoy/livebridge`** and **`github.com/ghchinoy/livebridge/browser`**, eliminating all copied switchboard and Web Audio boilerplate.

| Metric | Copy-Pasted `local-code-assistant` | Library-Based `03-code-assistant` |
| :--- | :--- | :--- |
| Copied `internal/livebridge/*.go` files | 9 files (~1,900 LOC) | **0 files** |
| Custom `tools/registry.go` wrapper | 2 files (~120 LOC) | **0 files** (`livebridge.FuncRegistry`) |
| Inline Web Audio / MSE JS in `index.html` | ~450 LOC | **0 LOC** (`import { LiveSession } from '/livebridge.js'`) |
| Total application code | ~3,100+ LOC (18 files) | **~360 LOC (3 files)** |

## Capabilities

- **Sandboxed Workspace Tools (`FuncRegistry`):** `list_directory` and `read_file` (confined to `WORKSPACE_ROOT` via `filepath.Rel`), plus `generate_diagram` (Graphviz DOT -> PNG; install `dot` via `brew install graphviz` for PNG rendering).
- **Google Search Grounding:** Enabled alongside function declarations via `SessionSpec.EnableGoogleSearch`.
- **Voice or Talking Avatar (`?avatar=Kira`):** `SpecFromRequest` upgrades the session from 24 kHz binary PCM to muxed H.264/AAC fMP4 video on demand.

## Quickstart

```bash
export GOOGLE_CLOUD_PROJECT="your-gcp-project"
WORKSPACE_ROOT="../.." go run .
```

Open <http://localhost:8083>, click **Connect**, and try asking:
- *"List the files in the root directory and explain what `handler.go` does."*
- *"Generate an architecture diagram showing how `Bridge`, `ToolRunner`, and `AlertBus` interact."*

## Verify

```bash
go test -race -v .
```
