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

export interface AvatarTarget {
  readonly width: number;
  readonly height: number;
}

/**
 * Canonical portrait and landscape reference dimensions accepted by Gemini Live
 * `CustomizedAvatar` (square images such as 1024x1024 fail setup with 1007).
 */
export const AVATAR_PORTRAIT: AvatarTarget = { width: 704, height: 1280 };
export const AVATAR_LANDSCAPE: AvatarTarget = { width: 1280, height: 704 };

/**
 * Picks the Live Avatar reference-image target that crops the least area from a
 * source image: landscape when wider than tall, portrait otherwise.
 */
export function pickAvatarTarget(
  sourceWidth: number,
  sourceHeight: number,
): AvatarTarget {
  return sourceWidth > sourceHeight ? AVATAR_LANDSCAPE : AVATAR_PORTRAIT;
}

/**
 * Center-crops and resizes an image data URL to a valid Gemini Live
 * `CustomizedAvatar` target (`704x1280` portrait or `1280x704` landscape by
 * default) and returns a JPEG data URL.
 */
export async function prepareAvatarImage(
  dataUrl: string,
  targetWidth?: number,
  targetHeight?: number,
  quality = 0.9,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const target =
        targetWidth && targetHeight
          ? { width: targetWidth, height: targetHeight }
          : pickAvatarTarget(img.width, img.height);

      const canvas = document.createElement('canvas');
      canvas.width = target.width;
      canvas.height = target.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get 2D canvas context'));
        return;
      }

      const imgRatio = img.width / img.height;
      const targetRatio = target.width / target.height;

      let drawWidth = img.width;
      let drawHeight = img.height;
      let offsetX = 0;
      let offsetY = 0;

      if (imgRatio > targetRatio) {
        drawWidth = img.height * targetRatio;
        offsetX = (img.width - drawWidth) / 2;
      } else {
        drawHeight = img.width / targetRatio;
        offsetY = (img.height - drawHeight) / 2;
      }

      ctx.drawImage(
        img,
        offsetX,
        offsetY,
        drawWidth,
        drawHeight,
        0,
        0,
        target.width,
        target.height,
      );

      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Failed to load avatar image'));
    img.src = dataUrl;
  });
}

/** Alias matching `gemini-live-avatar` `image-utils.ts`. */
export const resizeAndCropImage = prepareAvatarImage;

/**
 * Downscales an image data URL proportionally so neither dimension exceeds `maxDim`.
 */
export async function resizeToMaxDimension(
  dataUrl: string,
  maxDim = 1024,
  quality = 0.85,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      if (width <= maxDim && height <= maxDim) {
        resolve(dataUrl);
        return;
      }
      if (width > height) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get 2D canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('Failed to load image for resize'));
    img.src = dataUrl;
  });
}
