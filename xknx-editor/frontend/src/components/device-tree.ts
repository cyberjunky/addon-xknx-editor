import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  api,
  ApiError,
  type DeviceSummary,
  type Job,
  type Topology,
} from "../api.js";
import { icon } from "../icons.js";
import { deviceAddress, pictureKey, store } from "../store.js";
import { dropProduct, isProductDrag } from "../product-drop.js";
import { t as tr } from "../i18n.js";

@customElement("xknx-device-tree")
export class DeviceTree extends LitElement {
  static styles = css`
    img.thumb {
      width: 18px;
      height: 18px;
      object-fit: contain;
      border-radius: 3px;
      background: #fff;
      flex: none;
    }
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
      align-items: center;
      margin-bottom: 8px;
    }
    .toolbar sl-input {
      flex: 1;
    }
    .node {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 6px;
      border-radius: 6px;
      cursor: pointer;
      white-space: nowrap;
    }
    .node:hover {
      background: color-mix(in srgb, var(--ha-text) 6%, transparent);
    }
    .node.selected {
      background: color-mix(in srgb, var(--ha-primary) 18%, transparent);
    }
    .node .addr {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
      color: var(--ha-text-2);
      min-width: 3.5em;
    }
    .node .name {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .node .muted {
      color: var(--ha-text-2);
      font-size: 12px;
    }
    .children {
      margin-left: 18px;
    }
    .device.unresolved .name {
      color: var(--ha-warning);
    }
    .empty {
      padding: 16px 8px;
      color: var(--ha-text-2);
    }
  `;

  @state() private topology: Topology | null = null;
  @state() private filter = "";
  @state() private collapsed = new Set<string>();
  @state() private fetching = false;
  @state() private diagram = false;
  /** Device pictures by order number, for the thumbnails. */
  @state() private pictures: Record<string, string> = {};
  private picturesRev = -1;
  private unsubscribe = () => {};
  private loadedRevision = -1;

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
      this.loadPictures();
      this.sync();
    });
    this.loadPictures();
    void this.sync();
  }

  private loadPictures(): void {
    if (this.picturesRev === store.docsRevision) return;
    this.picturesRev = store.docsRevision;
    void store.pictures().then((m) => (this.pictures = m));
  }

  /** The device rows of a line or one of its segments. */
  private deviceRows(devices: DeviceSummary[]) {
    return devices.map(
      (d) => html`<div
        class="node device ${d.resolved || d.no_application ? "" : "unresolved"} ${store.selectedDevice === d.id ? "selected" : ""}"
        @click=${() => store.select(d.id)}
      >
        ${this.thumb(d.order_number)}<span class="addr"
          >${deviceAddress(d.individual_address, d.line)}</span
        ><span class="name" title=${d.product_name}
          >${d.name || d.product_name}</span
        >
      </div>`,
    );
  }

  /** A device's picture as a thumbnail, or the chip icon. */
  private thumb(orderNumber: string) {
    const id = this.pictures[pictureKey(orderNumber)];
    return id
      ? html`<img class="thumb" src="api/docs/${id}/raw" alt="" loading="lazy" />`
      : icon("cpu", 14);
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    super.disconnectedCallback();
  }

  private async sync(): Promise<void> {
    if (!store.project.open) {
      this.topology = null;
      return;
    }
    if (this.loadedRevision === store.revision && this.topology) {
      this.requestUpdate();
      return;
    }
    this.loadedRevision = store.revision;
    try {
      this.topology = await api.get<Topology>("api/project/topology");
    } catch {
      this.topology = null;
    }
  }

  private async fetchMissing(): Promise<void> {
    this.fetching = true;
    try {
      const job = await api.waitJob(
        await api.post<Job>("api/catalog/online/fetch-missing", {}),
      );
      const r = job.result as {
        item_ids: string[];
        applications_added: string[];
        still_missing: string[];
      };
      const msg =
        `Downloaded ${r.item_ids.length} product(s), ${r.applications_added.length} application(s) added` +
        (r.still_missing.length
          ? `, ${r.still_missing.length} still missing`
          : "");
      store.say(msg, r.still_missing.length ? "primary" : "success");
      this.loadedRevision = -1;
      await store.refresh();
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    } finally {
      this.fetching = false;
    }
  }

  private toggle(key: string): void {
    const next = new Set(this.collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.collapsed = next;
  }

  private matchesFilter(d: DeviceSummary): boolean {
    const q = this.filter.trim().toLowerCase();
    if (!q) return true;
    return [
      d.name,
      d.individual_address ?? "",
      d.product_name,
      d.manufacturer_name,
      d.order_number,
    ]
      .join(" ")
      .toLowerCase()
      .includes(q);
  }

  render() {
    if (!store.project.open)
      return html`<div class="empty">
        ${tr("Open, create or import a project (File menu).")}
      </div>`;
    const t = this.topology;
    return html`
      <div class="toolbar">
        <sl-input
          size="small"
          placeholder=${tr("Filter devices (name, address, product)")}
          clearable
          @sl-input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
        >
          <span slot="prefix">${icon("search", 14)}</span>
        </sl-input>
        <sl-tooltip content=${tr("Add a device from the catalog")}
          ><sl-button size="small" @click=${() => store.setBottom("catalog")}
            >${icon("plus", 14)}</sl-button
          ></sl-tooltip
        >
        <sl-tooltip content=${this.diagram ? "Show as tree" : "Show as diagram"}
          ><sl-button
            size="small"
            @click=${() => (this.diagram = !this.diagram)}
            >${icon(this.diagram ? "cpu" : "network", 14)}</sl-button
          ></sl-tooltip
        >
      </div>
      ${this.diagram ? html`<xknx-topology-view compact></xknx-topology-view>` : nothing}
      ${
        this.diagram
          ? nothing
          : t
            ? t.areas.map((a) => {
                const ak = `a${a.id}`;
                return html`
                  <div
                    class="node ${store.focus === "line" && store.selectedLine?.area === a.address && store.selectedLine.line === null ? "selected" : ""}"
                    @click=${() => store.selectLine(a.address, null)}
                  >
                    <span
                      @click=${(e: Event) => {
                        e.stopPropagation();
                        this.toggle(ak);
                      }}
                      >${icon(this.collapsed.has(ak) ? "right" : "down", 14)}</span
                    ><span class="addr">${a.address}</span
                    ><span class="name">${a.name || "Area"}</span>
                  </div>
                  ${
                    this.collapsed.has(ak)
                      ? nothing
                      : html`<div class="children">
                          ${a.lines.map((l) => {
                            const lk = `l${l.id}`;
                            const devices = l.segments
                              .flatMap((s) => s.devices)
                              .filter((d) => this.matchesFilter(d));
                            return html`
                              <div
                                class="node ${store.focus === "line" && store.selectedLine?.area === a.address && store.selectedLine.line === l.address ? "selected" : ""}"
                                @click=${() => store.selectLine(a.address, l.address)}
                              >
                                <span
                                  @click=${(e: Event) => {
                                    e.stopPropagation();
                                    this.toggle(lk);
                                  }}
                                  >${icon(this.collapsed.has(lk) ? "right" : "down", 14)}</span
                                ><span class="addr"
                                  >${a.address}.${l.address}</span
                                ><span class="name">${l.name || "Line"}</span
                                ><span class="muted">${devices.length}</span>
                              </div>
                              ${
                                this.collapsed.has(lk)
                                  ? nothing
                                  : html`<div class="children">
                                      ${
                                        l.segments.length > 1
                                          ? l.segments.map((sg) => {
                                              // A line repeater splits a line into segments; ETS
                                              // shows them as their own level, so show them too.
                                              const rows = sg.devices.filter((d) => this.matchesFilter(d));
                                              const sk = `s${sg.id}`;
                                              return html`<div
                                                  class="node"
                                                  @click=${() => this.toggle(sk)}
                                                >
                                                  ${icon(this.collapsed.has(sk) ? "right" : "down", 14)}<span
                                                    class="addr"
                                                    >${a.address}.${l.address}</span
                                                  ><span class="name"
                                                    >${sg.name || `${tr("Segment")} ${sg.number}`}</span
                                                  ><span class="muted">${rows.length}</span>
                                                </div>
                                                ${this.collapsed.has(sk) ? nothing : html`<div class="children">${this.deviceRows(rows)}</div>`}`;
                                            })
                                          : this.deviceRows(devices)
                                      }
                                    </div>`
                              }
                            `;
                          })}
                        </div>`
                  }
                `;
              })
            : html`<sl-spinner></sl-spinner>`
      }
      ${
        t?.unresolved.length
          ? html`<div class="empty">
              ${t.unresolved.length} product(s) missing from the catalog.
              Devices shown in orange cannot be configured yet.<br />
              <sl-button
                size="small"
                variant="primary"
                ?loading=${this.fetching}
                style="margin-top:8px"
                @click=${this.fetchMissing}
                >${icon("download", 14)} Fetch from KNX online
                catalog</sl-button
              >
            </div>`
          : nothing
      }
    `;
  }
}
