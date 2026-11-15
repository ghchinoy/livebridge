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

// Command minimal-voice demonstrates a complete single-binary Gemini Live 24 kHz
// voice assistant using github.com/ghchinoy/livebridge and its embedded browser
// ES module bundle — zero Node.js, npm, or copied library files required.
package main

import (
	_ "embed"
	"log"
	"log/slog"
	"net/http"
	"os"

	"github.com/ghchinoy/livebridge"
	"github.com/ghchinoy/livebridge/browser"
)

//go:embed index.html
var indexHTML []byte

func main() {
	clients, err := livebridge.NewClientPoolFromEnv()
	if err != nil {
		log.Fatal(err)
	}
	port := envOr("PORT", "8081")
	model := envOr("GEMINI_LIVE_MODEL", livebridge.DefaultModel)
	voice := envOr("GEMINI_VOICE", "Puck")

	addr := ":" + port
	slog.Info("Minimal Voice listening", "url", "http://localhost"+addr, "model", model, "voice", voice)
	srv := livebridge.NewHTTPServer(addr, newMux(clients, model, voice))
	log.Fatal(srv.ListenAndServe())
}

func newMux(connector livebridge.Connector, model, voice string) *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(indexHTML)
	})
	mux.Handle("GET /livebridge.js", browser.Handler())
	mux.Handle("GET /ws/live", livebridge.NewFixedHandler(livebridge.FixedHandlerConfig{
		Connector: connector,
		Spec: livebridge.SessionSpec{
			Mode:                     livebridge.ModeAudio,
			Model:                    model,
			VoiceName:                voice,
			WelcomeMessage:           "Hi! Minimal Voice is connected. What would you like to explore?",
			SystemInstruction:        "You are a crisp, friendly real-time voice assistant. Keep spoken answers concise and natural.",
			ProactiveAudio:           livebridge.Bool(true),
			ContextWindowCompression: livebridge.Bool(true),
		},
	}))
	return mux
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
