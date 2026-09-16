import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api } from "../api.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { t as tr } from "../i18n.js";

type MfrDevice = {
  id: number;
  name: string;
  individual_address: string | null;
  room: string;
  download_required: boolean;
};

type MfrProduct = {
  order_number: string;
  product_name: string;
  application_name: string;
  resolved: boolean;
  devices: MfrDevice[];
};

type Manufacturer = {
  manufacturer: string;
  device_count: number;
  products: MfrProduct[];
};

/** The project's devices grouped by manufacturer and product. */
@customElement("xknx-manufacturers-view")
export class ManufacturersView extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 12px 16px;
      font-size: 13px;
    }
    .toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }
    .toolbar sl-input {
      flex: 1;
      min-width: 160px;
      max-width: 360px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 6px;
      border-bottom: 1px solid var(--ha-divider);
      white-space: nowrap;
      cursor: pointer;
      user-select: none;
    }
    .row:hover {
      background: color-mix(in srgb, var(--ha-text) 5%, transparent);
    }
    .row.selected {
      background: color-mix(in srgb, var(--ha-primary) 16%, transparent);
    }
    .row.mfr {
      font-weight: 500;
    }
    .row.product {
      padding-left: 26px;
    }
    .row.device {
      padding-left: 64px;
    }
    .caret {
      display: inline-flex;
      width: 16px;
      color: var(--ha-text-2);
    }
    .addr {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
      min-width: 60px;
    }
    .muted {
      color: var(--ha-text-2);
    }
    .warn {
      color: var(--ha-warning);
    }
    .count {
      margin-left: auto;
      color: var(--ha-text-2);
    }
    .ellipsis {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .empty {
      color: var(--ha-text-2);
      padding: 24px;
    }
  `;

  @state() private items: Manufacturer[] = [];
  @state() private filter = "";
  /** Expanded node keys: "m:<manufacturer>" and "p:<manufacturer>|<order>|<application>". */
  @state() private open = new Set<string>();
  @state() private loading = false;
  @state() private error = "";
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
      this.items = [];
      this.rev = -1;
      return;
    }
    if (this.rev === store.revision) {
      this.requestUpdate();
      return;
    }
    this.rev = store.revision;
    this.loading = true;
    try {
      this.items = (
        await api.get<{ items: Manufacturer[] }>("api/project/manufacturers")
      ).items;
      this.error = "";
    } catch (e) {
      this.error = String((e as Error)?.message ?? e);
      this.rev = -1;
    } finally {
      this.loading = false;
    }
  }

  private productKey(m: Manufacturer, p: MfrProduct): string {
    return `p:${m.manufacturer}|${p.order_number}|${p.product_name}|${p.application_name}`;
  }

  private toggle(key: string): void {
    const next = new Set(this.open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.open = next;
  }

  private expandAll(): void {
    const next = new Set<string>();
    for (const m of this.items) {
      next.add(`m:${m.manufacturer}`);
      for (const p of m.products) next.add(this.productKey(m, p));
    }
    this.open = next;
  }

  /** The tree cut down to what matches the filter; a matching parent keeps all its children. */
  private filtered(q: string): Manufacturer[] {
    if (!q) return this.items;
    const has = (...parts: (string | null | undefined)[]) =>
      parts.some((s) => (s ?? "").toLowerCase().includes(q));
    const out: Manufacturer[] = [];
    for (const m of this.items) {
      if (has(m.manufacturer)) {
        out.push(m);
        continue;
      }
      const products: MfrProduct[] = [];
      for (const p of m.products) {
        if (has(p.product_name, p.order_number, p.application_name)) {
          products.push(p);
          continue;
        }
        const devices = p.devices.filter((d) =>
          has(d.name, d.individual_address, d.room),
        );
        if (devices.length) products.push({ ...p, devices });
      }
      if (products.length)
        out.push({
          ...m,
          products,
          device_count: products.reduce((n, p) => n + p.devices.length, 0),
        });
    }
    return out;
  }

  render() {
    if (!store.project.open)
      return html`<div class="empty">${tr("Open a project first.")}</div>`;
    const q = this.filter.trim().toLowerCase();
    const tree = this.filtered(q);
    // While filtering, show every match without needing to expand by hand.
    const isOpen = (key: string) => !!q || this.open.has(key);
    const caret = (openNow: boolean) =>
      html`<span class="caret">${icon(openNow ? "down" : "right", 14)}</span>`;
    return html`
      <div class="toolbar">
        <sl-input
          size="small"
          placeholder=${tr("Filter")}
          clearable
          .value=${this.filter}
          @sl-input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
          ><span slot="prefix">${icon("search", 14)}</span></sl-input
        >
        <sl-button size="small" @click=${() => this.expandAll()}
          >${tr("Expand all")}</sl-button
        >
        <sl-button size="small" @click=${() => (this.open = new Set())}
          >${tr("Collapse all")}</sl-button
        >
        <sl-button
          size="small"
          href="api/export/manufacturers.csv"
          download="manufacturers.csv"
          ><span slot="prefix">${icon("download", 14)}</span>CSV</sl-button
        >
        ${this.loading ? html`<sl-spinner></sl-spinner>` : nothing}
      </div>
      ${this.error ? html`<div class="warn">${this.error}</div>` : nothing}
      ${!this.loading && !tree.length
        ? html`<div class="empty">
            ${q ? tr("Nothing matches the filter.") : tr("No devices in this project.")}
          </div>`
        : nothing}
      ${tree.map((m) => {
        const mKey = `m:${m.manufacturer}`;
        const mOpen = isOpen(mKey);
        return html`
          <div class="row mfr" @click=${() => this.toggle(mKey)}>
            ${caret(mOpen)}
            <span>${m.manufacturer || tr("Unknown manufacturer")}</span>
            <span class="count">${m.device_count}</span>
          </div>
          ${mOpen
            ? m.products.map((p) => {
                const pKey = this.productKey(m, p);
                const pOpen = isOpen(pKey);
                return html`
                  <div class="row product" @click=${() => this.toggle(pKey)}>
                    ${caret(pOpen)}
                    ${p.resolved
                      ? nothing
                      : html`<span
                          class="warn"
                          title=${tr("Product data missing")}
                          >⚠</span
                        >`}
                    <span class="ellipsis"
                      >${p.product_name || html`<span class="muted">-</span>`}</span
                    >
                    <span class="muted">${p.order_number}</span>
                    ${p.application_name
                      ? html`<span class="muted ellipsis"
                          >· ${p.application_name}</span
                        >`
                      : nothing}
                    ${p.resolved
                      ? nothing
                      : html`<sl-badge variant="warning" pill
                          >${tr("Product data missing")}</sl-badge
                        >`}
                    <span class="count">${p.devices.length}</span>
                  </div>
                  ${pOpen
                    ? p.devices.map(
                        (d) =>
                          html`<div
                            class="row device ${store.selectedDevice === d.id ? "selected" : ""}"
                            @click=${() => store.select(d.id)}
                          >
                            <span class="addr">${d.individual_address ?? "-.-.-"}</span>
                            <span class="ellipsis">${d.name}</span>
                            ${d.room
                              ? html`<span class="muted ellipsis">${d.room}</span>`
                              : nothing}
                            ${d.download_required
                              ? html`<sl-badge variant="warning" pill
                                  >${tr("Download required")}</sl-badge
                                >`
                              : nothing}
                          </div>`,
                      )
                    : nothing}
                `;
              })
            : nothing}
        `;
      })}
    `;
  }
}
