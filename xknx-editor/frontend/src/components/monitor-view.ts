import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api, ApiError } from "../api.js";
import { icon } from "../icons.js";
import { store, type TelegramRecord } from "../store.js";
import { t as tr } from "../i18n.js";

/** "DPST-13-10" → "13.010", "DPT-1" → "1.xxx". */
function dptShort(dpt: string): string {
  const m = /^DPST-(\d+)-(\d+)$/.exec(dpt);
  if (m) return `${m[1]}.${m[2].padStart(3, "0")}`;
  const n = /^DPT-(\d+)$/.exec(dpt);
  return n ? `${n[1]}.xxx` : dpt;
}

/** Bottom-dock group monitor: live telegrams with decoded values, filter, read/write bar. */
@customElement("xknx-monitor-view")
export class MonitorView extends LitElement {
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
    .toolbar sl-input.filter {
      flex: 1;
      min-width: 160px;
      max-width: 320px;
    }
    .list {
      overflow: auto;
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
    .empty {
      padding: 16px;
      color: var(--ha-text-2);
    }
  `;

  @state() private filter = "";
  // The monitor records only while it is running, and it starts stopped and empty: neither opening
  // a project nor reloading the page should present traffic nobody asked to record. `frozen` is the
  // list as it stood when Stop was pressed; telegrams keep arriving in the background either way,
  // and `sinceId` is the last one that already existed when Start was pressed, so a run shows only
  // what happened during it. Ids come from the backend and only ever increase.
  @state() private running = false;
  @state() private frozen: TelegramRecord[] | null = [];
  private sinceId = 0;
  private unsubscribe = () => {};
  private lastProject = "";

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = store.subscribe(() => {
      this.stopOnProjectChange();
      this.requestUpdate();
    });
    // Deliberately no backlog fetch: a restart starts clean.
    if (!this.running) this.stop();
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    super.disconnectedCallback();
  }

  /** Opening (or closing) a project stops the monitor, so it never keeps running against a
   * project the user has moved away from. */
  private stopOnProjectChange(): void {
    const id = store.project.open ? (store.project.id ?? "") : "";
    if (id === this.lastProject) return;
    this.lastProject = id;
    this.stop();
  }

  /** The telegrams the table shows: this run's while running, the frozen snapshot while stopped. */
  private recorded(): TelegramRecord[] {
    if (!this.running) return this.frozen ?? [];
    return store.telegrams.filter((t) => t.id > this.sinceId);
  }

  /** How many arrived since the monitor stopped recording. */
  private missed(): number {
    const last = this.frozen?.at(-1)?.id ?? this.sinceId;
    return store.telegrams.filter((t) => t.id > last).length;
  }

  private start(): void {
    this.sinceId = store.telegrams.at(-1)?.id ?? 0;
    this.frozen = null;
    this.running = true;
  }

  private stop(): void {
    this.frozen = this.recorded();
    this.running = false;
  }

  updated(): void {
    if (!this.running) return;
    const list = this.renderRoot.querySelector(".list") as HTMLElement | null;
    if (list) list.scrollTop = list.scrollHeight;
  }

  private async send(kind: "read" | "write"): Promise<void> {
    const address = (
      this.renderRoot.querySelector("#ga") as HTMLInputElement
    ).value.trim();
    const raw = (
      this.renderRoot.querySelector("#raw") as HTMLInputElement
    ).value.trim();
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

  render() {
    const q = this.filter.trim().toLowerCase();
    const source = this.recorded();
    const items = source.filter(
      (t) =>
        !q ||
        `${t.source} ${t.destination} ${t.destination_name ?? ""} ${t.apci} ${t.value ?? ""} ${t.raw}`
          .toLowerCase()
          .includes(q),
    );
    const connected = store.bus.state === "CONNECTED";
    const dec = store.bus.decoding;
    const decoding =
      !dec || !dec.project
        ? tr("no project open, names and values need one")
        : `${tr("decoding")} ${dec.with_dpt}/${dec.addresses}${dec.from_objects ? ` (${dec.from_objects} ${tr("from objects")})` : ""}`;
    return html`
      <div class="toolbar">
        <span class="muted"
          >${connected ? html`<span style="color:var(--ha-success)">●</span> recording` : "not connected"}</span
        >
        <span
          class="muted"
          title=${tr("Group addresses whose datapoint type is known; set the DPT of an address in the Group addresses tab to decode it")}
          >${decoding}</span
        >
        <sl-input
          class="filter"
          size="small"
          placeholder=${tr("Filter")}
          clearable
          @sl-input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
          ><span slot="prefix">${icon("search", 14)}</span></sl-input
        >
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
              this.frozen = this.running ? null : [];
              this.sinceId = 0;
              this.requestUpdate();
            })}
          >${tr("Clear")}</sl-button
        >
        <span class="muted">${items.length}</span>
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
      <div class="list">
        ${
          items.length
            ? html`<table>
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
                ${items.map(
                  (t) =>
                    html`<tr>
                      <td class="muted">${t.time}</td>
                      <td class="addr">${t.source}</td>
                      <td class="addr">${t.destination}</td>
                      <td>${t.destination_name ?? ""}</td>
                      <td class="apci">${t.apci}</td>
                      <td>
                        ${t.value !== null && t.value !== undefined ? html`${String(t.value)}${t.unit ? html` <span class="muted">${t.unit}</span>` : nothing}` : t.destination_kind === "group" && dec?.project && !t.destination_dpt ? html`<span class="muted" title=${tr("This group address has no datapoint type in the project")}>${tr("no DPT")}</span>` : ""}
                      </td>
                      <td class="muted">
                        ${t.destination_dpt ? dptShort(t.destination_dpt) : ""}
                      </td>
                      <td class="addr muted">${t.raw}</td>
                    </tr>`,
                )}
              </table>`
            : html`<div class="empty">
                ${connected ? "Waiting for telegrams…" : "Connect to a gateway (top right) to see bus traffic."}
              </div>`
        }
      </div>
    `;
  }
}
