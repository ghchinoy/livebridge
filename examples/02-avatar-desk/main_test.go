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

func TestAvatarDesk_DynamicPresetCustomAndSquareRejection(t *testing.T) {
	cc := &captureConnector{}
	srv := httptest.NewServer(newMux(cc, livebridge.DefaultModel))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/config")
	if err != nil {
		t.Fatalf("http.Get(/api/config) failed: %v", err)
	}
	var cfgBody map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&cfgBody)
	_ = resp.Body.Close()
	if got := cfgBody["defaultModel"]; got != livebridge.DefaultModel {
		t.Errorf("newMux(/api/config) defaultModel = %v, want %q", got, livebridge.DefaultModel)
	}

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws"

	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("websocket.Dial(%q) failed: %v", wsURL, err)
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
		t.Fatalf("newMux(/ws, custom 704x1280) session_info = %+v (err=%v), want mode=\"avatar\"", info, err)
	}
	_ = conn.Close()

	cc.mu.Lock()
	dialed := cc.lastCfg
	cc.mu.Unlock()
	if dialed == nil || len(dialed.ResponseModalities) != 1 || dialed.ResponseModalities[0] != genai.ModalityVideo {
		t.Fatalf("newMux(/ws, ModeAvatar) ResponseModalities = %+v, want [VIDEO]", dialed)
	}
	if dialed.AvatarConfig == nil || dialed.AvatarConfig.CustomizedAvatar == nil {
		t.Errorf("newMux(/ws, custom 704x1280).AvatarConfig = %+v, want non-nil CustomizedAvatar", dialed.AvatarConfig)
	}

	badConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("websocket.Dial(%q) failed: %v", wsURL, err)
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
		t.Errorf("newMux(/ws, square 1024x1024) closeErr = %v, want CloseInvalidFramePayloadData (1007)", closeErr)
	}
}

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
		t.Fatalf("png.Encode(%dx%d) failed: %v", w, h, err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}
