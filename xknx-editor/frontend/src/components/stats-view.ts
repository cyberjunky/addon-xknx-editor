import { LitElement, css, html, nothing, svg } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api, ApiError } from "../api.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { t as tr } from "../i18n.js";
import { PRESETS, localInput, presetRange } from "./monitor-view.js";

type Segment = {
  state: "recording" | "link_down" | "not_running";
  from: number;
  to: number;
};
type Stats = {
  since: number;
  until: number;
  total: number;
  per_second: number;
  histogram: { width: number; counts: number[] };
  heatmap: number[][];
  top_addresses: {
    ga: number;
    destination: string;
    name: string;
    count: number;
  }[];
  top_sources: { source: string; count: number }[];
  by_apci: Record<string, number>;
  availability: {
    segments: Segment[];
    coverage: Record<Segment["state"], number>;
    quiet: { from: number; to: number }[];
  };
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATE_COLOR: Record<Segment["state"], string> = {
  recording: "var(--ha-success)",
  link_down: "var(--ha-warning)",
  not_running: "var(--ha-text-2)",
};
const STATE_LABEL: Record<Segment["state"], string> = {
  recording: "recording",
  link_down: "link lost",
  not_running: "add-on not running",
};

function duration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} d`;
}

/** A percentage that does not round a real sliver away to "0%". */
function share(part: number, total: number): string {
  const pct = (part / total) * 100;
  if (pct > 0 && pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

function when(ts: number): string {
  return new Date(ts * 1000).toLocaleString([], {
    dateStyle: "short",
    timeStyle: "short",
  });
}

/** Bottom-dock statistics over the recorded archive: totals, telegrams over time, a weekday ×
 * hour heatmap, the busiest addresses and sources, and what the recorder was doing. */
@customElement("xknx-stats-view")
export class StatsView extends LitElement {
  static styles = css`
    sl-button::part(label) {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    :host {
      display: block;
      font-size: 13px;
    }
    .toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 6px 8px;
      border-bottom: 1px solid var(--ha-divider);
      flex-wrap: wrap;
      position: sticky;
      top: 0;
      background: var(--ha-card);
      z-index: 2;
    }
    .body {
      padding: 8px 12px 16px;
      display: grid;
      gap: 14px;
    }
    .kpis {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }
    .kpi b {
      display: block;
      font-size: 20px;
      font-weight: 500;
      line-height: 1.2;
      font-variant-numeric: tabular-nums;
    }
    .kpi span {
      color: var(--ha-text-2);
      font-size: 12px;
    }
    h4 {
      margin: 0 0 4px;
      font-weight: 500;
      font-size: 13px;
      color: var(--ha-text-2);
    }
    .row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    @media (max-width: 900px) {
      .row {
        grid-template-columns: 1fr;
      }
    }
    svg {
      display: block;
      overflow: visible;
    }
    .hist {
      display: flex;
      align-items: flex-end;
      gap: 1px;
      height: 90px;
    }
    .hist .bar-slot {
      flex: 1;
      height: 100%;
      display: flex;
      align-items: flex-end;
    }
    .hist .bar-slot > div {
      width: 100%;
      background: var(--ha-primary);
      border-radius: 1px 1px 0 0;
      min-height: 0;
    }
    .ticks {
      display: flex;
      justify-content: space-between;
      color: var(--ha-text-2);
      font-size: 11px;
      margin-top: 2px;
    }
    svg text {
      font-size: 10px;
      fill: var(--ha-text-2);
    }
    .bar {
      display: flex;
      height: 14px;
      border-radius: 4px;
      overflow: hidden;
      background: var(--ha-divider);
    }
    .legend {
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      font-size: 12px;
      color: var(--ha-text-2);
      margin-top: 4px;
    }
    .legend i {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 2px;
      margin-right: 4px;
      vertical-align: -1px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th,
    td {
      text-align: left;
      padding: 2px 8px;
      border-bottom: 1px solid var(--ha-divider);
      white-space: nowrap;
    }
    th {
      color: var(--ha-text-2);
      font-weight: 500;
      font-size: 12px;
    }
    td.num,
    th.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    td.act sl-button::part(base) {
      min-height: 22px;
      height: 22px;
    }
    .addr {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .muted {
      color: var(--ha-text-2);
    }
    .empty {
      padding: 16px;
      color: var(--ha-text-2);
    }
  `;

  @state() private preset = "7d";
  @state() private customFrom = localInput(Date.now() / 1000 - 86400);
  @state() private customTo = localInput(Date.now() / 1000);
  @state() private stats: Stats | null = null;
  @state() private loading = false;
  private unsubscribe = () => {};

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = store.subscribe(() => this.requestUpdate());
    void this.load();
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    super.disconnectedCallback();
  }

  private async load(): Promise<void> {
    const { from, to } = presetRange(
      this.preset,
      this.customFrom,
      this.customTo,
    );
    this.loading = true;
    try {
      this.stats = await api.get<Stats>(`api/bus/stats?from=${from}&to=${to}`);
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    } finally {
      this.loading = false;
    }
  }

  /** Bars and labels as plain elements: an SVG stretched to the dock's width with
   * preserveAspectRatio="none" scales its text along with it, which reads as a distorted font. */
  private histogram(s: Stats) {
    const counts = s.histogram.counts;
    const max = Math.max(1, ...counts);
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(
      (f) => s.since + f * (s.until - s.since),
    );
    return html`<div class="hist">
        ${counts.map((c, i) => {
          const from = s.since + i * s.histogram.width;
          return html`<div
            class="bar-slot"
            title=${`${when(from)} – ${when(from + s.histogram.width)}: ${c.toLocaleString()}`}
          >
            <div style="height:${(c / max) * 100}%"></div>
          </div>`;
        })}
      </div>
      <div class="ticks">
        ${ticks.map((ts) => html`<span>${when(ts)}</span>`)}
      </div>`;
  }

  private heatmap(s: Stats) {
    // The backend counts with %w (0 = Sunday); show Monday first.
    const rows = [1, 2, 3, 4, 5, 6, 0].map((d) => s.heatmap[d] ?? []);
    const max = Math.max(1, ...rows.flat());
    const cw = 22;
    const ch = 16;
    const left = 30;
    return svg`<svg viewBox="0 0 ${left + 24 * cw} ${7 * ch + 14}" style="height:${7 * ch + 14}px;max-width:${left + 24 * cw}px">
      ${rows.map(
        (r, di) =>
          svg`<text x="0" y=${di * ch + 12}>${tr(DAYS[di])}</text>
        ${r.map((c, hi) => svg`<rect x=${left + hi * cw} y=${di * ch} width=${cw - 2} height=${ch - 2} rx="2" fill="var(--ha-primary)" fill-opacity=${c ? 0.15 + 0.85 * (c / max) : 0.05}><title>${tr(DAYS[di])} ${String(hi).padStart(2, "0")}:00 – ${c.toLocaleString()}</title></rect>`)}`,
      )}
      ${[0, 6, 12, 18, 23].map((hh) => svg`<text x=${left + hh * cw + (cw - 2) / 2} y=${7 * ch + 10} text-anchor="middle">${hh}</text>`)}
    </svg>`;
  }

  private availability(s: Stats) {
    const a = s.availability;
    const span = Math.max(1, s.until - s.since);
    const total = Object.values(a.coverage).reduce((x, y) => x + y, 0) || 1;
    return html`<div class="bar" title=${`${when(s.since)} – ${when(s.until)}`}>
        ${a.segments.map((seg) => html`<div style="width:${((seg.to - seg.from) / span) * 100}%;background:${STATE_COLOR[seg.state]}" title=${`${tr(STATE_LABEL[seg.state])}: ${when(seg.from)} – ${when(seg.to)} (${duration(seg.to - seg.from)})`}></div>`)}
      </div>
      <div class="legend">
        ${(["recording", "link_down", "not_running"] as const).map((k) => html`<span><i style="background:${STATE_COLOR[k]}"></i>${tr(STATE_LABEL[k])} ${share(a.coverage[k], total)}</span>`)}
      </div>
      ${
        a.quiet.length
          ? html`<div class="muted" style="margin-top:6px">
              ${tr("Quiet bus while recording (nothing for more than 30 minutes):")}
              ${a.quiet.slice(0, 5).map((q) => html`<div>${when(q.from)} – ${when(q.to)} (${duration(q.to - q.from)})</div>`)}
            </div>`
          : nothing
      }`;
  }

  render() {
    const s = this.stats;
    const custom = this.preset === "custom";
    const apci = s ? Object.entries(s.by_apci).sort((a, b) => b[1] - a[1]) : [];
    return html`
      <div class="toolbar">
        <sl-select
          size="small"
          hoist
          value=${this.preset}
          style="width:150px"
          @sl-change=${(e: Event) => {
            this.preset = (e.target as HTMLSelectElement).value;
            void this.load();
          }}
        >
          ${PRESETS.map((p) => html`<sl-option value=${p.id}>${tr(p.label)}</sl-option>`)}
        </sl-select>
        ${
          custom
            ? html`<sl-input
                  size="small"
                  type="datetime-local"
                  .value=${this.customFrom}
                  @sl-change=${(e: Event) => {
                    this.customFrom = (e.target as HTMLInputElement).value;
                    void this.load();
                  }}
                ></sl-input>
                <span class="muted">–</span>
                <sl-input
                  size="small"
                  type="datetime-local"
                  .value=${this.customTo}
                  @sl-change=${(e: Event) => {
                    this.customTo = (e.target as HTMLInputElement).value;
                    void this.load();
                  }}
                ></sl-input>`
            : nothing
        }
        <sl-button
          size="small"
          ?loading=${this.loading}
          @click=${() => this.load()}
          >${tr("Refresh")}</sl-button
        >
        <span style="flex:1"></span>
        ${s ? html`<span class="muted">${when(s.since)} – ${when(s.until)}</span>` : nothing}
      </div>
      ${
        !s
          ? html`<div class="empty">
              ${this.loading ? tr("Loading…") : tr("No statistics yet.")}
            </div>`
          : html`<div class="body">
              <div class="kpis">
                <div class="kpi">
                  <b>${s.total.toLocaleString()}</b
                  ><span>${tr("telegrams")}</span>
                </div>
                <div class="kpi">
                  <b>${(s.per_second * 60).toFixed(1)}</b
                  ><span>${tr("per minute")}</span>
                </div>
                <div class="kpi">
                  <b>${s.top_addresses[0]?.destination ?? "–"}</b
                  ><span
                    >${tr("busiest address")}${s.top_addresses[0]?.name ? ` · ${s.top_addresses[0].name}` : ""}</span
                  >
                </div>
                <div class="kpi">
                  <b>${s.top_sources[0]?.source ?? "–"}</b
                  ><span>${tr("busiest device")}</span>
                </div>
                ${apci.slice(0, 3).map(([k, v]) => html`<div class="kpi"><b>${Math.round((v / Math.max(1, s.total)) * 100)}%</b><span>${k}</span></div>`)}
              </div>
              <div>
                <h4>${tr("Telegrams over time")}</h4>
                ${s.total ? this.histogram(s) : html`<div class="muted">${tr("Nothing recorded in this range.")}</div>`}
              </div>
              <div class="row">
                <div>
                  <h4>${tr("Activity by weekday and hour")}</h4>
                  ${this.heatmap(s)}
                </div>
                <div>
                  <h4>${tr("Recorder availability")}</h4>
                  ${this.availability(s)}
                </div>
              </div>
              <div class="row">
                <div>
                  <h4>${tr("Busiest group addresses")}</h4>
                  <table>
                    <tr>
                      <th>${tr("Address")}</th>
                      <th>${tr("Name")}</th>
                      <th class="num">${tr("Telegrams")}</th>
                      <th></th>
                    </tr>
                    ${s.top_addresses.map(
                      (r) =>
                        html`<tr>
                          <td class="addr">${r.destination}</td>
                          <td>${r.name}</td>
                          <td class="num">${r.count.toLocaleString()}</td>
                          <td class="act">
                            <sl-button
                              size="small"
                              variant="text"
                              title=${tr("Chart this address")}
                              @click=${() => store.requestChart(r.destination, r.name)}
                              >${icon("chart", 14)}</sl-button
                            >
                          </td>
                        </tr>`,
                    )}
                  </table>
                </div>
                <div>
                  <h4>${tr("Busiest devices")}</h4>
                  <table>
                    <tr>
                      <th>${tr("Source")}</th>
                      <th class="num">${tr("Telegrams")}</th>
                    </tr>
                    ${s.top_sources.map(
                      (r) =>
                        html`<tr>
                          <td class="addr">${r.source}</td>
                          <td class="num">${r.count.toLocaleString()}</td>
                        </tr>`,
                    )}
                  </table>
                </div>
              </div>
            </div>`
      }
    `;
  }
}
