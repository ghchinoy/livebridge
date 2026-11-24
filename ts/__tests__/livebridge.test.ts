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

import { LitElement, html } from 'lit';
import { describe, expect, it, vi } from 'vitest';
import {
  AVATAR_LANDSCAPE,
  AVATAR_PORTRAIT,
  CHIME_PRESETS,
  ChimeSynth,
  LiveSession,
  LiveSocketClient,
  PRESET_AVATARS,
  TranscriptAssembler,
  WebmcpToolHost,
  computeInt16Rms,
  defaultVoiceForAvatar,
  describeCloseEvent,
  int16ArrayToLittleEndianBytes,
  isPrebuiltVoice,
  isPresetAvatar,
  normalizeChimePreset,
  pickAvatarTarget,
  prepareAvatarImage,
  presetAvatarImageUrl,
  uint8ArrayToBase64,
  type ModelContextLike,
  type WebmcpRegisteredTool,
} from '../index.js';
import { LiveSessionController } from '../lit/index.js';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly url: string;
  binaryType: BinaryType = 'blob';
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];

  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  emitJson(payload: Record<string, unknown>): void {
    this.onmessage?.(
      new MessageEvent('message', { data: JSON.stringify(payload) }),
    );
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close', { code, reason }));
  }
}

describe('TranscriptAssembler', () => {
  it('accumulates assistant partials, replaces user partials, and marks barge-in', () => {
    const t = new TranscriptAssembler();

    t.appendTurn('user', 'hello', false, false);
    t.appendTurn('user', 'hello there', true, false);
    expect(t.entries).toEqual([
      { type: 'user', text: 'hello there', isPartial: false },
    ]);

    t.appendTurn('assistant', 'Hi ', false, true);
    t.appendTurn('assistant', 'how can I ', false, true);
    expect(t.entries[1]).toEqual({
      type: 'assistant',
      text: 'Hi how can I ',
      isPartial: true,
    });

    expect(t.markInterrupted()).toBe(true);
    expect(t.entries[1]).toEqual({
      type: 'assistant',
      text: 'Hi how can I  \u2014',
      isPartial: false,
    });
    expect(t.markInterrupted()).toBe(false);
  });

  it('tracks tool call cards and marks cancelled IDs', () => {
    const t = new TranscriptAssembler();
    t.addToolCall({
      id: 'call-9',
      name: 'show_info_card',
      args: {
        title: 'Latency',
        summary: '2.45s TTFF on 3.8 Live',
        category: 'Metrics',
        items: ['24 kHz PCM', 'fMP4 muxed'],
      },
    });
    expect(t.entries[0].toolCard?.cancelled).toBeUndefined();

    t.cancelToolCalls(['call-9']);
    expect(t.entries[0].toolCard?.cancelled).toBe(true);
  });
});

describe('describeCloseEvent', () => {
  it('maps RFC 6455 close codes and suppresses clean termination', () => {
    expect(
      describeCloseEvent(1000, 'Session terminated', {
        limitReachedAlreadySurfaced: false,
        isTerminating: true,
        hadErrorEvent: false,
      }),
    ).toBeNull();

    expect(
      describeCloseEvent(1007, 'Invalid session config', {
        limitReachedAlreadySurfaced: false,
        isTerminating: false,
        hadErrorEvent: false,
      }),
    ).toEqual({ kind: 'invalid_config', message: 'Invalid session config' });

    expect(
      describeCloseEvent(1009, '', {
        limitReachedAlreadySurfaced: false,
        isTerminating: false,
        hadErrorEvent: false,
      })?.kind,
    ).toBe('too_large');
  });
});

describe('PCM, Chime & AvatarImage helpers', () => {
  it('encodes little-endian Int16 PCM and computes RMS bounds', () => {
    const samples = new Int16Array([0, 16384, -16384]);
    const bytes = int16ArrayToLittleEndianBytes(samples);
    expect(bytes.byteLength).toBe(6);
    expect(uint8ArrayToBase64(bytes).length).toBeGreaterThan(0);

    const rms = computeInt16Rms(samples);
    expect(rms).toBeGreaterThan(0.35);
    expect(rms).toBeLessThan(0.5);
  });

  it('normalizes and cycles chime presets', () => {
    expect(normalizeChimePreset('SUBTLE')).toBe('subtle');
    expect(normalizeChimePreset('invalid')).toBe('soft');

    const synth = new ChimeSynth('soft');
    expect(CHIME_PRESETS.soft.peakGain).toBeGreaterThan(
      CHIME_PRESETS.subtle.peakGain,
    );
    expect(synth.cycleMode()).toBe('subtle');
    expect(synth.cycleMode()).toBe('off');
    expect(synth.cycleMode()).toBe('soft');

    expect(PRESET_AVATARS).toContain('Kira');
    expect(isPresetAvatar('Kira')).toBe(true);
    expect(isPresetAvatar('Aoede')).toBe(false);
    expect(isPrebuiltVoice('Aoede')).toBe(true);
    expect(defaultVoiceForAvatar('Kira')).toBe('Aoede');
    expect(presetAvatarImageUrl('Carmen')).toContain('carmen_2.png');
  });

  it('crops square/portrait sources to 704x1280 and landscape sources to 1280x704', async () => {
    expect(pickAvatarTarget(1024, 1024)).toEqual(AVATAR_PORTRAIT);
    expect(pickAvatarTarget(1600, 900)).toEqual(AVATAR_LANDSCAPE);

    // Synthesize a 200x200 square canvas data URL and verify prepareAvatarImage
    // outputs a 704x1280 JPEG data URL.
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = 200;
    srcCanvas.height = 200;
    const ctx = srcCanvas.getContext('2d')!;
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(0, 0, 200, 200);

    const prepared = await prepareAvatarImage(srcCanvas.toDataURL('image/png'));
    expect(prepared.startsWith('data:image/jpeg;base64,')).toBe(true);

    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.width, h: img.height });
      img.src = prepared;
    });
    expect(dims).toEqual({ w: 704, h: 1280 });
  });
});

describe('WebmcpToolHost', () => {
  it('coalesces concurrent identical in-flight tool calls and negotiates string args', async () => {
    let invocations = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const host = new WebmcpToolHost((signal) => ({ signal }), null);
    await host.register([
      {
        name: 'upload_image',
        description: 'Prompt the user to upload an image',
        inputSchema: {
          type: 'object',
          properties: { title: { type: 'string' } },
        },
        coalesceInFlight: true,
        execute: async (args) => {
          invocations++;
          await gate;
          return { result: { uploaded: true, title: args.title ?? 'default' } };
        },
      },
    ]);

    const ac = new AbortController();
    const p1 = host.call('upload_image', { title: 'hero' }, ac.signal, 'live');
    const p2 = host.call('upload_image', { title: 'hero' }, ac.signal, 'live');

    release();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(invocations).toBe(1);
    expect(r1).toEqual({ uploaded: true, title: 'hero' });
    expect(r2).toEqual({ uploaded: true, title: 'hero' });

    // Verify Chrome 154 string-argument negotiation and foreign tool rejection:
    const stored = new Map<
      string,
      {
        reg: WebmcpRegisteredTool;
        exec: (input: Record<string, unknown> | string) => Promise<unknown>;
      }
    >();
    const fakeMc: ModelContextLike = Object.assign(new EventTarget(), {
      async registerTool(t: {
        name: string;
        description: string;
        inputSchema?: Record<string, unknown>;
        execute: (input: Record<string, unknown> | string) => Promise<unknown>;
      }) {
        stored.set(t.name, {
          reg: {
            name: t.name,
            description: t.description,
            inputSchema: JSON.stringify(t.inputSchema ?? {}),
          },
          exec: t.execute,
        });
      },
      async getTools() {
        return [
          ...Array.from(stored.values()).map((s) => s.reg),
          { name: 'foreign_tool', description: 'foreign', inputSchema: '{}' },
        ];
      },
      async executeTool(
        tool: WebmcpRegisteredTool,
        input: Record<string, unknown> | string,
      ) {
        if (typeof input !== 'string') {
          throw new TypeError('Failed to parse input arguments');
        }
        const entry = stored.get(tool.name);
        return JSON.stringify(await entry!.exec(input));
      },
    });

    const mcHost = new WebmcpToolHost((signal) => ({ signal }), fakeMc);
    await mcHost.register([
      {
        name: 'list_nodes',
        description: 'Lists topology nodes',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        execute: async () => ({ result: { count: 4 } }),
      },
    ]);
    const res = await mcHost.call(
      'list_nodes',
      {},
      new AbortController().signal,
    );
    expect(res).toEqual({ count: 4 });
    expect(mcHost.diagnostics.argsForm).toBe('string');
  });

  it('supports WebMCP PR #348 Tool interface (prototype getters, source filtering, nullable inputSchema, NotFoundError)', async () => {
    // Models the WebIDL Tool interface: non-enumerable prototype getters
    // (JSON.stringify(t) === '{}', spread copies nothing), `source` instead of
    // `window`, and `null` instead of `undefined` when inputSchema is omitted.
    class FakeTool implements WebmcpRegisteredTool {
      readonly #id: symbol;
      readonly #name: string;
      readonly #description: string;
      readonly #inputSchema: Record<string, unknown> | null;
      readonly #source: Window | null;

      constructor(
        id: symbol,
        name: string,
        description: string,
        inputSchema: Record<string, unknown> | null,
        source: Window | null,
      ) {
        this.#id = id;
        this.#name = name;
        this.#description = description;
        this.#inputSchema = inputSchema;
        this.#source = source;
      }

      get name() {
        return this.#name;
      }
      get title() {
        return '';
      }
      get description() {
        return this.#description;
      }
      get inputSchema() {
        return this.#inputSchema;
      }
      get outputSchema() {
        return null;
      }
      get source() {
        return this.#source;
      }
      get origin() {
        return window.location.origin;
      }
      get annotations() {
        return null;
      }
      get internalId() {
        return this.#id;
      }
    }

    const otherWindow = {} as Window;
    const registry = new Map<
      symbol,
      {
        name: string;
        description: string;
        inputSchema: Record<string, unknown> | null;
        source: Window | null;
        exec: (input: Record<string, unknown> | string) => Promise<unknown>;
      }
    >();

    // Seed an iframe tool and a detached-document tool BEFORE our own tool so
    // any failure to check `tool.source` would hijack both list() and call().
    const iframeId = Symbol('iframe');
    let iframeCalls = 0;
    registry.set(iframeId, {
      name: 'ping',
      description: 'Health check with no input schema',
      inputSchema: null,
      source: otherWindow,
      exec: async () => {
        iframeCalls++;
        return { pong: 'iframe' };
      },
    });
    const detachedId = Symbol('detached');
    registry.set(detachedId, {
      name: 'ping',
      description: 'Health check with no input schema',
      inputSchema: null,
      source: null,
      exec: async () => ({ pong: 'detached' }),
    });

    let failNextWithNotFound = false;
    const toolMc: ModelContextLike = Object.assign(new EventTarget(), {
      async registerTool(
        t: {
          name: string;
          description: string;
          inputSchema?: Record<string, unknown>;
          execute: (
            input: Record<string, unknown> | string,
          ) => Promise<unknown>;
        },
        options?: { signal?: AbortSignal },
      ) {
        const id = Symbol(t.name);
        registry.set(id, {
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema ?? null,
          source: window,
          exec: t.execute,
        });
        options?.signal?.addEventListener('abort', () => {
          registry.delete(id);
        });
      },
      async getTools() {
        // Fresh Tool instances per getTools() call, matching PR #348.
        return Array.from(registry.entries()).map(
          ([id, entry]) =>
            new FakeTool(
              id,
              entry.name,
              entry.description,
              entry.inputSchema,
              entry.source,
            ),
        );
      },
      async executeTool(
        tool: WebmcpRegisteredTool,
        input: Record<string, unknown> | string,
      ) {
        if (!(tool instanceof FakeTool)) {
          throw new TypeError('Illegal invocation: expected Tool instance');
        }
        if (failNextWithNotFound) {
          failNextWithNotFound = false;
          throw new DOMException(
            'Tool registration not found',
            'NotFoundError',
          );
        }
        const entry = registry.get(tool.internalId);
        if (!entry) {
          throw new DOMException(
            'Tool registration not found',
            'NotFoundError',
          );
        }
        return JSON.stringify(await entry.exec(input));
      },
    });

    // Sanity check our FakeTool matches PR #348 non-enumerable semantics.
    const sampleTool = new FakeTool(Symbol('s'), 'ping', 'desc', null, window);
    expect(JSON.stringify(sampleTool)).toBe('{}');
    expect({ ...sampleTool }).toEqual({});
    expect('window' in sampleTool).toBe(false);

    const host = new WebmcpToolHost((signal) => ({ signal }), toolMc);
    await host.register([
      {
        name: 'ping',
        description: 'Health check with no input schema',
        execute: async () => ({ result: { pong: 'self' } }),
      },
    ]);

    const listed = await host.list();
    expect(listed).toEqual([
      { name: 'ping', description: 'Health check with no input schema' },
    ]);
    expect(host.diagnostics.dropped).toEqual([]);
    expect(host.diagnostics.schemaType).toBe('null');

    const res = await host.call('ping', {}, new AbortController().signal);
    expect(res).toEqual({ pong: 'self' });
    expect(iframeCalls).toBe(0);

    // Mid-flight unregistration (NotFoundError) returns a clean tool error.
    failNextWithNotFound = true;
    const errRes = await host.call('ping', {}, new AbortController().signal);
    expect(errRes.error).toContain('Tool registration not found');
  });

  it('continues filtering legacy RegisteredTool.window when source is absent', async () => {
    const otherWindow = {} as Window;
    const legacyMc: ModelContextLike = Object.assign(new EventTarget(), {
      async registerTool() {},
      async getTools() {
        return [
          {
            name: 'status',
            description: 'Read status',
            inputSchema: { type: 'object', properties: {} },
            window: otherWindow,
          },
          {
            name: 'status',
            description: 'Read status',
            inputSchema: { type: 'object', properties: {} },
            window,
          },
        ];
      },
      async executeTool(tool: WebmcpRegisteredTool) {
        return JSON.stringify({
          sameWindow: tool.window === window,
        });
      },
    });

    const host = new WebmcpToolHost((signal) => ({ signal }), legacyMc);
    await host.register([
      {
        name: 'status',
        description: 'Read status',
        inputSchema: { type: 'object', properties: {} },
        execute: async () => ({ result: { sameWindow: true } }),
      },
    ]);

    const listed = await host.list();
    expect(listed).toHaveLength(1);
    const res = await host.call('status', {}, new AbortController().signal);
    expect(res).toEqual({ sameWindow: true });
  });
});

describe('LiveSession & @ghchinoy/livebridge/lit', () => {
  it('advertises WebMCP page tools, executes relayed tool_call with image snapshot, and updates Lit elements', async () => {
    const RealWS = globalThis.WebSocket;
    MockWebSocket.instances = [];
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket =
      MockWebSocket;

    try {
      const toolHost = new WebmcpToolHost((signal) => ({ signal }), null);
      await toolHost.register([
        {
          name: 'paint_status',
          description: 'Updates status badge on canvas',
          inputSchema: {
            type: 'object',
            properties: { status: { type: 'string' } },
          },
          execute: async (args) => ({
            result: { ok: true, applied: args.status },
            imageDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
          }),
        },
      ]);

      class TestLiveView extends LitElement {
        readonly live = new LiveSessionController(this, {
          mode: 'audio',
          chimePreset: 'off',
          toolHost,
        });

        protected override render() {
          return html`<div id="status">${this.live.status}</div>
            <ul>
              ${this.live.transcript.map((item) => html`<li>${item.text}</li>`)}
            </ul>`;
        }
      }
      if (!customElements.get('test-live-view')) {
        customElements.define('test-live-view', TestLiveView);
      }

      const el = document.createElement('test-live-view') as TestLiveView;
      document.body.appendChild(el);
      await el.updateComplete;

      await el.live.connect({
        endpoint: '/ws/live',
        initialPayload: { voiceName: 'Puck' },
        advertisePageTools: true,
        autoStartMic: false,
      });

      const ws = MockWebSocket.instances[0];
      expect(ws).toBeDefined();
      ws.open();
      await el.updateComplete;
      expect(el.shadowRoot?.querySelector('#status')?.textContent).toBe(
        'Connected',
      );

      // Verify initialPayload included voiceName + advertised WebMCP tools:
      const setupSent = JSON.parse(ws.sent[0]) as {
        voiceName: string;
        tools: Array<{ name: string }>;
      };
      expect(setupSent.voiceName).toBe('Puck');
      expect(setupSent.tools.map((t) => t.name)).toEqual(['paint_status']);

      // Server relays page tool_call -> LiveSession executes & sends tool_result with image:
      ws.emitJson({
        type: 'tool_call',
        id: 'tc-42',
        name: 'paint_status',
        args: { status: 'nominal' },
      });

      await new Promise((r) => setTimeout(r, 25));
      const toolResultSent = JSON.parse(ws.sent[1]) as Record<string, unknown>;
      expect(toolResultSent.type).toBe('tool_result');
      expect(toolResultSent.id).toBe('tc-42');
      expect(toolResultSent.image).toBe('data:image/jpeg;base64,/9j/4AAQ');

      // Server streams assistant output_transcript -> Lit element re-renders:
      ws.emitJson({
        type: 'output_transcript',
        text: 'Canvas updated to nominal.',
        finished: true,
      });
      await el.updateComplete;
      expect(el.shadowRoot?.textContent).toContain(
        'Canvas updated to nominal.',
      );

      // Verify standalone LiveSession gates mic audio until first server message,
      // and sends graceful terminate control frame:
      const standalone = new LiveSession({ mode: 'audio' });
      await standalone.connect({
        url: 'ws://localhost/ws',
        autoStartMic: false,
      });
      const ws2 = MockWebSocket.instances[1];
      ws2.open();
      standalone.socket.sendAudioChunk('AAAA');
      expect(ws2.sent.length).toBe(0);
      ws2.emitJson({
        type: 'session_info',
        mode: 'audio',
        model: 'gemini-3.8-live',
      });
      standalone.socket.sendAudioChunk('AAAA');
      expect(ws2.sent.length).toBe(1);
      standalone.terminate();
      expect(JSON.parse(ws2.sent[1])).toEqual({
        type: 'control',
        action: 'terminate',
      });

      el.remove();
    } finally {
      globalThis.WebSocket = RealWS;
    }
  });
});

describe('LiveSocketClient termination lifecycle', () => {
  it('resets isTerminating and status on ws.onclose while suppressing abnormal-close warnings', () => {
    const RealWS = globalThis.WebSocket;
    MockWebSocket.instances = [];
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket =
      MockWebSocket;

    try {
      for (const closeCase of [
        { code: 1000, reason: 'Session terminated', expectWarning: false },
        { code: 1006, reason: '', expectWarning: false },
        { code: 1007, reason: 'Bad config', expectWarning: true },
      ]) {
        const warnings: string[] = [];
        const observedOnDisconnect: Array<{
          isTerminating: boolean;
          isConnected: boolean;
          status: string;
        }> = [];
        let warningObservedTerminating: boolean | null = null;

        const client = new LiveSocketClient();
        client.connect({
          url: 'ws://localhost/ws',
          onWarning: (msg) => {
            warnings.push(msg);
            warningObservedTerminating = client.isTerminating;
          },
          onDisconnected: () => {
            observedOnDisconnect.push({
              isTerminating: client.isTerminating,
              isConnected: client.isConnected,
              status: client.status,
            });
          },
        });

        const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
        ws.open();

        client.terminate();
        expect(client.isTerminating).toBe(true);
        expect(client.status).toBe('Disconnecting...');

        ws.close(closeCase.code, closeCase.reason);

        expect(client.isTerminating).toBe(false);
        expect(client.isConnected).toBe(false);
        expect(client.status).toBe('Disconnected');
        expect(observedOnDisconnect).toEqual([
          {
            isTerminating: false,
            isConnected: false,
            status: 'Disconnected',
          },
        ]);
        if (closeCase.expectWarning) {
          expect(warnings).toEqual(['Bad config']);
          expect(warningObservedTerminating).toBe(false);
        } else {
          expect(warnings).toEqual([]);
        }
      }
    } finally {
      globalThis.WebSocket = RealWS;
    }
  });

  it('resets isTerminating and status when terminate() fallback timeout fires', () => {
    const RealWS = globalThis.WebSocket;
    MockWebSocket.instances = [];
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket =
      MockWebSocket;
    vi.useFakeTimers();

    try {
      let disconnectCount = 0;
      let stateOnDisconnect: { isTerminating: boolean; status: string } | null =
        null;

      const client = new LiveSocketClient();
      client.connect({
        url: 'ws://localhost/ws',
        terminateTimeoutMs: 50,
        onDisconnected: () => {
          disconnectCount++;
          stateOnDisconnect = {
            isTerminating: client.isTerminating,
            status: client.status,
          };
        },
      });

      const ws = MockWebSocket.instances[0];
      ws.open();

      client.terminate();
      expect(client.isTerminating).toBe(true);
      expect(client.status).toBe('Disconnecting...');

      vi.advanceTimersByTime(50);

      expect(client.isTerminating).toBe(false);
      expect(client.isConnected).toBe(false);
      expect(client.status).toBe('Disconnected');
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
      expect(disconnectCount).toBe(1);
      expect(stateOnDisconnect).toEqual({
        isTerminating: false,
        status: 'Disconnected',
      });
    } finally {
      vi.useRealTimers();
      globalThis.WebSocket = RealWS;
    }
  });

  it('resets isTerminating and cancels fallback timer when disconnect() follows terminate()', () => {
    const RealWS = globalThis.WebSocket;
    MockWebSocket.instances = [];
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket =
      MockWebSocket;
    vi.useFakeTimers();

    try {
      let disconnectCount = 0;
      const client = new LiveSocketClient();
      client.connect({
        url: 'ws://localhost/ws',
        terminateTimeoutMs: 50,
        onDisconnected: () => {
          disconnectCount++;
        },
      });

      const ws = MockWebSocket.instances[0];
      ws.open();

      client.terminate();
      expect(client.isTerminating).toBe(true);

      client.disconnect();
      expect(client.isTerminating).toBe(false);
      expect(client.status).toBe('Disconnected');
      expect(disconnectCount).toBe(1);

      vi.advanceTimersByTime(100);
      expect(disconnectCount).toBe(1);
    } finally {
      vi.useRealTimers();
      globalThis.WebSocket = RealWS;
    }
  });

  it('does not stick isTerminating when terminate() is called while idle, connecting, or closed', () => {
    const RealWS = globalThis.WebSocket;
    MockWebSocket.instances = [];
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket =
      MockWebSocket;

    try {
      const idle = new LiveSocketClient();
      idle.terminate();
      expect(idle.isTerminating).toBe(false);
      expect(idle.status).toBe('Disconnected');

      const client = new LiveSocketClient();
      client.connect({ url: 'ws://localhost/ws' });
      const ws = MockWebSocket.instances[0];
      expect(ws.readyState).toBe(MockWebSocket.CONNECTING);

      client.terminate();
      expect(client.isTerminating).toBe(false);
      expect(client.status).toBe('Disconnected');
      expect(ws.readyState).toBe(MockWebSocket.CLOSED);

      // Calling terminate() again when already closed stays clean.
      client.terminate();
      expect(client.isTerminating).toBe(false);
      expect(client.status).toBe('Disconnected');
    } finally {
      globalThis.WebSocket = RealWS;
    }
  });

  it('re-enables Lit LiveSessionController controls after graceful terminate()', async () => {
    const RealWS = globalThis.WebSocket;
    MockWebSocket.instances = [];
    (globalThis as unknown as { WebSocket: typeof MockWebSocket }).WebSocket =
      MockWebSocket;

    try {
      class TestTerminateView extends LitElement {
        readonly live = new LiveSessionController(this, {
          mode: 'audio',
          chimePreset: 'off',
        });

        protected override render() {
          return html`<button
              id="start"
              ?disabled=${this.live.isConnected || this.live.isTerminating}
            >
              ${this.live.isTerminating ? 'Ending...' : 'Start'}
            </button>
            <span id="status">${this.live.status}</span>`;
        }
      }
      if (!customElements.get('test-terminate-view')) {
        customElements.define('test-terminate-view', TestTerminateView);
      }

      const el = document.createElement(
        'test-terminate-view',
      ) as TestTerminateView;
      document.body.appendChild(el);
      await el.updateComplete;

      await el.live.connect({
        url: 'ws://localhost/ws',
        autoStartMic: false,
      });
      const ws = MockWebSocket.instances[0];
      ws.open();
      await el.updateComplete;

      const startBtn = () =>
        el.shadowRoot?.querySelector('#start') as HTMLButtonElement;
      const statusText = () =>
        el.shadowRoot?.querySelector('#status')?.textContent;

      expect(startBtn().disabled).toBe(true);
      expect(statusText()).toBe('Connected');

      el.live.terminate();
      await el.updateComplete;
      expect(el.live.isTerminating).toBe(true);
      expect(startBtn().disabled).toBe(true);
      expect(statusText()).toBe('Disconnecting...');

      ws.close(1000, 'Session terminated');
      await el.updateComplete;
      expect(el.live.isTerminating).toBe(false);
      expect(el.live.isConnected).toBe(false);
      expect(startBtn().disabled).toBe(false);
      expect(statusText()).toBe('Disconnected');

      el.remove();
    } finally {
      globalThis.WebSocket = RealWS;
    }
  });
});
