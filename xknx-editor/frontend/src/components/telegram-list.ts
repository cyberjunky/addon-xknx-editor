import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { api, ApiError } from "../api.js";
import { dptTitle, formatDpt, onDptNames } from "../dpt-format.js";
import { t as tr } from "../i18n.js";
import { icon } from "../icons.js";
import { store, type TelegramRecord } from "../store.js";

/** How long ago the recorded view looks back. */
const RANGES: { id: string; label: string; seconds: number }[] = [
  { id: "1h", label: "Last hour", seconds: 3600 },
  { id: "24h", label: "Last 24 hours", seconds: 24 * 3600 },
  { id: "7d", label: "Last 7 days", seconds: 7 * 24 * 3600 },
];

/** Telegrams of one device or one group address: what arrives live, and what was recorded. Used
 * as a tab in the device and group-address editors. */
@customElement("xknx-telegram-list")
export class TelegramList extends LitElement {
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
      flex-wrap: wrap;
      margin-bottom: 8px;
    }
    .list {
      max-height: 60vh;
      overflow: auto;
      border: 1px solid var(--ha-divider);
      border-radius: 8px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th,
    td {
      text-align: left;
      padding: 3px 8px;
      border-bottom: 1px solid var(--ha-divider);
      white-space: nowrap;
    }
    th {
      position: sticky;
      top: 0;
      background: var(--ha-card);
      color: var(--ha-text-2);
      font-weight: 500;
      font-size: 12px;
    }
    .addr {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .muted {
      color: var(--ha-text-2);
    }
    .apci {
      color: var(--ha-success);
    }
    .out {
      color: var(--ha-primary);
    }
    .empty {
      padding: 16px;
      color: var(--ha-text-2);
    }
  `;

  /** The device's individual address (device mode). */
  @property() address = "";
  /** Raw values of the device's group addresses (device mode). */
  @property({ attribute: false }) gas: number[] = [];
  /** Device id, for the recorded view (device mode). */
  @property({ type: Number }) deviceId = 0;
  /** A group address like 1/2/3 (group-address mode). */
  @property() ga = "";

  @state() private mode: "live" | "recorded" = "live";
  @state() private range = "24h";
  @state() private recorded: TelegramRecord[] = [];
  @state() private total = 0;
  @state() private loading = false;
  private unsubscribe = () => {};
  private unsubscribeDpt = () => {};
  private gaSet = new Set<number>();

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = store.subscribe(() => {
      if (this.mode === "live") this.requestUpdate();
    });
    this.unsubscribeDpt = onDptNames(() => this.requestUpdate());
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    this.unsubscribeDpt();
    super.disconnectedCallback();
  }

  willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("gas")) this.gaSet = new Set(this.gas);
    if (
      (changed.has("deviceId") ||
        changed.has("ga") ||
        changed.has("address")) &&
      this.mode === "recorded"
    )
      void this.load();
  }

  private concerns(t: TelegramRecord): boolean {
    if (this.ga) return t.destination === this.ga;
    if (!this.address && !this.gaSet.size) return false;
    return (
      t.source === this.address ||
      t.destination === this.address ||
      (t.ga !== null && t.ga !== undefined && this.gaSet.has(t.ga))
    );
  }

  private async load(): Promise<void> {
    if (!this.ga && !this.deviceId) return;
    this.loading = true;
    try {
      const seconds =
        RANGES.find((r) => r.id === this.range)?.seconds ?? 24 * 3600;
      const to = Date.now() / 1000;
      const p = new URLSearchParams({
        from: String(to - seconds),
        to: String(to),
        limit: "500",
      });
      if (this.ga) p.set("ga", this.ga);
      else p.set("device", String(this.deviceId));
      const r = await api.get<{ items: TelegramRecord[]; total: number }>(
        `api/bus/archive?${p}`,
      );
      this.recorded = r.items;
      this.total = r.total;
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    } finally {
      this.loading = false;
    }
  }

  private csvHref(): string {
    const seconds =
      RANGES.find((r) => r.id === this.range)?.seconds ?? 24 * 3600;
    const to = Date.now() / 1000;
    const p = new URLSearchParams({
      from: String(to - seconds),
      to: String(to),
    });
    if (this.ga) p.set("ga", this.ga);
    else p.set("device", String(this.deviceId));
    return `api/bus/archive.csv?${p}`;
  }

  private setMode(mode: "live" | "recorded"): void {
    this.mode = mode;
    if (mode === "recorded") void this.load();
  }

  private direction(t: TelegramRecord): string {
    if (this.ga) return "";
    return t.source === this.address ? "out" : "";
  }

  render() {
    const live = this.mode === "live";
    const items = live
      ? store.telegrams.filter((t) => this.concerns(t)).reverse()
      : this.recorded;
    const connected = store.bus.state === "CONNECTED";
    return html`
      <div class="toolbar">
        <sl-button-group>
          <sl-button
            size="small"
            variant=${live ? "primary" : "default"}
            @click=${() => this.setMode("live")}
            >${tr("Live")}</sl-button
          >
          <sl-button
            size="small"
            variant=${live ? "default" : "primary"}
            @click=${() => this.setMode("recorded")}
            >${tr("Recorded")}</sl-button
          >
        </sl-button-group>
        ${
          live
            ? html`<span class="muted"
                >${connected ? tr("newest first, since the page was opened") : tr("not connected")}</span
              >`
            : html`<sl-select
                  size="small"
                  hoist
                  value=${this.range}
                  style="width:160px"
                  @sl-change=${(e: Event) => {
                    this.range = (e.target as HTMLSelectElement).value;
                    void this.load();
                  }}
                  >${RANGES.map((r) => html`<sl-option value=${r.id}>${tr(r.label)}</sl-option>`)}</sl-select
                >
                <sl-button
                  size="small"
                  ?loading=${this.loading}
                  @click=${() => this.load()}
                  >${tr("Refresh")}</sl-button
                >
                <sl-button size="small" href=${this.csvHref()} download
                  >${icon("download", 14)} CSV</sl-button
                >
                <span class="muted"
                  >${items.length}${this.total > items.length ? ` / ${this.total}` : ""}</span
                >`
        }
      </div>
      ${
        items.length
          ? html`<div class="list">
              <table>
                <tr>
                  <th>${tr("Time")}</th>
                  <th>${tr("Source")}</th>
                  <th>${tr("Destination")}</th>
                  <th>${tr("Name")}</th>
                  <th>APCI</th>
                  <th>${tr("Value")}</th>
                  <th>DPT</th>
                  <th>${tr("Raw")}</th>
                </tr>
                ${items.slice(0, 500).map(
                  (t) =>
                    html`<tr>
                      <td class="muted">${live ? t.time : new Date(t.ts * 1000).toLocaleString()}</td>
                      <td class="addr ${this.direction(t)}">${t.source}</td>
                      <td class="addr">${t.destination}</td>
                      <td>${t.destination_name ?? ""}</td>
                      <td class="apci">${t.apci}</td>
                      <td>
                        ${t.value === null || t.value === undefined ? "" : String(t.value)}${t.unit ? html` <span class="muted">${t.unit}</span>` : nothing}
                      </td>
                      <td class="muted" title=${dptTitle(t.destination_dpt)}>
                        ${formatDpt(t.destination_dpt)}
                      </td>
                      <td class="addr muted">${t.raw}</td>
                    </tr>`,
                )}
              </table>
            </div>`
          : html`<div class="empty">
              ${live ? (connected ? tr("No telegrams for this yet. They appear here as they arrive.") : tr("Connect to a gateway (top right) to see bus traffic.")) : this.loading ? tr("Loading…") : tr("Nothing recorded in this range.")}
            </div>`
      }
    `;
  }
}
