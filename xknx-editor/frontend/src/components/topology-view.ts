import { LitElement, css, html, svg, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { api, type Topology } from "../api.js";
import { store } from "../store.js";
import { t as tr } from "../i18n.js";

/** Area → line → device diagram, laid out top-down in three columns; click a device to open it. */
@customElement("xknx-topology-view")
export class TopologyView extends LitElement {
  static styles = css`
    sl-button::part(label) {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    :host {
      display: block;
      padding: 12px;
      height: 100%;
      box-sizing: border-box;
      overflow: auto;
    }
    :host([compact]) {
      padding: 0;
      height: auto;
      font-size: 11px;
    }
    .toolbar {
      display: flex;
      gap: 12px;
      align-items: center;
      color: var(--ha-text-2);
      font-size: 12px;
      margin-bottom: 8px;
    }
    svg {
      font-family: var(--sl-font-sans);
      font-size: 12px;
      display: block;
    }
    .box {
      fill: var(--ha-card);
      stroke: var(--ha-divider);
      rx: 4px;
    }
    .box.area {
      fill: #3f6fa3;
      stroke: none;
    }
    .box.line {
      fill: #4f7d5a;
      stroke: none;
    }
    .box.device:hover {
      stroke: var(--ha-primary);
      cursor: pointer;
    }
    .box.selected {
      stroke: var(--ha-primary);
      stroke-width: 2;
    }
    .box.unresolved {
      stroke: var(--ha-warning);
    }
    text {
      fill: var(--ha-text);
      dominant-baseline: middle;
      pointer-events: none;
    }
    text.light {
      fill: #ffffff;
    }
    text.addr {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      fill: var(--ha-text-2);
    }
    path {
      fill: none;
      stroke: var(--ha-divider);
      stroke-width: 1.5;
    }
    .empty {
      color: var(--ha-text-2);
      padding: 24px;
    }
  `;

  @property({ type: Boolean }) compact = false;
  @state() private topology: Topology | null = null;
  @state() private zoom = 1;
  private unsubscribe = () => {};
  private rev = -1;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = store.subscribe(() => void this.sync());
    void this.sync();
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    super.disconnectedCallback();
  }

  private async sync(): Promise<void> {
    if (!store.project.open) {
      this.topology = null;
      return;
    }
    if (this.rev === store.revision && this.topology) {
      this.requestUpdate();
      return;
    }
    this.rev = store.revision;
    try {
      this.topology = await api.get<Topology>("api/project/topology");
    } catch {
      this.topology = null;
    }
  }

  render() {
    if (!store.project.open)
      return html`<div class="empty">
        ${tr("Open a project to see its topology.")}
      </div>`;
    const t = this.topology;
    if (!t) return html`<sl-spinner></sl-spinner>`;

    const ROW = this.compact ? 24 : 30;
    const BOX_H = this.compact ? 18 : 22;
    const COL = this.compact ? [4, 78, 156] : [16, 176, 336];
    const AREA_W = this.compact ? 66 : 120;
    const LINE_W = this.compact ? 70 : 150;
    const DEV_W = this.compact ? 190 : 300;
    const parts: TemplateResult[] = [];
    let y = 10;
    const areas = t.areas.filter((a) =>
      a.lines.some((l) => l.segments.some((s) => s.devices.length)),
    );
    for (const a of areas) {
      const lines = a.lines.filter((l) =>
        l.segments.some((s) => s.devices.length),
      );
      const areaTop = y;
      const lineCenters: number[] = [];
      for (const l of lines) {
        const devices = l.segments.flatMap((s) => s.devices);
        const lineTop = y;
        const devCenters: number[] = [];
        for (const d of devices) {
          const cy = y + BOX_H / 2;
          devCenters.push(cy);
          parts.push(svg`
            <g @click=${() => store.select(d.id)}>
              <rect class="box device ${store.selectedDevice === d.id ? "selected" : ""} ${d.resolved || d.no_application ? "" : "unresolved"}" x=${COL[2]} y=${y} width=${DEV_W} height=${BOX_H}></rect>
              <text class="addr" x=${COL[2] + 6} y=${cy}>${d.individual_address ?? "-.-.-"}</text>
              <text x=${COL[2] + (this.compact ? 50 : 60)} y=${cy}>${(d.name || d.product_name).slice(0, this.compact ? 22 : 34)}</text>
            </g>`);
          y += ROW;
        }
        const lineCy = (lineTop + y - ROW + BOX_H) / 2;
        lineCenters.push(lineCy);
        parts.push(svg`
          <rect class="box line" x=${COL[1]} y=${lineCy - BOX_H / 2} width=${LINE_W} height=${BOX_H}></rect>
          <text class="light" x=${COL[1] + 6} y=${lineCy}>${a.address}.${l.address}${this.compact ? "" : ` ${(l.name || "Line").slice(0, 14)}`}</text>
          ${devCenters.map((cy) => svg`<path d="M ${COL[1] + LINE_W} ${lineCy} C ${COL[1] + LINE_W + 20} ${lineCy}, ${COL[2] - 20} ${cy}, ${COL[2]} ${cy}"></path>`)}`);
        y += ROW / 2;
      }
      const areaCy = (areaTop + y - ROW / 2 - ROW + BOX_H) / 2;
      parts.push(svg`
        <rect class="box area" x=${COL[0]} y=${areaCy - BOX_H / 2} width=${AREA_W} height=${BOX_H}></rect>
        <text class="light" x=${COL[0] + 6} y=${areaCy}>${this.compact ? `Area ${a.address}` : `Area ${a.address} ${(a.name || "").slice(0, 10)}`}</text>
        ${lineCenters.map((cy) => svg`<path d="M ${COL[0] + AREA_W} ${areaCy} C ${COL[0] + AREA_W + 20} ${areaCy}, ${COL[1] - 20} ${cy}, ${COL[1]} ${cy}"></path>`)}`);
      y += ROW;
    }
    const width = COL[2] + DEV_W + 16;
    const height = Math.max(y, 60);
    return html`
      <div class="toolbar">
        <span
          >${areas.length} areas with devices ·
          ${t.areas.reduce((n, a) => n + a.lines.reduce((m, l) => m + l.segments.reduce((k, s) => k + s.devices.length, 0), 0), 0)}
          devices</span
        >
        <sl-button
          size="small"
          @click=${() => (this.zoom = Math.max(0.5, this.zoom - 0.1))}
          >−</sl-button
        >
        <span>${Math.round(this.zoom * 100)}%</span>
        <sl-button
          size="small"
          @click=${() => (this.zoom = Math.min(2, this.zoom + 0.1))}
          >+</sl-button
        >
        <span>${tr("Click a device to open it in the Editor.")}</span>
      </div>
      ${
        areas.length
          ? html`<svg
              width=${width * this.zoom}
              height=${height * this.zoom}
              viewBox="0 0 ${width} ${height}"
            >
              ${parts}
            </svg>`
          : html`<div class="empty">${tr("No devices yet.")}</div>`
      }
      ${nothing}
    `;
  }
}
