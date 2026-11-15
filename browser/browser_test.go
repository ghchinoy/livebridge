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

package browser

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestEmbeddedBundle_ExportsSymbolsWithoutFrameworkDeps(t *testing.T) {
	js := JS()
	if len(js) < 1024 {
		t.Fatalf("embedded bundle unexpectedly small: %d bytes", len(js))
	}

	requiredExports := []string{
		"LiveSession",
		"LiveSocketClient",
		"PcmMic",
		"PcmPlayer",
		"Fmp4Player",
		"VisionCapture",
		"WebmcpToolHost",
		"prepareAvatarImage",
	}
	for _, sym := range requiredExports {
		if !bytes.Contains(js, []byte(sym)) {
			t.Errorf("embedded bundle missing expected export %q", sym)
		}
	}

	// Core browser bundle must remain 100% framework-free (zero Lit runtime).
	if bytes.Contains(js, []byte("lit-html")) || bytes.Contains(js, []byte("ReactiveElement")) {
		t.Fatal("core browser bundle must not bundle Lit")
	}
}

func TestHandler_ServesJSAndHonorsETag(t *testing.T) {
	h := Handler()

	req := httptest.NewRequest(http.MethodGet, "/livebridge.js", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("GET status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/javascript") {
		t.Fatalf("Content-Type = %q, want text/javascript", ct)
	}
	etag := rec.Header().Get("ETag")
	if etag == "" || etag != ETag() {
		t.Fatalf("unexpected ETag %q", etag)
	}
	if rec.Body.Len() != len(JS()) {
		t.Fatalf("body length = %d, want %d", rec.Body.Len(), len(JS()))
	}

	// Conditional GET with matching ETag returns 304.
	condReq := httptest.NewRequest(http.MethodGet, "/livebridge.js", nil)
	condReq.Header.Set("If-None-Match", etag)
	condRec := httptest.NewRecorder()
	h.ServeHTTP(condRec, condReq)
	if condRec.Code != http.StatusNotModified {
		t.Fatalf("conditional GET status = %d, want 304", condRec.Code)
	}
}
