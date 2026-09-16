import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { customElement, state } from "lit/decorators.js";
import uPlot from "uplot";
import uplotCss from "uplot/dist/uPlot.min.css?inline";
import { api, ApiError, type GroupAddress } from "../api.js";
import { icon } from "../icons.js";
import { store, type TelegramRecord } from "../store.js";
import { t as tr } from "../i18n.js";
import { PRESETS, localInput, presetRange } from "./monitor-view.js";
import { dptTitle, formatDpt, onDptNames } from "../dpt-format.js";

/** [time, avg, min, max]; raw points carry the same value three times. */
type Point = [number, number, number, number];
type Series = {
  ga: string;
  name: string;
  unit: string | null;
  dpt: string | null;
  points: Point[];
  bucketed: boolean;
  bucket: number;
  count: number;
  color: string;
  /** Read from the payloads: the project types this address nowhere. */
  guessed: boolean;
};
type SeriesResponse = {
  ga: number;
  destination: string;
  name: string;
  dpt: string | null;
  unit: string | null;
  count: number;
  bucketed: boolean;
  bucket: number;
  guessed?: boolean;
  points: Point[];
};

const COLORS = ["#03a9f4", "#ff9800", "#43a047", "#9c27b0"];
const MAX_SERIES = 4;

/** A group address the recorder has seen. */
type Recorded = {
  ga: number;
  destination: string;
  count: number;
  numeric: number;
  unit: string | null;
  name: string;
  dpt: string | null;
};

/** What the picker offers: the project's addresses and the recorded ones, merged. */
type Candidate = {
  text: string;
  name: string;
  dpt: string | null;
  count: number;
  numeric: boolean;
};

function fmt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2).replace(/\.?0+$/, "");
}

/** Bottom-dock charts: the recorded values of up to four group addresses over a time range,
 * live-appended while the range ends now. */
@customElement("xknx-charts-view")
export class ChartsView extends LitElement {
  static styles = [
    unsafeCSS(uplotCss),
    css`
      sl-button::part(label) {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      :host {
        display: grid;
        grid-template-rows: auto 1fr auto;
        height: 100%;
        font-size: 13px;
        min-height: 0;
      }
      .toolbar {
        display: flex;
        gap: 8px;
        align-items: center;
        padding: 6px 8px;
        border-bottom: 1px solid var(--ha-divider);
        flex-wrap: wrap;
        position: relative;
      }
      .picker {
        position: relative;
        min-width: 220px;
      }
      .matches {
        position: absolute;
        top: 100%;
        left: 0;
        z-index: 20;
        min-width: 100%;
        max-height: 240px;
        overflow: auto;
        background: var(--ha-card);
        border: 1px solid var(--ha-divider);
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
      }
      .matches div {
        padding: 5px 10px;
        cursor: pointer;
        white-space: nowrap;
      }
      .matches div:hover {
        background: color-mix(in srgb, var(--ha-primary) 12%, transparent);
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 2px 6px 2px 8px;
        border-radius: 12px;
        border: 1px solid var(--ha-divider);
        font-size: 12px;
      }
      .chip .dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
      }
      .chip button {
        border: 0;
        background: none;
        color: var(--ha-text-2);
        cursor: pointer;
        padding: 0 2px;
        font-size: 13px;
      }
      .plot {
        min-height: 0;
        overflow: hidden;
        padding: 4px 8px 0;
      }
      .plot .uplot {
        font-family: inherit;
      }
      .summary {
        border-top: 1px solid var(--ha-divider);
        padding: 4px 8px;
        overflow: auto;
      }
      table {
        border-collapse: collapse;
        width: 100%;
        font-size: 12px;
      }
      th,
      td {
        text-align: left;
        padding: 2px 8px;
        white-space: nowrap;
      }
      th {
        color: var(--ha-text-2);
        font-weight: 500;
      }
      td.num,
      th.num {
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
      .addr {
        font-family: ui-monospace, Menlo, Consolas, monospace;
      }
      .muted {
        color: var(--ha-text-2);
      }
      .guess {
        font-style: italic;
      }
      .empty {
        padding: 16px;
        color: var(--ha-text-2);
      }
    `,
  ];

  @state() private series: Series[] = [];
  @state() private preset = "24h";
  @state() private customFrom = localInput(Date.now() / 1000 - 3600);
  @state() private customTo = localInput(Date.now() / 1000);
  @state() private mode: "line" | "steps" | "area" = "line";
  @state() private query = "";
  @state() private showMatches = false;
  @state() private loading = false;
  private gas: GroupAddress[] = [];
  // What the recorder has seen: the picker offers these too, so an address the project does not
  // know - or a session with no project at all - can still be charted.
  @state() private recorded: Recorded[] = [];
  private gasRevision = -1;
  private plot: uPlot | null = null;
  private resize: ResizeObserver | null = null;
  private unsubscribe = () => {};
  private lastTelegram = 0;
  private redraw: number | undefined;
  private scheme: MediaQueryList | null = null;
  private unsubscribeDpt = () => {};

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = store.subscribe(() => this.onStore());
    this.unsubscribeDpt = onDptNames(() => this.requestUpdate());
    void this.loadRecorded();
    void this.loadGas();
    this.onStore();
    this.scheme = window.matchMedia("(prefers-color-scheme: dark)");
    this.scheme.addEventListener("change", this.onTheme);
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    this.unsubscribeDpt();
    this.scheme?.removeEventListener("change", this.onTheme);
    this.resize?.disconnect();
    this.plot?.destroy();
    this.plot = null;
    super.disconnectedCallback();
  }

  private onTheme = () => this.rebuild();

  firstUpdated(): void {
    const host = this.renderRoot.querySelector(".plot") as HTMLElement;
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
  }

  private onStore(): void {
    if (store.revision !== this.gasRevision) void this.loadGas();
    const req = store.chartRequest;
    if (req) {
      store.chartRequest = null;
      void this.add(req.ga, req.name);
    }
    this.appendLive();
    this.requestUpdate();
  }

  private async loadGas(): Promise<void> {
    this.gasRevision = store.revision;
    if (!store.project.open) {
      this.gas = [];
      return;
    }
    try {
      this.gas = (
        await api.get<{ items: GroupAddress[] }>("api/group-addresses")
      ).items;
    } catch {
      this.gas = [];
    }
  }

  private range(): { from: number; to: number } {
    return presetRange(this.preset, this.customFrom, this.customTo);
  }

  /** Live values arrive through the store; append them to the series they belong to while the
   * range ends now. Redraws are coalesced to one per second. */
  private appendLive(): void {
    if (this.preset === "custom" || !this.series.length) return;
    const fresh = store.telegrams.filter((t) => t.id > this.lastTelegram);
    if (!fresh.length) return;
    this.lastTelegram = fresh[fresh.length - 1].id;
    let touched = false;
    for (const t of fresh) {
      const s = this.series.find((x) => x.ga === t.destination);
      if (!s) continue;
      const v = liveValue(t);
      if (v === null) continue;
      s.points.push([t.ts, v, v, v]);
      s.count += 1;
      touched = true;
    }
    if (touched && this.redraw === undefined)
      this.redraw = window.setTimeout(() => {
        this.redraw = undefined;
        this.rebuild();
        this.requestUpdate();
      }, 1000);
  }

  private async add(ga: string, name = ""): Promise<void> {
    if (this.series.some((s) => s.ga === ga)) return;
    if (this.series.length >= MAX_SERIES) {
      store.say(
        tr("Up to four addresses at a time; remove one first."),
        "danger",
      );
      return;
    }
    const color =
      COLORS.find((c) => !this.series.some((s) => s.color === c)) ?? COLORS[0];
    const entry: Series = {
      ga,
      name,
      unit: null,
      dpt: null,
      points: [],
      bucketed: false,
      bucket: 0,
      count: 0,
      color,
      guessed: false,
    };
    this.series = [...this.series, entry];
    this.query = "";
    this.showMatches = false;
    await this.fetch(entry);
    this.rebuild();
  }

  private dropSeries(ga: string): void {
    this.series = this.series.filter((s) => s.ga !== ga);
    this.rebuild();
  }

  private async fetch(s: Series): Promise<void> {
    const { from, to } = this.range();
    this.loading = true;
    try {
      const r = await api.get<SeriesResponse>(
        `api/bus/series?ga=${encodeURIComponent(s.ga)}&from=${from}&to=${to}&points=800`,
      );
      s.points = r.points;
      s.unit = r.unit;
      s.dpt = r.dpt;
      s.name = r.name || s.name;
      s.bucketed = r.bucketed;
      s.bucket = r.bucket;
      s.count = r.count;
      s.guessed = !!r.guessed;
      this.lastTelegram = store.telegrams.at(-1)?.id ?? 0;
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    } finally {
      this.loading = false;
    }
  }

  private async reload(): Promise<void> {
    await Promise.all(this.series.map((s) => this.fetch(s)));
    this.rebuild();
    this.requestUpdate();
  }

  // --- the plot ------------------------------------------------------------------------------

  private colors() {
    const cs = getComputedStyle(this);
    const v = (name: string, fallback: string) =>
      cs.getPropertyValue(name).trim() || fallback;
    return {
      text: v("--ha-text-2", "#727272"),
      grid: v("--ha-divider", "rgba(0,0,0,0.12)"),
    };
  }

  private fit(): void {
    const host = this.renderRoot.querySelector(".plot") as HTMLElement | null;
    if (!host || !this.plot) return;
    const w = host.clientWidth - 16;
    const h = host.clientHeight - 8;
    if (w > 50 && h > 50) this.plot.setSize({ width: w, height: h });
  }

  private rebuild(): void {
    const host = this.renderRoot.querySelector(".plot") as HTMLElement | null;
    if (!host) return;
    this.plot?.destroy();
    this.plot = null;
    const live = this.series.filter((s) => s.points.length);
    if (!live.length) return;
    const { text, grid } = this.colors();
    // One y scale per unit, the first two get their own axis (left, right); the rest share the left.
    const units = [...new Set(live.map((s) => s.unit ?? ""))];
    const scaleOf = (u: string | null) =>
      units.indexOf(u ?? "") === 1 ? "y2" : "y";
    const tables = live.map(
      (s) =>
        [
          s.points.map((p) => p[0]),
          s.points.map((p) => p[1]),
        ] as uPlot.AlignedData,
    );
    const data = uPlot.join(tables);
    const paths =
      this.mode === "steps"
        ? uPlot.paths.stepped!({ align: 1 })
        : uPlot.paths.linear!();
    const opts: uPlot.Options = {
      width: Math.max(300, host.clientWidth - 16),
      height: Math.max(120, host.clientHeight - 8),
      cursor: { drag: { x: true, y: false } },
      legend: { show: true, live: true },
      scales: { x: { time: true }, y: {}, y2: {} },
      axes: [
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid, width: 1 },
        },
        {
          scale: "y",
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { stroke: grid, width: 1 },
          label: units[0] || undefined,
          labelFont: "12px Roboto, sans-serif",
          size: 56,
        },
        {
          scale: "y2",
          side: 1,
          stroke: text,
          grid: { show: false },
          ticks: { stroke: grid, width: 1 },
          label: units[1] || undefined,
          labelFont: "12px Roboto, sans-serif",
          size: 56,
          show: units.length > 1,
        },
      ],
      series: [
        { label: tr("Time") },
        ...live.map((s) => ({
          label: `${s.ga} ${s.name}`.trim(),
          stroke: s.color,
          width: 1.5,
          spanGaps: true,
          scale: scaleOf(s.unit),
          paths,
          fill: this.mode === "area" ? `${s.color}33` : undefined,
          value: (_u: uPlot, v: number | null) =>
            v === null ? "–" : `${fmt(v)}${s.unit ? ` ${s.unit}` : ""}`,
        })),
      ],
    };
    this.plot = new uPlot(opts, data, host);
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has("mode")) this.rebuild();
  }

  // --- rendering ------------------------------------------------------------------------------

  private async loadRecorded(): Promise<void> {
    try {
      this.recorded = (
        await api.get<{ items: Recorded[] }>("api/bus/archive/addresses")
      ).items;
    } catch {
      this.recorded = [];
    }
  }

  /** The project's group addresses and everything the recorder has seen, busiest first. */
  private candidates(): Candidate[] {
    const q = this.query.trim().toLowerCase();
    const seen = new Map<string, Candidate>();
    for (const r of this.recorded)
      seen.set(r.destination, {
        text: r.destination,
        name: r.name,
        dpt: r.dpt,
        count: r.count,
        numeric: r.numeric > 0,
      });
    for (const g of this.gas) {
      const known = seen.get(g.text);
      if (known) {
        known.name ||= g.name;
        known.dpt ??= g.datapoint_type;
      } else {
        seen.set(g.text, {
          text: g.text,
          name: g.name,
          dpt: g.datapoint_type,
          count: 0,
          numeric: true,
        });
      }
    }
    return [...seen.values()]
      .filter((c) => !this.series.some((s) => s.ga === c.text))
      .filter(
        (c) => !q || c.text.startsWith(q) || c.name.toLowerCase().includes(q),
      )
      .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
      .slice(0, 20);
  }

  private stat(s: Series) {
    const ys = s.points.map((p) => p[1]);
    if (!ys.length) return { min: null, max: null, avg: null, last: null };
    return {
      min: Math.min(...s.points.map((p) => p[2])),
      max: Math.max(...s.points.map((p) => p[3])),
      avg: ys.reduce((a, b) => a + b, 0) / ys.length,
      last: ys[ys.length - 1],
    };
  }

  /** Every picked address is recorded but none of it carries a number: say why, since an empty
   * plot looks like a bug. Telegrams recorded while no project was open have no decoded value
   * until the project supplies the datapoint types. */
  private renderNoValues() {
    const typed = this.series.some((s) => s.dpt);
    return html`<div class="empty">
      ${tr("Nothing numeric was recorded for these addresses in this range.")}
      ${!store.project.open ? html`<br />${tr("No project is open, so telegrams are recorded without a datapoint type and cannot be charted. Open the project: the addresses it knows are decoded, including what was recorded before.")}` : !typed ? html`<br />${tr("These addresses have no datapoint type in the project. Set it in the Group addresses tab and the recorded telegrams are decoded.")}` : nothing}
    </div>`;
  }

  render() {
    const matches = this.candidates();
    const custom = this.preset === "custom";
    return html`
      <div class="toolbar">
        <div class="picker">
          <sl-input
            size="small"
            placeholder=${tr("Add a group address: pick a recorded one or type an address or name")}
            clearable
            .value=${this.query}
            @sl-input=${(e: Event) => {
              this.query = (e.target as HTMLInputElement).value;
              this.showMatches = true;
            }}
            @sl-focus=${() => {
              this.showMatches = true;
              void this.loadRecorded();
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") {
                const first = matches[0];
                if (first) void this.add(first.text, first.name);
                else if (/^\d+\/\d+\/\d+$/.test(this.query.trim()))
                  void this.add(this.query.trim());
              }
              if (e.key === "Escape") this.showMatches = false;
            }}
            ><span slot="prefix">${icon("chart", 14)}</span></sl-input
          >
          ${
            this.showMatches && matches.length
              ? html`<div
                  class="matches"
                  @mousedown=${(e: Event) => e.preventDefault()}
                >
                  ${matches.map((c) => html`<div @click=${() => this.add(c.text, c.name)}><span class="addr">${c.text}</span> ${c.name}${c.dpt ? html` <span class="muted" title=${dptTitle(c.dpt)}>${formatDpt(c.dpt)}</span>` : nothing}${c.count ? html` <span class="muted">· ${c.count.toLocaleString()} ${tr("telegrams")}${c.numeric ? "" : ` (${tr("nothing numeric")})`}</span>` : nothing}</div>`)}
                </div>`
              : nothing
          }
        </div>
        ${this.series.map(
          (s) =>
            html`<span class="chip"
              ><span class="dot" style="background:${s.color}"></span
              ><span class="addr">${s.ga}</span> ${s.name}<button
                title=${tr("Remove")}
                @click=${() => this.dropSeries(s.ga)}
              >
                ✕
              </button></span
            >`,
        )}
        <span style="flex:1"></span>
        <sl-select
          size="small"
          hoist
          value=${this.preset}
          style="width:150px"
          @sl-change=${(e: Event) => {
            this.preset = (e.target as HTMLSelectElement).value;
            void this.reload();
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
                    void this.reload();
                  }}
                ></sl-input>
                <span class="muted">–</span>
                <sl-input
                  size="small"
                  type="datetime-local"
                  .value=${this.customTo}
                  @sl-change=${(e: Event) => {
                    this.customTo = (e.target as HTMLInputElement).value;
                    void this.reload();
                  }}
                ></sl-input>`
            : nothing
        }
        <sl-select
          size="small"
          hoist
          value=${this.mode}
          style="width:110px"
          @sl-change=${(e: Event) => (this.mode = (e.target as HTMLSelectElement).value as "line")}
        >
          <sl-option value="line">${tr("Line")}</sl-option>
          <sl-option value="steps">${tr("Steps")}</sl-option>
          <sl-option value="area">${tr("Area")}</sl-option>
        </sl-select>
        <sl-button
          size="small"
          ?loading=${this.loading}
          @click=${() => this.reload()}
          >${tr("Refresh")}</sl-button
        >
      </div>
      <div class="plot">
        ${
          this.series.length
            ? this.series.some((s) => s.points.length)
              ? nothing
              : this.renderNoValues()
            : html`<div class="empty">
                ${tr("Pick a group address above, or press the chart button on a telegram in the group monitor or on a group address. Values come from the recorded archive; the range “Last hour” and the like keep growing live.")}
              </div>`
        }
      </div>
      ${
        this.series.length
          ? html`<div class="summary">
              <table>
                <tr>
                  <th></th>
                  <th>${tr("Address")}</th>
                  <th>${tr("Name")}</th>
                  <th>DPT</th>
                  <th class="num">${tr("Telegrams")}</th>
                  <th class="num">${tr("Min")}</th>
                  <th class="num">${tr("Max")}</th>
                  <th class="num">${tr("Average")}</th>
                  <th class="num">${tr("Last")}</th>
                  <th></th>
                </tr>
                ${this.series.map((s) => {
                  const st = this.stat(s);
                  const u = s.unit ? ` ${s.unit}` : "";
                  return html`<tr>
                    <td>
                      <span
                        class="dot"
                        style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${s.color}"
                      ></span>
                    </td>
                    <td class="addr">${s.ga}</td>
                    <td>${s.name}</td>
                    <td class="muted" title=${dptTitle(s.dpt)}>${formatDpt(s.dpt)}</td>
                    <td class="num">${s.count.toLocaleString()}</td>
                    <td class="num">${fmt(st.min)}${u}</td>
                    <td class="num">${fmt(st.max)}${u}</td>
                    <td class="num">${fmt(st.avg)}${u}</td>
                    <td class="num">${fmt(st.last)}${u}</td>
                    <td class="muted">
                      ${s.guessed ? html`<span class="guess">${tr("read from the payloads, this address has no datapoint type")}</span> ` : nothing}${s.bucketed ? `${tr("averaged per")} ${Math.round(s.bucket)} s` : s.points.length ? "" : tr("nothing to chart in this range")}
                    </td>
                  </tr>`;
                })}
              </table>
            </div>`
          : nothing
      }
    `;
  }
}

/** The chartable value of a live telegram, or null. */
function liveValue(t: TelegramRecord): number | null {
  if (typeof t.value === "number") return t.value;
  if (typeof t.value === "boolean") return t.value ? 1 : 0;
  return null;
}
