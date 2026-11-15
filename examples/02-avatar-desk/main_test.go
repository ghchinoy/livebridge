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

package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/genai"

	"github.com/ghchinoy/livebridge"
)

type captureConnector struct {
	mu      sync.Mutex
	lastCfg *genai.LiveConnectConfig
}

type noopSession struct{ done chan struct{} }

func (s *noopSession) SendRealtimeInput(genai.LiveSendRealtimeInputParameters) error { return nil }
func (s *noopSession) SendToolResponse(genai.LiveSendToolResponseParameters) error   { return nil }
func (s *noopSession) Receive() (*genai.LiveServerMessage, error) {
	<-s.done
	return nil, io.EOF
}
func (s *noopSession) Close() error {
	select {
	case <-s.done:
	default:
		close(s.done)
	}
	return nil
}

func (c *captureConnector) Connect(_ context.Context, _, _ string, cfg *genai.LiveConnectConfig) (livebridge.Session, error) {
	c.mu.Lock()
	c.lastCfg = cfg
	c.mu.Unlock()
	return &noopSession{done: make(chan struct{})}, nil
}

func makePNGDataURL(t *testing.T, w, h int) string {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

func TestAvatarDesk_DynamicPresetCustomAndSquareRejection(t *testing.T) {
	cc := &captureConnector{}
	srv := httptest.NewServer(newMux(cc, livebridge.DefaultModel))
	defer srv.Close()

	// 1. /api/config returns presets.
	resp, err := http.Get(srv.URL + "/api/config")
	if err != nil {
		t.Fatalf("GET /api/config: %v", err)
	}
	var cfgBody map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&cfgBody)
	_ = resp.Body.Close()
	if cfgBody["defaultModel"] != livebridge.DefaultModel {
		t.Fatalf("unexpected /api/config: %+v", cfgBody)
	}

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"

	// 2. Valid custom 704x1280 portrait avatar configures ModalityVideo + CustomizedAvatar.
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial /ws: %v", err)
	}
	_ = conn.WriteJSON(map[string]any{
		"mode":       "avatar",
		"avatarType": "custom",
		"avatarData": makePNGDataURL(t, 704, 1280),
		"voiceName":  "Aoede",
	})
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var info map[string]any
	if err := conn.ReadJSON(&info); err != nil || info["mode"] != "avatar" {
		t.Fatalf("expected avatar session_info, got %+v (err=%v)", info, err)
	}
	_ = conn.Close()

	cc.mu.Lock()
	dialed := cc.lastCfg
	cc.mu.Unlock()
	if dialed == nil || len(dialed.ResponseModalities) != 1 || dialed.ResponseModalities[0] != genai.ModalityVideo {
		t.Fatalf("expected [VIDEO] modality, got %+v", dialed)
	}
	if dialed.AvatarConfig == nil || dialed.AvatarConfig.CustomizedAvatar == nil {
		t.Fatal("expected CustomizedAvatar populated")
	}

	// 3. Square 1024x1024 custom avatar fails pre-dial with 1007.
	badConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial /ws: %v", err)
	}
	defer func() { _ = badConn.Close() }()
	_ = badConn.WriteJSON(map[string]any{
		"mode":       "avatar",
		"avatarData": makePNGDataURL(t, 1024, 1024),
	})
	_ = badConn.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, _, closeErr := badConn.ReadMessage()
	var ce *websocket.CloseError
	if !errors.As(closeErr, &ce) || ce.Code != websocket.CloseInvalidFramePayloadData {
		t.Fatalf("expected 1007 close for square avatar, got %v", closeErr)
	}
}
