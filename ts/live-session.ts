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

import { ChimeSynth, type ChimePreset } from './chime-synth.js';
import { Fmp4Player } from './fmp4-player.js';
import { LiveSocketClient } from './live-socket.js';
import { PcmMic } from './pcm-mic.js';
import { PcmPlayer } from './pcm-player.js';
import type { TranscriptItem } from './transcript-assembler.js';
import {
  VisionCapture,
  type PreviewElementProvider,
} from './vision-capture.js';
import type { WebmcpToolHost } from './webmcp-host.js';

export type LiveSessionMode = 'audio' | 'avatar';

export interface LiveSessionInit {
  mode?: LiveSessionMode;
  chimePreset?: ChimePreset;
  toolHost?: WebmcpToolHost<any> | null;
  visionIntervalMs?: number;
  onStateChange?: () => void;
  onRmsLevel?: (rms: number) => void;
  onWarning?: (message: string) => void;
  onError?: (source: 'mic' | 'camera' | 'screen', err: unknown) => void;
}

export interface LiveSessionConnectOptions {
  mode?: LiveSessionMode;
  url?: string;
  endpoint?: string;
  initialPayload?: Record<string, unknown>;
  /**
   * When true and a `toolHost` is attached, merges `tools: await toolHost.list()`
   * into `initialPayload` before opening the WebSocket.
   */
  advertisePageTools?: boolean;
  /** Starts the 16 kHz AudioWorklet microphone automatically (default: true). */
  autoStartMic?: boolean;
  /** Optional `<video>` element to attach for `mode === 'avatar'`. */
  videoElement?: HTMLVideoElement | null;
  terminateTimeoutMs?: number;
  onProactiveAlert?: (alert: Record<string, unknown>) => void;
  onToolCall?: (msg: Record<string, unknown>) => void;
  onCustomMessage?: (msg: Record<string, unknown>) => void;
  onDisconnected?: () => void;
  onFirstVideoChunk?: () => void;
}

/**
 * High-level framework-agnostic coordinator combining `LiveSocketClient`,
 * `PcmMic`, `PcmPlayer`, `Fmp4Player`, `VisionCapture`, `ChimeSynth`, and an
 * optional `WebmcpToolHost` into a single reactive `EventTarget`.
 *
 * Dispatches `'change'`, `'rms'`, `'warning'`, `'alert'`, and `'disconnect'`
 * events so Vanilla JS, Lit, React, or Svelte UIs can subscribe with minimal
 * glue code.
 */
export class LiveSession extends EventTarget {
  mode: LiveSessionMode;
  micRms = 0;
  lastWarning = '';

  readonly socket = new LiveSocketClient();
  readonly mic: PcmMic;
  readonly pcmPlayer: PcmPlayer;
  readonly fmp4Player: Fmp4Player;
  readonly vision: VisionCapture;
  readonly chime: ChimeSynth;
  readonly toolHost: WebmcpToolHost<any> | null;

  private readonly initOpts: LiveSessionInit;
  private attachedVideoEl: HTMLVideoElement | null = null;
  private onFirstVideoChunkCb: (() => void) | undefined;
  private readonly inFlightPageTools = new Map<string, AbortController>();

  constructor(init: LiveSessionInit = {}) {
    super();
    this.initOpts = init;
    this.mode = init.mode ?? 'audio';
    this.chime = new ChimeSynth(init.chimePreset ?? 'soft');
    this.toolHost = init.toolHost ?? null;

    this.mic = new PcmMic({
      onStateChange: () => {
        if (!this.mic.isRecording) {
          this.micRms = 0;
        }
        this.emitChange();
      },
      onRmsLevel: (rms) => {
        this.micRms = rms;
        this.initOpts.onRmsLevel?.(rms);
        this.dispatchEvent(new CustomEvent<number>('rms', { detail: rms }));
      },
      onError: (err) => {
        this.initOpts.onError?.('mic', err);
      },
    });

    this.pcmPlayer = new PcmPlayer({
      onStateChange: () => this.emitChange(),
      onPlayingChange: () => this.emitChange(),
    });

    this.fmp4Player = new Fmp4Player({
      onFirstChunk: () => {
        this.onFirstVideoChunkCb?.();
        this.emitChange();
      },
    });

    this.vision = new VisionCapture({
      intervalMs: init.visionIntervalMs ?? 1000,
      onStateChange: () => this.emitChange(),
      onError: (kind, err) => this.initOpts.onError?.(kind, err),
    });
  }

  get status(): string {
    return this.socket.status;
  }

  get isConnected(): boolean {
    return this.socket.isConnected;
  }

  get isTerminating(): boolean {
    return this.socket.isTerminating;
  }

  get transcript(): TranscriptItem[] {
    return this.socket.transcript;
  }

  get sessionModel(): string {
    return this.socket.sessionModel;
  }

  get sessionLocation(): string {
    return this.socket.sessionLocation;
  }

  get isRecording(): boolean {
    return this.mic.isRecording;
  }

  get isMuted(): boolean {
    return this.mode === 'avatar'
      ? (this.attachedVideoEl?.muted ?? false)
      : this.pcmPlayer.isMuted;
  }

  get isCameraActive(): boolean {
    return this.vision.isCameraActive;
  }

  get isScreenShareActive(): boolean {
    return this.vision.isScreenShareActive;
  }

  attachVideoElement(videoEl: HTMLVideoElement | null): void {
    this.attachedVideoEl = videoEl;
    if (videoEl) {
      this.fmp4Player.attach(videoEl);
    } else {
      this.fmp4Player.destroy();
    }
  }

  async connect(options: LiveSessionConnectOptions = {}): Promise<void> {
    this.abortInFlightTools();
    if (options.mode) {
      this.mode = options.mode;
    }
    this.onFirstVideoChunkCb = options.onFirstVideoChunk;

    if (options.videoElement !== undefined) {
      this.attachVideoElement(options.videoElement);
    }
    if (this.mode === 'audio') {
      this.pcmPlayer.init(24000);
    }

    let initialPayload: unknown = options.initialPayload;
    if (options.advertisePageTools && this.toolHost) {
      const tools = await this.toolHost.list();
      initialPayload = {
        ...(options.initialPayload ?? {}),
        tools,
      };
    }

    const defaultEndpoint = this.mode === 'avatar' ? '/ws' : '/ws/live';
    this.socket.connect({
      url: options.url,
      endpoint: options.endpoint ?? defaultEndpoint,
      initialPayload,
      terminateTimeoutMs: options.terminateTimeoutMs,
      onMediaConfig: (msg) => {
        if (msg.mimeType === 'video/mp4') {
          this.mode = 'avatar';
          if (typeof msg.codecs === 'string') {
            this.fmp4Player.setCodec(msg.codecs);
          }
        } else if (
          typeof msg.mimeType === 'string' &&
          msg.mimeType.startsWith('audio/pcm')
        ) {
          this.mode = 'audio';
          const rate =
            typeof msg.sampleRate === 'number' ? msg.sampleRate : 24000;
          this.pcmPlayer.init(rate);
        }
        this.emitChange();
      },
      onBinaryFrame: (data) => {
        if (this.mode === 'avatar') {
          this.fmp4Player.appendChunk(new Uint8Array(data));
        } else {
          this.pcmPlayer.feed(data);
        }
      },
      onToolCall: (msg) => {
        options.onToolCall?.(msg);
        void this.maybeExecutePageTool(msg);
      },
      onToolCallCancellation: (ids) => {
        for (const id of ids) {
          this.inFlightPageTools.get(id)?.abort();
          this.inFlightPageTools.delete(id);
        }
      },
      onInterrupted: () => {
        if (this.mode === 'avatar') {
          this.fmp4Player.flushAndAbort();
        } else {
          this.pcmPlayer.flushAndInterrupt();
        }
      },
      onProactiveAlert: (alert) => {
        if (this.mode === 'audio') {
          this.pcmPlayer.init(24000);
          if (this.pcmPlayer.context) {
            const cueSec = this.chime.playAmbientCue(this.pcmPlayer.context);
            this.pcmPlayer.deferPlayback(cueSec);
          }
        }
        options.onProactiveAlert?.(alert);
        this.dispatchEvent(
          new CustomEvent<Record<string, unknown>>('alert', { detail: alert }),
        );
        this.emitChange();
      },
      onCustomMessage: options.onCustomMessage,
      onBeforeTerminate: () => {
        this.mic.stop();
        this.vision.stopAll();
        this.abortInFlightTools();
      },
      onWarning: (warning) => {
        this.lastWarning = warning;
        this.initOpts.onWarning?.(warning);
        this.dispatchEvent(
          new CustomEvent<string>('warning', { detail: warning }),
        );
        this.emitChange();
      },
      onStateChange: () => {
        if (
          this.socket.sessionMode === 'avatar' ||
          this.socket.sessionMode === 'audio'
        ) {
          this.mode = this.socket.sessionMode;
        }
        this.emitChange();
      },
      onDisconnected: () => {
        this.mic.stop();
        this.vision.stopAll();
        this.abortInFlightTools();
        this.pcmPlayer.destroy();
        this.fmp4Player.destroy();
        options.onDisconnected?.();
        this.dispatchEvent(new Event('disconnect'));
        this.emitChange();
      },
    });

    if (options.autoStartMic !== false) {
      await this.startMic();
    }
  }

  async startMic(): Promise<void> {
    await this.mic.start((b64) => this.socket.sendAudioChunk(b64));
  }

  stopMic(): void {
    this.mic.stop();
  }

  async toggleMic(): Promise<void> {
    await this.mic.toggle((b64) => this.socket.sendAudioChunk(b64));
  }

  setMuted(muted: boolean): void {
    this.pcmPlayer.setMuted(muted);
    if (this.attachedVideoEl) {
      this.attachedVideoEl.muted = muted;
    }
    this.emitChange();
  }

  toggleMute(): void {
    this.setMuted(!this.isMuted);
  }

  async toggleCamera(getPreviewEl?: PreviewElementProvider): Promise<void> {
    await this.vision.toggleCamera(
      (jpeg) => this.socket.sendVideoFrame(jpeg),
      getPreviewEl,
    );
  }

  async toggleScreenShare(
    getPreviewEl?: PreviewElementProvider,
  ): Promise<void> {
    await this.vision.toggleScreenShare(
      (jpeg) => this.socket.sendVideoFrame(jpeg),
      getPreviewEl,
    );
  }

  stopVision(): void {
    this.vision.stopAll();
  }

  sendText(text: string): boolean {
    return this.socket.sendText(text);
  }

  sendPayload(payload: Record<string, unknown>): void {
    this.socket.sendPayload(payload);
  }

  terminate(): void {
    this.socket.terminate();
  }

  disconnect(): void {
    this.socket.disconnect();
  }

  private async maybeExecutePageTool(
    msg: Record<string, unknown>,
  ): Promise<void> {
    // Server-completed tool events already carry `result`; only execute tools
    // registered on our browser `toolHost` that await a client `tool_result`.
    if (!this.toolHost || msg.result !== undefined) {
      return;
    }
    const id = typeof msg.id === 'string' ? msg.id : '';
    const name = typeof msg.name === 'string' ? msg.name : '';
    if (!name || !this.toolHost.isRegistered(name)) {
      return;
    }
    const args =
      msg.args && typeof msg.args === 'object' && !Array.isArray(msg.args)
        ? (msg.args as Record<string, unknown>)
        : {};

    const ac = new AbortController();
    if (id) {
      this.inFlightPageTools.get(id)?.abort();
      this.inFlightPageTools.set(id, ac);
    }

    const started = performance.now();
    const out = await this.toolHost.callWithOutput(
      name,
      args,
      ac.signal,
      'live',
    );
    if (ac.signal.aborted) {
      return;
    }
    if (id && !this.inFlightPageTools.delete(id)) {
      return;
    }
    this.socket.sendToolResult(id, name, out.result, {
      imageDataUrl: out.imageDataUrl,
      execMs: Math.round(performance.now() - started),
    });
  }

  private abortInFlightTools(): void {
    for (const ac of this.inFlightPageTools.values()) {
      ac.abort();
    }
    this.inFlightPageTools.clear();
  }

  private emitChange(): void {
    this.initOpts.onStateChange?.();
    this.dispatchEvent(new Event('change'));
  }
}
