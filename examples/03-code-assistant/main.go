// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Command code-assistant is the zero-copy port of local-code-assistant built
// directly on github.com/ghchinoy/livebridge and livebridge/browser.
package main

import (
	_ "embed"
	"log"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"

	"github.com/ghchinoy/livebridge"
	"github.com/ghchinoy/livebridge/browser"
)

//go:embed index.html
var indexHTML []byte

const persona = `You are an expert Software Development Assistant and codebase explorer. You have access to workspace tools (list_directory, read_file, generate_diagram) and Google Search. Answer concisely in natural spoken prose; summarize code rather than reading raw syntax aloud.`

var allowedModels = []string{
	livebridge.DefaultModel,
	"gemini-3.5-flash-lite-live-preview",
}

func main() {
	clients, err := livebridge.NewClientPoolFromEnv()
	if err != nil {
		log.Fatal(err)
	}
	rootDir := envOr("WORKSPACE_ROOT", ".")
	diagramsDir := filepath.Join(os.TempDir(), "livebridge-code-assistant-diagrams")
	port := envOr("PORT", "8083")
	model := envOr("GEMINI_LIVE_MODEL", livebridge.DefaultModel)

	mux, err := newAppMux(clients, rootDir, diagramsDir, model)
	if err != nil {
		log.Fatal(err)
	}
	addr := ":" + port
	slog.Info("Code Assistant listening", "url", "http://localhost"+addr, "root", rootDir)
	log.Fatal(livebridge.NewHTTPServer(addr, mux).ListenAndServe())
}

func newAppMux(connector livebridge.Connector, rootDir, diagramsDir, defaultModel string) (*http.ServeMux, error) {
	reg, err := buildCodebaseRegistry(rootDir, diagramsDir)
	if err != nil {
		return nil, err
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(indexHTML)
	})
	mux.Handle("GET /livebridge.js", browser.Handler())

	mux.Handle("GET /ws", livebridge.NewFixedHandler(livebridge.FixedHandlerConfig{
		Connector: connector,
		Registry:  reg,
		Spec: livebridge.SessionSpec{
			Mode:                     livebridge.ModeAudio,
			Model:                    defaultModel,
			VoiceName:                "Puck",
			WelcomeMessage:           "Hello! I am your codebase explorer. Ask me about any file or architecture diagram.",
			SystemInstruction:        persona,
			EnableGoogleSearch:       livebridge.Bool(true),
			ProactiveAudio:           livebridge.Bool(true),
			ContextWindowCompression: livebridge.Bool(true),
		},
		SpecFromRequest: func(r *http.Request, base livebridge.SessionSpec) (livebridge.SessionSpec, error) {
			base.Model = livebridge.ResolveAllowed("live model", r.URL.Query().Get("model"), base.Model, allowedModels)
			if avatar := r.URL.Query().Get("avatar"); avatar != "" {
				base.Mode = livebridge.ModeAvatar
				base.AvatarType = "preset"
				base.AvatarData = avatar
			}
			return base, nil
		},
	}))
	return mux, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
