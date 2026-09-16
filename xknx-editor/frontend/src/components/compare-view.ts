import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api, ApiError, type DeviceSummary } from "../api.js";
import { t as tr } from "../i18n.js";
import { icon } from "../icons.js";
import { store } from "../store.js";

type Row = {
  values: (string | null)[];
  differs: boolean;
};
type Comparison = {
  devices: {
    id: number;
    name: string;
    individual_address: string | null;
    application: string;
    application_id: string;
  }[];
  same_application: boolean;
  parameters: (Row & { ref_id: string; path: string; label: string })[];
  objects: (Row & { number: string; name: string })[];
  differences: { parameters: number; objects: number };
};

/** Two or more devices side by side: every parameter and every group object (flags and addresses),
 * differences highlighted. */
@customElement("xknx-compare-view")
export class CompareView extends LitElement {
  static styles = css`
    sl-button::part(label) {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
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
      margin-bottom: 10px;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 4px 2px 8px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--ha-text) 8%, transparent);
    }
    .chip button {
      border: 0;
      background: transparent;
      cursor: pointer;
      color: inherit;
      display: inline-flex;
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
      vertical-align: top;
    }
    th {
      color: var(--ha-text-2);
      font-weight: 500;
      font-size: 12px;
      position: sticky;
      top: 0;
      background: var(--ha-card);
    }
    tr.differs td.value {
      background: color-mix(in srgb, var(--ha-warning) 14%, transparent);
    }
    td.missing {
      color: var(--ha-text-2);
      font-style: italic;
    }
    .path {
      color: var(--ha-text-2);
      font-size: 12px;
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
    h4 {
      margin: 16px 0 6px;
      font-weight: 500;
    }
    .empty {
      color: var(--ha-text-2);
      padding: 24px 0;
    }
  `;

  @state() private devices: DeviceSummary[] = [];
  @state() private result: Comparison | null = null;
  @state() private onlyDifferences = true;
  @state() private filter = "";
  @state() private loading = false;
  private unsubscribe = () => {};
  private loaded = { ids: "", rev: -1 };

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
    if (!store.project.open) return;
    const ids = store.compareIds.join(",");
    if (this.loaded.ids === ids && this.loaded.rev === store.revision) return;
    const revChanged = this.loaded.rev !== store.revision;
    this.loaded = { ids, rev: store.revision };
    if (revChanged || !this.devices.length)
      this.devices = (
        await api.get<{ items: DeviceSummary[] }>("api/project/devices")
      ).items;
    if (store.compareIds.length < 2) {
      this.result = null;
      return;
    }
    this.loading = true;
    try {
      this.result = await api.get<Comparison>(
        `api/devices/compare?ids=${ids}`,
      );
    } catch (e) {
      this.result = null;
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    } finally {
      this.loading = false;
    }
  }

  private setIds(ids: number[]): void {
    store.compareIds = ids;
    void this.sync();
    this.requestUpdate();
  }

  /** Devices with the same application as the first one picked, for the quick-add. */
  private siblings(): DeviceSummary[] {
    const first = this.devices.find((d) => d.id === store.compareIds[0]);
    if (!first?.application_id) return [];
    return this.devices.filter(
      (d) =>
        d.application_id === first.application_id &&
        !store.compareIds.includes(d.id),
    );
  }

  render() {
    if (!store.project.open)
      return html`<div class="empty">${tr("Open a project first.")}</div>`;
    const ids = store.compareIds;
    const byId = new Map(this.devices.map((d) => [d.id, d]));
    const siblings = this.siblings();
    return html`
      <div class="toolbar">
        ${ids.map((id) => {
          const d = byId.get(id);
          return html`<span class="chip"
            ><span class="addr">${d?.individual_address ?? "-.-.-"}</span>
            ${d?.name || d?.product_name || id}
            <button
              title=${tr("Remove")}
              @click=${() => this.setIds(ids.filter((x) => x !== id))}
            >
              ${icon("close", 12)}
            </button></span
          >`;
        })}
        <sl-select
          size="small"
          hoist
          placeholder=${tr("Add a device…")}
          style="min-width:260px"
          value=""
          @sl-change=${(e: Event) => {
            const el = e.target as HTMLSelectElement;
            const v = Number(el.value);
            el.value = "";
            if (v && !ids.includes(v)) this.setIds([...ids, v]);
          }}
        >
          ${this.devices
            .filter((d) => d.resolved && !ids.includes(d.id))
            .map((d) => html`<sl-option value=${String(d.id)}>${d.individual_address ?? "-.-.-"} ${d.name || d.product_name}</sl-option>`)}
        </sl-select>
        ${siblings.length ? html`<sl-button size="small" @click=${() => this.setIds([...ids, ...siblings.slice(0, 8 - ids.length).map((d) => d.id)])}>${tr("Add all with the same application")} (${siblings.length})</sl-button>` : nothing}
        <sl-checkbox
          size="small"
          ?checked=${this.onlyDifferences}
          @sl-change=${(e: Event) => (this.onlyDifferences = (e.target as HTMLInputElement).checked)}
          >${tr("Differences only")}</sl-checkbox
        >
        <sl-input
          size="small"
          clearable
          placeholder=${tr("Filter parameters…")}
          style="width:220px"
          @sl-input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
          ><span slot="prefix">${icon("search", 14)}</span></sl-input
        >
        ${this.loading ? html`<sl-spinner></sl-spinner>` : nothing}
      </div>
      ${ids.length < 2 ? html`<div class="empty">${tr("Pick two or more devices to compare their parameters and group objects. From a device, use Compare; from the Device overview, select devices and press Compare.")}</div>` : this.result ? this.renderResult(this.result) : nothing}
    `;
  }

  private renderResult(r: Comparison) {
    const q = this.filter.trim().toLowerCase();
    const params = r.parameters.filter(
      (p) =>
        (!this.onlyDifferences || p.differs) &&
        (!q ||
          `${p.path} ${p.label} ${p.values.join(" ")}`.toLowerCase().includes(q)),
    );
    const objects = r.objects.filter((o) => !this.onlyDifferences || o.differs);
    const head = html`${r.devices.map((d) => html`<th><span class="addr">${d.individual_address ?? "-.-.-"}</span> ${d.name}${r.same_application ? nothing : html`<div class="muted">${d.application}</div>`}</th>`)}`;
    const cell = (v: string | null) =>
      v === null
        ? html`<td class="value missing">${tr("not shown")}</td>`
        : html`<td class="value">${v}</td>`;
    return html`
      ${r.same_application ? html`<p class="muted">${r.devices[0].application} · ${r.differences.parameters} ${tr("parameter(s) differ")}, ${r.differences.objects} ${tr("group object(s) differ")}</p>` : html`<p class="warn">${tr("These devices run different applications: parameters are lined up by page and name, which is only a rough match.")}</p>`}
      <h4>${tr("Parameters")} (${params.length})</h4>
      ${
        params.length
          ? html`<table>
              <tr>
                <th>${tr("Parameter")}</th>
                ${head}
              </tr>
              ${params.map(
                (p) =>
                  html`<tr class=${p.differs ? "differs" : ""}>
                    <td>
                      ${p.label}
                      ${p.path ? html`<div class="path">${p.path}</div>` : nothing}
                    </td>
                    ${p.values.map(cell)}
                  </tr>`,
              )}
            </table>`
          : html`<div class="muted">${this.onlyDifferences ? tr("No parameter differs.") : tr("No parameters.")}</div>`
      }
      <h4>${tr("Group objects")} (${objects.length})</h4>
      ${
        objects.length
          ? html`<table>
              <tr>
                <th>${tr("Object")}</th>
                ${head}
              </tr>
              ${objects.map(
                (o) =>
                  html`<tr class=${o.differs ? "differs" : ""}>
                    <td>${o.number} ${o.name}</td>
                    ${o.values.map((v) => (v === null ? cell(v) : html`<td class="value addr">${v}</td>`))}
                  </tr>`,
              )}
            </table>
            <p class="muted">
              ${tr("Flags C R W T U I, then the group addresses; * marks the sending one.")}
            </p>`
          : html`<div class="muted">${tr("No group object differs.")}</div>`
      }
    `;
  }
}
