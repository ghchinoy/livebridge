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

// Command avatar-desk demonstrates a talking video avatar & live-vision desk
// built with livebridge.NewDynamicHandler and @ghchinoy/livebridge in Vite + TS.
package main

import (
	"encoding/json"
	"log"
	"log/slog"
	"net/http"
	"os"

	"github.com/ghchinoy/livebridge"
)

var (
	allowedModels = []string{
		livebridge.DefaultModel,
		"gemini-3.5-flash-lite-live-preview",
	}
	presetAvatars = []string{"Kira", "Puck", "Aoede", "Charon", "Fenrir", "Kore"}
	presetVoices  = []string{"Kore", "Puck", "Aoede", "Charon", "Fenrir", "Leda"}
)

func newMux(connector livebridge.Connector, defaultModel string) *http.ServeMux {
	origins := livebridge.NewOriginPolicyFromEnv()
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/config", origins.WithCORS(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"defaultModel": defaultModel,
			"models":       livebridge.AllowedValues(defaultModel, allowedModels),
			"avatars":      presetAvatars,
			"voices":       presetVoices,
		})
	}))

	// /ws defaults to ModeAvatar (fMP4 muxed H.264 + AAC), while allowing the
	// client setup frame to switch mode, preset/custom avatar, voice, & persona.
	mux.Handle("GET /ws", livebridge.NewDynamicHandler(livebridge.DynamicHandlerConfig{
		Connector:        connector,
		OriginPolicy:     origins,
		AllowedModels:    allowedModels,
		AllowedLocations: []string{livebridge.DefaultLocation},
		Defaults: livebridge.SessionSpec{
			Mode:                     livebridge.ModeAvatar,
			Model:                    defaultModel,
			Location:                 livebridge.DefaultLocation,
			AvatarType:               "preset",
			AvatarData:               "Kira",
			VoiceName:                "Kore",
			WelcomeMessage:           "Hi! Welcome to Avatar Desk. Feel free to turn on your camera or screen share.",
			SystemInstruction:        "You are a warm, observant visual concierge. When the user shares their camera or screen, reference concrete details you see.",
			EnableGoogleSearch:       livebridge.Bool(true),
			ProactiveAudio:           livebridge.Bool(true),
			ContextWindowCompression: livebridge.Bool(true),
		},
	}))

	if _, err := os.Stat("frontend/dist"); err == nil {
		mux.Handle("/", http.FileServer(http.Dir("frontend/dist")))
	}
	return mux
}

func main() {
	clients, err := livebridge.NewClientPoolFromEnv()
	if err != nil {
		log.Fatal(err)
	}
	port := envOr("PORT", "8082")
	model := envOr("GEMINI_LIVE_MODEL", livebridge.DefaultModel)

	addr := ":" + port
	slog.Info("Avatar Desk backend listening", "url", "http://localhost"+addr, "model", model)
	srv := livebridge.NewHTTPServer(addr, newMux(clients, model))
	log.Fatal(srv.ListenAndServe())
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
