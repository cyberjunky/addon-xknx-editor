import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api, type DeviceSummary } from "../api.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { t as tr } from "../i18n.js";

/** Site-wide device table (the desktop app's "Device overview" / cockpit). */
@customElement("xknx-overview-view")
export class OverviewView extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 12px 16px;
    }
    .toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 8px;
    }
    .toolbar sl-input {
      flex: 1;
      max-width: 360px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 13px;
    }
    th,
    td {
      text-align: left;
      padding: 6px 8px;
      border-bottom: 1px solid var(--ha-divider);
      white-space: nowrap;
    }
    th {
      color: var(--ha-text-2);
      font-weight: 500;
      font-size: 12px;
      cursor: pointer;
      user-select: none;
    }
    tr:hover td {
      background: color-mix(in srgb, var(--ha-text) 5%, transparent);
      cursor: pointer;
    }
    tr.selected td {
      background: color-mix(in srgb, var(--ha-primary) 16%, transparent);
    }
    .addr {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .muted {
      color: var(--ha-text-2);
    }
    .warn {
      color: var(--ha-warning);
    }
    .empty {
      color: var(--ha-text-2);
      padding: 24px;
    }
  `;

  @state() private devices: DeviceSummary[] = [];
  /** Flat list of the project's spaces, for the Room column. */
  @state() private spaces: { id: number; name: string }[] = [];
  @state() private filter = "";
  @state() private sort: keyof DeviceSummary = "individual_address";
  @state() private onlyAttention = false;
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
      this.devices = [];
      return;
    }
    if (this.rev === store.revision) {
      this.requestUpdate();
      return;
    }
    this.rev = store.revision;
    this.devices = (
      await api.get<{ items: DeviceSummary[] }>("api/project/devices")
    ).items;
    const flatten = (
      nodes: {
        id: number;
        name: string;
        space_type: string;
        children: unknown[];
      }[],
      prefix = "",
    ): { id: number; name: string }[] =>
      nodes.flatMap((s) => {
        const label = `${prefix}${s.name || s.space_type}`;
        return [
          { id: s.id, name: label },
          ...flatten(
            s.children as {
              id: number;
              name: string;
              space_type: string;
              children: unknown[];
            }[],
            `${label} / `,
          ),
        ];
      });
    this.spaces = flatten(
      (
        await api.get<{
          tree: {
            id: number;
            name: string;
            space_type: string;
            children: unknown[];
          }[];
        }>("api/spaces")
      ).tree,
    );
  }

  private issues(d: DeviceSummary): string[] {
    const out: string[] = [];
    if (!d.resolved) out.push("product not in catalog");
    if (d.individual_address === null) out.push("no individual address");
    if (d.download_required) out.push("download required");
    if (d.space_id === null || d.space_id === undefined) out.push("no room");
    return out;
  }

  render() {
    if (!store.project.open)
      return html`<div class="empty">${tr("Open a project first.")}</div>`;
    const q = this.filter.trim().toLowerCase();
    const rows = this.devices
      .filter(
        (d) =>
          !q ||
          `${d.name} ${d.individual_address ?? ""} ${d.product_name} ${d.manufacturer_name} ${d.order_number}`
            .toLowerCase()
            .includes(q),
      )
      .filter((d) => !this.onlyAttention || this.issues(d).length)
      .filter(
        (d) =>
          !store.overviewIssue ||
          (store.overviewIssue === "download"
            ? d.download_required
            : d.space_id === null || d.space_id === undefined),
      )
      .sort((a, b) =>
        String(a[this.sort] ?? "").localeCompare(
          String(b[this.sort] ?? ""),
          undefined,
          { numeric: true },
        ),
      );
    const th = (key: keyof DeviceSummary, label: string) =>
      html`<th @click=${() => (this.sort = key)}>
        ${label}${this.sort === key ? " ▾" : ""}
      </th>`;
    return html`
      <div class="toolbar">
        <sl-input
          size="small"
          placeholder=${tr("Filter")}
          clearable
          @sl-input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
          ><span slot="prefix">${icon("search", 14)}</span></sl-input
        >
        <sl-checkbox
          size="small"
          @sl-change=${(e: Event) => (this.onlyAttention = (e.target as HTMLInputElement).checked)}
          >${tr("Needs attention only")}</sl-checkbox
        >
        <span class="muted">${rows.length} of ${this.devices.length}</span>
      </div>
      <table>
        <tr>
          ${th("individual_address", "Address")}${th("room", "Room")}${th("name", "Name")}${th("application_name", "Application program")}
          <th title=${tr("Individual address loaded")}>Adr</th>
          <th title=${tr("Application program loaded")}>Prg</th>
          <th title=${tr("Parameters loaded")}>Par</th>
          <th title=${tr("Group communication loaded")}>Grp</th>
          ${th("manufacturer_name", "Manufacturer")}${th("serial_number", "Serial number")}${th("order_number", "Order no.")}${th("product_name", "Product")}
          <th>${tr("Status")}</th>
        </tr>
        ${rows.map(
          (d) =>
            html`<tr
              class=${store.selectedDevice === d.id ? "selected" : ""}
              draggable="true"
              title=${tr("Drag onto a room in the Buildings dock to assign it")}
              @dragstart=${(e: DragEvent) => e.dataTransfer?.setData("text/plain", String(d.id))}
              @click=${() => store.select(d.id)}
            >
              <td class="addr">${d.individual_address ?? "-.-.-"}</td>
              <td>
                <sl-select
                  size="small"
                  hoist
                  value=${d.space_id ?? ""}
                  placeholder=${tr("No room")}
                  style="min-width:150px"
                  @sl-change=${(e: Event) => {
                    const v = (e.target as HTMLSelectElement).value;
                    void api
                      .patch(`api/devices/${d.id}`, {
                        space_id: v === "" ? null : Number(v),
                      })
                      .then(() => void store.refresh());
                  }}
                >
                  <sl-option value="">${tr("No room")}</sl-option>
                  ${this.spaces.map((s) => html`<sl-option value=${s.id}>${s.name}</sl-option>`)}
                </sl-select>
              </td>
              <td>${d.name}</td>
              <td>
                ${d.application_name || html`<span class="muted">-</span>`}
              </td>
              ${[d.individual_address_loaded, d.application_loaded, d.parameters_loaded, d.communication_part_loaded].map((v) => html`<td style="text-align:center">${v ? html`<span style="color:var(--ha-success)">✔</span>` : html`<span class="muted">–</span>`}</td>`)}
              <td class="muted">${d.manufacturer_name}</td>
              <td class="addr">${d.serial_number ?? ""}</td>
              <td class="muted">${d.order_number}</td>
              <td>${d.product_name}</td>
              <td class=${this.issues(d).length ? "warn" : "muted"}>
                ${this.issues(d).join(", ") || "ok"}
              </td>
            </tr>`,
        )}
      </table>
    `;
  }
}
