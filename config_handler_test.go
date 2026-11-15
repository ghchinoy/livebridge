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
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/genai"
)

type fakeConnector struct {
	mu          sync.Mutex
	session     *fakeLiveSession
	connectErr  error
	lastModel   string
	lastLoc     string
	lastCfg     *genai.LiveConnectConfig
	connectHits int
}

func (fc *fakeConnector) Connect(_ context.Context, model, location string, cfg *genai.LiveConnectConfig) (Session, error) {
	fc.mu.Lock()
	defer fc.mu.Unlock()
	fc.connectHits++
	fc.lastModel = model
	fc.lastLoc = location
	fc.lastCfg = cfg
	if fc.connectErr != nil {
		return nil, fc.connectErr
	}
	return fc.session, nil
}

func TestBuildConnectConfig_GuardrailsAndModalities(t *testing.T) {
	// 1. Audio mode + proactive audio on 3.8 + compression + Google Search
	audioCfg, err := BuildConnectConfig(SessionSpec{
		Mode:                     ModeAudio,
		Model:                    "gemini-3.8-live",
		VoiceName:                "Puck",
		LanguageCode:             "en-US",
		SystemInstruction:        "Be concise.",
		GroundingContext:         "Doc v1",
		ProactiveAudio:           Bool(true),
		EnableGoogleSearch:       Bool(true),
		ContextWindowCompression: Bool(true),
		CompressionTriggerTokens: 24000,
		Temperature:              Float32(0.7),
		TopP:                     Float32(2.5), // out-of-range -> dropped
	})
	if err != nil {
		t.Fatalf("BuildConnectConfig(audio): %v", err)
	}
	if len(audioCfg.ResponseModalities) != 1 || audioCfg.ResponseModalities[0] != genai.ModalityAudio {
		t.Fatalf("unexpected audio modalities: %v", audioCfg.ResponseModalities)
	}
	if audioCfg.AvatarConfig != nil {
		t.Fatal("expected nil AvatarConfig in ModeAudio")
	}
	if audioCfg.Proactivity == nil || audioCfg.Proactivity.ProactiveAudio == nil || !*audioCfg.Proactivity.ProactiveAudio {
		t.Fatal("expected ProactiveAudio enabled on gemini-3.8-live")
	}
	if audioCfg.ContextWindowCompression == nil || *audioCfg.ContextWindowCompression.TriggerTokens != 24000 {
		t.Fatal("expected ContextWindowCompression TriggerTokens=24000")
	}
	if audioCfg.TopP != nil {
		t.Fatalf("expected out-of-range TopP to be dropped, got %v", *audioCfg.TopP)
	}
	if audioCfg.RealtimeInputConfig != nil {
		t.Fatal("expected nil RealtimeInputConfig when all VAD fields are unset")
	}

	// 2. ProactiveAudio gated off on full 3.5-flash
	flashCfg, err := BuildConnectConfig(SessionSpec{
		Mode:           ModeAudio,
		Model:          "gemini-3.5-flash-live-preview",
		ProactiveAudio: Bool(true),
	})
	if err != nil {
		t.Fatalf("BuildConnectConfig(3.5-flash): %v", err)
	}
	if flashCfg.Proactivity != nil {
		t.Fatal("expected Proactivity nil on gemini-3.5-flash-live-preview")
	}

	// 3. Avatar mode uses VIDEO alone and validates custom PNG dimensions
	portraitURL := encodePNGDataURL(t, 704, 1280)
	avatarCfg, err := BuildConnectConfig(SessionSpec{
		Mode:            ModeAvatar,
		AvatarData:      portraitURL,
		VideoBitrateBps: Int32(1_000_000),
	})
	if err != nil {
		t.Fatalf("BuildConnectConfig(custom portrait avatar): %v", err)
	}
	if len(avatarCfg.ResponseModalities) != 1 || avatarCfg.ResponseModalities[0] != genai.ModalityVideo {
		t.Fatalf("expected [VIDEO] alone for avatar mode, got %v", avatarCfg.ResponseModalities)
	}
	if avatarCfg.AvatarConfig == nil || avatarCfg.AvatarConfig.CustomizedAvatar == nil {
		t.Fatal("expected CustomizedAvatar populated")
	}
	if *avatarCfg.AvatarConfig.VideoBitrateBps != 1_000_000 {
		t.Fatal("expected VideoBitrateBps propagated")
	}

	// 4. Square custom avatar fails pre-dial
	squareURL := encodePNGDataURL(t, 1024, 1024)
	if _, err := BuildConnectConfig(SessionSpec{Mode: ModeAvatar, AvatarData: squareURL}); err == nil {
		t.Fatal("expected square 1024x1024 custom avatar to fail BuildConnectConfig")
	}
}

func TestDeclarationsFromPageTools_WebMCPStringAndObjectSchemas(t *testing.T) {
	tools := []PageTool{
		{
			Name:        "draw_node",
			Description: "Draws a node on the canvas.",
			// Chrome WebMCP stringified inputSchema form:
			InputSchema: json.RawMessage(`"{\"type\":\"object\",\"properties\":{\"label\":{\"type\":\"string\"}}}"`),
		},
		{
			Name:        "evil_tool",
			Description: "Not allowlisted",
			InputSchema: json.RawMessage(`{"type":"object"}`),
		},
	}

	decls, rejected := DeclarationsFromPageTools(tools, PageToolPolicy{
		AllowedNames: map[string]bool{"draw_node": true},
	})
	if len(decls) != 1 || decls[0].Name != "draw_node" || decls[0].ParametersJsonSchema == nil {
		t.Fatalf("unexpected converted declarations: %+v", decls)
	}
	if len(rejected) != 1 || !strings.Contains(rejected[0], "evil_tool") {
		t.Fatalf("expected evil_tool in rejected list, got %v", rejected)
	}
}

func TestNewFixedHandler_AudioAndAlerts(t *testing.T) {
	fake := newFakeLiveSession()
	fc := &fakeConnector{session: fake}
	bus := NewAlertBus(4)
	bus.Publish(Alert{ID: "a-1", Source: "ci", Title: "Build green", Text: "main passed"})

	reg := NewFuncRegistry()
	reg.Register(&genai.FunctionDeclaration{Name: "ping_service"}, func(_ context.Context, _ map[string]any) (map[string]any, error) {
		return map[string]any{"ok": true}, nil
	})

	srv := httptest.NewServer(NewFixedHandler(FixedHandlerConfig{
		Connector: fc,
		Spec: SessionSpec{
			Mode:           ModeAudio,
			VoiceName:      "Puck",
			WelcomeMessage: "Hello there!",
		},
		Registry: reg,
		AlertBus: bus,
		FormatAlert: func(a Alert) (string, any) {
			return "Summarize: " + a.Title, map[string]any{"type": "proactive_alert", "id": a.ID}
		},
	}))
	defer srv.Close()

	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = conn.Close() }()

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var info map[string]any
	if err := conn.ReadJSON(&info); err != nil || info["type"] != "session_info" {
		t.Fatalf("expected session_info frame, got %+v (err=%v)", info, err)
	}

	// Trigger SetupComplete so greeting + queued AlertBus item flush in order.
	fake.recvCh <- &genai.LiveServerMessage{SetupComplete: &genai.LiveServerSetupComplete{}}

	var alertFrame map[string]any
	if err := conn.ReadJSON(&alertFrame); err != nil || alertFrame["type"] != "proactive_alert" || alertFrame["id"] != "a-1" {
		t.Fatalf("expected proactive_alert frame after SetupComplete, got %+v (err=%v)", alertFrame, err)
	}

	// Emit PCM audio chunk from upstream -> expect media_config then binary frame.
	fake.recvCh <- &genai.LiveServerMessage{
		ServerContent: &genai.LiveServerContent{
			ModelTurn: &genai.Content{
				Parts: []*genai.Part{{
					InlineData: &genai.Blob{MIMEType: "audio/pcm;rate=24000", Data: []byte{1, 2, 3, 4}},
				}},
			},
		},
	}

	var mediaCfg map[string]any
	if err := conn.ReadJSON(&mediaCfg); err != nil || mediaCfg["type"] != "media_config" {
		t.Fatalf("expected media_config, got %+v (err=%v)", mediaCfg, err)
	}
	msgType, pcm, err := conn.ReadMessage()
	if err != nil || msgType != websocket.BinaryMessage || len(pcm) != 4 {
		t.Fatalf("expected 4-byte binary PCM frame, got type=%d len=%d err=%v", msgType, len(pcm), err)
	}
}

func TestNewDynamicHandler_PreDialValidationAndAllowlists(t *testing.T) {
	t.Run("rejects_broken_avatar_with_1007_before_dialing", func(t *testing.T) {
		fc := &fakeConnector{session: newFakeLiveSession()}
		srv := httptest.NewServer(NewDynamicHandler(DynamicHandlerConfig{
			Connector: fc,
			Defaults:  SessionSpec{Mode: ModeAvatar},
		}))
		defer srv.Close()

		conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer func() { _ = conn.Close() }()

		_ = conn.WriteJSON(SessionSpec{
			Mode:       ModeAvatar,
			AvatarType: "custom",
			AvatarData: "not-a-data-url",
		})

		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		_, _, closeErr := conn.ReadMessage()
		var ce *websocket.CloseError
		if !errors.As(closeErr, &ce) || ce.Code != websocket.CloseInvalidFramePayloadData {
			t.Fatalf("expected 1007 invalid payload close, got %v", closeErr)
		}
		if fc.connectHits != 0 {
			t.Fatalf("expected 0 upstream dial attempts on invalid avatar, got %d", fc.connectHits)
		}
	})

	t.Run("enforces_model_allowlist_and_registers_page_tools", func(t *testing.T) {
		fake := newFakeLiveSession()
		fc := &fakeConnector{session: fake}
		srv := httptest.NewServer(NewDynamicHandler(DynamicHandlerConfig{
			Connector:      fc,
			Defaults:       SessionSpec{Mode: ModeAudio, Model: DefaultModel, Location: DefaultLocation},
			AllowedModels:  []string{DefaultModel},
			AllowPageTools: true,
		}))
		defer srv.Close()

		conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer func() { _ = conn.Close() }()

		_ = conn.WriteJSON(SessionSpec{
			Model: "unapproved-experimental-model",
			PageTools: []PageTool{{
				Name:        "inspect_canvas",
				Description: "Reads canvas state",
				InputSchema: json.RawMessage(`{"type":"object"}`),
			}},
		})

		_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		var info map[string]any
		if err := conn.ReadJSON(&info); err != nil || info["model"] != DefaultModel {
			t.Fatalf("expected fallback to %s, got %+v (err=%v)", DefaultModel, info, err)
		}

		fc.mu.Lock()
		dialedCfg := fc.lastCfg
		fc.mu.Unlock()
		if dialedCfg == nil || len(dialedCfg.Tools) != 1 || len(dialedCfg.Tools[0].FunctionDeclarations) != 1 {
			t.Fatalf("expected 1 page tool declaration wired into LiveConnectConfig, got %+v", dialedCfg)
		}
	})
}
