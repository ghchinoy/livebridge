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

// Package browser embeds the compiled, zero-dependency @ghchinoy/livebridge ES
// module bundle so single-binary Go applications can serve LiveSession,
// LiveSocketClient, PcmMic, PcmPlayer, Fmp4Player, VisionCapture, and
// WebmcpToolHost directly without Node, npm, or a frontend bundler.
package browser

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"net/http"
	"strconv"
)

//go:embed dist/livebridge.esm.js
var bundleJS []byte

var bundleETag = computeETag(bundleJS)

// JS returns a copy of the embedded @ghchinoy/livebridge ES module bundle.
func JS() []byte {
	out := make([]byte, len(bundleJS))
	copy(out, bundleJS)
	return out
}

// ETag returns the quoted SHA-256 ETag header value for the embedded bundle.
func ETag() string {
	return bundleETag
}

// Handler returns an http.Handler serving the embedded ES module bundle with
// text/javascript MIME headers and conditional If-None-Match (304) support.
//
// Mount at e.g. mux.Handle("GET /livebridge.js", browser.Handler()) and import
// in HTML via:
//
//	<script type="module">
//	  import { LiveSession } from '/livebridge.js';
//	</script>
func Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("ETag", bundleETag)
		if r.Header.Get("If-None-Match") == bundleETag {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		w.Header().Set("Content-Length", strconv.Itoa(len(bundleJS)))
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusOK)
			return
		}
		_, _ = w.Write(bundleJS)
	})
}

func computeETag(b []byte) string {
	sum := sha256.Sum256(b)
	return `"` + hex.EncodeToString(sum[:12]) + `"`
}
