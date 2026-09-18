import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api, type DeviceSummary } from "../api.js";
import { icon } from "../icons.js";
import { deviceAddress, store } from "../store.js";
import { dropProduct, isProductDrag } from "../product-drop.js";
import { t as tr } from "../i18n.js";

/** Left-dock flat device list (the "Devices" panel): every device, filterable, sortable by address. */
@customElement("xknx-devices-list")
export class DevicesList extends LitElement {
  static styles = css`
    sl-button::part(label) {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    :host(.drop) {
      outline: 2px solid var(--ha-primary);
      outline-offset: -2px;
    }
    :host {
      display: block;
      padding: 8px;
    }
    .toolbar {
      display: flex;
      gap: 6px;
      margin-bottom: 8px;
    }
    .toolbar sl-input {
      flex: 1;
    }
    .row {
      display: grid;
      grid-template-columns: 4.5em 1fr;
      gap: 6px;
      padding: 4px 6px;
      border-radius: 6px;
      cursor: pointer;
      align-items: center;
    }
    .row:hover {
      background: color-mix(in srgb, var(--ha-text) 7%, transparent);
    }
    .row.selected {
      background: color-mix(in srgb, var(--ha-primary) 18%, transparent);
    }
    .addr {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
      color: var(--ha-text-2);
    }
    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .name small {
      color: var(--ha-text-2);
      margin-left: 6px;
    }
    .unresolved .name {
      color: var(--ha-warning);
    }
    .empty {
      padding: 16px 8px;
      color: var(--ha-text-2);
    }
  `;

  @state() private devices: DeviceSummary[] = [];
  @state() private filter = "";
  private unsubscribe = () => {};
  private rev = -1;

  connectedCallback(): void {
    super.connectedCallback();
    // A catalog product dropped anywhere on this pane is added to the project.
    this.addEventListener("dragover", (e: DragEvent) => {
      if (!isProductDrag(e)) return;
      e.preventDefault();
      this.classList.add("drop");
    });
    this.addEventListener("dragleave", () => this.classList.remove("drop"));
    this.addEventListener("drop", (e: DragEvent) => {
      this.classList.remove("drop");
      if (isProductDrag(e)) {
        e.preventDefault();
        void dropProduct(e);
      }
    });
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
    if (!store.project.open) {
      this.devices = [];
      return;
    }
    if (this.rev === store.revision) return;
    this.rev = store.revision;
    this.devices = (
      await api.get<{ items: DeviceSummary[] }>("api/project/devices")
    ).items.sort((a, b) =>
      (a.individual_address ?? "9.9.999").localeCompare(
        b.individual_address ?? "9.9.999",
        undefined,
        { numeric: true },
      ),
    );
  }

  render() {
    if (!store.project.open)
      return html`<div class="empty">${tr("Open a project first.")}</div>`;
    const q = this.filter.trim().toLowerCase();
    const rows = this.devices.filter(
      (d) =>
        !q ||
        `${d.name} ${d.individual_address ?? ""} ${d.product_name} ${d.manufacturer_name} ${d.order_number} ${d.room ?? ""}`
          .toLowerCase()
          .includes(q),
    );
    return html`
      <div class="toolbar">
        <sl-input
          size="small"
          placeholder=${tr("Filter devices")}
          clearable
          @sl-input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
          ><span slot="prefix">${icon("search", 14)}</span></sl-input
        >
        <sl-tooltip content=${tr("Add a device from the catalog")}
          ><sl-button size="small" @click=${() => store.setBottom("catalog")}
            >${icon("plus", 14)}</sl-button
          ></sl-tooltip
        >
      </div>
      ${rows.map(
        (d) =>
          html`<div
            class="row ${d.resolved || d.no_application ? "" : "unresolved"} ${store.selectedDevice === d.id ? "selected" : ""}"
            @click=${() => store.select(d.id)}
            title=${d.product_name}
          >
            <span class="addr">${deviceAddress(d.individual_address, d.line)}</span
            ><span class="name"
              >${d.name || d.product_name}${d.room ? html`<small>${d.room}</small>` : nothing}</span
            >
          </div>`,
      )}
      ${rows.length ? nothing : html`<div class="empty">No devices${q ? " match" : " yet"}.</div>`}
    `;
  }
}
