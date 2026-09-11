import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ApiError, api, type Job } from "../api.js";
import { store } from "../store.js";
import { t as tr } from "../i18n.js";

type Ecg = {
  slot: number;
  present: boolean;
  ecg_type: number;
  group_index: number;
  group_label: string;
  ets_ecg_index: number;
  long_address_hex: string;
  alarm: number;
};
type Group = {
  index: number;
  ecg_count: number;
  lamp_failures: number;
  ecg_failures: number;
  knx_value: number;
};
type Scan = {
  channel: number;
  firmware: string | null;
  ecgs: Ecg[];
  present: number;
  groups: Group[];
};

/** "DALI bus" tab of an MDT DALI Control gateway: scan, identify ballasts, new/post installation. */
@customElement("xknx-dali-panel")
export class DaliPanel extends LitElement {
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
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th,
    td {
      text-align: left;
      padding: 4px 8px;
      border-bottom: 1px solid var(--ha-divider);
      white-space: nowrap;
    }
    th {
      color: var(--ha-text-2);
      font-weight: 500;
      font-size: 12px;
    }
    .mono {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .wrap {
      overflow-x: auto;
    }
    p.desc {
      color: var(--ha-text-2);
      max-width: 80ch;
      margin: 4px 0 8px;
    }
  `;

  @property({ type: Number }) deviceId = 0;
  @state() private channel = 0;
  @state() private scan: Scan | null = null;
  @state() private busy = "";
  @state() private stage = "";
  @state() private error = "";
  @state() private confirm: "new-install" | "post-install" | null = null;

  private async op(
    name: string,
    params: Record<string, unknown> = {},
    storeScan = false,
  ): Promise<void> {
    if (this.busy) return;
    this.busy = name;
    this.error = "";
    this.stage = "";
    try {
      let job = await api.post<Job>(
        `api/devices/${this.deviceId}/dali/${name}`,
        { channel: this.channel, ...params },
      );
      while (job.status === "queued" || job.status === "running") {
        await new Promise((r) => setTimeout(r, 400));
        job = await api.get<Job>(`api/jobs/${job.id}`);
        this.stage = job.stage;
      }
      if (job.status === "failed")
        throw new ApiError(500, job.error ?? "failed");
      if (storeScan) this.scan = job.result as Scan;
    } catch (e) {
      this.error = e instanceof ApiError ? e.message : String(e);
      store.say(this.error, "danger");
    } finally {
      this.busy = "";
      this.stage = "";
    }
  }

  render() {
    const connected = store.bus.state === "CONNECTED";
    if (!connected)
      return html`<p class="desc">
        ${tr("Connect to a KNX interface to commission the DALI bus.")}
      </p>`;
    const s = this.scan;
    return html`
      <p class="desc">
        MDT DALI Control gateway: read the DALI bus (ballasts, groups), identify
        a ballast by blinking it, and run a new or post installation.
        Installation actions renumber ballasts on the DALI bus; start every
        session with a read-only scan. Manufacturer specific; verified on few
        devices.
      </p>
      <div class="row">
        <sl-select
          size="small"
          style="width:130px"
          value=${String(this.channel)}
          @sl-change=${(e: Event) => (this.channel = Number((e.target as HTMLSelectElement).value))}
        >
          <sl-option value="0">${tr("Channel 1")}</sl-option
          ><sl-option value="1">${tr("Channel 2")}</sl-option>
        </sl-select>
        <sl-button
          size="small"
          variant="primary"
          ?disabled=${!!this.busy}
          ?loading=${this.busy === "scan"}
          @click=${() => this.op("scan", {}, true)}
          >${tr("Scan bus")}</sl-button
        >
        <sl-button
          size="small"
          ?disabled=${!!this.busy}
          @click=${() => this.op("broadcast", { on: true })}
          >${tr("All on")}</sl-button
        >
        <sl-button
          size="small"
          ?disabled=${!!this.busy}
          @click=${() => this.op("broadcast", { on: false })}
          >${tr("All off")}</sl-button
        >
        <sl-button
          size="small"
          ?disabled=${!!this.busy}
          @click=${() => (this.confirm = "new-install")}
          >${tr("New installation…")}</sl-button
        >
        <sl-button
          size="small"
          ?disabled=${!!this.busy}
          @click=${() => (this.confirm = "post-install")}
          >${tr("Post installation…")}</sl-button
        >
        <sl-button
          size="small"
          ?disabled=${!this.busy}
          @click=${() => api.post(`api/devices/${this.deviceId}/dali/abort`, { channel: this.channel })}
          >${tr("Abort")}</sl-button
        >
        ${this.busy ? html`<span class="muted">Running: ${this.busy}${this.stage ? ` (${this.stage})` : ""}</span>` : nothing}
      </div>
      ${this.error ? html`<p class="bad">${this.error}</p>` : nothing}
      ${
        s
          ? html`<p class="muted">
                Firmware ${s.firmware ?? "?"} · ${s.present}
                ballast${s.present === 1 ? "" : "s"} present
              </p>
              <div class="wrap">
                <table>
                  <tr>
                    <th>${tr("Slot")}</th>
                    <th>${tr("Group")}</th>
                    <th>${tr("ECG number")}</th>
                    <th>${tr("Type")}</th>
                    <th>${tr("Long address")}</th>
                    <th>${tr("Alarm")}</th>
                    <th></th>
                  </tr>
                  ${s.ecgs
                    .filter((e) => e.present)
                    .map(
                      (e) =>
                        html`<tr>
                          <td>${e.slot}</td>
                          <td>${e.group_label}</td>
                          <td>
                            ${e.ets_ecg_index === 255 ? "–" : e.ets_ecg_index}
                          </td>
                          <td>${e.ecg_type}</td>
                          <td class="mono">${e.long_address_hex}</td>
                          <td class=${e.alarm ? "bad" : ""}>
                            ${e.alarm ? "!" : ""}
                          </td>
                          <td>
                            <sl-button
                              size="small"
                              ?disabled=${!!this.busy}
                              @click=${() => this.op("blink", { slot: e.slot, on: true })}
                              >${tr("Blink")}</sl-button
                            >
                            <sl-button
                              size="small"
                              ?disabled=${!!this.busy}
                              @click=${() => this.op("blink", { slot: e.slot, on: false })}
                              >${tr("Stop")}</sl-button
                            >
                            <sl-button
                              size="small"
                              ?disabled=${!!this.busy}
                              @click=${() => this.op("switch", { slot: e.slot, on: true })}
                              >${tr("On")}</sl-button
                            >
                            <sl-button
                              size="small"
                              ?disabled=${!!this.busy}
                              @click=${() => this.op("switch", { slot: e.slot, on: false })}
                              >${tr("Off")}</sl-button
                            >
                          </td>
                        </tr>`,
                    )}
                </table>
              </div>
              <p class="muted" style="margin-top:8px">
                Groups with ballasts:
                ${
                  s.groups
                    .filter((g) => g.ecg_count)
                    .map(
                      (g) =>
                        `${g.index + 1} (${g.ecg_count}${g.lamp_failures || g.ecg_failures ? `, ${g.lamp_failures + g.ecg_failures} failures` : ""})`,
                    )
                    .join(", ") || "none"
                }
              </p>`
          : html`<p class="muted">
              ${tr("Run “Scan bus” to read the DALI bus.")}
            </p>`
      }
      <sl-dialog
        label=${tr("Confirm DALI installation")}
        ?open=${this.confirm !== null}
        @sl-after-hide=${() => (this.confirm = null)}
      >
        <p>
          ${this.confirm === "new-install" ? "New installation re-scans the DALI bus and REASSIGNS every ballast's short address. This is destructive and cannot be undone." : "Post installation scans the bus for new ballasts and updates the addressing. This changes the gateway."}
          Continue?
        </p>
        <sl-button slot="footer" @click=${() => (this.confirm = null)}
          >${tr("Cancel")}</sl-button
        >
        <sl-button
          slot="footer"
          variant="danger"
          @click=${() => {
            const k = this.confirm;
            this.confirm = null;
            if (k) void this.op(k, {}, true);
          }}
          >${tr("Continue")}</sl-button
        >
      </sl-dialog>
    `;
  }
}
