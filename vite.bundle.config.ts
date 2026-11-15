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

import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Builds the zero-dependency standalone browser ESM bundle embedded by the Go
 * `github.com/ghchinoy/livebridge/browser` subpackage (`//go:embed dist/livebridge.esm.js`).
 */
export default defineConfig({
  build: {
    outDir: resolve(import.meta.dirname, 'browser/dist'),
    emptyOutDir: true,
    sourcemap: false,
    minify: true,
    lib: {
      entry: resolve(import.meta.dirname, 'ts/index.ts'),
      formats: ['es'],
      fileName: () => 'livebridge.esm.js',
    },
    rolldownOptions: {
      output: {
        codeSplitting: false,
      },
    },
  },
});
