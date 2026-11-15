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

	"github.com/google/go-cmp/cmp"
	"github.com/gorilla/websocket"
	"google.golang.org/genai"
)

func TestBuildConnectConfig_GuardrailsAndModalities(t *testing.T) {
	audioSpec := SessionSpec{
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
	}
	audioCfg, err := BuildConnectConfig(audioSpec)
	if err != nil {
		t.Fatalf("BuildConnectConfig(audioSpec) returned error: %v", err)
	}
	if diff := cmp.Diff([]genai.Modality{genai.ModalityAudio}, audioCfg.ResponseModalities); diff != "" {
		t.Errorf("BuildConnectConfig(audioSpec).ResponseModalities diff (-want +got):\n%s", diff)
	}
	if audioCfg.AvatarConfig != nil {
		t.Errorf("BuildConnectConfig(audioSpec).AvatarConfig = %+v, want nil", audioCfg.AvatarConfig)
	}
	if audioCfg.Proactivity == nil || audioCfg.Proactivity.ProactiveAudio == nil || !*audioCfg.Proactivity.ProactiveAudio {
		t.Errorf("BuildConnectConfig(audioSpec).Proactivity = %+v, want ProactiveAudio=true", audioCfg.Proactivity)
	}
	if audioCfg.ContextWindowCompression == nil || *audioCfg.ContextWindowCompression.TriggerTokens != 24000 {
		t.Errorf("BuildConnectConfig(audioSpec).ContextWindowCompression = %+v, want TriggerTokens=24000", audioCfg.ContextWindowCompression)
	}
	if audioCfg.TopP != nil {
		t.Errorf("BuildConnectConfig(TopP=2.5).TopP = %v, want nil", *audioCfg.TopP)
	}
	if audioCfg.RealtimeInputConfig != nil {
		t.Errorf("BuildConnectConfig(unset VAD).RealtimeInputConfig = %+v, want nil", audioCfg.RealtimeInputConfig)
	}

	flashSpec := SessionSpec{
		Mode:           ModeAudio,
		Model:          "gemini-3.5-flash-live-preview",
		ProactiveAudio: Bool(true),
	}
	flashCfg, err := BuildConnectConfig(flashSpec)
	if err != nil {
		t.Fatalf("BuildConnectConfig(flashSpec) returned error: %v", err)
	}
	if flashCfg.Proactivity != nil {
		t.Errorf("BuildConnectConfig(gemini-3.5-flash-live-preview).Proactivity = %+v, want nil", flashCfg.Proactivity)
	}

	portraitURL := encodePNGDataURL(t, 704, 1280)
	avatarSpec := SessionSpec{
		Mode:            ModeAvatar,
		AvatarData:      portraitURL,
		VideoBitrateBps: Int32(1_000_000),
	}
	avatarCfg, err := BuildConnectConfig(avatarSpec)
	if err != nil {
		t.Fatalf("BuildConnectConfig(704x1280 avatar) returned error: %v", err)
	}
	if diff := cmp.Diff([]genai.Modality{genai.ModalityVideo}, avatarCfg.ResponseModalities); diff != "" {
		t.Errorf("BuildConnectConfig(ModeAvatar).ResponseModalities diff (-want +got):\n%s", diff)
	}
	if avatarCfg.AvatarConfig == nil || avatarCfg.AvatarConfig.CustomizedAvatar == nil {
		t.Fatalf("BuildConnectConfig(704x1280 avatar).AvatarConfig = %+v, want non-nil CustomizedAvatar", avatarCfg.AvatarConfig)
	}
	if got := *avatarCfg.AvatarConfig.VideoBitrateBps; got != 1_000_000 {
		t.Errorf("BuildConnectConfig(VideoBitrateBps=1000000) = %d, want 1000000", got)
	}

	squareURL := encodePNGDataURL(t, 1024, 1024)
	if _, err := BuildConnectConfig(SessionSpec{Mode: ModeAvatar, AvatarData: squareURL}); err == nil {
		t.Errorf("BuildConnectConfig(square 1024x1024) = nil error, want non-nil error")
	}
}

func TestDeclarationsFromPageTools_WebMCPStringAndObjectSchemas(t *testing.T) {
	tools := []PageTool{
		{
			Name:        "draw_node",
			Description: "Draws a node on the canvas.",
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
		t.Errorf("DeclarationsFromPageTools(tools) decls = %+v, want [draw_node] with ParametersJsonSchema", decls)
	}
	if len(rejected) != 1 || !strings.Contains(rejected[0], "evil_tool") {
		t.Errorf("DeclarationsFromPageTools(tools) rejected = %v, want [evil_tool: not on allowlist]", rejected)
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
		t.Fatalf("websocket.Dial(%q) failed: %v", srv.URL, err)
	}
	defer func() { _ = conn.Close() }()

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var info map[string]any
	if err := conn.ReadJSON(&info); err != nil || info["type"] != "session_info" {
		t.Fatalf("NewFixedHandler(ModeAudio) first frame = %+v (err=%v), want session_info", info, err)
	}

	fake.recvCh <- &genai.LiveServerMessage{SetupComplete: &genai.LiveServerSetupComplete{}}

	var alertFrame map[string]any
	if err := conn.ReadJSON(&alertFrame); err != nil || alertFrame["type"] != "proactive_alert" || alertFrame["id"] != "a-1" {
		t.Fatalf("NewFixedHandler(AlertBus) post-SetupComplete frame = %+v (err=%v), want proactive_alert id=a-1", alertFrame, err)
	}

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
		t.Fatalf("NewFixedHandler(PCM) announcement = %+v (err=%v), want media_config", mediaCfg, err)
	}
	msgType, pcm, err := conn.ReadMessage()
	if err != nil || msgType != websocket.BinaryMessage || len(pcm) != 4 {
		t.Errorf("NewFixedHandler(PCM) binary frame = (type=%d, len=%d, err=%v), want (BinaryMessage, 4, nil)", msgType, len(pcm), err)
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
			t.Fatalf("websocket.Dial(%q) failed: %v", srv.URL, err)
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
			t.Errorf("NewDynamicHandler(invalid avatar) closeErr = %v, want CloseInvalidFramePayloadData (1007)", closeErr)
		}
		if fc.connectHits != 0 {
			t.Errorf("NewDynamicHandler(invalid avatar) Connector.Connect calls = %d, want 0", fc.connectHits)
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
			t.Fatalf("websocket.Dial(%q) failed: %v", srv.URL, err)
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
			t.Fatalf("NewDynamicHandler(unapproved model) session_info = %+v (err=%v), want model=%q", info, err, DefaultModel)
		}

		fc.mu.Lock()
		dialedCfg := fc.lastCfg
		fc.mu.Unlock()
		if dialedCfg == nil || len(dialedCfg.Tools) != 1 || len(dialedCfg.Tools[0].FunctionDeclarations) != 1 {
			t.Errorf("NewDynamicHandler(AllowPageTools) LiveConnectConfig.Tools = %+v, want 1 FunctionDeclaration", dialedCfg)
		}
	})
}

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
