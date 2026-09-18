import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api } from "../api.js";
import { icon } from "../icons.js";
import { deviceAddress, store } from "../store.js";
import { t as tr } from "../i18n.js";
import { dptTitle, formatDpt, onDptNames } from "../dpt-format.js";

type FlagKey =
  | "communication"
  | "read"
  | "write"
  | "transmit"
  | "update"
  | "read_on_init";

type ObjectLink = {
  id: number;
  group_address_id: number;
  text: string;
  name: string;
  is_sending: boolean;
};

type GroupObject = {
  ref_id: string;
  db_id: number;
  number: number;
  name: string;
  function_text: string;
  dpt_codes: string[];
  object_size: string;
  priority: string;
  flags: Record<FlagKey, boolean>;
  locked: Partial<Record<FlagKey, boolean>>;
  device_id: number;
  device_name: string;
  individual_address: string | null;
  line?: string | null;
  room: string;
  links: ObjectLink[];
};

type SortKey =
  | "device"
  | "number"
  | "name"
  | "function_text"
  | "links"
  | "dpt"
  | "object_size"
  | "priority";

type LinkFilter = "all" | "linked" | "unlinked";

const PAGE = 500;

/** Compare "1.1.10" style addresses numerically; missing addresses last. */
function compareText(a: string, b: string): number {
  if (!a && b) return 1;
  if (a && !b) return -1;
  return a.localeCompare(b, undefined, { numeric: true });
}

/** Every group object in the project, with its device and links. */
@customElement("xknx-objects-view")
export class ObjectsView extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 12px 16px;
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
    .toolbar sl-select {
      width: 140px;
    }
    .note {
      color: var(--ha-warning);
      font-size: 13px;
      margin-bottom: 8px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 13px;
    }
    th,
    td {
      text-align: left;
      padding: 5px 8px;
      border-bottom: 1px solid var(--ha-divider);
      white-space: nowrap;
      vertical-align: top;
    }
    th {
      color: var(--ha-text-2);
      font-weight: 500;
      font-size: 12px;
      user-select: none;
      position: sticky;
      top: 0;
      background: var(--ha-card, var(--ha-bg));
    }
    th.sortable {
      cursor: pointer;
    }
    th.c,
    td.c {
      text-align: center;
      padding: 5px 2px;
    }
    tr:hover td {
      background: color-mix(in srgb, var(--ha-text) 5%, transparent);
    }
    tr.selected td {
      background: color-mix(in srgb, var(--ha-primary) 10%, transparent);
    }
    .addr {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .device {
      cursor: pointer;
      color: var(--ha-primary);
    }
    .num {
      text-align: right;
    }
    .muted {
      color: var(--ha-text-2);
    }
    .gas {
      display: flex;
      flex-wrap: wrap;
      gap: 3px;
      white-space: normal;
      max-width: 320px;
    }
    .ga {
      display: inline-flex;
      align-items: center;
      padding: 1px 6px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--ha-text) 8%, transparent);
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
      cursor: pointer;
      color: var(--ha-primary);
    }
    .ga.sending {
      background: color-mix(in srgb, var(--ha-success) 22%, transparent);
      font-weight: 600;
    }
    .flag.on {
      color: var(--ha-primary);
      font-weight: 600;
    }
    .flag.off {
      color: var(--ha-text-2);
    }
    .more {
      display: flex;
      justify-content: center;
      padding: 12px;
    }
    .empty {
      color: var(--ha-text-2);
      padding: 24px;
    }
    .warn {
      color: var(--ha-warning);
    }
  `;

  @state() private items: GroupObject[] = [];
  @state() private withoutProductData = 0;
  @state() private filter = "";
  @state() private linkFilter: LinkFilter = "all";
  @state() private sort: SortKey = "device";
  @state() private descending = false;
  @state() private limit = PAGE;
  @state() private loading = false;
  @state() private error = "";
  private unsubscribe = () => {};
  private unsubscribeDpt = () => {};
  private rev = -1;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = store.subscribe(() => void this.sync());
    this.unsubscribeDpt = onDptNames(() => this.requestUpdate());
    void this.sync();
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    this.unsubscribeDpt();
    super.disconnectedCallback();
  }

  private async sync(): Promise<void> {
    if (!store.project.open) {
      this.items = [];
      this.withoutProductData = 0;
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
      const r = await api.get<{
        items: GroupObject[];
        count: number;
        devices_without_product_data: number;
      }>("api/project/objects");
      this.items = r.items;
      this.withoutProductData = r.devices_without_product_data ?? 0;
      this.error = "";
    } catch (e) {
      this.error = String((e as Error)?.message ?? e);
      this.rev = -1;
    } finally {
      this.loading = false;
    }
  }

  private sortValue(o: GroupObject, key: SortKey): string | number {
    switch (key) {
      case "device":
        return o.individual_address ?? "";
      case "number":
        return o.number;
      case "links":
        return o.links[0]?.text ?? "";
      case "dpt":
        return o.dpt_codes.map((d) => formatDpt(d)).join(" ");
      default:
        return String(o[key] ?? "");
    }
  }

  private rows(): GroupObject[] {
    const q = this.filter.trim().toLowerCase();
    const key = this.sort;
    const dir = this.descending ? -1 : 1;
    return this.items
      .filter((o) =>
        this.linkFilter === "linked"
          ? o.links.length > 0
          : this.linkFilter === "unlinked"
            ? o.links.length === 0
            : true,
      )
      .filter(
        (o) =>
          !q ||
          [
            o.device_name,
            o.individual_address ?? "",
            o.room,
            o.name,
            o.function_text,
            ...o.links.map((l) => `${l.text} ${l.name}`),
          ]
            .join(" ")
            .toLowerCase()
            .includes(q),
      )
      .sort((a, b) => {
        const va = this.sortValue(a, key);
        const vb = this.sortValue(b, key);
        let c =
          typeof va === "number" && typeof vb === "number"
            ? va - vb
            : compareText(String(va), String(vb));
        // Stable secondary order: device, then object number.
        if (c === 0)
          c =
            compareText(a.individual_address ?? "", b.individual_address ?? "") ||
            a.device_id - b.device_id ||
            a.number - b.number;
        return c * dir;
      });
  }

  private setSort(key: SortKey): void {
    if (this.sort === key) this.descending = !this.descending;
    else {
      this.sort = key;
      this.descending = false;
    }
  }

  render() {
    if (!store.project.open)
      return html`<div class="empty">${tr("Open a project first.")}</div>`;
    const rows = this.rows();
    const shown = rows.slice(0, this.limit);
    const th = (key: SortKey, label: string) =>
      html`<th class="sortable" @click=${() => this.setSort(key)}>
        ${label}${this.sort === key ? (this.descending ? " ▴" : " ▾") : ""}
      </th>`;
    const flag = (o: GroupObject, key: FlagKey, letter: string, title: string) =>
      html`<td
        class="c flag ${o.flags[key] ? "on" : "off"}"
        title=${title}
      >
        ${o.flags[key] ? letter : "–"}
      </td>`;
    return html`
      <div class="toolbar">
        <sl-input
          size="small"
          placeholder=${tr("Filter")}
          clearable
          .value=${this.filter}
          @sl-input=${(e: Event) => {
            this.filter = (e.target as HTMLInputElement).value;
            this.limit = PAGE;
          }}
          ><span slot="prefix">${icon("search", 14)}</span></sl-input
        >
        <sl-select
          size="small"
          hoist
          .value=${this.linkFilter}
          @sl-change=${(e: Event) => {
            this.linkFilter = (e.target as HTMLSelectElement).value as LinkFilter;
            this.limit = PAGE;
          }}
        >
          <sl-option value="all">${tr("All objects")}</sl-option>
          <sl-option value="linked">${tr("Linked only")}</sl-option>
          <sl-option value="unlinked">${tr("Unlinked only")}</sl-option>
        </sl-select>
        <span class="muted"
          >${tr("{n} of {m}")
            .replace("{n}", String(rows.length))
            .replace("{m}", String(this.items.length))}</span
        >
        ${this.loading ? html`<sl-spinner></sl-spinner>` : nothing}
        <span style="flex:1"></span>
        <sl-button
          size="small"
          href="api/export/group-objects.csv"
          download="group-objects.csv"
          ><span slot="prefix">${icon("download", 14)}</span>CSV</sl-button
        >
      </div>
      ${this.withoutProductData > 0
        ? html`<div class="note">
            ${tr(
              "{n} device(s) are left out: their product data is not in the catalog.",
            ).replace("{n}", String(this.withoutProductData))}
          </div>`
        : nothing}
      ${this.error ? html`<div class="warn">${this.error}</div>` : nothing}
      <table>
        <tr>
          ${th("device", tr("Device"))}${th("number", "#")}${th("name", tr("Name"))}${th("function_text", tr("Function"))}${th("links", tr("Group addresses"))}${th("dpt", tr("Data type"))}${th("object_size", tr("Size"))}
          <th class="c" title=${tr("Communication")}>C</th>
          <th class="c" title=${tr("Read")}>R</th>
          <th class="c" title=${tr("Write")}>W</th>
          <th class="c" title=${tr("Transmit")}>T</th>
          <th class="c" title=${tr("Update")}>U</th>
          ${th("priority", tr("Priority"))}
        </tr>
        ${shown.map(
          (o) =>
            html`<tr class=${store.selectedDevice === o.device_id ? "selected" : ""}>
              <td>
                <span
                  class="device"
                  title=${o.room || ""}
                  @click=${() => store.select(o.device_id)}
                  ><span class="addr">${deviceAddress(o.individual_address, o.line)}</span>
                  ${o.device_name}</span
                >
              </td>
              <td class="num">${o.number}</td>
              <td>${o.name}</td>
              <td class="muted">
                ${o.function_text && o.function_text !== o.name ? o.function_text : ""}
              </td>
              <td>
                <div class="gas">
                  ${o.links.map(
                    (l) =>
                      html`<span
                        class="ga ${l.is_sending ? "sending" : ""}"
                        title=${`${l.name}${l.is_sending ? ` (${tr("sending address")})` : ""}`}
                        @click=${() => store.selectGroupAddress(l.group_address_id)}
                        >${l.text}</span
                      >`,
                  )}
                </div>
              </td>
              <td>
                ${o.dpt_codes.map(
                  (d, i) =>
                    html`${i ? ", " : ""}<span title=${dptTitle(d)}
                        >${formatDpt(d)}</span
                      >`,
                )}
              </td>
              <td class="muted">${o.object_size}</td>
              ${flag(o, "communication", "C", tr("Communication"))}
              ${flag(o, "read", "R", tr("Read"))}
              ${flag(o, "write", "W", tr("Write"))}
              ${flag(o, "transmit", "T", tr("Transmit"))}
              ${flag(o, "update", "U", tr("Update"))}
              <td class="muted">${o.priority}</td>
            </tr>`,
        )}
      </table>
      ${!this.loading && rows.length === 0
        ? html`<div class="empty">
            ${this.items.length
              ? tr("Nothing matches the filter.")
              : tr("No group objects in this project.")}
          </div>`
        : nothing}
      ${rows.length > shown.length
        ? html`<div class="more">
            <sl-button size="small" @click=${() => (this.limit += PAGE)}
              >${tr("Show more")}
              (${rows.length - shown.length})</sl-button
            >
          </div>`
        : nothing}
    `;
  }
}
