import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import ForceGraph, { type LinkObject, type NodeObject } from "force-graph";
import { api, ApiError } from "../api.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { t as tr } from "../i18n.js";
import { dptTitle, formatDpt, onDptNames } from "../dpt-format.js";

type NetNode = NodeObject & {
  kind: "device" | "ga";
  id: string;
  name: string;
  address: string | null;
  device_id?: number;
  ga_id?: number;
  ga?: number;
  room?: string;
  product?: string;
  dpt?: string | null;
};
type NetLink = LinkObject & {
  source: string | NetNode;
  target: string | NetNode;
  sending: boolean;
};
type Network = {
  nodes: NetNode[];
  links: NetLink[];
  devices: number;
  addresses: number;
  unlinked: number;
};
type Graph = ForceGraph<NetNode, NetLink>;

const PALETTE = [
  "#03a9f4",
  "#ff9800",
  "#43a047",
  "#9c27b0",
  "#e91e63",
  "#00acc1",
  "#fdd835",
  "#8d6e63",
  "#5c6bc0",
  "#7cb342",
  "#f4511e",
  "#26a69a",
];

function hashColor(key: string): string {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function idOf(x: string | NetNode): string {
  return typeof x === "string" ? x : x.id;
}

/** Centre view: devices and group addresses as a force-directed graph, edges for the links in the
 * project, pulsing with live traffic. */
@customElement("xknx-network-view")
export class NetworkView extends LitElement {
  static styles = css`
    sl-button::part(label) {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    :host {
      display: grid;
      grid-template-rows: auto 1fr;
      height: 100%;
      min-height: 0;
      font-size: 13px;
    }
    .toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 6px 8px;
      border-bottom: 1px solid var(--ha-divider);
      flex-wrap: wrap;
    }
    .canvas {
      position: relative;
      min-height: 0;
      overflow: hidden;
    }
    .canvas > div {
      position: absolute;
      inset: 0;
    }
    .card {
      position: absolute;
      top: 10px;
      right: 10px;
      z-index: 5;
      width: 260px;
      background: var(--ha-card);
      border: 1px solid var(--ha-divider);
      border-radius: var(--ha-radius);
      padding: 10px 12px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
      font-size: 12px;
    }
    .card h4 {
      margin: 0 0 4px;
      font-size: 13px;
      font-weight: 500;
    }
    .card .addr {
      font-family: ui-monospace, Menlo, Consolas, monospace;
    }
    .card .actions {
      display: flex;
      gap: 6px;
      margin-top: 8px;
    }
    .legend {
      display: flex;
      gap: 12px;
      font-size: 12px;
      color: var(--ha-text-2);
      align-items: center;
    }
    .legend i {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 4px;
      vertical-align: -1px;
      background: var(--ha-text-2);
    }
    .legend i.ga {
      border-radius: 2px;
      transform: rotate(45deg);
      width: 8px;
      height: 8px;
    }
    .muted {
      color: var(--ha-text-2);
    }
    .empty {
      padding: 16px;
      color: var(--ha-text-2);
    }
  `;

  @state() private net: Network | null = null;
  @state() private query = "";
  @state() private room = "";
  @state() private selected: NetNode | null = null;
  @state() private loading = false;
  private graph: Graph | null = null;
  private resize: ResizeObserver | null = null;
  private unsubscribe = () => {};
  private revision = -1;
  private byGa = new Map<number, NetNode>();
  private linksOf = new Map<string, NetLink[]>();
  private active = new Map<string, number>();
  private lastTelegram = 0;
  private hover: NetNode | null = null;
  private neighbours = new Set<string>();

  private unsubscribeDpt = () => {};

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = store.subscribe(() => this.onStore());
    this.unsubscribeDpt = onDptNames(() => this.requestUpdate());
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    this.unsubscribeDpt();
    this.resize?.disconnect();
    this.graph?._destructor();
    this.graph = null;
    super.disconnectedCallback();
  }

  firstUpdated(): void {
    const host = this.renderRoot.querySelector(".canvas > div") as HTMLElement;
    this.graph = this.build(host);
    this.resize = new ResizeObserver(() => {
      const box = this.renderRoot.querySelector(".canvas") as HTMLElement;
      if (box && this.graph)
        this.graph.width(box.clientWidth).height(box.clientHeight);
    });
    this.resize.observe(
      this.renderRoot.querySelector(".canvas") as HTMLElement,
    );
    this.onStore();
  }

  private onStore(): void {
    if (store.revision !== this.revision) void this.load();
    this.pulse();
    this.requestUpdate();
  }

  private async load(): Promise<void> {
    this.revision = store.revision;
    if (!store.project.open) {
      this.net = null;
      this.graph?.graphData({ nodes: [], links: [] });
      return;
    }
    this.loading = true;
    try {
      this.net = await api.get<Network>("api/project/network");
      this.apply();
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    } finally {
      this.loading = false;
    }
  }

  /** Feed the (room-filtered) graph. force-graph mutates the objects it is given, so the indexes
   * are built on the very same objects and `emitParticle` finds its links. */
  private apply(): void {
    if (!this.net || !this.graph) return;
    let nodes = this.net.nodes;
    let links = this.net.links;
    if (this.room) {
      const keep = new Set(
        nodes
          .filter((n) => n.kind === "device" && (n.room || "") === this.room)
          .map((n) => n.id),
      );
      links = links.filter((l) => keep.has(idOf(l.source)));
      for (const l of links) keep.add(idOf(l.target));
      nodes = nodes.filter((n) => keep.has(n.id));
    }
    this.byGa.clear();
    this.linksOf.clear();
    for (const n of nodes)
      if (n.kind === "ga" && n.ga !== undefined) this.byGa.set(n.ga, n);
    for (const l of links) {
      for (const end of [idOf(l.source), idOf(l.target)]) {
        const list = this.linksOf.get(end) ?? [];
        list.push(l);
        this.linksOf.set(end, list);
      }
    }
    this.graph.graphData({ nodes, links });
    window.setTimeout(() => this.graph?.zoomToFit(400, 40), 600);
  }

  /** Live traffic: a telegram on a group address flashes its node and sends a particle along each
   * of its links. */
  private pulse(): void {
    if (!this.graph || !this.byGa.size) return;
    const fresh = store.telegrams.filter((t) => t.id > this.lastTelegram);
    if (!fresh.length) return;
    this.lastTelegram = fresh[fresh.length - 1].id;
    const now = Date.now();
    for (const t of fresh) {
      if (t.ga === null || t.ga === undefined) continue;
      const node = this.byGa.get(t.ga);
      if (!node) continue;
      this.active.set(node.id, now);
      for (const l of this.linksOf.get(node.id) ?? [])
        this.graph.emitParticle(l);
    }
  }

  private colors() {
    const cs = getComputedStyle(this);
    const v = (name: string, fallback: string) =>
      cs.getPropertyValue(name).trim() || fallback;
    return {
      text: v("--ha-text", "#212121"),
      muted: v("--ha-text-2", "#727272"),
      divider: v("--ha-divider", "rgba(0,0,0,0.12)"),
      primary: v("--ha-primary", "#03a9f4"),
    };
  }

  private build(host: HTMLElement): Graph {
    const c = this.colors();
    const graph = new ForceGraph<NetNode, NetLink>(host);
    graph
      .backgroundColor("rgba(0,0,0,0)")
      .nodeId("id")
      .linkColor((l) => (l.sending ? c.muted : c.divider))
      .linkWidth((l) => (l.sending ? 1.2 : 0.8))
      .linkDirectionalArrowLength((l) => (l.sending ? 4 : 0))
      .linkDirectionalArrowRelPos(1)
      .linkDirectionalParticleWidth(3.5)
      .linkDirectionalParticleColor(() => c.primary)
      .linkDirectionalParticleSpeed(0.02)
      .nodeCanvasObject((n, ctx, scale) => this.drawNode(n, ctx, scale))
      .nodePointerAreaPaint((n, color, ctx) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(
          n.x ?? 0,
          n.y ?? 0,
          n.kind === "device" ? 7 : 5,
          0,
          2 * Math.PI,
        );
        ctx.fill();
      })
      .nodeLabel(() => "")
      .onNodeHover((n) => {
        this.hover = n ?? null;
        this.neighbours.clear();
        if (this.hover) {
          this.neighbours.add(this.hover.id);
          for (const l of this.linksOf.get(this.hover.id) ?? []) {
            this.neighbours.add(idOf(l.source));
            this.neighbours.add(idOf(l.target));
          }
        }
        host.style.cursor = this.hover ? "pointer" : "";
      })
      .onNodeClick((n) => {
        this.selected = n;
      })
      .onBackgroundClick(() => (this.selected = null))
      .cooldownTicks(200)
      .d3VelocityDecay(0.3);
    (
      graph.d3Force("charge") as { strength(v: number): unknown } | undefined
    )?.strength(-60);
    return graph;
  }

  private drawNode(
    n: NetNode,
    ctx: CanvasRenderingContext2D,
    scale: number,
  ): void {
    const c = this.colors();
    const x = n.x ?? 0;
    const y = n.y ?? 0;
    const q = this.query.trim().toLowerCase();
    const matched =
      q && `${n.address ?? ""} ${n.name}`.toLowerCase().includes(q);
    const dim = (this.hover && !this.neighbours.has(n.id)) || (q && !matched);
    const since = this.active.get(n.id);
    const glow = since !== undefined && Date.now() - since < 1500;
    ctx.globalAlpha = dim ? 0.15 : 1;
    if (glow) {
      const r =
        (n.kind === "device" ? 7 : 5) + 6 * (1 - (Date.now() - since) / 1500);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = `${c.primary}55`;
      ctx.fill();
    }
    ctx.beginPath();
    if (n.kind === "device") {
      ctx.arc(x, y, 5, 0, 2 * Math.PI);
      ctx.fillStyle = hashColor(n.room || "");
      ctx.fill();
      ctx.lineWidth = 1 / scale;
      ctx.strokeStyle = c.text;
      ctx.stroke();
    } else {
      const r = 3.5;
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fillStyle = hashColor(`ga${(n.address ?? "").split("/")[0]}`);
      ctx.fill();
    }
    const showLabel =
      scale > 2.2 ||
      matched ||
      this.neighbours.has(n.id) ||
      this.selected?.id === n.id;
    if (showLabel) {
      const label =
        n.kind === "device"
          ? `${n.address ?? ""} ${n.name}`.trim()
          : `${n.address ?? ""} ${n.name}`.trim();
      ctx.font = `${11 / scale}px Roboto, sans-serif`; // 11 px on screen at any zoom
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = c.text;
      ctx.fillText(label, x, y + (n.kind === "device" ? 7 : 5));
    }
    ctx.globalAlpha = 1;
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has("room") && this.net) this.apply();
  }

  private open(n: NetNode): void {
    if (n.kind === "device" && n.device_id !== undefined)
      store.select(n.device_id);
    else if (n.ga_id !== undefined) store.selectGroupAddress(n.ga_id);
  }

  render() {
    const rooms = [
      ...new Set(
        (this.net?.nodes ?? [])
          .filter((n) => n.kind === "device")
          .map((n) => n.room || ""),
      ),
    ].sort();
    const sel = this.selected;
    return html`
      <div class="toolbar">
        <sl-input
          size="small"
          placeholder=${tr("Find (address or name)")}
          clearable
          style="width:220px"
          .value=${this.query}
          @sl-input=${(e: Event) => (this.query = (e.target as HTMLInputElement).value)}
          ><span slot="prefix">${icon("search", 14)}</span></sl-input
        >
        <sl-select
          size="small"
          hoist
          value=${this.room || "all"}
          style="width:180px"
          @sl-change=${(e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            this.room = v === "all" ? "" : v;
          }}
        >
          <sl-option value="all">${tr("All rooms")}</sl-option>
          ${rooms.map((r) => html`<sl-option value=${r || "-"}>${r || tr("No room")}</sl-option>`)}
        </sl-select>
        <sl-button size="small" @click=${() => this.graph?.zoomToFit(400, 40)}
          >${tr("Fit")}</sl-button
        >
        <span class="legend">
          <span><i></i>${tr("device (colour = room)")}</span>
          <span
            ><i class="ga"></i
            >${tr("group address (colour = main group)")}</span
          >
          <span>${tr("arrow = sending object")}</span>
        </span>
        <span style="flex:1"></span>
        ${this.net ? html`<span class="muted">${this.net.devices} ${tr("devices")} · ${this.net.addresses} ${tr("addresses")} · ${this.net.links.length} ${tr("links")}${this.net.unlinked ? ` · ${this.net.unlinked} ${tr("addresses without a link are not shown")}` : ""}</span>` : nothing}
      </div>
      <div class="canvas">
        <div></div>
        ${
          !store.project.open
            ? html`<div class="empty">
                ${tr("Open a project to see its devices and group addresses as a network.")}
              </div>`
            : this.loading && !this.net
              ? html`<div class="empty">${tr("Loading…")}</div>`
              : nothing
        }
        ${
          sel
            ? html`<div class="card">
                <h4>
                  ${sel.kind === "device" ? tr("Device") : tr("Group address")}
                </h4>
                <div class="addr">${sel.address ?? ""}</div>
                <div>${sel.name}</div>
                ${sel.kind === "device" ? html`<div class="muted">${sel.product ?? ""}${sel.room ? ` · ${sel.room}` : ""}</div>` : html`<div class="muted" title=${dptTitle(sel.dpt)}>${sel.dpt ? formatDpt(sel.dpt) : tr("no DPT")}</div>`}
                <div class="muted">
                  ${(this.linksOf.get(sel.id) ?? []).length} ${tr("links")}
                </div>
                <div class="actions">
                  <sl-button size="small" @click=${() => this.open(sel)}
                    >${tr("Open in editor")}</sl-button
                  >
                  ${sel.kind === "ga" ? html`<sl-button size="small" @click=${() => store.requestChart(sel.address ?? "", sel.name)}>${icon("chart", 14)} ${tr("Chart")}</sl-button>` : nothing}
                </div>
              </div>`
            : nothing
        }
      </div>
    `;
  }
}
