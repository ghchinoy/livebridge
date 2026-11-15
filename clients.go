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
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"

	"google.golang.org/genai"
)

// DefaultLocation is the default Google Cloud regional endpoint for Gemini Live.
const DefaultLocation = "us-central1"

// DefaultModel is the default Gemini Live model on Google Cloud.
const DefaultModel = "gemini-3.8-live"

// Session abstracts *genai.Session so the switchboard and tool runner can be
// tested hermetically without dialing the Gemini Live API.
type Session interface {
	SendRealtimeInput(genai.LiveSendRealtimeInputParameters) error
	SendToolResponse(genai.LiveSendToolResponseParameters) error
	Receive() (*genai.LiveServerMessage, error)
	Close() error
}

// Connector dials an upstream Gemini Live Bidi session.
type Connector interface {
	Connect(ctx context.Context, model, location string, config *genai.LiveConnectConfig) (Session, error)
}

// ClientPoolOptions configures a ClientPool for either Google Cloud (Vertex AI)
// or the Gemini Developer API (API key).
type ClientPoolOptions struct {
	// Backend selects genai.BackendVertexAI (default when ProjectID != "" or
	// APIKey == "") or genai.BackendGeminiAPI.
	Backend        genai.Backend
	ProjectID      string
	APIKey         string
	BaseURL        string
	KnownLocations []string
}

// ClientPool caches *genai.Client instances per location (or a single API-key
// client when configured with BackendGeminiAPI).
type ClientPool struct {
	mu             sync.Mutex
	backend        genai.Backend
	projectID      string
	apiKey         string
	baseURL        string
	knownLocations []string
	clients        map[string]*genai.Client
}

// NewClientPool creates a per-location Google Cloud *genai.Client cache.
func NewClientPool(projectID, baseURL string, knownLocations ...string) *ClientPool {
	return NewClientPoolWithOptions(ClientPoolOptions{
		Backend:        genai.BackendVertexAI,
		ProjectID:      projectID,
		BaseURL:        baseURL,
		KnownLocations: knownLocations,
	})
}

// NewGeminiAPIClientPool creates a *genai.Client pool authenticated with a
// Gemini Developer API key (audio & tool sessions without a GCP project).
func NewGeminiAPIClientPool(apiKey, baseURL string) *ClientPool {
	return NewClientPoolWithOptions(ClientPoolOptions{
		Backend: genai.BackendGeminiAPI,
		APIKey:  apiKey,
		BaseURL: baseURL,
	})
}

// NewClientPoolFromEnv constructs a ClientPool from standard environment
// variables: GOOGLE_CLOUD_PROJECT (preferred, Vertex AI) or GEMINI_API_KEY /
// GOOGLE_API_KEY when GOOGLE_CLOUD_PROJECT is unset or GOOGLE_GENAI_USE_VERTEXAI=false.
func NewClientPoolFromEnv() (*ClientPool, error) {
	projectID := strings.TrimSpace(os.Getenv("GOOGLE_CLOUD_PROJECT"))
	apiKey := strings.TrimSpace(os.Getenv("GEMINI_API_KEY"))
	if apiKey == "" {
		apiKey = strings.TrimSpace(os.Getenv("GOOGLE_API_KEY"))
	}
	baseURL := strings.TrimSpace(os.Getenv("GOOGLE_VERTEX_BASE_URL"))
	useVertex := strings.TrimSpace(os.Getenv("GOOGLE_GENAI_USE_VERTEXAI"))

	if strings.EqualFold(useVertex, "false") || (projectID == "" && apiKey != "") {
		if apiKey == "" {
			return nil, errors.New("livebridge: GEMINI_API_KEY or GOOGLE_CLOUD_PROJECT is required")
		}
		return NewGeminiAPIClientPool(apiKey, baseURL), nil
	}
	if projectID == "" {
		return nil, errors.New("livebridge: GOOGLE_CLOUD_PROJECT (or GEMINI_API_KEY) is required")
	}
	return NewClientPool(projectID, baseURL), nil
}

// NewClientPoolWithOptions constructs a ClientPool from explicit options.
func NewClientPoolWithOptions(opts ClientPoolOptions) *ClientPool {
	backend := opts.Backend
	if backend == genai.BackendUnspecified {
		backend = genai.BackendVertexAI
		if opts.ProjectID == "" && opts.APIKey != "" {
			backend = genai.BackendGeminiAPI
		}
	}
	known := opts.KnownLocations
	if len(known) == 0 {
		known = []string{DefaultLocation, "global"}
	}
	return &ClientPool{
		backend:        backend,
		projectID:      opts.ProjectID,
		apiKey:         opts.APIKey,
		baseURL:        opts.BaseURL,
		knownLocations: append([]string(nil), known...),
		clients:        make(map[string]*genai.Client),
	}
}

// Backend returns the configured genai.Backend for this pool.
func (p *ClientPool) Backend() genai.Backend {
	return p.backend
}

// ClientFor returns the cached *genai.Client for location, creating it on first
// use without holding the cache mutex across genai.NewClient. A process-wide
// background context is used intentionally so cloud.google.com/go/auth ADC
// token refresh outlives individual HTTP request contexts.
func (p *ClientPool) ClientFor(location string) (*genai.Client, error) {
	key := p.cacheKey(location)

	p.mu.Lock()
	cached, ok := p.clients[key]
	p.mu.Unlock()
	if ok {
		return cached, nil
	}

	created, err := genai.NewClient(context.Background(), p.clientConfig(key))
	if err != nil {
		return nil, fmt.Errorf("creating genai client for %q: %w", key, err)
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	if existing, ok := p.clients[key]; ok {
		return existing, nil
	}
	p.clients[key] = created
	return created, nil
}

// Connect dials a Gemini Live session for model and location. Note that
// genai's Live.Connect ignores ctx after dialing; callers must Close the
// returned Session explicitly.
func (p *ClientPool) Connect(ctx context.Context, model, location string, config *genai.LiveConnectConfig) (Session, error) {
	client, err := p.ClientFor(location)
	if err != nil {
		return nil, err
	}
	session, err := client.Live.Connect(ctx, model, config)
	if err != nil {
		return nil, fmt.Errorf("connecting to Live model %q in %q: %w", model, location, err)
	}
	return session, nil
}

// BaseURLForLocation rewrites the regional host prefix on *.googleapis.com
// endpoints ("us-central1-aiplatform.googleapis.com" <-> "aiplatform.googleapis.com")
// while leaving custom proxy hosts, ports, and URL paths untouched.
func BaseURLForLocation(base, location string, knownLocations ...string) string {
	if base == "" {
		return ""
	}
	u, err := url.Parse(base)
	if err != nil || u.Host == "" {
		return base
	}
	host := u.Hostname()
	if !strings.HasSuffix(strings.ToLower(host), ".googleapis.com") {
		return base
	}
	if len(knownLocations) == 0 {
		knownLocations = []string{DefaultLocation, "global"}
	}
	bareHost := host
	for _, loc := range append([]string{location}, knownLocations...) {
		if loc != "" && strings.HasPrefix(bareHost, loc+"-") {
			bareHost = strings.TrimPrefix(bareHost, loc+"-")
			break
		}
	}
	newHost := bareHost
	if location != "global" {
		newHost = location + "-" + bareHost
	}
	if port := u.Port(); port != "" {
		newHost += ":" + port
	}
	u.Host = newHost
	return u.String()
}

func (p *ClientPool) cacheKey(location string) string {
	if p.backend == genai.BackendGeminiAPI {
		return "gemini-api"
	}
	if location == "" {
		return DefaultLocation
	}
	return location
}

func (p *ClientPool) clientConfig(key string) *genai.ClientConfig {
	if p.backend == genai.BackendGeminiAPI {
		return &genai.ClientConfig{
			Backend:     genai.BackendGeminiAPI,
			APIKey:      p.apiKey,
			HTTPOptions: genai.HTTPOptions{BaseURL: p.baseURL},
		}
	}
	return &genai.ClientConfig{
		Backend:     genai.BackendVertexAI,
		Project:     p.projectID,
		Location:    key,
		HTTPOptions: genai.HTTPOptions{BaseURL: BaseURLForLocation(p.baseURL, key, p.knownLocations...)},
	}
}
