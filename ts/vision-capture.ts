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

export type PreviewElementProvider = () =>
  | Promise<HTMLVideoElement | null | undefined>
  | HTMLVideoElement
  | null
  | undefined;

export interface VisionCaptureCallbacks {
  onStateChange?: () => void;
  onError?: (kind: 'camera' | 'screen', err: unknown) => void;
  /** Sampling interval in milliseconds (default 1000 = 1 FPS). */
  intervalMs?: number;
  /** JPEG encoder quality in [0, 1] (default 0.7). */
  jpegQuality?: number;
  /** Maximum dimension in pixels for screen-share frames (default 1280). */
  maxScreenDimension?: number;
}

/**
 * Framework-agnostic 1 FPS camera and screen-share JPEG frame sampler.
 *
 * Captures the MediaStream at its native device frame rate so any attached
 * `<video>` PiP preview renders smoothly, while sampling JPEG frames on an
 * offscreen `<canvas>` at `intervalMs` (default 1 FPS) for Gemini Live vision.
 */
export class VisionCapture {
  isCameraActive = false;
  isScreenShareActive = false;

  private readonly callbacks: VisionCaptureCallbacks;
  private cameraStream: MediaStream | null = null;
  private cameraIntervalId: ReturnType<typeof setInterval> | null = null;
  private cameraInternalVideo: HTMLVideoElement | null = null;
  private screenStream: MediaStream | null = null;
  private screenIntervalId: ReturnType<typeof setInterval> | null = null;
  private screenInternalVideo: HTMLVideoElement | null = null;
  private cameraToken = 0;
  private screenToken = 0;

  constructor(callbacks: VisionCaptureCallbacks = {}) {
    this.callbacks = callbacks;
  }

  stopAll(): void {
    this.stopCamera();
    this.stopScreenShare();
  }

  async toggleCamera(
    onJpegFrame: (base64Jpeg: string) => void,
    getPreviewEl?: PreviewElementProvider,
  ): Promise<void> {
    if (this.isCameraActive) {
      this.stopCamera();
    } else {
      await this.startCamera(onJpegFrame, getPreviewEl);
    }
  }

  async startCamera(
    onJpegFrame: (base64Jpeg: string) => void,
    getPreviewEl?: PreviewElementProvider,
  ): Promise<void> {
    if (this.isScreenShareActive) {
      this.stopScreenShare();
    }
    const token = ++this.cameraToken;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
      });
      if (token !== this.cameraToken) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      if (this.cameraStream) {
        this.cameraStream.getTracks().forEach((t) => t.stop());
      }
      this.cameraStream = stream;
      this.isCameraActive = true;
      this.callbacks.onStateChange?.();

      const previewEl =
        (await getPreviewEl?.()) ?? this.createHeadlessVideoElement('camera');
      if (token !== this.cameraToken) {
        this.stopCamera();
        return;
      }
      previewEl.srcObject = this.cameraStream;
      await previewEl.play().catch(() => {});
      if (token !== this.cameraToken) {
        this.stopCamera();
        return;
      }

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const intervalMs = this.callbacks.intervalMs ?? 1000;
      const quality = this.callbacks.jpegQuality ?? 0.7;

      this.cameraIntervalId = setInterval(async () => {
        const videoEl = (await getPreviewEl?.()) ?? previewEl;
        if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) return;

        canvas.width = videoEl.videoWidth;
        canvas.height = videoEl.videoHeight;
        ctx?.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64Data = dataUrl.split(',')[1];
        if (base64Data) {
          onJpegFrame(base64Data);
        }
      }, intervalMs);
    } catch (err) {
      this.stopCamera();
      this.callbacks.onError?.('camera', err);
    }
  }

  stopCamera(): void {
    this.cameraToken++;
    if (this.cameraIntervalId) {
      clearInterval(this.cameraIntervalId);
      this.cameraIntervalId = null;
    }
    if (this.cameraInternalVideo) {
      this.cameraInternalVideo.srcObject = null;
      this.cameraInternalVideo = null;
    }
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((t) => t.stop());
      this.cameraStream = null;
    }
    if (this.isCameraActive) {
      this.isCameraActive = false;
      this.callbacks.onStateChange?.();
    }
  }

  async toggleScreenShare(
    onJpegFrame: (base64Jpeg: string) => void,
    getPreviewEl?: PreviewElementProvider,
  ): Promise<void> {
    if (this.isScreenShareActive) {
      this.stopScreenShare();
    } else {
      await this.startScreenShare(onJpegFrame, getPreviewEl);
    }
  }

  async startScreenShare(
    onJpegFrame: (base64Jpeg: string) => void,
    getPreviewEl?: PreviewElementProvider,
  ): Promise<void> {
    if (this.isCameraActive) {
      this.stopCamera();
    }
    const token = ++this.screenToken;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (token !== this.screenToken) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      if (this.screenStream) {
        this.screenStream.getTracks().forEach((t) => t.stop());
      }
      this.screenStream = stream;
      this.isScreenShareActive = true;
      this.callbacks.onStateChange?.();

      const track = this.screenStream.getVideoTracks()[0];
      if (track) {
        track.onended = () => {
          this.stopScreenShare();
        };
      }

      const previewEl =
        (await getPreviewEl?.()) ?? this.createHeadlessVideoElement('screen');
      if (token !== this.screenToken) {
        this.stopScreenShare();
        return;
      }
      previewEl.srcObject = this.screenStream;
      await previewEl.play().catch(() => {});
      if (token !== this.screenToken) {
        this.stopScreenShare();
        return;
      }

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const intervalMs = this.callbacks.intervalMs ?? 1000;
      const quality = this.callbacks.jpegQuality ?? 0.7;
      const maxDim = this.callbacks.maxScreenDimension ?? 1280;

      this.screenIntervalId = setInterval(async () => {
        const videoEl = (await getPreviewEl?.()) ?? previewEl;
        if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) return;

        let w = videoEl.videoWidth;
        let h = videoEl.videoHeight;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }

        canvas.width = w;
        canvas.height = h;
        ctx?.drawImage(videoEl, 0, 0, w, h);

        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const base64Data = dataUrl.split(',')[1];
        if (base64Data) {
          onJpegFrame(base64Data);
        }
      }, intervalMs);
    } catch (err) {
      this.stopScreenShare();
      this.callbacks.onError?.('screen', err);
    }
  }

  stopScreenShare(): void {
    this.screenToken++;
    if (this.screenIntervalId) {
      clearInterval(this.screenIntervalId);
      this.screenIntervalId = null;
    }
    if (this.screenInternalVideo) {
      this.screenInternalVideo.srcObject = null;
      this.screenInternalVideo = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      this.screenStream = null;
    }
    if (this.isScreenShareActive) {
      this.isScreenShareActive = false;
      this.callbacks.onStateChange?.();
    }
  }

  private createHeadlessVideoElement(
    kind: 'camera' | 'screen',
  ): HTMLVideoElement {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    if (kind === 'camera') {
      this.cameraInternalVideo = v;
    } else {
      this.screenInternalVideo = v;
    }
    return v;
  }
}
