import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ApiError, api } from "../api.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { t as tr } from "../i18n.js";

type Entry = {
  address: string;
  mask_version: string;
  app_id: {
    manufacturer_id: string;
    application_number: number;
    application_version: number;
  } | null;
  product_ref_id: string | null;
  product_name: string | null;
  state: string;
  selected: boolean;
  ambiguous: boolean;
  candidates: number;
  recoverable: boolean;
  applied: boolean;
  error: string;
  verify_changed: number | null;
  recovered: {
    group_addresses: number;
    links: number;
    parameters: number;
    unknown: number;
    serial_number: string | null;
    order_info: string | null;
    hardware_type: string | null;
  } | null;
};
type Status = {
  phase: string;
  busy: boolean;
  error: string | null;
  connected: boolean;
  progress: { done: number; total: number; current: string; stage: string };
  entries: Entry[];
  totals: {
    devices: number;
    group_addresses: number;
    links: number;
    unknown: number;
  };
  apply_status: string;
  warnings: {
    group_address: number;
    kind: string;
    senders: number;
    receivers: number;
  }[];
};

const STATE_LABEL: Record<string, string> = {
  found: "product found",
  ambiguous: "confirm product",
  unprogrammed: "not programmed",
  "no-product": "product data missing",
  recovered: "read back",
  error: "error",
  exists: "already in project",
  applied: "added to project",
};

/** Centre-dock "Recover": scan a line, identify devices, read them back from the bus, write them into a project. */
@customElement("xknx-recover-view")
export class RecoverView extends LitElement {
  static styles = css`
    sl-button::part(label) {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    :host {
      display: block;
      padding: 8px 16px 16px;
      font-size: 13px;
    }
    .desc {
      color: var(--ha-text-2);
      margin: 4px 0 12px;
      max-width: 80ch;
    }
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      margin: 8px 0;
    }
    .muted {
      color: var(--ha-text-2);
    }
    .bad {
      color: var(--ha-error);
    }
    .warn {
      color: var(--ha-warning);
    }
    .ok {
      color: var(--ha-success);
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th,
    td {
      text-align: left;
      padding: 5px 8px;
      border-bottom: 1px solid var(--ha-divider);
      white-space: nowrap;
      vertical-align: middle;
    }
    th {
      color: var(--ha-text-2);
      font-weight: 500;
      font-size: 12px;
    }
    .addr {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .wrap {
      overflow-x: auto;
    }
    .status {
      margin-top: 12px;
      padding: 8px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--ha-text) 5%, transparent);
      white-space: pre-line;
    }
    h4 {
      margin: 14px 0 6px;
      font-weight: 500;
    }
  `;

  @state() private st: Status | null = null;
  @state() private start = "1.1.1";
  @state() private end = "1.1.255";
  @state() private newProject = "";
  @state() private busy = false;
  private timer: number | null = null;
  private unsubscribe = () => {};

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = store.subscribe(() => this.requestUpdate());
    void this.poll();
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    if (this.timer) window.clearTimeout(this.timer);
    super.disconnectedCallback();
  }

  private async poll(): Promise<void> {
    try {
      this.st = await api.get<Status>("api/recover");
    } catch {
      /* transient */
    }
    const delay = this.st?.busy ? 700 : 4000;
    this.timer = window.setTimeout(() => void this.poll(), delay);
  }

  private async act(fn: () => Promise<unknown>, done?: string): Promise<void> {
    this.busy = true;
    try {
      const r = await fn();
      if (r && typeof r === "object" && "phase" in (r as Status))
        this.st = r as Status;
      if (done) store.say(done, "success");
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    } finally {
      this.busy = false;
      void this.poll();
    }
  }

  private renderEntries(s: Status) {
    if (!s.entries.length)
      return html`<p class="muted">
        ${s.phase === "idle" ? "No scan yet." : s.phase === "scanning" ? "Scanning…" : "No device answered in that range."}
      </p>`;
    return html`<div class="wrap">
      <table>
        <tr>
          <th></th>
          <th>${tr("Address")}</th>
          <th>${tr("Mask")}</th>
          <th>${tr("Application")}</th>
          <th>${tr("Product")}</th>
          <th>${tr("State")}</th>
          <th>${tr("Read back")}</th>
          <th>${tr("Verify")}</th>
        </tr>
        ${s.entries.map(
          (e) =>
            html`<tr>
              <td>
                <sl-checkbox
                  size="small"
                  ?checked=${e.selected}
                  ?disabled=${!e.recoverable || s.busy}
                  @sl-change=${(ev: Event) => this.act(() => api.post("api/recover/select", { address: e.address, selected: (ev.target as HTMLInputElement).checked }))}
                ></sl-checkbox>
              </td>
              <td class="addr">${e.address}</td>
              <td class="addr">${e.mask_version}</td>
              <td class="muted">
                ${e.app_id ? `${e.app_id.manufacturer_id} #${e.app_id.application_number} v${e.app_id.application_version}` : "–"}
              </td>
              <td>
                ${e.product_name ?? html`<span class="warn">${tr("not in catalog")}</span>`}${e.ambiguous ? html` <span class="warn">(${e.candidates} candidates, check)</span>` : nothing}
              </td>
              <td
                class=${e.state === "error" ? "bad" : e.state === "applied" || e.state === "recovered" ? "ok" : e.state === "ambiguous" || e.state === "no-product" ? "warn" : ""}
              >
                ${STATE_LABEL[e.state] ?? e.state}${e.error ? html`<div class="bad" style="white-space:normal;max-width:360px">${e.error}</div>` : nothing}
              </td>
              <td class="muted">
                ${e.recovered ? `${e.recovered.group_addresses} GAs, ${e.recovered.links} links, ${e.recovered.parameters} params${e.recovered.unknown ? `, ${e.recovered.unknown} unknown` : ""}${e.recovered.serial_number ? `, S/N ${e.recovered.serial_number}` : ""}` : "–"}
              </td>
              <td>
                ${e.verify_changed === null ? html`<span class="muted">–</span>` : e.verify_changed === 0 ? html`<span class="ok">${tr("identical")}</span>` : html`<span class="warn">${e.verify_changed} bytes differ</span>`}
              </td>
            </tr>`,
        )}
      </table>
    </div>`;
  }

  render() {
    const s = this.st;
    if (!s) return html`<p class="desc">${tr("Loading…")}</p>`;
    const p = s.progress;
    const recovered = s.entries.filter((e) => e.recovered);
    const selectable = s.entries.filter(
      (e) => e.selected && e.recoverable,
    ).length;
    return html`
      <p class="desc">
        ${tr("Rebuild a project from what is on the bus: scan a range of individual addresses, match each device's application against the catalog, read its group-address, association and parameter tables back (read-only), optionally verify the result against the device, and write the devices into the open project or a new one. Devices whose product data is missing need their .knxprod in the catalog first (Catalog tab), then use Re-identify.")}
      </p>
      ${!s.connected ? html`<p class="warn">${tr("Connect to a KNX gateway first (top right).")}</p>` : nothing}
      <div class="row">
        <label class="muted">${tr("From")}</label
        ><sl-input
          size="small"
          style="width:110px"
          value=${this.start}
          @sl-input=${(e: Event) => (this.start = (e.target as HTMLInputElement).value)}
        ></sl-input>
        <label class="muted">to</label
        ><sl-input
          size="small"
          style="width:110px"
          value=${this.end}
          @sl-input=${(e: Event) => (this.end = (e.target as HTMLInputElement).value)}
        ></sl-input>
        <sl-button
          size="small"
          variant="primary"
          ?disabled=${!s.connected || s.busy || this.busy}
          @click=${() => this.act(() => api.post("api/recover/scan", { start: this.start.trim(), end: this.end.trim() }))}
          >${icon("search", 14)} ${tr("Scan")}</sl-button
        >
        <sl-button
          size="small"
          ?disabled=${!s.connected || s.busy || !selectable}
          @click=${() => this.act(() => api.post("api/recover/recover", {}))}
          >${tr("Read back")} ${selectable ? `(${selectable})` : ""}</sl-button
        >
        <sl-button
          size="small"
          ?disabled=${!s.connected || s.busy || !recovered.length}
          @click=${() => this.act(() => api.post("api/recover/verify", {}))}
          >${tr("Verify")}</sl-button
        >
        <sl-button
          size="small"
          ?disabled=${!s.busy}
          @click=${() => this.act(() => api.post("api/recover/stop", {}))}
          >${tr("Stop")}</sl-button
        >
        <sl-button
          size="small"
          ?disabled=${s.busy || !s.entries.length}
          @click=${() => this.act(() => api.post("api/recover/reidentify", {}))}
          >${tr("Re-identify")}</sl-button
        >
        <sl-button
          size="small"
          ?disabled=${s.busy || !s.entries.length}
          @click=${() => this.act(() => api.post("api/recover/reset", {}))}
          >${tr("Clear")}</sl-button
        >
      </div>
      ${s.busy ? html`<div class="row"><sl-spinner style="font-size:14px"></sl-spinner><span class="muted">${s.phase} ${p.done}/${p.total} ${p.current}${p.stage ? ` · ${p.stage}` : ""}</span></div>` : nothing}
      ${s.error ? html`<div class="status bad">${s.error}</div>` : nothing}
      ${this.renderEntries(s)}
      ${
        recovered.length
          ? html`<h4>${tr("Write into a project")}</h4>
              <p class="muted">
                ${s.totals.devices} device${s.totals.devices === 1 ? "" : "s"}
                read back: ${s.totals.group_addresses} group addresses,
                ${s.totals.links}
                links${s.totals.unknown ? `, ${s.totals.unknown} parameters could not be decoded` : ""}.
                Group addresses are created by value (no names); rename them
                afterwards.
              </p>
              ${
                s.warnings.length
                  ? html`<p class="warn">
                      ${s.warnings.length} group
                      address${s.warnings.length === 1 ? "" : "es"} with
                      ${s.warnings.some((w) => w.kind === "no_sender") ? "no sender" : ""}${s.warnings.some((w) => w.kind === "multiple_senders") ? " / several senders" : ""}:
                      ${s.warnings
                        .slice(0, 8)
                        .map(
                          (w) =>
                            `${w.group_address >> 11}/${(w.group_address >> 8) & 7}/${w.group_address & 255}`,
                        )
                        .join(", ")}${s.warnings.length > 8 ? "…" : ""}
                    </p>`
                  : nothing
              }
              <div class="row">
                <sl-button
                  size="small"
                  variant="primary"
                  ?disabled=${s.busy || !store.project.open}
                  @click=${() => this.act(() => api.post("api/recover/apply", {}), "Devices added to the open project")}
                  >Add to open
                  project${store.project.open ? "" : " (none open)"}</sl-button
                >
                <span class="muted">or</span>
                <sl-input
                  size="small"
                  placeholder=${tr("New project name")}
                  style="width:220px"
                  value=${this.newProject}
                  @sl-input=${(e: Event) => (this.newProject = (e.target as HTMLInputElement).value)}
                ></sl-input>
                <sl-button
                  size="small"
                  ?disabled=${s.busy || !this.newProject.trim()}
                  @click=${() => this.act(() => api.post("api/recover/apply", { new_project: this.newProject.trim() }), "New project created from the bus")}
                  >${tr("Create project and add")}</sl-button
                >
                <a
                  href="api/recover/snapshot"
                  download="recover-snapshot.json"
                  style="margin-left:auto"
                  ><sl-button size="small"
                    >${icon("download", 14)} Snapshot (JSON)</sl-button
                  ></a
                >
              </div>
              ${s.apply_status ? html`<div class="status">${s.apply_status}</div>` : nothing}`
          : nothing
      }
    `;
  }
}
