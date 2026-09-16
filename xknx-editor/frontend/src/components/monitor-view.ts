import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api, ApiError } from "../api.js";
import { icon } from "../icons.js";
import { store, type TelegramRecord } from "../store.js";
import { t as tr } from "../i18n.js";
import { dptTitle, formatDpt, onDptNames } from "../dpt-format.js";
import "./telegram-timeline.js";

/** "DPST-13-10" → "13.010", "DPT-1" → "1.xxx". */
export function dptShort(dpt: string): string {
  const m = /^DPST-(\d+)-(\d+)$/.exec(dpt);
  if (m) return `${m[1]}.${m[2].padStart(3, "0")}`;
  const n = /^DPT-(\d+)$/.exec(dpt);
  return n ? `${n[1]}.xxx` : dpt;
}

/** The DPT filter: "9" or "9." is the main type, "9.001" (or "DPST-9-1") the exact sub-type. */
export function dptMatches(
  filter: string,
  dpt: string | null | undefined,
): boolean {
  let f = filter.trim().toLowerCase();
  if (!f) return true;
  if (!dpt) return false;
  const short = dptShort(dpt).toLowerCase();
  const main = short.split(".")[0];
  if (f.startsWith("dpst-") || f.startsWith("dpt-"))
    f = dptShort(f.toUpperCase()).toLowerCase();
  if (/^\d+$/.test(f)) return main === f;
  if (/^\d+\.$/.test(f)) return main === f.slice(0, -1);
  const parts = /^(\d+)\.(\d+)$/.exec(f);
  if (parts) return short === `${parts[1]}.${parts[2].padStart(3, "0")}`;
  return short.startsWith(f);
}

/** A reading of a payload whose address has no datapoint type in the project. KNX types are
 * bound to a payload length, so the length leaves one likely candidate and a couple of others;
 * the table shows this greyed and in italics, never as the project's truth. */
export function guessValue(raw: string): { text: string; dpt: string } | null {
  const hex = raw.replace(/\s+/g, "");
  if (!hex || hex.length % 2 || /[^0-9a-fA-F]/.test(hex)) return null;
  const bytes = hex.match(/../g)!.map((b) => parseInt(b, 16));
  if (bytes.length === 1) {
    const v = bytes[0];
    if (v <= 1) return { text: v ? "on" : "off", dpt: "1.xxx" };
    return { text: `${v} · ${Math.round((v / 255) * 100)} %`, dpt: "5.xxx" };
  }
  if (bytes.length === 2) {
    // DPT 9: 0.01 · M · 2^E, M an 11-bit two's complement mantissa.
    const word = (bytes[0] << 8) | bytes[1];
    const exp = (word & 0x7800) >> 11;
    let mant = word & 0x07ff;
    if (word & 0x8000) mant = -(~(mant - 1) & 0x07ff);
    const value = 0.01 * mant * 2 ** exp;
    return { text: round(value), dpt: "9.xxx" };
  }
  if (bytes.length === 4) {
    const view = new DataView(new Uint8Array(bytes).buffer);
    const value = view.getFloat32(0);
    if (Number.isFinite(value) && (value === 0 || Math.abs(value) >= 1e-6))
      return { text: round(value), dpt: "14.xxx" };
    return { text: String(view.getInt32(0)), dpt: "13.xxx" };
  }
  return null;
}

/** The gap between two telegrams: "+120 ms", "+3.4 s", "+2 min". */
export function formatDelta(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 1) return `+${Math.round(s * 1000)} ms`;
  if (s < 10) return `+${s.toFixed(1)} s`;
  if (s < 60) return `+${Math.round(s)} s`;
  if (s < 3600) return `+${Math.round(s / 60)} min`;
  if (s < 86400) return `+${(s / 3600).toFixed(1).replace(/\.0$/, "")} h`;
  return `+${(s / 86400).toFixed(1).replace(/\.0$/, "")} d`;
}

const TIMELINE_KEY = "xknx.monitor.timeline";

function loadTimeline(): boolean {
  try {
    return localStorage.getItem(TIMELINE_KEY) === "1";
  } catch {
    return false;
  }
}

function round(v: number): string {
  const text = Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(2);
  return text.replace(/\.?0+$/, "");
}

/** The address filter: "1/2/" is a prefix (a middle group), "1/2/3" an exact address. */
export function addressMatches(filter: string, destination: string): boolean {
  const f = filter.trim();
  if (!f) return true;
  return f.endsWith("/") ? destination.startsWith(f) : destination === f;
}

type ArchiveItem = TelegramRecord & { ts: number; num: number | null };
type Summary = {
  enabled: boolean;
  rows: number;
  oldest: number | null;
  newest: number | null;
  bytes: number;
  retain_days: number;
  retain_rows: number;
};
type Preset = { id: string; label: string; seconds: number };
export const PRESETS: Preset[] = [
  { id: "1h", label: "Last hour", seconds: 3600 },
  { id: "6h", label: "Last 6 hours", seconds: 6 * 3600 },
  { id: "24h", label: "Last 24 hours", seconds: 24 * 3600 },
  { id: "7d", label: "Last 7 days", seconds: 7 * 24 * 3600 },
  { id: "30d", label: "Last 30 days", seconds: 30 * 24 * 3600 },
  { id: "custom", label: "Custom range", seconds: 0 },
];

/** `datetime-local` value for a timestamp, in the browser's zone. */
export function localInput(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The range a preset (or a custom pair of `datetime-local` values) stands for, in seconds. */
export function presetRange(
  preset: string,
  customFrom: string,
  customTo: string,
): { from: number; to: number } {
  const p = PRESETS.find((x) => x.id === preset) ?? PRESETS[2];
  if (p.seconds) {
    const to = Date.now() / 1000;
    return { from: to - p.seconds, to };
  }
  const from = new Date(customFrom).getTime() / 1000;
  const to = new Date(customTo).getTime() / 1000;
  return {
    from: Number.isFinite(from) ? from : 0,
    to: Number.isFinite(to) ? to : Date.now() / 1000,
  };
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024)
    return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} kB`;
}

/** A telegram whose value can be charted: numbers and booleans on a group address. */
function chartable(t: TelegramRecord | ArchiveItem): boolean {
  if (t.destination_kind !== "group") return false;
  if ("num" in t) return t.num !== null; // archive rows carry the value as text plus `num`
  return typeof t.value === "number" || typeof t.value === "boolean";
}

/** Bottom-dock group monitor: live telegrams, and the recorded archive behind them, with one
 * filter bar (text, address, DPT) for both. */
@customElement("xknx-monitor-view")
export class MonitorView extends LitElement {
  static styles = css`
    sl-button::part(label) {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      font-size: 13px;
    }
    .toolbar,
    xknx-telegram-timeline {
      flex: none;
    }
    .toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 6px 8px;
      border-bottom: 1px solid var(--ha-divider);
      flex-wrap: wrap;
    }
    .toolbar sl-input.filter {
      flex: 1;
      min-width: 140px;
      max-width: 260px;
    }
    .toolbar sl-input.narrow {
      width: 100px;
    }
    .list {
      flex: 1;
      min-height: 0;
      overflow: auto;
    }
    td.delta {
      text-align: right;
      font-variant-numeric: tabular-nums;
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
    td.act {
      padding: 0 4px;
      width: 24px;
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
    .apci {
      color: var(--ha-success);
    }
    .guess {
      color: var(--ha-text-2);
      font-style: italic;
    }
    .empty {
      padding: 16px;
      color: var(--ha-text-2);
    }
    .more {
      padding: 8px;
      text-align: center;
    }
    .form {
      display: grid;
      gap: 12px;
    }
    .form .two {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .hint {
      color: var(--ha-text-2);
      font-size: 12px;
      line-height: 1.4;
    }
  `;

  @state() private mode: "live" | "archive" = "live";
  // The shared filter: free text (name parts, values), an address or address prefix, a DPT.
  @state() private filter = "";
  @state() private address = "";
  @state() private dpt = "";
  // Live: the monitor records only while it is running, and it starts stopped and empty: neither
  // opening a project nor reloading the page should present traffic nobody asked to record.
  // Telegrams keep arriving in the background either way, and a run shows only what happened
  // during it. The state sits in the store (see `store.monitor`) so that switching the bottom
  // dock to Charts and back does not end the run; ids come from the backend and only increase.
  // Archive: the recorded telegrams, newest first, paged with a cursor.
  @state() private preset = "24h";
  @state() private customFrom = localInput(Date.now() / 1000 - 3600);
  @state() private customTo = localInput(Date.now() / 1000);
  @state() private source = "";
  @state() private kind = "";
  @state() private items: ArchiveItem[] = [];
  @state() private total = 0;
  @state() private nextCursor: number | null = null;
  @state() private loading = false;
  @state() private summary: Summary | null = null;
  @state() private settingsOpen = false;
  @state() private busy = false;
  @state() private timeline = loadTimeline();
  private unsubscribe = () => {};
  private unsubscribeDpt = () => {};
  private debounce: number | undefined;

  private get running(): boolean {
    return store.monitor.running;
  }

  private get frozen(): TelegramRecord[] | null {
    return store.monitor.frozen;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = store.subscribe(() => {
      this.stopOnProjectChange();
      this.requestUpdate();
    });
    this.unsubscribeDpt = onDptNames(() => this.requestUpdate());
    // Deliberately no backlog fetch: a page load starts clean. A run in progress is picked up
    // from the store, so only the first mount of a session freezes an empty list.
    this.stopOnProjectChange();
    void this.loadSummary();
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    this.unsubscribeDpt();
    super.disconnectedCallback();
  }

  /** Opening (or closing) a project stops the monitor, so it never keeps running against a
   * project the user has moved away from. */
  private stopOnProjectChange(): void {
    const id = store.project.open ? (store.project.id ?? "") : "";
    if (id === store.monitor.project) return;
    store.monitor.project = id;
    this.stop();
  }

  /** The telegrams the live table shows: this run's while running, the frozen snapshot while stopped. */
  private recorded(): TelegramRecord[] {
    if (!this.running) return this.frozen ?? [];
    return store.telegrams.filter((t) => t.id > store.monitor.sinceId);
  }

  /** How many arrived since the monitor stopped recording. */
  private missed(): number {
    const last = this.frozen?.at(-1)?.id ?? store.monitor.sinceId;
    return store.telegrams.filter((t) => t.id > last).length;
  }

  private toggleTimeline(): void {
    this.timeline = !this.timeline;
    try {
      localStorage.setItem(TIMELINE_KEY, this.timeline ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  }

  /** A dot picked on the timeline narrows the list to its destination. */
  private onPick(e: CustomEvent<TelegramRecord>): void {
    this.address = e.detail.destination;
    this.scheduleArchive();
  }

  private start(): void {
    store.monitor = {
      running: true,
      sinceId: store.telegrams.at(-1)?.id ?? 0,
      frozen: null,
      project: store.monitor.project,
    };
    this.requestUpdate();
  }

  private stop(): void {
    store.monitor = {
      ...store.monitor,
      running: false,
      frozen: this.recorded(),
    };
    this.requestUpdate();
  }

  updated(): void {
    if (this.mode !== "live" || !this.running) return;
    const list = this.renderRoot.querySelector(".list") as HTMLElement | null;
    if (list) list.scrollTop = list.scrollHeight;
  }

  private passes(t: TelegramRecord, q: string): boolean {
    if (!addressMatches(this.address, t.destination)) return false;
    if (this.dpt && !dptMatches(this.dpt, t.destination_dpt)) return false;
    return (
      !q ||
      `${t.source} ${t.destination} ${t.destination_name ?? ""} ${t.apci} ${t.value ?? ""} ${t.raw}`
        .toLowerCase()
        .includes(q)
    );
  }

  // --- archive -------------------------------------------------------------------------------

  private params(): URLSearchParams {
    const { from, to } = presetRange(
      this.preset,
      this.customFrom,
      this.customTo,
    );
    const p = new URLSearchParams({ from: String(from), to: String(to) });
    if (this.address.trim()) p.set("ga", this.address.trim());
    if (this.filter.trim()) p.set("q", this.filter.trim());
    if (this.dpt.trim()) p.set("dpt", this.dpt.trim());
    if (this.source.trim()) p.set("source", this.source.trim());
    if (this.kind) p.set("kind", this.kind);
    return p;
  }

  private async loadArchive(more = false): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    try {
      const p = this.params();
      p.set("limit", "200");
      if (more && this.nextCursor) p.set("cursor", String(this.nextCursor));
      const r = await api.get<{
        items: ArchiveItem[];
        total: number;
        next_cursor: number | null;
      }>(`api/bus/archive?${p}`);
      this.items = more ? [...this.items, ...r.items] : r.items;
      this.total = r.total;
      this.nextCursor = r.next_cursor;
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    } finally {
      this.loading = false;
    }
  }

  private scheduleArchive(): void {
    if (this.mode !== "archive") return;
    clearTimeout(this.debounce);
    this.debounce = window.setTimeout(() => void this.loadArchive(), 300);
  }

  private async loadSummary(): Promise<void> {
    try {
      this.summary = await api.get<Summary>("api/bus/archive/summary");
    } catch {
      this.summary = null;
    }
  }

  private setMode(mode: "live" | "archive"): void {
    this.mode = mode;
    if (mode === "archive") {
      void this.loadArchive();
      void this.loadSummary();
    }
  }

  private async clearArchive(): Promise<void> {
    if (!confirm(tr("Delete every recorded telegram? This cannot be undone.")))
      return;
    try {
      this.summary = await api.post<Summary>("api/bus/archive/clear", {});
      this.items = [];
      this.total = 0;
      this.nextCursor = null;
      store.say(tr("Archive cleared"), "success");
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    }
  }

  private value(id: string): string {
    return (
      this.renderRoot.querySelector(`#${id}`) as HTMLInputElement
    ).value.trim();
  }

  private async saveRecording(): Promise<void> {
    this.busy = true;
    try {
      await api.post("api/bus/settings", {
        record: (this.renderRoot.querySelector("#rec-on") as HTMLInputElement)
          .checked,
        retain_days: Number(this.value("rec-days")) || 0,
        retain_rows: Number(this.value("rec-rows")) || 0,
      });
      store.say(tr("Recording settings saved"), "success");
      this.settingsOpen = false;
      void this.loadSummary();
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    } finally {
      this.busy = false;
    }
  }

  private async send(kind: "read" | "write"): Promise<void> {
    const address = this.value("ga");
    const raw = this.value("raw");
    try {
      if (kind === "read") await api.post("api/bus/read", { address });
      else
        await api.post("api/bus/write", {
          address,
          raw: /^\d+$/.test(raw) && Number(raw) <= 63 ? Number(raw) : raw,
        });
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    }
  }

  // --- rendering ------------------------------------------------------------------------------

  private renderValue(t: TelegramRecord, projectOpen: boolean) {
    if (t.value !== null && t.value !== undefined)
      return html`${String(t.value)}${t.unit ? html` <span class="muted">${t.unit}</span>` : nothing}`;
    if (t.destination_kind !== "group" || t.destination_dpt) return "";
    const guess = guessValue(t.raw);
    if (guess)
      return html`<span
        class="guess"
        title=${tr("Read from the payload length, not from the project. Set the datapoint type of this address to see the real value.")}
        >${guess.text}</span
      >`;
    return projectOpen
      ? html`<span
          class="muted"
          title=${tr("This group address has no datapoint type in the project")}
          >${tr("no DPT")}</span
        >`
      : "";
  }

  private renderRows(items: TelegramRecord[], withDate: boolean) {
    const projectOpen = !!store.bus.decoding?.project;
    // The live list runs oldest first, the archive newest first: the delta is always to the
    // telegram that came before in time.
    const previous = (i: number) => items[withDate ? i + 1 : i - 1];
    return html`<table>
      <tr>
        <th>${tr("Time")}</th>
        <th
          title=${tr("Time since the previous telegram in this list")}
          style="text-align:right"
        >
          Δ
        </th>
        <th>${tr("Source")}</th>
        <th>${tr("Destination")}</th>
        <th>${tr("Name")}</th>
        <th>APCI</th>
        <th>${tr("Value")}</th>
        <th>DPT</th>
        <th>${tr("Raw")}</th>
        <th></th>
      </tr>
      ${items.map((t, i) => {
        const prev = previous(i);
        return html`<tr>
            <td class="muted">${withDate ? t.time : t.time.slice(-8)}</td>
            <td class="muted delta">${prev ? formatDelta(t.ts - prev.ts) : ""}</td>
            <td class="addr">${t.source}</td>
            <td class="addr">${t.destination}</td>
            <td>${t.destination_name ?? ""}</td>
            <td class="apci">${t.apci}</td>
            <td>${this.renderValue(t, projectOpen)}</td>
            <td class="muted" title=${dptTitle(t.destination_dpt)}>
              ${t.destination_dpt ? formatDpt(t.destination_dpt) : t.destination_kind === "group" ? html`<span class="guess">${guessValue(t.raw)?.dpt ?? ""}</span>` : ""}
            </td>
            <td class="addr muted">${t.raw}</td>
            <td class="act">
              ${chartable(t) ? html`<sl-button size="small" variant="text" title=${tr("Chart this address")} @click=${() => store.requestChart(t.destination, t.destination_name ?? "")}>${icon("chart", 14)}</sl-button>` : nothing}
            </td>
          </tr>`;
      })}
    </table>`;
  }

  private renderRecordingDialog() {
    const s = store.bus.settings;
    const sum = this.summary;
    const when = (ts: number | null) =>
      ts ? new Date(ts * 1000).toLocaleString() : "–";
    return html`<sl-dialog
      label=${tr("Recording")}
      ?open=${this.settingsOpen}
      @sl-after-hide=${() => (this.settingsOpen = false)}
      style="--width: 520px"
    >
      <div class="form">
        <p class="hint" style="margin:0">
          ${tr("Every telegram the connection sees is written to /config/telegrams.db, whether the live monitor is running or not. The Archive, the Charts and the Statistics read from it.")}
        </p>
        <sl-switch id="rec-on" ?checked=${s.record}
          >${tr("Record telegrams")}</sl-switch
        >
        <div class="two">
          <sl-input
            id="rec-days"
            type="number"
            min="0"
            size="small"
            label=${tr("Keep for (days, 0 = no limit)")}
            value=${String(s.retain_days)}
          ></sl-input>
          <sl-input
            id="rec-rows"
            type="number"
            min="0"
            size="small"
            label=${tr("Keep at most (telegrams, 0 = no limit)")}
            value=${String(s.retain_rows)}
          ></sl-input>
        </div>
        ${sum ? html`<div class="hint">${tr("Stored")}: ${sum.rows.toLocaleString()} ${tr("telegrams")}, ${formatBytes(sum.bytes)} · ${tr("oldest")} ${when(sum.oldest)} · ${tr("newest")} ${when(sum.newest)}</div>` : nothing}
        ${!s.auto_connect ? html`<div class="hint" style="color:var(--ha-warning)">${tr("Round-the-clock recording needs the connection to come back after a restart: turn on “Connect automatically when the add-on starts” in the gateway settings.")}</div>` : nothing}
      </div>
      <sl-button
        slot="footer"
        variant="danger"
        outline
        @click=${() => this.clearArchive()}
        >${tr("Clear archive")}</sl-button
      >
      <sl-button slot="footer" @click=${() => (this.settingsOpen = false)}
        >${tr("Cancel")}</sl-button
      >
      <sl-button
        slot="footer"
        variant="primary"
        ?loading=${this.busy}
        @click=${() => this.saveRecording()}
        >${tr("Save")}</sl-button
      >
    </sl-dialog>`;
  }

  render() {
    const q = this.filter.trim().toLowerCase();
    const connected = store.bus.state === "CONNECTED";
    const live = this.mode === "live";
    const liveItems = live
      ? this.recorded().filter((t) => this.passes(t, q))
      : [];
    const dec = store.bus.decoding;
    const decoding =
      !dec || !dec.project
        ? tr("no project open, names and values need one")
        : `${tr("decoding")} ${dec.with_dpt}/${dec.addresses}${dec.from_objects ? ` (${dec.from_objects} ${tr("from objects")})` : ""}`;
    const state = connected
      ? html`<span style="color:var(--ha-success)">●</span>
          ${store.bus.recording ? tr("recording") : tr("connected")}`
      : store.bus.retrying
        ? html`<span style="color:var(--ha-warning)">●</span>
            ${tr("reconnecting…")}`
        : tr("not connected");
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
            @click=${() => this.setMode("archive")}
            >${tr("Archive")}</sl-button
          >
        </sl-button-group>
        <span class="muted">${state}</span>
        <span
          class="muted"
          title=${tr("Group addresses whose datapoint type is known; set the DPT of an address in the Group addresses tab to decode it")}
          >${decoding}</span
        >
        <sl-input
          class="filter"
          size="small"
          placeholder=${tr("Filter (name, value, source…)")}
          clearable
          .value=${this.filter}
          @sl-input=${(e: Event) => {
            this.filter = (e.target as HTMLInputElement).value;
            this.scheduleArchive();
          }}
          ><span slot="prefix">${icon("search", 14)}</span></sl-input
        >
        <sl-input
          class="narrow addr"
          size="small"
          placeholder="1/2/ or 1/2/3"
          title=${tr("Address: 1/2/ shows a whole middle group, 1/2/3 one address")}
          clearable
          .value=${this.address}
          @sl-input=${(e: Event) => {
            this.address = (e.target as HTMLInputElement).value;
            this.scheduleArchive();
          }}
        ></sl-input>
        <sl-input
          class="narrow"
          size="small"
          placeholder="DPT 9.001"
          title=${tr("Datapoint type: 9 for every 9.xxx, 9.001 for one sub-type")}
          clearable
          .value=${this.dpt}
          @sl-input=${(e: Event) => {
            this.dpt = (e.target as HTMLInputElement).value;
            this.scheduleArchive();
          }}
        ></sl-input>
        <sl-button
          size="small"
          variant=${this.timeline ? "primary" : "default"}
          outline
          title=${tr("Show the telegrams on a time axis, one lane per source")}
          @click=${() => this.toggleTimeline()}
          >${tr("Timeline")}</sl-button
        >
        ${live ? this.renderLiveControls(liveItems.length) : this.renderArchiveControls()}
        <span style="flex:1"></span>
        <sl-input
          id="ga"
          size="small"
          placeholder="1/2/3"
          style="width:110px"
          ?disabled=${!connected}
        ></sl-input>
        <sl-input
          id="raw"
          size="small"
          placeholder=${tr("value: 0-63 or hex bytes")}
          style="width:180px"
          ?disabled=${!connected}
        ></sl-input>
        <sl-button
          size="small"
          ?disabled=${!connected}
          @click=${() => this.send("read")}
          >${tr("Read")}</sl-button
        >
        <sl-button
          size="small"
          ?disabled=${!connected}
          @click=${() => this.send("write")}
          >${tr("Write")}</sl-button
        >
      </div>
      ${
        this.timeline
          ? html`<xknx-telegram-timeline
              .items=${live ? liveItems : this.items}
              @telegram-pick=${(e: CustomEvent<TelegramRecord>) => this.onPick(e)}
            ></xknx-telegram-timeline>`
          : nothing
      }
      <div class="list">
        ${live ? this.renderLive(liveItems, connected) : this.renderArchive()}
      </div>
      ${this.renderRecordingDialog()}
    `;
  }

  private renderLiveControls(shown: number) {
    return html`
      <sl-button
        size="small"
        variant=${this.running ? "default" : "primary"}
        ?disabled=${this.running}
        @click=${() => this.start()}
        >${tr("Start")}</sl-button
      >
      <sl-button
        size="small"
        ?disabled=${!this.running}
        @click=${() => this.stop()}
        >${tr("Stop")}</sl-button
      >
      ${this.running ? nothing : html`<span class="muted">${tr("stopped")}${this.missed() > 0 ? ` · ${this.missed()} ${tr("new since")}` : ""}</span>`}
      <sl-button
        size="small"
        @click=${() =>
          api.post("api/bus/telegrams/clear", {}).then(() => {
            store.telegrams = [];
            store.monitor = {
              ...store.monitor,
              sinceId: 0,
              frozen: this.running ? null : [],
            };
            this.requestUpdate();
          })}
        >${tr("Clear")}</sl-button
      >
      <span class="muted">${shown}</span>
    `;
  }

  private renderArchiveControls() {
    const custom = this.preset === "custom";
    const csv = `api/bus/archive.csv?${this.params()}`;
    return html`
      <sl-select
        size="small"
        hoist
        value=${this.preset}
        style="width:150px"
        @sl-change=${(e: Event) => {
          this.preset = (e.target as HTMLSelectElement).value;
          void this.loadArchive();
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
                  void this.loadArchive();
                }}
              ></sl-input>
              <span class="muted">–</span>
              <sl-input
                size="small"
                type="datetime-local"
                .value=${this.customTo}
                @sl-change=${(e: Event) => {
                  this.customTo = (e.target as HTMLInputElement).value;
                  void this.loadArchive();
                }}
              ></sl-input>`
          : nothing
      }
      <sl-input
        class="narrow addr"
        size="small"
        placeholder="1.1.5"
        title=${tr("Source address")}
        clearable
        .value=${this.source}
        @sl-input=${(e: Event) => {
          this.source = (e.target as HTMLInputElement).value;
          this.scheduleArchive();
        }}
      ></sl-input>
      <sl-select
        size="small"
        hoist
        value=${this.kind || "all"}
        style="width:120px"
        @sl-change=${(e: Event) => {
          const v = (e.target as HTMLSelectElement).value;
          this.kind = v === "all" ? "" : v;
          void this.loadArchive();
        }}
      >
        <sl-option value="all">${tr("All")}</sl-option>
        <sl-option value="group">${tr("Group")}</sl-option>
        <sl-option value="individual">${tr("Individual")}</sl-option>
      </sl-select>
      <sl-button
        size="small"
        ?loading=${this.loading}
        @click=${() => this.loadArchive()}
        >${tr("Refresh")}</sl-button
      >
      <sl-button
        size="small"
        href=${csv}
        download
        title=${tr("Export the filtered archive as CSV")}
        >${icon("download", 14)} CSV</sl-button
      >
      <sl-button
        size="small"
        title=${tr("Recording settings")}
        @click=${() => {
          void this.loadSummary();
          this.settingsOpen = true;
        }}
        >${icon("settings", 14)}</sl-button
      >
      <span class="muted"
        >${this.total.toLocaleString()}${this.summary ? ` / ${this.summary.rows.toLocaleString()}` : ""}</span
      >
    `;
  }

  private renderLive(items: TelegramRecord[], connected: boolean) {
    if (items.length) return this.renderRows(items, false);
    return html`<div class="empty">
      ${connected ? tr("Waiting for telegrams…") : tr("Connect to a gateway (top right) to see bus traffic.")}
    </div>`;
  }

  private renderArchive() {
    if (!this.items.length)
      return html`<div class="empty">
        ${this.loading ? tr("Loading…") : store.bus.recording ? tr("Nothing recorded in this range.") : tr("Recording is off. Turn it on under the settings button to keep every telegram on disk.")}
      </div>`;
    return html`${this.renderRows(this.items, true)}
    ${this.nextCursor ? html`<div class="more"><sl-button size="small" ?loading=${this.loading} @click=${() => this.loadArchive(true)}>${tr("Load more")} (${(this.total - this.items.length).toLocaleString()} ${tr("more")})</sl-button></div>` : nothing}`;
  }
}
