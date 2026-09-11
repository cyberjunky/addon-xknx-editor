import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ApiError, api } from "../api.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { t as tr } from "../i18n.js";

type Keyring = {
  path: string;
  project: string;
  created_by: string;
  created: string;
  backbone_key: string | null;
  interfaces: {
    type: string;
    individual_address: string | null;
    host: string | null;
    user_id: number | null;
    password: string | null;
    authentication: string | null;
  }[];
  devices: {
    individual_address: string;
    tool_key: string | null;
    management_password: string | null;
    authentication: string | null;
    fdsk: string | null;
    sequence_number: number | null;
  }[];
  group_keys: { address: number; text: string; key: string | null }[];
  revealed: boolean;
};

/** Centre-dock "Secure": what the configured KNX Data Secure keyring holds, and a converter. */
@customElement("xknx-secure-view")
export class SecureView extends LitElement {
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
    .warn {
      color: var(--ha-warning);
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
    h4 {
      margin: 14px 0 6px;
      font-weight: 500;
    }
    .grid {
      display: grid;
      grid-template-columns: 120px 1fr;
      gap: 4px 12px;
      max-width: 640px;
    }
  `;

  @state() private kr: Keyring | null = null;
  @state() private error = "";
  @state() private reveal = false;
  @state() private exportPath = "/share/keyring-converted.knxkeys";
  @state() private exportPassword = "";
  @state() private busy = false;
  private unsubscribe = () => {};
  private loadedFor = "";

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = store.subscribe(() => {
      this.requestUpdate();
      void this.load();
    });
    void this.load(true);
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    super.disconnectedCallback();
  }

  private async load(force = false): Promise<void> {
    const key = `${store.bus.settings.keyring_path}|${this.reveal}`;
    if (!force && key === this.loadedFor) return;
    this.loadedFor = key;
    if (!store.bus.settings.keyring_path) {
      this.kr = null;
      this.error = "";
      return;
    }
    try {
      this.kr = await api.get<Keyring>(
        `api/secure/keyring${this.reveal ? "?reveal=1" : ""}`,
      );
      this.error = "";
    } catch (e) {
      this.kr = null;
      this.error = e instanceof ApiError ? e.message : String(e);
    }
  }

  private async exportKeyring(): Promise<void> {
    this.busy = true;
    try {
      const r = await api.post<{ path: string }>("api/secure/export", {
        path: this.exportPath,
        new_password: this.exportPassword,
      });
      store.say(`Keyring written to ${r.path}`, "success");
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    } finally {
      this.busy = false;
    }
  }

  render() {
    const s = store.bus.settings;
    if (!s.keyring_path)
      return html`<p class="desc">
        ${tr("No keyring configured. Open the gateway menu (top right) → Settings, upload your .knxkeys export and enter its password. The keyring is what makes IP Secure tunnelling and Data Secure programming possible.")}
      </p>`;
    const k = this.kr;
    return html`
      <p class="desc">
        ${tr("The KNX Data Secure keyring the add-on uses for IP Secure tunnels and secure device programming. Keys are masked; reveal them only on a trusted screen. A converted copy under another password can be handed to another tool or installer.")}
      </p>
      <div class="row">
        <sl-checkbox
          size="small"
          ?checked=${this.reveal}
          @sl-change=${(e: Event) => {
            this.reveal = (e.target as HTMLInputElement).checked;
            void this.load(true);
          }}
          >${tr("Reveal keys")}</sl-checkbox
        >
        <sl-button size="small" @click=${() => this.load(true)}
          >${tr("Reload")}</sl-button
        >
      </div>
      ${this.error ? html`<p class="warn">${this.error}</p>` : nothing}
      ${
        k
          ? html`
              <div class="grid">
                <span class="muted">${tr("File")}</span
                ><span class="mono">${k.path}</span>
                <span class="muted">${tr("Project")}</span
                ><span>${k.project || "–"}</span>
                <span class="muted">${tr("Created by")}</span
                ><span
                  >${k.created_by || "–"}
                  ${k.created ? html`<span class="muted">(${k.created})</span>` : nothing}</span
                >
                <span class="muted">${tr("Backbone key")}</span
                ><span class="mono">${k.backbone_key ?? "–"}</span>
              </div>
              <h4>${tr("Interfaces")} (${k.interfaces.length})</h4>
              <div class="wrap">
                <table>
                  <tr>
                    <th>${tr("Type")}</th>
                    <th>${tr("Address")}</th>
                    <th>${tr("Host")}</th>
                    <th>${tr("User")}</th>
                    <th>${tr("Password")}</th>
                    <th>${tr("Authentication")}</th>
                  </tr>
                  ${k.interfaces.map(
                    (i) =>
                      html`<tr>
                        <td>${i.type}</td>
                        <td class="mono">${i.individual_address ?? ""}</td>
                        <td class="mono">${i.host ?? ""}</td>
                        <td>${i.user_id ?? ""}</td>
                        <td class="mono">${i.password ?? "–"}</td>
                        <td class="mono">${i.authentication ?? "–"}</td>
                      </tr>`,
                  )}
                </table>
              </div>
              <h4>${tr("Devices")} (${k.devices.length})</h4>
              <div class="wrap">
                <table>
                  <tr>
                    <th>${tr("Address")}</th>
                    <th>${tr("Tool key")}</th>
                    <th>${tr("Sequence")}</th>
                    <th>FDSK</th>
                    <th>${tr("Management password")}</th>
                  </tr>
                  ${k.devices.map(
                    (d) =>
                      html`<tr>
                        <td class="mono">${d.individual_address}</td>
                        <td class="mono">${d.tool_key ?? "–"}</td>
                        <td>${d.sequence_number ?? ""}</td>
                        <td class="mono">${d.fdsk ?? "–"}</td>
                        <td class="mono">${d.management_password ?? "–"}</td>
                      </tr>`,
                  )}
                </table>
              </div>
              <h4>${tr("Group addresses")} (${k.group_keys.length})</h4>
              <div class="wrap">
                <table>
                  <tr>
                    <th>${tr("Address")}</th>
                    <th>${tr("Key")}</th>
                  </tr>
                  ${k.group_keys.map(
                    (g) =>
                      html`<tr>
                        <td class="mono">${g.text}</td>
                        <td class="mono">${g.key ?? "–"}</td>
                      </tr>`,
                  )}
                </table>
              </div>
              <h4>${tr("Convert")}</h4>
              <div class="row">
                <sl-input
                  size="small"
                  style="width:320px"
                  label=${tr("Write to")}
                  value=${this.exportPath}
                  @sl-input=${(e: Event) => (this.exportPath = (e.target as HTMLInputElement).value)}
                ></sl-input>
                <sl-input
                  size="small"
                  type="password"
                  password-toggle
                  style="width:220px"
                  label=${tr("New keyring password")}
                  value=${this.exportPassword}
                  @sl-input=${(e: Event) => (this.exportPassword = (e.target as HTMLInputElement).value)}
                ></sl-input>
                <sl-button
                  size="small"
                  variant="primary"
                  style="align-self:end"
                  ?disabled=${!this.exportPassword || this.busy}
                  ?loading=${this.busy}
                  @click=${() => this.exportKeyring()}
                  >${icon("download", 14)} ${tr("Export")}</sl-button
                >
              </div>
            `
          : nothing
      }
    `;
  }
}
