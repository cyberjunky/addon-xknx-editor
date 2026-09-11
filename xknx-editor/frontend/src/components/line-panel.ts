import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { api, type DeviceSummary, type Line, type Topology } from "../api.js";
import { store } from "../store.js";
import { t as tr } from "../i18n.js";

// One power supply feeds one segment, so the draw is reported per segment (a line with a single
// segment, the normal case, reads as one figure). 640 mA is the most common supply rating; the
// product data carries each device's draw but never a supply's rated output, so the reference is
// stated rather than assumed silently.
const SUPPLY_MA = 640;

function busLoad(line: Line): TemplateResult {
  const rows = line.segments
    .filter((s) => s.device_count)
    .map((s) => {
      const label =
        line.segments.length > 1 ? `${tr("Segment")} ${s.number}: ` : "";
      const missing = s.unknown
        ? html` <span
            class="muted"
            title=${tr("No product data in the catalog for these devices, so their draw is not counted.")}
            >(${s.unknown} ${tr("not counted")})</span
          >`
        : nothing;
      const supply = s.power_supplies.length
        ? html` · ${s.power_supplies.join(", ")}`
        : html` ·
            <span class="muted">${tr("no power supply in the project")}</span>`;
      return html`<div>
        ${label}<strong class=${s.current_ma > SUPPLY_MA ? "over" : ""}
          >${Math.round(s.current_ma)}</strong
        >
        / ${SUPPLY_MA} mA · ${s.device_count}
        ${tr("devices")}${missing}${supply}
      </div>`;
    });
  return rows.length ? html`${rows}` : html`<span class="muted">-</span>`;
}

/** Centre-dock table for an area or a line: the devices on it with the usual columns. */
@customElement("xknx-line-panel")
export class LinePanel extends LitElement {
  static styles = css`
    .over {
      color: var(--ha-error, #db4437);
    }
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
    .muted {
      color: var(--ha-text-2);
      font-weight: 400;
    }
    .grid {
      display: grid;
      grid-template-columns: 110px 1fr;
      gap: 6px 12px;
      align-items: center;
      max-width: 520px;
      margin-bottom: 12px;
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
    tr.dev:hover td {
      background: color-mix(in srgb, var(--ha-text) 5%, transparent);
      cursor: pointer;
    }
    .addr {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    td.tick {
      text-align: center;
    }
    .ok {
      color: var(--ha-success);
    }
    .wrap {
      overflow-x: auto;
    }
    .empty {
      color: var(--ha-text-2);
      padding: 16px 0;
    }
  `;

  @property({ type: Number }) area = 0;
  @property({ type: Number }) line: number | null = null;
  @state() private devices: DeviceSummary[] = [];
  @state() private topology: Topology | null = null;
  private unsubscribe = () => {};
  private rev = -1;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = store.subscribe(() => {
      this.requestUpdate();
      void this.sync();
    });
    void this.sync();
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    super.disconnectedCallback();
  }

  private async sync(): Promise<void> {
    if (this.rev === store.revision) return;
    this.rev = store.revision;
    const [d, t] = await Promise.all([
      api.get<{ items: DeviceSummary[] }>("api/project/devices"),
      api.get<Topology>("api/project/topology"),
    ]);
    this.devices = d.items;
    this.topology = t;
  }

  private tick(v: boolean | undefined) {
    return html`<td class="tick">
      ${v ? html`<span class="ok">✔</span>` : html`<span class="muted">–</span>`}
    </td>`;
  }

  render() {
    const areaNode = this.topology?.areas.find((a) => a.address === this.area);
    const lineNode =
      this.line === null
        ? null
        : areaNode?.lines.find((l) => l.address === this.line);
    const prefix =
      this.line === null ? `${this.area}.` : `${this.area}.${this.line}.`;
    const rows = this.devices
      .filter((d) => (d.individual_address ?? "").startsWith(prefix))
      .sort((a, b) =>
        a.individual_address!.localeCompare(b.individual_address!, undefined, {
          numeric: true,
        }),
      );
    const title =
      this.line === null
        ? `Area ${this.area}`
        : `Line ${this.area}.${this.line}`;
    const name = this.line === null ? areaNode?.name : lineNode?.name;
    const id = this.line === null ? areaNode?.id : lineNode?.id;
    const patch = this.line === null ? "areas" : "lines";
    return html`
      <h3>${title} <span class="muted">${name ?? ""}</span></h3>
      ${
        id !== undefined
          ? html`<div class="grid">
              <label class="muted">${tr("Name")}</label>
              <sl-input
                size="small"
                value=${name ?? ""}
                @sl-change=${(e: Event) => api.patch(`api/project/${patch}/${id}`, { name: (e.target as HTMLInputElement).value })}
              ></sl-input>
              ${lineNode ? html`<label class="muted">${tr("Medium")}</label><span>${lineNode.segments.map((s) => s.medium_type).join(", ") || "-"}</span>` : nothing}
              ${lineNode ? html`<label class="muted">${tr("Bus load")}</label><span>${busLoad(lineNode)}</span>` : nothing}
            </div>`
          : nothing
      }
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
          ${rows.map(
            (x) =>
              html`<tr class="dev" @click=${() => store.select(x.id)}>
                <td class="addr">${x.individual_address}</td>
                <td>${x.room ?? ""}</td>
                <td>${x.name}</td>
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
      ${rows.length ? nothing : html`<div class="empty">${tr(this.line === null ? "No devices on this area yet." : "No devices on this line yet.")}</div>`}
    `;
  }
}
