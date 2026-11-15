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
import {
  LiveSession,
  type LiveSessionConnectOptions,
  type LiveSessionInit,
} from '../live-session.js';
import type { TranscriptItem } from '../transcript-assembler.js';
import type { PreviewElementProvider } from '../vision-capture.js';

/**
 * Lit 3 `ReactiveController` wrapping `LiveSession`, automatically scheduling
 * `host.requestUpdate()` on session, transcript, audio, video, and vision state
 * transitions and disconnecting cleanly when the host element leaves the DOM.
 */
export class LiveSessionController implements ReactiveController {
  readonly session: LiveSession;
  private readonly host: ReactiveControllerHost;

  constructor(host: ReactiveControllerHost, init: LiveSessionInit = {}) {
    this.host = host;
    this.session = new LiveSession({
      ...init,
      onStateChange: () => {
        init.onStateChange?.();
        this.host.requestUpdate();
      },
    });
    host.addController(this);
  }

  get status(): string {
    return this.session.status;
  }

  get isConnected(): boolean {
    return this.session.isConnected;
  }

  get isTerminating(): boolean {
    return this.session.isTerminating;
  }

  get transcript(): TranscriptItem[] {
    return this.session.transcript;
  }

  get sessionModel(): string {
    return this.session.sessionModel;
  }

  get sessionLocation(): string {
    return this.session.sessionLocation;
  }

  get isRecording(): boolean {
    return this.session.isRecording;
  }

  get isMuted(): boolean {
    return this.session.isMuted;
  }

  get isCameraActive(): boolean {
    return this.session.isCameraActive;
  }

  get isScreenShareActive(): boolean {
    return this.session.isScreenShareActive;
  }

  get micRms(): number {
    return this.session.micRms;
  }

  hostConnected(): void {}

  hostDisconnected(): void {
    this.session.disconnect();
  }

  async connect(options?: LiveSessionConnectOptions): Promise<void> {
    await this.session.connect(options);
  }

  attachVideoElement(videoEl: HTMLVideoElement | null): void {
    this.session.attachVideoElement(videoEl);
  }

  async toggleMic(): Promise<void> {
    await this.session.toggleMic();
  }

  toggleMute(): void {
    this.session.toggleMute();
  }

  async toggleCamera(getPreviewEl?: PreviewElementProvider): Promise<void> {
    await this.session.toggleCamera(getPreviewEl);
  }

  async toggleScreenShare(
    getPreviewEl?: PreviewElementProvider,
  ): Promise<void> {
    await this.session.toggleScreenShare(getPreviewEl);
  }

  sendText(text: string): boolean {
    return this.session.sendText(text);
  }

  terminate(): void {
    this.session.terminate();
  }

  disconnect(): void {
    this.session.disconnect();
  }
}
