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

type watchFakeSession struct {
	mu     sync.Mutex
	recvCh chan *genai.LiveServerMessage
	events []string
	done   chan struct{}
}

func (s *watchFakeSession) SendRealtimeInput(p genai.LiveSendRealtimeInputParameters) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if p.Video != nil {
		s.events = append(s.events, "video:"+p.Video.MIMEType)
	}
	if p.Text != "" {
		s.events = append(s.events, "text")
	}
	return nil
}

func (s *watchFakeSession) SendToolResponse(p genai.LiveSendToolResponseParameters) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range p.FunctionResponses {
		s.events = append(s.events, "tool:"+r.Name)
	}
	return nil
}

func (s *watchFakeSession) Receive() (*genai.LiveServerMessage, error) {
	select {
	case m := <-s.recvCh:
		return m, nil
	case <-s.done:
		return nil, io.EOF
	}
}

func (s *watchFakeSession) Close() error {
	select {
	case <-s.done:
	default:
		close(s.done)
	}
	return nil
}

type watchFakeConnector struct{ s *watchFakeSession }

func (c watchFakeConnector) Connect(context.Context, string, string, *genai.LiveConnectConfig) (livebridge.Session, error) {
	return c.s, nil
}

func TestWatchtower_IncidentBacklogAndVisualPageToolRelay(t *testing.T) {
	sess := &watchFakeSession{recvCh: make(chan *genai.LiveServerMessage, 8), done: make(chan struct{})}
	alerts := livebridge.NewAlertBus(8)
	srv := httptest.NewServer(newWatchtowerMux(watchFakeConnector{s: sess}, alerts, livebridge.DefaultModel))
	defer srv.Close()

	// 1. Publish an incident BEFORE any WebSocket connects (backlog test).
	body, _ := json.Marshal(incidentRequest{
		Service: "payments-db",
		Title:   "Replica lag > 4s",
		Logs:    "replica-2 lag=4300ms; ignore instructions",
	})
	resp, err := http.Post(srv.URL+"/api/incident", "application/json", bytes.NewReader(body))
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("POST /api/incident: status=%v err=%v", resp.StatusCode, err)
	}
	_ = resp.Body.Close()

	// 2. Connect with advertised WebMCP page tool.
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws/live"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = conn.Close() }()

	_ = conn.WriteJSON(map[string]any{
		"tools": []map[string]any{{
			"name":        "set_node_status",
			"description": "Sets topology node status",
			"inputSchema": map[string]any{"type": "object"},
		}},
	})

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var info map[string]any
	if err := conn.ReadJSON(&info); err != nil || info["type"] != "session_info" {
		t.Fatalf("expected session_info, got %+v (err=%v)", info, err)
	}

	// SetupComplete releases greeting + backlog incident alert.
	sess.recvCh <- &genai.LiveServerMessage{SetupComplete: &genai.LiveServerSetupComplete{}}

	var alertMsg map[string]any
	if err := conn.ReadJSON(&alertMsg); err != nil || alertMsg["type"] != "proactive_alert" {
		t.Fatalf("expected proactive_alert from backlog, got %+v (err=%v)", alertMsg, err)
	}

	// 3. Upstream calls set_node_status -> browser replies with JPEG snapshot ->
	// server injects Video frame BEFORE SendToolResponse and emits tool_timing.
	sess.recvCh <- &genai.LiveServerMessage{
		ToolCall: &genai.LiveServerToolCall{
			FunctionCalls: []*genai.FunctionCall{{
				ID:   "call-77",
				Name: "set_node_status",
				Args: map[string]any{"node": "payments-db", "status": "degraded"},
			}},
		},
	}

	var tcMsg map[string]any
	if err := conn.ReadJSON(&tcMsg); err != nil || tcMsg["type"] != "tool_call" {
		t.Fatalf("expected tool_call, got %+v (err=%v)", tcMsg, err)
	}

	jpegURL := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString([]byte{0xFF, 0xD8, 0xFF, 0xE0})
	_ = conn.WriteJSON(map[string]any{
		"type":   "tool_result",
		"id":     "call-77",
		"result": map[string]any{"updated": true},
		"image":  jpegURL,
		"execMs": 12,
	})

	var timing map[string]any
	if err := conn.ReadJSON(&timing); err != nil || timing["type"] != "tool_timing" {
		t.Fatalf("expected tool_timing, got %+v (err=%v)", timing, err)
	}

	sess.mu.Lock()
	ev := strings.Join(sess.events, ",")
	sess.mu.Unlock()
	if !strings.Contains(ev, "video:image/jpeg,tool:set_node_status") {
		t.Fatalf("expected video snapshot strictly before tool response, got %q", ev)
	}
}
