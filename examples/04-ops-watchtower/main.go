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

// Command ops-watchtower demonstrates Lit 3 (@ghchinoy/livebridge/lit),
// browser-hosted WebMCP canvas tools with pre-response visual snapshots
// (SeeVisualResults), and multi-tab proactive background alerts (AlertBus +
// FormatUntrustedAlert).
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"
	"sync/atomic"
	"time"

	"github.com/ghchinoy/livebridge"
)

var allowedPageTools = map[string]bool{
	"set_node_status":  true,
	"inspect_topology": true,
}

type incidentRequest struct {
	Service string `json:"service"`
	Title   string `json:"title"`
	Logs    string `json:"logs"`
}

func main() {
	clients, err := livebridge.NewClientPoolFromEnv()
	if err != nil {
		log.Fatal(err)
	}
	alerts := livebridge.NewAlertBus(16)
	port := envOr("PORT", "8084")
	model := envOr("GEMINI_LIVE_MODEL", livebridge.DefaultModel)

	addr := ":" + port
	slog.Info("Ops Watchtower backend listening", "url", "http://localhost"+addr, "model", model)
	log.Fatal(livebridge.NewHTTPServer(addr, newWatchtowerMux(clients, alerts, model)).ListenAndServe())
}

func newWatchtowerMux(connector livebridge.Connector, alerts *livebridge.AlertBus, defaultModel string) *http.ServeMux {
	origins := livebridge.NewOriginPolicyFromEnv()
	mux := http.NewServeMux()

	var seq atomic.Uint64
	mux.HandleFunc("POST /api/incident", origins.WithCORS(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
		var req incidentRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON body", http.StatusBadRequest)
			return
		}
		if req.Service == "" {
			req.Service = "payments-db"
		}
		if req.Title == "" {
			req.Title = "Elevated p99 latency"
		}
		alert := livebridge.Alert{
			ID:        fmt.Sprintf("inc-%d", seq.Add(1)),
			Source:    req.Service,
			Type:      "incident",
			Title:     req.Title,
			Text:      req.Logs,
			CreatedAt: time.Now().UTC(),
		}
		alerts.Publish(alert)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"published": true, "id": alert.ID})
	}))

	mux.Handle("GET /ws/live", livebridge.NewDynamicHandler(livebridge.DynamicHandlerConfig{
		Connector:    connector,
		OriginPolicy: origins,
		Defaults: livebridge.SessionSpec{
			Mode:                     livebridge.ModeAudio,
			Model:                    defaultModel,
			Location:                 livebridge.DefaultLocation,
			VoiceName:                "Charon",
			WelcomeMessage:           "Watchtower online. I can inspect or update the topology canvas and summarize incoming alerts.",
			SystemInstruction:        "You are an SRE incident copilot. Use inspect_topology and set_node_status to read or update the live topology canvas. Keep spoken briefings calm and under two sentences.",
			ProactiveAudio:           livebridge.Bool(true),
			ContextWindowCompression: livebridge.Bool(true),
		},
		AllowPageTools: true,
		PageToolPolicy: livebridge.PageToolPolicy{
			AllowedNames: allowedPageTools,
		},
		SeeVisualResults: true,
		EmitToolTiming:   true,
		AlertBus:         alerts,
		FormatAlert: func(a livebridge.Alert) (string, any) {
			prompt := livebridge.FormatUntrustedAlert(
				"Briefly alert the operator in one calm sentence and ask if you should mark the service degraded on the topology canvas.",
				map[string]string{"service": a.Source, "title": a.Title},
				a.Text,
				600,
			)
			card := map[string]any{
				"type":    "proactive_alert",
				"id":      a.ID,
				"source":  a.Source,
				"summary": a.Title,
			}
			return prompt, card
		},
	}))

	if _, err := os.Stat("frontend/dist"); err == nil {
		mux.Handle("/", http.FileServer(http.Dir("frontend/dist")))
	}
	return mux
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
