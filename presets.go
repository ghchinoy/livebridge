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
	"slices"
	"strings"
)

const presetAvatarCDNBase = "https://www.gstatic.com/pantheon/images/aiplatform/vertex_ai_studio/avatars"

// PresetAvatars lists the built-in Gemini Live talking avatar preset names
// accepted by AvatarConfig.AvatarName (distinct from PrebuiltVoices).
var PresetAvatars = []string{
	"Ben",
	"Carmen",
	"Ingrid",
	"Jay",
	"Kai",
	"Kira",
	"Leo",
	"Paul",
	"Piper",
	"Sam",
	"Vera",
}

// PrebuiltVoices lists the 30 Gemini Live prebuilt voice identifiers accepted
// by SpeechConfig.VoiceConfig.PrebuiltVoiceConfig.VoiceName.
var PrebuiltVoices = []string{
	"Achernar",
	"Achird",
	"Algenib",
	"Algieba",
	"Alnilam",
	"Aoede",
	"Autonoe",
	"Callirrhoe",
	"Charon",
	"Despina",
	"Enceladus",
	"Erinome",
	"Fenrir",
	"Gacrux",
	"Iapetus",
	"Kore",
	"Laomedeia",
	"Leda",
	"Orus",
	"Puck",
	"Pulcherrima",
	"Rasalgethi",
	"Sadachbia",
	"Sadaltager",
	"Schedar",
	"Sulafat",
	"Umbriel",
	"Vindemiatrix",
	"Zephyr",
	"Zubenelgenubi",
}

// PresetAvatarVoices maps each built-in PresetAvatar name to its recommended
// companion PrebuiltVoice.
var PresetAvatarVoices = map[string]string{
	"Ben":    "Puck",
	"Carmen": "Laomedeia",
	"Ingrid": "Kore",
	"Jay":    "Puck",
	"Kai":    "Fenrir",
	"Kira":   "Aoede",
	"Leo":    "Orus",
	"Paul":   "Charon",
	"Piper":  "Autonoe",
	"Sam":    "Schedar",
	"Vera":   "Erinome",
}

// IsPresetAvatar reports whether name is a known built-in Gemini Live avatar preset.
func IsPresetAvatar(name string) bool {
	return slices.Contains(PresetAvatars, strings.TrimSpace(name))
}

// IsPrebuiltVoice reports whether name is a known Gemini Live prebuilt voice.
func IsPrebuiltVoice(name string) bool {
	return slices.Contains(PrebuiltVoices, strings.TrimSpace(name))
}

// DefaultVoiceForAvatar returns the recommended voice for a built-in avatar
// preset, or "" when avatarName is unknown.
func DefaultVoiceForAvatar(avatarName string) string {
	return PresetAvatarVoices[strings.TrimSpace(avatarName)]
}

// PresetAvatarImageURL returns the Google Cloud Studio CDN portrait thumbnail
// URL for a built-in preset avatar.
func PresetAvatarImageURL(name string) string {
	key := strings.ToLower(strings.TrimSpace(name))
	if key == "carmen" {
		return presetAvatarCDNBase + "/carmen_2.png"
	}
	return presetAvatarCDNBase + "/" + key + ".png"
}
