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
	"fmt"
	"log/slog"
	"strings"

	"google.golang.org/genai"
)

// Bool returns a pointer to v for populating optional SessionSpec flags.
func Bool(v bool) *bool { return &v }

// Float32 returns a pointer to v for populating optional SessionSpec sampling parameters.
func Float32(v float32) *float32 { return &v }

// Int32 returns a pointer to v for populating optional SessionSpec bitrates.
func Int32(v int32) *int32 { return &v }

// SessionSpec describes the desired Gemini Live session configuration. It can
// be constructed statically in Go (FixedHandlerConfig) or unmarshaled from a
// browser's initial WebSocket setup frame and merged with server defaults
// (DynamicHandlerConfig).
type SessionSpec struct {
	Mode     Mode   `json:"mode,omitempty"`
	Model    string `json:"liveModel,omitempty"`
	Location string `json:"liveLocation,omitempty"`

	// AvatarType is "preset" or "custom" when Mode == ModeAvatar. When empty,
	// BuildConnectConfig infers "custom" if AvatarData starts with "data:",
	// otherwise "preset".
	AvatarType string `json:"avatarType,omitempty"`
	// AvatarData holds either a preset avatar identifier (e.g. "Kira") or a
	// base64 PNG/JPEG data URL ("data:image/jpeg;base64,...").
	AvatarData string `json:"avatarData,omitempty"`
	// ValidateAvatarDimensions defaults to true and verifies custom PNG/JPEG
	// dimensions (>=704x1280 portrait or >=1280x704 landscape, non-square)
	// before dialing the Live API. Set Bool(false) only in synthetic unit tests.
	ValidateAvatarDimensions *bool  `json:"-"`
	VideoBitrateBps          *int32 `json:"videoBitrateBps,omitempty"`
	AudioBitrateBps          *int32 `json:"audioBitrateBps,omitempty"`

	VoiceName       string                       `json:"voiceName,omitempty"`
	ReplicatedVoice *genai.ReplicatedVoiceConfig `json:"-"`
	LanguageCode    string                       `json:"languageCode,omitempty"`

	// WelcomeMessage, when non-empty and GreetingPrompt is empty, instructs the
	// model on SetupComplete to proactively speak this exact welcome line.
	WelcomeMessage    string   `json:"welcomeMessage,omitempty"`
	GreetingPrompt    string   `json:"-"`
	SystemInstruction string   `json:"systemInstruction,omitempty"`
	GroundingContext  string   `json:"groundingContext,omitempty"`
	AdaptationPhrases []string `json:"adaptationPhrases,omitempty"`

	SilenceDurationMs        int32  `json:"silenceDurationMs,omitempty"`
	PrefixPaddingMs          int32  `json:"prefixPaddingMs,omitempty"`
	StartOfSpeechSensitivity string `json:"startOfSpeechSensitivity,omitempty"`
	EndOfSpeechSensitivity   string `json:"endOfSpeechSensitivity,omitempty"`
	ActivityHandling         string `json:"activityHandling,omitempty"`

	Temperature     *float32 `json:"temperature,omitempty"`
	TopP            *float32 `json:"topP,omitempty"`
	TopK            *float32 `json:"topK,omitempty"`
	MaxOutputTokens int32    `json:"maxOutputTokens,omitempty"`

	EnableGoogleSearch       *bool `json:"enableGoogleSearch,omitempty"`
	EnableToolCalling        *bool `json:"enableToolCalling,omitempty"`
	ProactiveAudio           *bool `json:"proactiveAudio,omitempty"`
	ContextWindowCompression *bool `json:"contextWindowCompression,omitempty"`
	CompressionTriggerTokens int64 `json:"compressionTriggerTokens,omitempty"`

	// PageTools carries browser-advertised (e.g. WebMCP) tool definitions from
	// the initial setup JSON frame.
	PageTools []PageTool `json:"tools,omitempty"`

	// ServerDeclarations supplies server-registered FunctionDeclarations (such
	// as FuncRegistry.Declarations()).
	ServerDeclarations []*genai.FunctionDeclaration `json:"-"`
	// PageDeclarations supplies validated FunctionDeclarations converted via
	// DeclarationsFromPageTools.
	PageDeclarations []*genai.FunctionDeclaration `json:"-"`
}

// EffectiveGreetingPrompt returns GreetingPrompt if set, else wraps
// WelcomeMessage in a proactive introduction prompt, or "" if neither is set.
func (s SessionSpec) EffectiveGreetingPrompt() string {
	if p := strings.TrimSpace(s.GreetingPrompt); p != "" {
		return p
	}
	if w := strings.TrimSpace(s.WelcomeMessage); w != "" {
		return "Proactively introduce yourself now. Say exactly this: " + w
	}
	return ""
}

// MergeSessionSpec overlays non-zero fields from client onto base while
// restricting Model and Location to server allowlists via ResolveAllowed.
func MergeSessionSpec(base, client SessionSpec, allowedModels, allowedLocations []string) SessionSpec {
	out := base
	defModel := out.Model
	if defModel == "" {
		defModel = DefaultModel
	}
	defLoc := out.Location
	if defLoc == "" {
		defLoc = DefaultLocation
	}
	out.Model = ResolveAllowed("live model", client.Model, defModel, allowedModels)
	out.Location = ResolveAllowed("location", client.Location, defLoc, allowedLocations)

	if client.Mode == ModeAudio || client.Mode == ModeAvatar {
		out.Mode = client.Mode
	}
	if out.Mode == "" {
		out.Mode = ModeAudio
	}
	if client.AvatarData != "" {
		out.AvatarData = client.AvatarData
		if client.AvatarType == "" {
			out.AvatarType = inferAvatarType(client.AvatarData)
		}
	}
	if client.AvatarType != "" {
		out.AvatarType = client.AvatarType
	}
	if client.VideoBitrateBps != nil {
		out.VideoBitrateBps = client.VideoBitrateBps
	}
	if client.AudioBitrateBps != nil {
		out.AudioBitrateBps = client.AudioBitrateBps
	}
	if client.VoiceName != "" {
		out.VoiceName = client.VoiceName
	}
	if client.LanguageCode != "" {
		out.LanguageCode = client.LanguageCode
	}
	if client.WelcomeMessage != "" {
		out.WelcomeMessage = client.WelcomeMessage
		out.GreetingPrompt = ""
	}
	if client.SystemInstruction != "" {
		out.SystemInstruction = client.SystemInstruction
	}
	if client.GroundingContext != "" {
		out.GroundingContext = client.GroundingContext
	}
	if len(client.AdaptationPhrases) > 0 {
		out.AdaptationPhrases = client.AdaptationPhrases
	}
	if client.SilenceDurationMs > 0 {
		out.SilenceDurationMs = client.SilenceDurationMs
	}
	if client.PrefixPaddingMs > 0 {
		out.PrefixPaddingMs = client.PrefixPaddingMs
	}
	if client.StartOfSpeechSensitivity != "" {
		out.StartOfSpeechSensitivity = client.StartOfSpeechSensitivity
	}
	if client.EndOfSpeechSensitivity != "" {
		out.EndOfSpeechSensitivity = client.EndOfSpeechSensitivity
	}
	if client.ActivityHandling != "" {
		out.ActivityHandling = client.ActivityHandling
	}
	if client.Temperature != nil {
		out.Temperature = client.Temperature
	}
	if client.TopP != nil {
		out.TopP = client.TopP
	}
	if client.TopK != nil {
		out.TopK = client.TopK
	}
	if client.MaxOutputTokens > 0 {
		out.MaxOutputTokens = client.MaxOutputTokens
	}
	if client.EnableGoogleSearch != nil {
		out.EnableGoogleSearch = client.EnableGoogleSearch
	}
	if client.EnableToolCalling != nil {
		out.EnableToolCalling = client.EnableToolCalling
	}
	if client.ProactiveAudio != nil {
		out.ProactiveAudio = client.ProactiveAudio
	}
	if client.ContextWindowCompression != nil {
		out.ContextWindowCompression = client.ContextWindowCompression
	}
	if client.CompressionTriggerTokens > 0 {
		out.CompressionTriggerTokens = client.CompressionTriggerTokens
	}
	if len(client.PageTools) > 0 {
		out.PageTools = client.PageTools
	}
	return out
}

// BuildConnectConfig translates spec into a validated *genai.LiveConnectConfig
// enforcing Gemini Live modality, avatar, voice, proactivity, VAD, and
// context-compression invariants.
//
// Only an invalid or missing avatar in ModeAvatar returns a hard error;
// malformed optional values (language code, voice, sampling ranges, VAD enums)
// are logged and dropped so server defaults apply cleanly.
func BuildConnectConfig(spec SessionSpec) (*genai.LiveConnectConfig, error) {
	mode := spec.Mode
	if mode == "" {
		mode = ModeAudio
	}

	var avatarCfg *genai.AvatarConfig
	modality := genai.ModalityAudio
	if mode == ModeAvatar {
		var err error
		avatarCfg, err = buildAvatarConfig(spec)
		if err != nil {
			return nil, err
		}
		// VIDEO must be requested alone; [AUDIO, VIDEO] fails upstream with 1007
		// because avatar audio is muxed inside the fMP4 stream.
		modality = genai.ModalityVideo
	}

	languageCode := resolveLanguageCode(spec.LanguageCode)
	instruction := buildSystemInstruction(spec)
	voiceCfg := buildVoiceConfig(spec)

	cfg := &genai.LiveConnectConfig{
		ResponseModalities: []genai.Modality{modality},
		SystemInstruction: &genai.Content{
			Parts: []*genai.Part{{Text: instruction}},
		},
		AvatarConfig: avatarCfg,
		SpeechConfig: &genai.SpeechConfig{
			VoiceConfig:  voiceCfg,
			LanguageCode: languageCode,
		},
		InputAudioTranscription: &genai.AudioTranscriptionConfig{
			LanguageCodes:     []string{languageCode},
			AdaptationPhrases: cleanAdaptationPhrases(spec.AdaptationPhrases),
		},
		OutputAudioTranscription: &genai.AudioTranscriptionConfig{
			LanguageCodes: []string{languageCode},
		},
		Tools:                    buildToolsConfig(spec),
		ContextWindowCompression: buildCompressionConfig(spec),
		RealtimeInputConfig:      buildRealtimeInputConfig(spec),
	}

	applySamplingConfig(cfg, spec)
	applyProactivityConfig(cfg, spec)
	return cfg, nil
}

func inferAvatarType(avatarData string) string {
	if strings.HasPrefix(strings.TrimSpace(avatarData), "data:") {
		return "custom"
	}
	return "preset"
}

func buildAvatarConfig(spec SessionSpec) (*genai.AvatarConfig, error) {
	avatarType := strings.ToLower(strings.TrimSpace(spec.AvatarType))
	data := strings.TrimSpace(spec.AvatarData)
	if avatarType == "" {
		avatarType = inferAvatarType(data)
	}

	var cfg *genai.AvatarConfig
	switch avatarType {
	case "preset":
		if !ValidPresetName(data) {
			return nil, fmt.Errorf("invalid preset avatar name %q", TruncateRunes(data, MaxLoggedValueRunes))
		}
		if IsPrebuiltVoice(data) && !IsPresetAvatar(data) {
			return nil, fmt.Errorf("preset avatar %q is a voiceName, not an avatar preset (use Kira, Jay, Ingrid, Paul, Vera, Sam, Ben, Kai, Leo, Carmen, or Piper)", data)
		}
		cfg = &genai.AvatarConfig{AvatarName: data}
	case "custom":
		mimeType, imgBytes, err := ParseImageDataURL(data, AvatarImageMIMETypes)
		if err != nil {
			return nil, fmt.Errorf("invalid custom avatar image: %w", err)
		}
		checkDims := spec.ValidateAvatarDimensions == nil || *spec.ValidateAvatarDimensions
		if checkDims {
			w, h, dimErr := ParseImageDimensions(imgBytes)
			if dimErr != nil {
				return nil, fmt.Errorf("invalid custom avatar image: %w", dimErr)
			}
			if err := ValidateCustomAvatarDimensions(w, h); err != nil {
				return nil, err
			}
		}
		cfg = &genai.AvatarConfig{
			CustomizedAvatar: &genai.CustomizedAvatar{
				ImageMIMEType: mimeType,
				ImageData:     imgBytes,
			},
		}
	default:
		return nil, fmt.Errorf("unknown avatarType %q (want \"preset\" or \"custom\")", TruncateRunes(spec.AvatarType, MaxLoggedValueRunes))
	}

	if spec.VideoBitrateBps != nil && *spec.VideoBitrateBps > 0 {
		cfg.VideoBitrateBps = spec.VideoBitrateBps
	}
	if spec.AudioBitrateBps != nil && *spec.AudioBitrateBps > 0 {
		cfg.AudioBitrateBps = spec.AudioBitrateBps
	}
	return cfg, nil
}

func buildVoiceConfig(spec SessionSpec) *genai.VoiceConfig {
	if spec.ReplicatedVoice != nil {
		return &genai.VoiceConfig{
			ReplicatedVoiceConfig: spec.ReplicatedVoice,
		}
	}
	voice := strings.TrimSpace(spec.VoiceName)
	if voice != "" && !ValidPresetName(voice) {
		slog.Warn("ignoring invalid voiceName; using server default voice", "value", TruncateRunes(voice, MaxLoggedValueRunes))
		voice = ""
	}
	if voice == "" && spec.Mode == ModeAvatar {
		voice = DefaultVoiceForAvatar(spec.AvatarData)
	}
	return &genai.VoiceConfig{
		PrebuiltVoiceConfig: &genai.PrebuiltVoiceConfig{VoiceName: voice},
	}
}

func resolveLanguageCode(requested string) string {
	code := strings.TrimSpace(requested)
	if code != "" && !ValidLanguageCode(code) {
		slog.Warn("ignoring invalid languageCode", "value", TruncateRunes(code, MaxLoggedValueRunes))
		code = ""
	}
	if code == "" {
		return "en-US"
	}
	return code
}

func cleanAdaptationPhrases(phrases []string) []string {
	var cleaned []string
	for _, phrase := range phrases {
		if len(cleaned) == MaxAdaptationPhrases {
			slog.Warn("ignoring extra adaptationPhrases", "max", MaxAdaptationPhrases)
			break
		}
		if trimmed := TruncateRunes(strings.TrimSpace(phrase), MaxAdaptationPhraseLen); trimmed != "" {
			cleaned = append(cleaned, trimmed)
		}
	}
	return cleaned
}

func buildSystemInstruction(spec SessionSpec) string {
	instruction := TruncateRunes(strings.TrimSpace(spec.SystemInstruction), MaxSystemInstructionChars)
	if instruction == "" {
		instruction = "You are a helpful AI assistant."
	}
	if grounding := strings.TrimSpace(spec.GroundingContext); grounding != "" {
		instruction += "\n\nUse the following reference material to answer questions when it's relevant:\n" +
			TruncateRunes(grounding, MaxGroundingContextChars)
	}
	return instruction
}

func buildToolsConfig(spec SessionSpec) []*genai.Tool {
	includeSearch := spec.EnableGoogleSearch != nil && *spec.EnableGoogleSearch
	allowTools := spec.EnableToolCalling == nil || *spec.EnableToolCalling

	var decls []*genai.FunctionDeclaration
	if allowTools {
		decls = append(decls, spec.ServerDeclarations...)
		decls = append(decls, spec.PageDeclarations...)
	}
	if !includeSearch && len(decls) == 0 {
		return nil
	}
	tool := &genai.Tool{}
	if includeSearch {
		tool.GoogleSearch = &genai.GoogleSearch{}
	}
	if len(decls) > 0 {
		tool.FunctionDeclarations = decls
	}
	return []*genai.Tool{tool}
}

func applySamplingConfig(cfg *genai.LiveConnectConfig, spec SessionSpec) {
	cfg.Temperature = clampFloatOption("temperature (want 0..2)", spec.Temperature, 0, 2)
	cfg.TopP = clampFloatOption("topP (want 0..1)", spec.TopP, 0, 1)
	cfg.TopK = clampFloatOption("topK (want 1..1000)", spec.TopK, 1, 1000)
	if spec.MaxOutputTokens > 0 {
		cfg.MaxOutputTokens = spec.MaxOutputTokens
	}
}

func clampFloatOption(label string, v *float32, lo, hi float32) *float32 {
	if v == nil {
		return nil
	}
	if InRange(v, lo, hi) {
		return v
	}
	slog.Warn("ignoring out-of-range "+label, "value", *v)
	return nil
}

func applyProactivityConfig(cfg *genai.LiveConnectConfig, spec SessionSpec) {
	if spec.ProactiveAudio == nil || !*spec.ProactiveAudio {
		return
	}
	if !SupportsProactiveAudio(spec.Model, DefaultModel) {
		slog.Warn("ignoring proactiveAudio: only supported on 3.8 and lite models", "model", spec.Model)
		return
	}
	proactive := true
	cfg.Proactivity = &genai.ProactivityConfig{ProactiveAudio: &proactive}
}

func buildCompressionConfig(spec SessionSpec) *genai.ContextWindowCompressionConfig {
	if spec.ContextWindowCompression != nil && !*spec.ContextWindowCompression {
		return nil
	}
	if (spec.ContextWindowCompression == nil || !*spec.ContextWindowCompression) && spec.CompressionTriggerTokens <= 0 {
		return nil
	}
	compression := &genai.ContextWindowCompressionConfig{
		SlidingWindow: &genai.SlidingWindow{},
	}
	if spec.CompressionTriggerTokens > 0 {
		trigger := spec.CompressionTriggerTokens
		compression.TriggerTokens = &trigger
	}
	return compression
}

func buildRealtimeInputConfig(spec SessionSpec) *genai.RealtimeInputConfig {
	var detection *genai.AutomaticActivityDetection
	if spec.SilenceDurationMs > 0 || spec.PrefixPaddingMs > 0 || spec.StartOfSpeechSensitivity != "" || spec.EndOfSpeechSensitivity != "" {
		detection = &genai.AutomaticActivityDetection{}
		if spec.SilenceDurationMs > 0 {
			silence := spec.SilenceDurationMs
			detection.SilenceDurationMs = &silence
		}
		if spec.PrefixPaddingMs > 0 {
			prefix := spec.PrefixPaddingMs
			detection.PrefixPaddingMs = &prefix
		}
		detection.StartOfSpeechSensitivity = resolveStartSensitivity(spec.StartOfSpeechSensitivity)
		detection.EndOfSpeechSensitivity = resolveEndSensitivity(spec.EndOfSpeechSensitivity)
	}

	activityHandling := resolveActivityHandling(spec.ActivityHandling)
	if detection == nil && activityHandling == "" {
		return nil
	}
	return &genai.RealtimeInputConfig{
		AutomaticActivityDetection: detection,
		ActivityHandling:           activityHandling,
	}
}

func resolveStartSensitivity(raw string) genai.StartSensitivity {
	if raw == "" {
		return ""
	}
	if ValidStartSensitivity[raw] {
		return genai.StartSensitivity(raw)
	}
	slog.Warn("ignoring unknown startOfSpeechSensitivity", "value", TruncateRunes(raw, MaxLoggedValueRunes))
	return ""
}

func resolveEndSensitivity(raw string) genai.EndSensitivity {
	if raw == "" {
		return ""
	}
	if ValidEndSensitivity[raw] {
		return genai.EndSensitivity(raw)
	}
	slog.Warn("ignoring unknown endOfSpeechSensitivity", "value", TruncateRunes(raw, MaxLoggedValueRunes))
	return ""
}

func resolveActivityHandling(raw string) genai.ActivityHandling {
	if raw == "" {
		return ""
	}
	if ValidActivityHandling[raw] {
		return genai.ActivityHandling(raw)
	}
	slog.Warn("ignoring unknown activityHandling", "value", TruncateRunes(raw, MaxLoggedValueRunes))
	return ""
}
