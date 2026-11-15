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
		t.Fatalf("browser.JS() len = %d, want >= 1024", len(js))
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
			t.Errorf("browser.JS() missing symbol %q", sym)
		}
	}

	if bytes.Contains(js, []byte("lit-html")) || bytes.Contains(js, []byte("ReactiveElement")) {
		t.Errorf("browser.JS() contains Lit runtime symbols, want zero UI framework dependencies")
	}
}

func TestHandler_ServesJSAndHonorsETag(t *testing.T) {
	h := Handler()

	req := httptest.NewRequest(http.MethodGet, "/livebridge.js", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("browser.Handler().ServeHTTP(GET) status = %d, want %d", rec.Code, http.StatusOK)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/javascript") {
		t.Errorf("browser.Handler() Content-Type = %q, want prefix %q", ct, "text/javascript")
	}
	etag := rec.Header().Get("ETag")
	if etag == "" || etag != ETag() {
		t.Errorf("browser.Handler() ETag = %q, want %q", etag, ETag())
	}
	if rec.Body.Len() != len(JS()) {
		t.Errorf("browser.Handler() body len = %d, want %d", rec.Body.Len(), len(JS()))
	}

	condReq := httptest.NewRequest(http.MethodGet, "/livebridge.js", nil)
	condReq.Header.Set("If-None-Match", etag)
	condRec := httptest.NewRecorder()
	h.ServeHTTP(condRec, condReq)
	if condRec.Code != http.StatusNotModified {
		t.Errorf("browser.Handler().ServeHTTP(If-None-Match: %s) status = %d, want %d", etag, condRec.Code, http.StatusNotModified)
	}
}
