import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { api, ApiError, type DeviceSummary } from "../api.js";
import { deviceAddress, store } from "../store.js";
import { t as tr } from "../i18n.js";

type Detail = {
  id: number;
  name: string;
  space_type: string;
  number: string;
  description: string;
  devices: DeviceSummary[];
  functions: {
    id: number;
    name: string;
    function_type: string;
    space: string;
    group_addresses: { text: string; role: string }[];
  }[];
  parts: {
    id: number;
    name: string;
    space_type: string;
    devices: number;
    children: number;
  }[];
};

/** Centre-dock view of a building/room: its devices (the usual columns), functions and building parts. */
@customElement("xknx-space-panel")
export class SpacePanel extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 8px 16px 16px;
      font-size: 13px;
    }
    h3 {
      margin: 4px 0 8px;
      font-weight: 500;
      font-size: 15px;
    }
    h3 .muted {
      font-weight: 400;
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
      position: sticky;
      top: 0;
      background: var(--ha-card);
    }
    tr.dev:hover td {
      background: color-mix(in srgb, var(--ha-text) 5%, transparent);
      cursor: pointer;
    }
    .addr {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .muted {
      color: var(--ha-text-2);
    }
    .ok {
      color: var(--ha-success);
    }
    .no {
      color: var(--ha-text-2);
    }
    td.tick {
      text-align: center;
      width: 26px;
    }
    .empty {
      color: var(--ha-text-2);
      padding: 16px 0;
    }
    .wrap {
      overflow-x: auto;
    }
  `;

  @property({ type: Number }) spaceId = 0;
  @state() private detail: Detail | null = null;
  private unsubscribe = () => {};
  private loaded = { id: -1, rev: -1 };

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = store.subscribe(() => {
      this.requestUpdate();
      void this.sync();
    });
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    super.disconnectedCallback();
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has("spaceId")) void this.sync(true);
  }

  private async sync(force = false): Promise<void> {
    if (
      !force &&
      this.loaded.id === this.spaceId &&
      this.loaded.rev === store.revision
    )
      return;
    this.loaded = { id: this.spaceId, rev: store.revision };
    try {
      this.detail = await api.get<Detail>(`api/spaces/${this.spaceId}`);
    } catch (e) {
      this.detail = null;
      if (!(e instanceof ApiError && e.status === 404))
        store.say(e instanceof ApiError ? e.message : String(e), "danger");
    }
  }

  private tick(v: boolean | undefined) {
    return html`<td class="tick">
      ${v ? html`<span class="ok">✔</span>` : html`<span class="no">–</span>`}
    </td>`;
  }

  render() {
    const d = this.detail;
    if (!d)
      return html`<div class="empty">
        ${tr("This space no longer exists.")}
      </div>`;
    return html`
      <h3>
        ${d.name}
        <span class="muted"
          >· ${d.space_type}${d.number ? ` ${d.number}` : ""}</span
        >
      </h3>
      ${d.description ? html`<p class="muted">${d.description}</p>` : nothing}
      <sl-tab-group>
        <sl-tab slot="nav" panel="devices"
          >${tr("Devices")} (${d.devices.length})</sl-tab
        >
        <sl-tab slot="nav" panel="functions"
          >Functions (${d.functions.length})</sl-tab
        >
        <sl-tab slot="nav" panel="parts"
          >Building parts (${d.parts.length})</sl-tab
        >
        <sl-tab-panel name="devices">
          <div class="wrap">
            <table>
              <tr>
                <th>${tr("Address")}</th>
                <th>${tr("Room")}</th>
                <th>${tr("Name")}</th>
                <th>${tr("Description")}</th>
                <th>${tr("Application program")}</th>
                <th title=${tr("Individual address loaded")}>Adr</th>
                <th title=${tr("Application program loaded")}>Prg</th>
                <th title=${tr("Parameters loaded")}>Par</th>
                <th title=${tr("Group communication loaded")}>Grp</th>
                <th>${tr("Manufacturer")}</th>
                <th>${tr("Serial number")}</th>
                <th>${tr("Order number")}</th>
                <th>${tr("Product")}</th>
              </tr>
              ${d.devices.map(
                (x) =>
                  html`<tr class="dev" @click=${() => store.select(x.id)}>
                    <td class="addr">${deviceAddress(x.individual_address, x.line)}</td>
                    <td>${x.room ?? ""}</td>
                    <td>${x.name || x.product_name}</td>
                    <td class="muted">${x.description ?? ""}</td>
                    <td>
                      ${x.application_name || html`<span class="muted">${x.resolved ? "-" : "product data missing"}</span>`}
                    </td>
                    ${this.tick(x.individual_address_loaded)}${this.tick(x.application_loaded)}${this.tick(x.parameters_loaded)}${this.tick(x.communication_part_loaded)}
                    <td>${x.manufacturer_name}</td>
                    <td class="addr">${x.serial_number ?? ""}</td>
                    <td class="muted">${x.order_number}</td>
                    <td>${x.product_name}</td>
                  </tr>`,
              )}
            </table>
          </div>
          ${d.devices.length ? nothing : html`<div class="empty">${tr("No devices in this space. Assign devices from the Buildings tab or a device's editor.")}</div>`}
        </sl-tab-panel>
        <sl-tab-panel name="functions">
          ${
            d.functions.length
              ? html`<table>
                  <tr>
                    <th>${tr("Name")}</th>
                    <th>${tr("Type")}</th>
                    <th>${tr("Space")}</th>
                    <th>${tr("Group addresses")}</th>
                  </tr>
                  ${d.functions.map(
                    (f) =>
                      html`<tr>
                        <td>${f.name}</td>
                        <td class="muted">${f.function_type}</td>
                        <td>${f.space}</td>
                        <td class="addr">
                          ${f.group_addresses.map((g) => `${g.text}${g.role ? ` (${g.role})` : ""}`).join(", ")}
                        </td>
                      </tr>`,
                  )}
                </table>`
              : html`<div class="empty">
                  ${tr("No building functions here.")}
                </div>`
          }
        </sl-tab-panel>
        <sl-tab-panel name="parts">
          ${
            d.parts.length
              ? html`<table>
                  <tr>
                    <th>${tr("Name")}</th>
                    <th>${tr("Type")}</th>
                    <th>${tr("Devices")}</th>
                    <th>${tr("Sub-spaces")}</th>
                  </tr>
                  ${d.parts.map(
                    (p) =>
                      html`<tr
                        class="dev"
                        @click=${() => store.selectSpace(p.id)}
                      >
                        <td>${p.name}</td>
                        <td class="muted">${p.space_type}</td>
                        <td>${p.devices}</td>
                        <td>${p.children}</td>
                      </tr>`,
                  )}
                </table>`
              : html`<div class="empty">${tr("No sub-spaces.")}</div>`
          }
        </sl-tab-panel>
      </sl-tab-group>
    `;
  }
}
