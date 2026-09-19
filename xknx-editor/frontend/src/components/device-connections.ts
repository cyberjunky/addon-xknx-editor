import { LitElement, css, html, nothing, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { api, ApiError } from "../api.js";
import { formatDpt, onDptNames } from "../dpt-format.js";
import { t as tr } from "../i18n.js";
import { store } from "../store.js";

type Peer = {
  device_id: number;
  name: string;
  individual_address: string | null;
  object_number: number;
  object_name: string;
  sending: boolean;
};
type Connections = {
  device: { id: number; name: string; individual_address: string | null };
  objects: {
    number: number;
    name: string;
    dpt: string | null;
    flags: string;
    links: { group_address_id: number; sending: boolean }[];
  }[];
  group_addresses: {
    id: number;
    address: number;
    text: string;
    name: string;
    dpt: string | null;
    peers: Peer[];
  }[];
};

/** A flash on one group address: who sent it, the value, and until when it shows. */
type Pulse = { from: string; value: string; until: number; seq: number };

const ROW = 38;
const BOX_H = 30;
const GAP = 120;
/** Inside a box: the padding either side, and the gap between address and name (the tspan's dx). */
const PAD = 8;
const DX = 6;
const MIN_COL = 160;

/** How a device reaches the rest of the installation: its group objects' addresses in the middle,
 * every other device on them on the right. Telegrams on those addresses run along the lines. */
@customElement("xknx-device-connections")
export class DeviceConnections extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-size: 12px;
    }
    .scroll {
      overflow: auto;
      max-height: 70vh;
    }
    svg text {
      fill: var(--ha-text);
      font-family: inherit;
    }
    .box {
      fill: var(--ha-card);
      stroke: var(--ha-divider);
    }
    .box.self {
      stroke: var(--ha-primary);
      stroke-width: 2;
    }
    .box.ga {
      fill: color-mix(in srgb, var(--ha-primary) 8%, var(--ha-card));
    }
    .box.hot {
      stroke: var(--ha-success);
      stroke-width: 2;
    }
    .addr {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      fill: var(--ha-text-2);
    }
    .muted {
      fill: var(--ha-text-2);
    }
    .edge {
      fill: none;
      stroke: var(--ha-divider);
      stroke-width: 1.5;
    }
    .edge.sending {
      stroke: color-mix(in srgb, var(--ha-primary) 60%, var(--ha-divider));
    }
    .edge.hot {
      stroke: var(--ha-success);
      stroke-width: 2.5;
    }
    .click {
      cursor: pointer;
    }
    .bubble rect {
      fill: var(--ha-success);
    }
    .bubble text {
      fill: #fff;
      font-weight: 500;
    }
    .dot {
      fill: var(--ha-success);
    }
    .legend {
      display: flex;
      gap: 16px;
      color: var(--ha-text-2);
      margin: 0 0 8px;
      flex-wrap: wrap;
    }
    .empty {
      color: var(--ha-text-2);
      padding: 12px 0;
    }
  `;

  @property({ type: Number }) deviceId = 0;
  @state() private data: Connections | null = null;
  @state() private pulses = new Map<number, Pulse>();
  private unsubscribe = () => {};
  private unsubscribeDpt = () => {};
  private lastTelegram = 0;
  private loaded = { id: -1, rev: -1 };
  private timer: number | undefined;
  private seq = 0;

  connectedCallback(): void {
    super.connectedCallback();
    this.lastTelegram = store.telegrams.at(-1)?.id ?? 0;
    this.unsubscribe = store.subscribe(() => {
      void this.sync();
      this.onTelegrams();
    });
    this.unsubscribeDpt = onDptNames(() => this.requestUpdate());
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    this.unsubscribeDpt();
    window.clearInterval(this.timer);
    super.disconnectedCallback();
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has("deviceId")) void this.sync(true);
  }

  private async sync(force = false): Promise<void> {
    if (
      !force &&
      this.loaded.id === this.deviceId &&
      this.loaded.rev === store.revision
    )
      return;
    this.loaded = { id: this.deviceId, rev: store.revision };
    try {
      this.data = await api.get<Connections>(
        `api/devices/${this.deviceId}/connections`,
      );
    } catch (e) {
      this.data = null;
      // 422: no product data for this device; 404: it has just been removed.
      if (!(e instanceof ApiError && (e.status === 422 || e.status === 404)))
        store.say(e instanceof ApiError ? e.message : String(e), "danger");
    }
  }

  /** New telegrams on one of the drawn addresses light up their lines for a moment. */
  private onTelegrams(): void {
    const d = this.data;
    const fresh = store.telegrams.filter((t) => t.id > this.lastTelegram);
    this.lastTelegram = store.telegrams.at(-1)?.id ?? this.lastTelegram;
    if (!d || !fresh.length) return;
    const byValue = new Map(d.group_addresses.map((g) => [g.address, g.id]));
    let changed = false;
    for (const t of fresh) {
      const id = t.ga !== null && t.ga !== undefined ? byValue.get(t.ga) : undefined;
      if (id === undefined) continue;
      const value =
        t.value === null || t.value === undefined
          ? t.apci.replace("GroupValue", "")
          : `${String(t.value)}${t.unit ? ` ${t.unit}` : ""}`;
      this.pulses.set(id, {
        from: t.source,
        value,
        until: Date.now() + 2500,
        seq: ++this.seq,
      });
      changed = true;
    }
    if (!changed) return;
    this.pulses = new Map(this.pulses);
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      const now = Date.now();
      let left = false;
      for (const [id, p] of this.pulses) {
        if (p.until <= now) this.pulses.delete(id);
        else left = true;
      }
      this.pulses = new Map(this.pulses);
      if (!left) window.clearInterval(this.timer);
    }, 250);
  }

  /** An SVG box gets no layout of its own, so it is sized from the measured text it holds. */
  private ctx: CanvasRenderingContext2D | null = null;

  private textWidth(text: string, mono: boolean): number {
    if (!this.ctx) this.ctx = document.createElement("canvas").getContext("2d");
    if (!this.ctx) return text.length * (mono ? 7.2 : 6.6);
    const family = mono
      ? "ui-monospace, Menlo, Consolas, monospace"
      : getComputedStyle(this).fontFamily || "sans-serif";
    this.ctx.font = `12px ${family}`;
    return this.ctx.measureText(text).width;
  }

  /** Wide enough for the widest address + name in the column, so no name has to be cut. */
  private columnWidth(rows: { addr: string; name: string }[]): number {
    let w = MIN_COL;
    for (const r of rows)
      w = Math.max(
        w,
        PAD + this.textWidth(r.addr, true) + DX + this.textWidth(r.name, false) + PAD,
      );
    return Math.ceil(w);
  }

  render() {
    const d = this.data;
    if (!d) return html`<div class="empty">${tr("Loading…")}</div>`;
    if (!d.group_addresses.length)
      return html`<div class="empty">
        ${tr("This device has no linked group objects yet.")}
      </div>`;
    // Which of the device's own links send, per address.
    const sends = new Set<number>();
    for (const o of d.objects)
      for (const l of o.links) if (l.sending) sends.add(l.group_address_id);
    // Peers: one box per device, in order of first appearance.
    const peers: {
      device_id: number;
      name: string;
      individual_address: string | null;
    }[] = [];
    const peerIndex = new Map<number, number>();
    for (const g of d.group_addresses)
      for (const p of g.peers)
        if (!peerIndex.has(p.device_id)) {
          peerIndex.set(p.device_id, peers.length);
          peers.push(p);
        }
    const rows = Math.max(d.group_addresses.length, peers.length, 1);
    const height = rows * ROW + 20;
    const self = d.device;
    // Every column is as wide as its own longest line; the diagram scrolls if that is wide.
    const w0 = this.columnWidth([
      { addr: self.individual_address ?? "-.-.-", name: self.name },
    ]);
    const w1 = this.columnWidth(
      d.group_addresses.map((g) => ({ addr: g.text, name: g.name })),
    );
    const w2 = this.columnWidth(
      peers.map((p) => ({ addr: p.individual_address ?? "-.-.-", name: p.name })),
    );
    const x0 = 10;
    const x1 = x0 + w0 + GAP;
    const x2 = x1 + w1 + GAP;
    const width = x2 + w2 + 10;
    const selfY = height / 2 - BOX_H / 2;
    const gaY = (i: number) =>
      10 + i * ROW + ((rows - d.group_addresses.length) * ROW) / 2;
    const peerY = (i: number) => 10 + i * ROW + ((rows - peers.length) * ROW) / 2;
    const curve = (xa: number, ya: number, xb: number, yb: number) => {
      const mid = (xa + xb) / 2;
      return `M${xa},${ya} C${mid},${ya} ${mid},${yb} ${xb},${yb}`;
    };
    return html`
      <div class="legend">
        <span>${d.group_addresses.length} ${tr("group addresses")}</span>
        <span>${peers.length} ${tr("other devices")}</span>
        <span
          >${tr("A coloured line sends; telegrams light up the address they are sent to.")}</span
        >
      </div>
      <div class="scroll">
        <svg width=${width} height=${height} viewBox="0 0 ${width} ${height}">
          ${d.group_addresses.map((g, i) => {
            const hot = this.pulses.has(g.id);
            const y = gaY(i) + BOX_H / 2;
            return svg`<path class="edge ${sends.has(g.id) ? "sending" : ""} ${hot ? "hot" : ""}" d=${curve(x0 + w0, selfY + BOX_H / 2, x1, y)}></path>
              ${g.peers.map((p) => svg`<path class="edge ${p.sending ? "sending" : ""} ${hot ? "hot" : ""}" d=${curve(x1 + w1, y, x2, peerY(peerIndex.get(p.device_id)!) + BOX_H / 2)}></path>`)}`;
          })}
          <g>
            <rect class="box self" x=${x0} y=${selfY} width=${w0} height=${BOX_H} rx="6"></rect>
            <text x=${x0 + 8} y=${selfY + 19}>
              <tspan class="addr">${self.individual_address ?? "-.-.-"}</tspan>
              <tspan dx="6">${self.name}</tspan>
            </text>
          </g>
          ${d.group_addresses.map((g, i) => {
            const y = gaY(i);
            const pulse = this.pulses.get(g.id);
            const bw = pulse ? Math.ceil(this.textWidth(pulse.value, false)) + 16 : 0;
            return svg`<g class="click" @click=${() => store.selectGroupAddress(g.id)}>
              <title>${g.text} ${g.name}${g.dpt ? ` · ${formatDpt(g.dpt)}` : ""}\n${g.peers.map((p) => `${p.individual_address ?? "-"} ${p.name} · #${p.object_number} ${p.object_name}${p.sending ? " (sends)" : ""}`).join("\n")}</title>
              <rect class="box ga ${pulse ? "hot" : ""}" x=${x1} y=${y} width=${w1} height=${BOX_H} rx="6"></rect>
              <text x=${x1 + 8} y=${y + 19}><tspan class="addr">${g.text}</tspan><tspan dx="6">${g.name}</tspan></text>
              ${
                pulse
                  ? svg`<g class="bubble">
                      <rect x=${x1 + w1 + 6 - bw} y=${y - 14} width=${bw} height="18" rx="9"></rect>
                      <text x=${x1 + w1 + 6 - bw / 2} y=${y - 1} text-anchor="middle">${pulse.value}</text>
                    </g>
                    <circle class="dot" r="4">
                      <animateMotion dur="0.8s" repeatCount="1" fill="freeze" path=${this.pulsePath(pulse, self.individual_address, x0, x1, x2, w0, w1, selfY, y, peers, peerIndex, peerY)}></animateMotion>
                    </circle>`
                  : nothing
              }
            </g>`;
          })}
          ${peers.map((p, i) => {
            const y = peerY(i);
            return svg`<g class="click" @click=${() => store.select(p.device_id)}>
              <title>${p.individual_address ?? "-"} ${p.name}</title>
              <rect class="box" x=${x2} y=${y} width=${w2} height=${BOX_H} rx="6"></rect>
              <text x=${x2 + 8} y=${y + 19}><tspan class="addr">${p.individual_address ?? "-.-.-"}</tspan><tspan dx="6">${p.name}</tspan></text>
            </g>`;
          })}
        </svg>
      </div>
    `;
  }

  /** The route a telegram's dot travels: from its sender to the address box. */
  private pulsePath(
    pulse: Pulse,
    selfAddress: string | null,
    x0: number,
    x1: number,
    x2: number,
    w0: number,
    w1: number,
    selfY: number,
    gaY: number,
    peers: { device_id: number; individual_address: string | null }[],
    peerIndex: Map<number, number>,
    peerY: (i: number) => number,
  ): string {
    const y = gaY + BOX_H / 2;
    if (pulse.from === selfAddress)
      return `M${x0 + w0},${selfY + BOX_H / 2} L${x1},${y}`;
    const peer = peers.find((p) => p.individual_address === pulse.from);
    if (peer) {
      const py = peerY(peerIndex.get(peer.device_id)!) + BOX_H / 2;
      return `M${x2},${py} L${x1 + w1},${y}`;
    }
    return `M${x1 + w1 / 2},${gaY - 20} L${x1 + w1 / 2},${gaY}`;
  }
}
