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

const PRESET_AVATAR_CDN_BASE =
  'https://www.gstatic.com/pantheon/images/aiplatform/vertex_ai_studio/avatars';

/**
 * Built-in Gemini Live talking avatar preset identifiers accepted by
 * `AvatarConfig.avatarName` (distinct from `PREBUILT_VOICES`).
 */
export const PRESET_AVATARS = [
  'Ben',
  'Carmen',
  'Ingrid',
  'Jay',
  'Kai',
  'Kira',
  'Leo',
  'Paul',
  'Piper',
  'Sam',
  'Vera',
] as const;

export type PresetAvatarName = (typeof PRESET_AVATARS)[number];

/**
 * Gemini Live prebuilt speech voice identifiers accepted by `voiceName`.
 */
export const PREBUILT_VOICES = [
  'Achernar',
  'Achird',
  'Algenib',
  'Algieba',
  'Alnilam',
  'Aoede',
  'Autonoe',
  'Callirrhoe',
  'Charon',
  'Despina',
  'Enceladus',
  'Erinome',
  'Fenrir',
  'Gacrux',
  'Iapetus',
  'Kore',
  'Laomedeia',
  'Leda',
  'Orus',
  'Puck',
  'Pulcherrima',
  'Rasalgethi',
  'Sadachbia',
  'Sadaltager',
  'Schedar',
  'Sulafat',
  'Umbriel',
  'Vindemiatrix',
  'Zephyr',
  'Zubenelgenubi',
] as const;

export type PrebuiltVoiceName = (typeof PREBUILT_VOICES)[number];

/**
 * Recommended companion `voiceName` for each built-in `PresetAvatarName`.
 */
export const PRESET_AVATAR_VOICES: Readonly<
  Record<PresetAvatarName, PrebuiltVoiceName>
> = {
  Ben: 'Puck',
  Carmen: 'Laomedeia',
  Ingrid: 'Kore',
  Jay: 'Puck',
  Kai: 'Fenrir',
  Kira: 'Aoede',
  Leo: 'Orus',
  Paul: 'Charon',
  Piper: 'Autonoe',
  Sam: 'Schedar',
  Vera: 'Erinome',
};

export function isPresetAvatar(name: string): name is PresetAvatarName {
  return (PRESET_AVATARS as readonly string[]).includes(name.trim());
}

export function isPrebuiltVoice(name: string): name is PrebuiltVoiceName {
  return (PREBUILT_VOICES as readonly string[]).includes(name.trim());
}

export function defaultVoiceForAvatar(avatarName: string): string {
  return (
    (PRESET_AVATAR_VOICES as Readonly<Record<string, string>>)[
      avatarName.trim()
    ] ?? ''
  );
}

export function presetAvatarImageUrl(name: string): string {
  const key = name.trim().toLowerCase();
  const file = key === 'carmen' ? 'carmen_2.png' : `${key}.png`;
  return `${PRESET_AVATAR_CDN_BASE}/${file}`;
}
