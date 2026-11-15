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
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// TestLiveSmoke exercises real Gemini Live Bidi streaming (both ModeAudio and
// ModeAvatar) through NewFixedHandler + Bridge when GEMINI_LIVE_SMOKE=1.
func TestLiveSmoke(t *testing.T) {
	if os.Getenv("GEMINI_LIVE_SMOKE") == "" {
		t.Skip("set GEMINI_LIVE_SMOKE=1 to run live Gemini API smoke tests")
	}

	clients, err := NewClientPoolFromEnv()
	if err != nil {
		t.Fatalf("NewClientPoolFromEnv: %v", err)
	}
	model := os.Getenv("GEMINI_LIVE_MODEL")
	if model == "" {
		model = DefaultModel
	}

	t.Run("audio", func(t *testing.T) {
		srv := httptest.NewServer(NewFixedHandler(FixedHandlerConfig{
			Connector: clients,
			Spec: SessionSpec{
				Mode:           ModeAudio,
				Model:          model,
				VoiceName:      "Puck",
				WelcomeMessage: "Say hello in three words.",
			},
		}))
		defer srv.Close()

		conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer func() { _ = conn.Close() }()

		waitForBinaryMedia(t, conn, "audio/pcm")
	})

	t.Run("avatar_preset", func(t *testing.T) {
		srv := httptest.NewServer(NewFixedHandler(FixedHandlerConfig{
			Connector: clients,
			Spec: SessionSpec{
				Mode:           ModeAvatar,
				Model:          model,
				AvatarType:     "preset",
				AvatarData:     "Kira",
				VoiceName:      "Kore",
				WelcomeMessage: "Say hi briefly.",
			},
		}))
		defer srv.Close()

		conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer func() { _ = conn.Close() }()

		waitForBinaryMedia(t, conn, "video/mp4")
	})
}

func waitForBinaryMedia(t *testing.T, conn *websocket.Conn, wantMimePrefix string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	_ = conn.SetReadDeadline(time.Now().Add(25 * time.Second))

	sawConfig := false
	for ctx.Err() == nil {
		msgType, data, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("reading frame: %v", err)
		}
		if msgType == websocket.TextMessage && strings.Contains(string(data), `"media_config"`) {
			if !strings.Contains(string(data), wantMimePrefix) {
				t.Fatalf("unexpected media_config: %s", string(data))
			}
			sawConfig = true
		}
		if msgType == websocket.BinaryMessage && len(data) > 0 {
			if !sawConfig {
				t.Fatal("received binary media frame before media_config")
			}
			return
		}
	}
	t.Fatal("timed out waiting for binary media")
}
