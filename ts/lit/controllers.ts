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

import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { Fmp4Player } from '../fmp4-player.js';
import {
  LiveSocketClient,
  type LiveSocketClientOptions,
} from '../live-socket.js';
import { PcmMic, type PcmMicCallbacks } from '../pcm-mic.js';
import { PcmPlayer } from '../pcm-player.js';
import type { TranscriptItem } from '../transcript-assembler.js';
import {
  VisionCapture,
  type PreviewElementProvider,
  type VisionCaptureCallbacks,
} from '../vision-capture.js';

export class LiveSocketController implements ReactiveController {
  readonly client = new LiveSocketClient();
  private readonly host: ReactiveControllerHost;

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    host.addController(this);
  }

  get status(): string {
    return this.client.status;
  }

  get transcript(): TranscriptItem[] {
    return this.client.transcript;
  }

  get isTerminating(): boolean {
    return this.client.isTerminating;
  }

  hostConnected(): void {}

  hostDisconnected(): void {
    this.client.cleanup();
  }

  connect(options: LiveSocketClientOptions): void {
    this.client.connect({
      ...options,
      onStateChange: () => {
        options.onStateChange?.();
        this.host.requestUpdate();
      },
    });
  }
}

export class PcmMicController implements ReactiveController {
  readonly mic: PcmMic;
  private readonly host: ReactiveControllerHost;

  constructor(host: ReactiveControllerHost, callbacks: PcmMicCallbacks = {}) {
    this.host = host;
    this.mic = new PcmMic({
      ...callbacks,
      onStateChange: (recording) => {
        callbacks.onStateChange?.(recording);
        this.host.requestUpdate();
      },
    });
    host.addController(this);
  }

  get isRecording(): boolean {
    return this.mic.isRecording;
  }

  hostConnected(): void {}

  hostDisconnected(): void {
    this.mic.stop();
  }
}

export class PcmPlayerController implements ReactiveController {
  readonly player: PcmPlayer;
  private readonly host: ReactiveControllerHost;

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    this.player = new PcmPlayer({
      onStateChange: () => this.host.requestUpdate(),
      onPlayingChange: () => this.host.requestUpdate(),
    });
    host.addController(this);
  }

  get isMuted(): boolean {
    return this.player.isMuted;
  }

  hostConnected(): void {}

  hostDisconnected(): void {
    this.player.destroy();
  }
}

export class Fmp4PlayerController implements ReactiveController {
  readonly player: Fmp4Player;
  private readonly host: ReactiveControllerHost;

  constructor(host: ReactiveControllerHost) {
    this.host = host;
    this.player = new Fmp4Player({
      onFirstChunk: () => this.host.requestUpdate(),
    });
    host.addController(this);
  }

  get hasReceivedVideo(): boolean {
    return this.player.hasReceivedVideo;
  }

  hostConnected(): void {}

  hostDisconnected(): void {
    this.player.destroy();
  }
}

export class VisionCaptureController implements ReactiveController {
  readonly vision: VisionCapture;
  private readonly host: ReactiveControllerHost;

  constructor(
    host: ReactiveControllerHost,
    callbacks: VisionCaptureCallbacks = {},
  ) {
    this.host = host;
    this.vision = new VisionCapture({
      ...callbacks,
      onStateChange: () => {
        callbacks.onStateChange?.();
        this.host.requestUpdate();
      },
    });
    host.addController(this);
  }

  get isCameraActive(): boolean {
    return this.vision.isCameraActive;
  }

  get isScreenShareActive(): boolean {
    return this.vision.isScreenShareActive;
  }

  hostConnected(): void {}

  hostDisconnected(): void {
    this.vision.stopAll();
  }

  async toggleCamera(
    onJpegFrame: (base64Jpeg: string) => void,
    getPreviewEl?: PreviewElementProvider,
  ): Promise<void> {
    await this.vision.toggleCamera(onJpegFrame, getPreviewEl);
  }

  async toggleScreenShare(
    onJpegFrame: (base64Jpeg: string) => void,
    getPreviewEl?: PreviewElementProvider,
  ): Promise<void> {
    await this.vision.toggleScreenShare(onJpegFrame, getPreviewEl);
  }
}
