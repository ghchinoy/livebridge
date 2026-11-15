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

import { WebmcpToolError, WebmcpToolHost } from '@ghchinoy/livebridge';
import { LiveSessionController } from '@ghchinoy/livebridge/lit';
import { LitElement, css, html } from 'lit';

type NodeHealth = 'healthy' | 'degraded' | 'down';

interface ServiceNode {
  id: string;
  label: string;
  status: NodeHealth;
  x: number;
  y: number;
}

const COLORS: Record<NodeHealth, string> = {
  healthy: '#22c55e',
  degraded: '#f59e0b',
  down: '#ef4444',
};

export class OpsWatchtowerApp extends LitElement {
  static override styles = css`
    :host {
      display: block;
      max-width: 1120px;
      margin: 0 auto;
      padding: 1.25rem;
    }
    .grid {
      display: grid;
      grid-template-columns: 500px 1fr;
      gap: 1.2rem;
    }
    @media (max-width: 900px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
    .card {
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 16px;
      padding: 1.1rem;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }
    canvas {
      width: 100%;
      border-radius: 12px;
      background: #030712;
      border: 1px solid #1f2937;
    }
    .row {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
    button {
      padding: 0.5rem 0.9rem;
      border-radius: 999px;
      border: 1px solid #334155;
      background: #1e293b;
      color: #f8fafc;
      font-weight: 600;
      cursor: pointer;
    }
    button.primary {
      background: #38bdf8;
      color: #082f49;
      border-color: transparent;
    }
    button.warn {
      background: #f59e0b;
      color: #451a03;
      border-color: transparent;
    }
    button:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .transcript {
      height: 360px;
      overflow-y: auto;
      background: #030712;
      border-radius: 12px;
      padding: 0.85rem;
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
    }
    .turn {
      padding: 0.55rem 0.8rem;
      border-radius: 10px;
      max-width: 88%;
      font-size: 0.9rem;
    }
    .turn.user {
      align-self: flex-end;
      background: #1d4ed8;
    }
    .turn.assistant {
      align-self: flex-start;
      background: #1e293b;
    }
    .turn.tool {
      align-self: stretch;
      background: #0f172a;
      border: 1px solid #334155;
      font-family: ui-monospace, monospace;
      font-size: 0.78rem;
    }
    .meta {
      font-size: 0.8rem;
      color: #94a3b8;
    }
    input {
      flex: 1;
      padding: 0.5rem 0.75rem;
      border-radius: 8px;
      border: 1px solid #334155;
      background: #030712;
      color: #f8fafc;
    }
  `;

  private readonly nodes: ServiceNode[] = [
    { id: 'api-gateway', label: 'API Gateway', status: 'healthy', x: 120, y: 90 },
    { id: 'auth-service', label: 'Auth Service', status: 'healthy', x: 360, y: 90 },
    { id: 'payments-db', label: 'Payments DB', status: 'healthy', x: 120, y: 230 },
    { id: 'live-relay', label: 'Live Relay', status: 'healthy', x: 360, y: 230 },
  ];

  private readonly toolHost = new WebmcpToolHost((signal) => ({ signal }));
  private readonly live = new LiveSessionController(this, {
    mode: 'audio',
    chimePreset: 'soft',
    toolHost: this.toolHost,
  });

  private lastTiming = '';
  private lastAlert = '';

  override async connectedCallback(): Promise<void> {
    super.connectedCallback();
    await this.toolHost.register([
      {
        name: 'inspect_topology',
        description:
          'Returns current health status of all services on the topology canvas and captures a visual snapshot.',
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        execute: async () => ({
          result: {
            nodes: this.nodes.map(({ id, status }) => ({ id, status })),
          },
          imageDataUrl: this.renderCanvasSnapshot(),
        }),
      },
      {
        name: 'set_node_status',
        description:
          'Updates a service node status on the topology canvas (healthy, degraded, or down) and captures a visual snapshot.',
        inputSchema: {
          type: 'object',
          properties: {
            node: { type: 'string', description: 'Service node ID' },
            status: {
              type: 'string',
              enum: ['healthy', 'degraded', 'down'],
            },
          },
          required: ['node', 'status'],
        },
        execute: async (args) => {
          const id = String(args.node ?? '').trim();
          const st = String(args.status ?? '') as NodeHealth;
          const target = this.nodes.find((n) => n.id === id);
          if (!target) {
            throw new WebmcpToolError(`Unknown node "${id}"`);
          }
          if (!COLORS[st]) {
            throw new WebmcpToolError(`Invalid status "${st}"`);
          }
          target.status = st;
          const snapshot = this.renderCanvasSnapshot();
          this.requestUpdate();
          return {
            result: { updated: id, status: st },
            imageDataUrl: snapshot,
          };
        },
      },
    ]);
  }

  protected override firstUpdated(): void {
    this.renderCanvasSnapshot();
  }

  private renderCanvasSnapshot(): string {
    const canvas = this.renderRoot.querySelector('canvas');
    if (!canvas) return '';
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Edges
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    const pairs: Array<[number, number]> = [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
    ];
    for (const [a, b] of pairs) {
      ctx.beginPath();
      ctx.moveTo(this.nodes[a].x, this.nodes[a].y);
      ctx.lineTo(this.nodes[b].x, this.nodes[b].y);
      ctx.stroke();
    }

    // Nodes
    for (const node of this.nodes) {
      ctx.fillStyle = '#111827';
      ctx.strokeStyle = COLORS[node.status];
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(node.x - 85, node.y - 34, 170, 68, 12);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 14px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.label, node.x, node.y - 4);

      ctx.fillStyle = COLORS[node.status];
      ctx.font = '12px ui-monospace, monospace';
      ctx.fillText(node.status.toUpperCase(), node.x, node.y + 18);
    }

    return canvas.toDataURL('image/jpeg', 0.82);
  }

  private async startSession(): Promise<void> {
    await this.live.connect({
      endpoint: '/ws/live',
      advertisePageTools: true,
      onProactiveAlert: (alert) => {
        this.lastAlert = `${String(alert.source ?? 'ops')}: ${String(alert.summary ?? '')}`;
        this.requestUpdate();
      },
      onCustomMessage: (msg) => {
        if (msg.type === 'tool_timing') {
          this.lastTiming = `${String(msg.name)}: ${String(msg.execMs)}ms page / ${String(msg.roundTripMs)}ms RTT`;
          this.requestUpdate();
        }
      },
    });
  }

  private async simulateIncident(): Promise<void> {
    await fetch('/api/incident', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'payments-db',
        title: 'Replication lag spiked to 4.8s',
        logs: 'WARN primary->replica-2 wal_lag_ms=4810 conn_pool=98%',
      }),
    });
  }

  private cycleChime(): void {
    this.live.session.chime.cycleMode();
    this.requestUpdate();
  }

  private handlePrompt(e: SubmitEvent): void {
    e.preventDefault();
    const input = this.renderRoot.querySelector('input');
    if (input && this.live.sendText(input.value)) {
      input.value = '';
    }
  }

  protected override render() {
    const active = this.live.isConnected && !this.live.isTerminating;
    return html`
      <div class="grid">
        <section class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>Live Service Topology (WebMCP + SeeVisualResults)</strong>
            <span class="meta">Mode: ${this.toolHost.mode}</span>
          </div>
          <canvas width="480" height="320"></canvas>
          <div class="row">
            <button class="warn" @click=${() => void this.simulateIncident()}>
              Simulate Incident Webhook
            </button>
            <button @click=${() => this.cycleChime()}>
              Chime: ${this.live.session.chime.mode}
            </button>
          </div>
          ${this.lastTiming
            ? html`<div class="meta">Last page tool: ${this.lastTiming}</div>`
            : null}
          ${this.lastAlert
            ? html`<div class="meta" style="color:#fcd34d">
                Alert: ${this.lastAlert}
              </div>`
            : null}
        </section>

        <section class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>04 · Ops Watchtower</strong>
            <span class="meta">${this.live.status}</span>
          </div>
          <div class="row">
            <button
              class="primary"
              ?disabled=${this.live.isConnected || this.live.isTerminating}
              @click=${() => void this.startSession()}
            >
              Connect Copilot
            </button>
            <button
              ?disabled=${!active}
              @click=${() => void this.live.toggleMic()}
            >
              ${this.live.isRecording ? 'Mute Mic' : 'Unmute Mic'}
            </button>
            <button ?disabled=${!active} @click=${() => this.live.terminate()}>
              End Session
            </button>
          </div>
          <div class="transcript" aria-live="polite">
            ${this.live.transcript.map(
              (item) =>
                html`<div class="turn ${item.type}">${item.text}</div>`,
            )}
          </div>
          <form class="row" @submit=${(e: SubmitEvent) => this.handlePrompt(e)}>
            <input placeholder="e.g. Mark payments-db degraded and inspect topology" />
            <button type="submit" ?disabled=${!active}>Send</button>
          </form>
        </section>
      </div>
    `;
  }
}

if (!customElements.get('ops-watchtower-app')) {
  customElements.define('ops-watchtower-app', OpsWatchtowerApp);
}
