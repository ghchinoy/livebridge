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

package livebridge

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/gorilla/websocket"
)

// FixedHandlerConfig configures an http.Handler that dials Gemini Live
// immediately on WebSocket upgrade without waiting for a client setup JSON frame.
type FixedHandlerConfig struct {
	Connector    Connector
	Spec         SessionSpec
	OriginPolicy *OriginPolicy

	// SpecFromRequest optionally customizes Spec per HTTP request (for example,
	// reading ?model= or ?avatar= query parameters). Returning an error closes
	// the WebSocket with 1007 before dialing.
	SpecFromRequest func(r *http.Request, base SessionSpec) (SessionSpec, error)

	// Registry optionally supplies server-side tools; each session automatically
	// receives Registry.Declarations() and a per-session ToolRunner unless
	// NewTools overrides it.
	Registry    *FuncRegistry
	ToolTimeout *Timings
	NewTools    func(r *http.Request, spec SessionSpec) *ToolRunner

	AlertBus    *AlertBus
	FormatAlert func(Alert) (prompt string, browserMsg any)

	// Bridge provides template settings (AudioDelivery, Timings, EmitTurnComplete,
	// OnSetupComplete, OnCustomClientMessage, Logger). Mode, Model, Location,
	// GreetingPrompt, Tools, and Alerts are populated automatically when unset.
	Bridge             BridgeConfig
	DisableSessionInfo bool
}

// NewFixedHandler returns an http.Handler implementing a fixed-persona Gemini
// Live WebSocket endpoint.
func NewFixedHandler(cfg FixedHandlerConfig) http.Handler {
	origins := cfg.OriginPolicy
	if origins == nil {
		origins = NewOriginPolicyFromEnv()
	}
	upgrader := origins.Upgrader()

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rawConn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			slog.Warn("upgrading WebSocket", "err", err)
			return
		}
		ws := NewSafeConn(rawConn)
		defer func() { _ = ws.Close() }()
		ws.SetReadLimit(MaxClientMessageBytes)

		spec := cfg.Spec
		if cfg.SpecFromRequest != nil {
			spec, err = cfg.SpecFromRequest(r, spec)
			if err != nil {
				slog.Warn("invalid session request", "err", err)
				_ = ws.WriteClose(websocket.CloseInvalidFramePayloadData, "Invalid session config")
				return
			}
		}
		if spec.Mode == "" {
			spec.Mode = ModeAudio
		}
		if spec.Model == "" {
			spec.Model = DefaultModel
		}
		if spec.Location == "" {
			spec.Location = DefaultLocation
		}
		if cfg.Registry != nil && len(spec.ServerDeclarations) == 0 {
			spec.ServerDeclarations = cfg.Registry.Declarations()
		}

		logger := cfg.Bridge.Logger
		if logger == nil {
			logger = slog.Default()
		}
		logger = logger.With("mode", spec.Mode, "model", spec.Model, "location", spec.Location)

		liveCfg, err := BuildConnectConfig(spec)
		if err != nil {
			logger.Warn("invalid session config", "err", err)
			_ = ws.WriteClose(websocket.CloseInvalidFramePayloadData, "Invalid session config")
			return
		}

		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()

		upstream, err := cfg.Connector.Connect(ctx, spec.Model, spec.Location, liveCfg)
		if err != nil {
			logger.Error("connecting to Gemini Live", "err", err)
			_ = ws.WriteClose(websocket.CloseInternalServerErr, "Failed to connect")
			return
		}

		var toolRunner *ToolRunner
		if cfg.NewTools != nil {
			toolRunner = cfg.NewTools(r, spec)
		} else if cfg.Registry != nil {
			toolRunner = NewToolRunner(ToolRunnerConfig{Registry: cfg.Registry})
		}

		bCfg := populateBridgeConfig(cfg.Bridge, spec, !cfg.DisableSessionInfo, toolRunner, logger)
		if cfg.AlertBus != nil && cfg.FormatAlert != nil {
			alerts, unsub := cfg.AlertBus.Subscribe()
			defer unsub()
			bCfg.Alerts = alerts
			bCfg.FormatAlert = cfg.FormatAlert
		}

		bridge := NewBridge(ctx, ws, upstream, bCfg)
		defer bridge.Shutdown(0, "")
		bridge.Run()
	})
}

// DynamicHandlerConfig configures an http.Handler that reads a 16 MiB initial
// SessionSpec JSON frame from the browser on connect, merges it onto server
// Defaults with model/location allowlist checks, tightens the WebSocket read
// limit to 8 MiB, and bridges the session.
type DynamicHandlerConfig struct {
	Connector        Connector
	Defaults         SessionSpec
	AllowedModels    []string
	AllowedLocations []string
	OriginPolicy     *OriginPolicy

	// TransformSpec optionally inspects or adjusts the merged SessionSpec before
	// BuildConnectConfig runs. Returning an error closes with 1007.
	TransformSpec func(r *http.Request, merged SessionSpec) (SessionSpec, error)

	// Registry optionally supplies server-side tools.
	Registry *FuncRegistry
	// AllowPageTools enables browser-advertised WebMCP page tools from the
	// initial setup payload ("tools": [...]) and relays calls over WebSocket.
	AllowPageTools   bool
	PageToolPolicy   PageToolPolicy
	SeeVisualResults bool
	EmitToolTiming   bool
	NewTools         func(r *http.Request, spec SessionSpec) *ToolRunner

	AlertBus    *AlertBus
	FormatAlert func(Alert) (prompt string, browserMsg any)

	Bridge             BridgeConfig
	DisableSessionInfo bool
}

// NewDynamicHandler returns an http.Handler implementing a dynamic-setup Gemini
// Live WebSocket endpoint.
func NewDynamicHandler(cfg DynamicHandlerConfig) http.Handler {
	origins := cfg.OriginPolicy
	if origins == nil {
		origins = NewOriginPolicyFromEnv()
	}
	upgrader := origins.Upgrader()

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rawConn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			slog.Warn("upgrading WebSocket", "err", err)
			return
		}
		ws := NewSafeConn(rawConn)
		defer func() { _ = ws.Close() }()

		ws.SetReadLimit(MaxInitialConfigBytes)
		var clientSpec SessionSpec
		if err := ws.ReadJSON(&clientSpec); err != nil {
			slog.Warn("reading initial session config", "err", err)
			_ = ws.WriteClose(websocket.CloseInvalidFramePayloadData, "Invalid session config")
			return
		}
		ws.SetReadLimit(MaxClientMessageBytes)

		spec := MergeSessionSpec(cfg.Defaults, clientSpec, cfg.AllowedModels, cfg.AllowedLocations)
		if cfg.Registry != nil && len(spec.ServerDeclarations) == 0 {
			spec.ServerDeclarations = cfg.Registry.Declarations()
		}

		var rejectedTools []string
		if cfg.AllowPageTools && len(spec.PageTools) > 0 {
			spec.PageDeclarations, rejectedTools = DeclarationsFromPageTools(spec.PageTools, cfg.PageToolPolicy)
		}

		if cfg.TransformSpec != nil {
			spec, err = cfg.TransformSpec(r, spec)
			if err != nil {
				slog.Warn("transforming session config", "err", err)
				_ = ws.WriteClose(websocket.CloseInvalidFramePayloadData, "Invalid session config")
				return
			}
		}

		logger := cfg.Bridge.Logger
		if logger == nil {
			logger = slog.Default()
		}
		logger = logger.With("mode", spec.Mode, "model", spec.Model, "location", spec.Location)

		liveCfg, err := BuildConnectConfig(spec)
		if err != nil {
			logger.Warn("invalid session config", "err", err)
			_ = ws.WriteClose(websocket.CloseInvalidFramePayloadData, "Invalid session config")
			return
		}

		if len(rejectedTools) > 0 {
			_ = ws.WriteJSON(map[string]any{
				"type":  "tools_rejected",
				"tools": rejectedTools,
			})
		}

		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()

		upstream, err := cfg.Connector.Connect(ctx, spec.Model, spec.Location, liveCfg)
		if err != nil {
			logger.Error("connecting to Gemini Live", "err", err)
			_ = ws.WriteClose(websocket.CloseInternalServerErr, "Failed to connect")
			return
		}

		var toolRunner *ToolRunner
		if cfg.NewTools != nil {
			toolRunner = cfg.NewTools(r, spec)
		} else if cfg.Registry != nil || cfg.AllowPageTools {
			toolRunner = NewToolRunner(ToolRunnerConfig{
				Registry:         cfg.Registry,
				AllowPageRelay:   cfg.AllowPageTools,
				SeeVisualResults: cfg.SeeVisualResults,
				EmitTiming:       cfg.EmitToolTiming,
			})
		}

		bCfg := populateBridgeConfig(cfg.Bridge, spec, !cfg.DisableSessionInfo, toolRunner, logger)
		if cfg.AlertBus != nil && cfg.FormatAlert != nil {
			alerts, unsub := cfg.AlertBus.Subscribe()
			defer unsub()
			bCfg.Alerts = alerts
			bCfg.FormatAlert = cfg.FormatAlert
		}

		bridge := NewBridge(ctx, ws, upstream, bCfg)
		defer bridge.Shutdown(0, "")
		bridge.Run()
	})
}

func populateBridgeConfig(base BridgeConfig, spec SessionSpec, emitInfo bool, tools *ToolRunner, logger *slog.Logger) BridgeConfig {
	out := base
	out.Mode = spec.Mode
	out.Model = spec.Model
	out.Location = spec.Location
	if out.GreetingPrompt == "" {
		out.GreetingPrompt = spec.EffectiveGreetingPrompt()
	}
	if emitInfo {
		out.EmitSessionInfo = true
	}
	if out.Tools == nil {
		out.Tools = tools
	}
	out.Logger = logger
	return out
}
