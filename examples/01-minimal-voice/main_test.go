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
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/genai"

	"github.com/ghchinoy/livebridge"
)

type stubSession struct {
	ch   chan *genai.LiveServerMessage
	done chan struct{}
}

func (s *stubSession) SendRealtimeInput(genai.LiveSendRealtimeInputParameters) error { return nil }
func (s *stubSession) SendToolResponse(genai.LiveSendToolResponseParameters) error   { return nil }
func (s *stubSession) Receive() (*genai.LiveServerMessage, error) {
	select {
	case m := <-s.ch:
		return m, nil
	case <-s.done:
		return nil, io.EOF
	}
}
func (s *stubSession) Close() error {
	select {
	case <-s.done:
	default:
		close(s.done)
	}
	return nil
}

type stubConnector struct{ s *stubSession }

func (c stubConnector) Connect(context.Context, string, string, *genai.LiveConnectConfig) (livebridge.Session, error) {
	return c.s, nil
}

func TestMinimalVoiceServer_RoutesAndWebSocket(t *testing.T) {
	sess := &stubSession{ch: make(chan *genai.LiveServerMessage, 4), done: make(chan struct{})}
	srv := httptest.NewServer(newMux(stubConnector{s: sess}, livebridge.DefaultModel, "Puck"))
	defer srv.Close()

	// 1. Verify HTML shell and embedded /livebridge.js serve cleanly.
	for _, path := range []string{"/", "/livebridge.js"} {
		resp, err := http.Get(srv.URL + path)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET %s status = %d", path, resp.StatusCode)
		}
	}

	// 2. Verify /ws/live bridges session_info and transcripts.
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/live"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial /ws/live: %v", err)
	}
	defer func() { _ = conn.Close() }()

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var info map[string]any
	if err := conn.ReadJSON(&info); err != nil || info["type"] != "session_info" {
		t.Fatalf("expected session_info, got %+v (err=%v)", info, err)
	}

	sess.ch <- &genai.LiveServerMessage{
		ServerContent: &genai.LiveServerContent{
			OutputTranscription: &genai.Transcription{Text: "Hello from Minimal Voice!", Finished: true},
		},
	}

	var transcript map[string]any
	if err := conn.ReadJSON(&transcript); err != nil || transcript["text"] != "Hello from Minimal Voice!" {
		t.Fatalf("expected output_transcript, got %+v (err=%v)", transcript, err)
	}
}
