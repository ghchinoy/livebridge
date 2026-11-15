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
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"google.golang.org/genai"

	"github.com/ghchinoy/livebridge"
)

type toolFakeSession struct {
	mu       sync.Mutex
	recvCh   chan *genai.LiveServerMessage
	toolResp []*genai.FunctionResponse
	done     chan struct{}
}

func (s *toolFakeSession) SendRealtimeInput(genai.LiveSendRealtimeInputParameters) error {
	return nil
}

func (s *toolFakeSession) SendToolResponse(p genai.LiveSendToolResponseParameters) error {
	s.mu.Lock()
	s.toolResp = append(s.toolResp, p.FunctionResponses...)
	s.mu.Unlock()
	return nil
}

func (s *toolFakeSession) Receive() (*genai.LiveServerMessage, error) {
	select {
	case m := <-s.recvCh:
		return m, nil
	case <-s.done:
		return nil, io.EOF
	}
}

func (s *toolFakeSession) Close() error {
	select {
	case <-s.done:
	default:
		close(s.done)
	}
	return nil
}

type toolFakeConnector struct {
	mu      sync.Mutex
	session *toolFakeSession
	lastCfg *genai.LiveConnectConfig
}

func (c *toolFakeConnector) Connect(_ context.Context, _, _ string, cfg *genai.LiveConnectConfig) (livebridge.Session, error) {
	c.mu.Lock()
	c.lastCfg = cfg
	c.mu.Unlock()
	return c.session, nil
}

func TestCodeAssistant_ConfinementToolsAndAvatarQuery(t *testing.T) {
	root := t.TempDir()
	diagrams := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "hello.go"), []byte("package demo\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	reg, err := buildCodebaseRegistry(root, diagrams)
	if err != nil {
		t.Fatal(err)
	}

	// Verify workspace root confinement rejects ../ escapes.
	escapeRes := reg.Execute(context.Background(), "read_file", map[string]any{"path": "../secret.txt"})
	if _, hasErr := escapeRes["error"]; !hasErr {
		t.Fatalf("expected path escape error, got %+v", escapeRes)
	}

	// Verify end-to-end tool dispatch and ?avatar=Kira mode switch over WebSocket.
	sess := &toolFakeSession{recvCh: make(chan *genai.LiveServerMessage, 8), done: make(chan struct{})}
	fc := &toolFakeConnector{session: sess}
	mux, err := newAppMux(fc, root, diagrams, livebridge.DefaultModel)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/ws?avatar=Kira"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = conn.Close() }()

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	var info map[string]any
	if err := conn.ReadJSON(&info); err != nil || info["mode"] != "avatar" {
		t.Fatalf("expected avatar mode from ?avatar=Kira, got %+v (err=%v)", info, err)
	}

	sess.recvCh <- &genai.LiveServerMessage{
		ToolCall: &genai.LiveServerToolCall{
			FunctionCalls: []*genai.FunctionCall{{
				ID:   "call-read-1",
				Name: "read_file",
				Args: map[string]any{"path": "hello.go"},
			}},
		},
	}

	var toolEvt map[string]any
	if err := conn.ReadJSON(&toolEvt); err != nil || toolEvt["type"] != "tool_call" {
		t.Fatalf("expected tool_call frame, got %+v (err=%v)", toolEvt, err)
	}
	resMap, _ := toolEvt["result"].(map[string]any)
	if resMap["content"] != "package demo\n" {
		t.Fatalf("unexpected read_file content: %+v", resMap)
	}
}
