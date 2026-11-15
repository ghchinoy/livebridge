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

import {
  LiveSession,
  prepareAvatarImage,
  type LiveSessionMode,
} from '@ghchinoy/livebridge';

const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const avatarVideo = $<HTMLVideoElement>('avatar-video');
const pipVideo = $<HTMLVideoElement>('pip-video');
const modeSelect = $<HTMLSelectElement>('mode-select');
const avatarSelect = $<HTMLSelectElement>('avatar-select');
const customFile = $<HTMLInputElement>('custom-file');
const cropStatus = $<HTMLDivElement>('crop-status');

let customAvatarDataUrl: string | null = null;

customFile.addEventListener('change', async () => {
  const file = customFile.files?.[0];
  if (!file) {
    customAvatarDataUrl = null;
    cropStatus.textContent = 'Using preset avatar.';
    return;
  }
  const rawUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  customAvatarDataUrl = await prepareAvatarImage(rawUrl);
  cropStatus.textContent =
    'Prepared compliant 704x1280 / 1280x704 JPEG custom avatar.';
});

const session = new LiveSession({ mode: 'avatar' });

session.addEventListener('warning', (e) => {
  $('warning').textContent = (e as CustomEvent<string>).detail;
});

session.addEventListener('change', () => {
  const active = session.isConnected && !session.isTerminating;
  $('status').textContent = session.sessionModel
    ? `${session.status} · ${session.mode} · ${session.sessionModel}`
    : session.status;

  $<HTMLButtonElement>('connect-btn').disabled =
    session.isConnected || session.isTerminating;
  $<HTMLButtonElement>('mic-btn').disabled = !active;
  $<HTMLButtonElement>('mic-btn').textContent = session.isRecording
    ? 'Mute Mic'
    : 'Unmute Mic';
  $<HTMLButtonElement>('cam-btn').disabled = !active;
  $<HTMLButtonElement>('cam-btn').textContent = session.isCameraActive
    ? 'Stop Camera'
    : '1 FPS Camera';
  $<HTMLButtonElement>('screen-btn').disabled = !active;
  $<HTMLButtonElement>('screen-btn').textContent = session.isScreenShareActive
    ? 'Stop Screen'
    : '1 FPS Screen';
  $<HTMLButtonElement>('end-btn').disabled = !active;
  $<HTMLButtonElement>('send-btn').disabled = !active;

  pipVideo.style.display =
    session.isCameraActive || session.isScreenShareActive ? 'block' : 'none';

  const pane = $('transcript');
  pane.replaceChildren(
    ...session.transcript.map((item) => {
      const div = document.createElement('div');
      div.className = `bubble ${item.type}`;
      div.textContent = item.text;
      return div;
    }),
  );
  pane.scrollTop = pane.scrollHeight;
});

$('connect-btn').addEventListener('click', async () => {
  $('warning').textContent = '';
  const mode = modeSelect.value as LiveSessionMode;
  await session.connect({
    mode,
    endpoint: '/ws',
    videoElement: mode === 'avatar' ? avatarVideo : null,
    initialPayload: {
      mode,
      avatarType: customAvatarDataUrl ? 'custom' : 'preset',
      avatarData: customAvatarDataUrl ?? avatarSelect.value,
      voiceName: 'Kore',
    },
  });
});

$('mic-btn').addEventListener('click', () => void session.toggleMic());
$('cam-btn').addEventListener(
  'click',
  () => void session.toggleCamera(() => pipVideo),
);
$('screen-btn').addEventListener(
  'click',
  () => void session.toggleScreenShare(() => pipVideo),
);
$('end-btn').addEventListener('click', () => session.terminate());

$<HTMLFormElement>('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('chat-input');
  if (session.sendText(input.value)) {
    input.value = '';
  }
});
