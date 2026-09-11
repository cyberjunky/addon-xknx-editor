import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ApiError, api, type DeviceSummary } from "../api.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { t as tr } from "../i18n.js";

type Tab = "copy" | "replace" | "shift" | "labels" | "topology";
type CoInfo = {
  ref_id: string;
  number: number;
  name: string;
  function_text: string;
  object_size: string;
  dpt_codes: string[];
};
type ReplacePreview = {
  pairs: { old: CoInfo; new: CoInfo | null; links: number }[];
  mapped: number;
  lost: number;
};
type ShiftResult = {
  applied: number;
  preview: { device_id: number; from: string | null; to: string }[];
  errors: string[];
};
type Finding = {
  device_id: number;
  severity: "error" | "warning";
  message: string;
};

/** Shift the device octet of "a.l.d" by offset (mirrors the backend rule); null when invalid. */
function shiftedIa(ia: string | null, offset: number): string | null {
  if (!ia) return null;
  const parts = ia.split(".").map(Number);
  if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) return null;
  const dev = parts[2] + offset;
  return dev >= 1 && dev <= 255 ? `${parts[0]}.${parts[1]}.${dev}` : null;
}

/** Centre-dock "Tools" view: the desktop app's Extended copy / Replace device / Shift addresses / Labels / Topology check. */
@customElement("xknx-tools-view")
export class ToolsView extends LitElement {
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
      max-width: 70ch;
    }
    .form {
      display: grid;
      grid-template-columns: 160px minmax(200px, 520px);
      gap: 8px 12px;
      align-items: center;
      margin-bottom: 12px;
    }
    .form label {
      color: var(--ha-text-2);
    }
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      margin: 8px 0;
    }
    .list {
      border: 1px solid var(--ha-divider);
      border-radius: 8px;
      max-height: 320px;
      overflow: auto;
      margin: 8px 0;
    }
    .item {
      display: grid;
      grid-template-columns: 24px 5em 1fr auto;
      gap: 8px;
      padding: 4px 8px;
      align-items: center;
      border-bottom: 1px solid var(--ha-divider);
      cursor: pointer;
    }
    .item:hover {
      background: color-mix(in srgb, var(--ha-text) 5%, transparent);
    }
    .item.selected {
      background: color-mix(in srgb, var(--ha-primary) 16%, transparent);
    }
    .addr {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .muted {
      color: var(--ha-text-2);
    }
    .bad {
      color: var(--ha-error);
    }
    .warn {
      color: var(--ha-warning);
    }
    .ok {
      color: var(--ha-success);
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
    .wrap {
      overflow-x: auto;
    }
    .status {
      margin-top: 12px;
      padding: 8px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--ha-text) 5%, transparent);
      white-space: pre-line;
    }
    .cols {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    @media (max-width: 900px) {
      .cols {
        grid-template-columns: 1fr;
      }
    }
    h4 {
      margin: 12px 0 4px;
      font-weight: 500;
    }
  `;

  @state() private tab: Tab = "copy";
  @state() private devices: DeviceSummary[] = [];
  @state() private status = "";
  @state() private busy = false;
  // extended copy
  @state() private copySource: number | null = null;
  @state() private copyCount = 1;
  @state() private copyFind = "";
  @state() private copyReplace = "";
  @state() private copyGas = false;
  // replace
  @state() private replTarget: number | null = null;
  @state() private replTemplate: number | null = null;
  @state() private replFilter = { target: "", template: "" };
  @state() private preview: ReplacePreview | null = null;
  // shift + labels share a selection
  @state() private selected = new Set<number>();
  @state() private filter = "";
  @state() private offset = 1;
  @state() private shiftDry: ShiftResult | null = null;
  // topology
  @state() private findings: Finding[] | null = null;
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
    const ids = new Set(this.devices.map((d) => d.id));
    if (this.copySource !== null && !ids.has(this.copySource))
      this.copySource = null;
    if (this.replTarget !== null && !ids.has(this.replTarget))
      this.replTarget = null;
    if (this.replTemplate !== null && !ids.has(this.replTemplate))
      this.replTemplate = null;
    this.selected = new Set([...this.selected].filter((id) => ids.has(id)));
    if (this.replTarget !== null && this.replTemplate !== null)
      void this.loadPreview();
    if (this.findings) void this.runTopology();
  }

  private async act(fn: () => Promise<string>): Promise<void> {
    this.busy = true;
    try {
      this.status = await fn();
    } catch (e) {
      this.status = e instanceof ApiError ? e.message : String(e);
      store.say(this.status, "danger");
    } finally {
      this.busy = false;
    }
  }

  private label(d: DeviceSummary): string {
    return `${d.individual_address ?? "-.-.-"}  ${d.name || d.product_name}${d.description ? `  ·  ${d.description}` : ""}`;
  }

  private matchesDevice(d: DeviceSummary, q: string): boolean {
    return (
      !q ||
      `${d.name} ${d.individual_address ?? ""} ${d.product_name} ${d.manufacturer_name} ${d.order_number} ${d.room ?? ""}`
        .toLowerCase()
        .includes(q)
    );
  }

  private deviceSelect(value: number | null, onChange: (id: number) => void) {
    return html`<sl-select
      size="small"
      hoist
      placeholder=${tr("Pick a device")}
      value=${value === null ? "" : String(value)}
      @sl-change=${(e: Event) => onChange(Number((e.target as HTMLSelectElement).value))}
    >
      ${this.devices.map((d) => html`<sl-option value=${String(d.id)}>${this.label(d)}</sl-option>`)}
    </sl-select>`;
  }

  // --- extended copy ------------------------------------------------------------------------

  private renderCopy() {
    const src = this.devices.find((d) => d.id === this.copySource);
    const previewName = src
      ? this.copyFind
        ? src.name.replaceAll(this.copyFind, this.copyReplace)
        : src.name
      : "";
    return html`
      <p class="desc">
        ${tr("Duplicate a device several times, parameters included. Optionally rewrite the copies' names (find / replace) and create a group address for every communication object of each copy. Copies land on the same line with the next free addresses.")}
      </p>
      <div class="form">
        <label>${tr("Source device")}</label
        >${this.deviceSelect(this.copySource, (id) => (this.copySource = id))}
        <label>${tr("Copies")}</label
        ><sl-input
          size="small"
          type="number"
          min="1"
          max="500"
          value=${String(this.copyCount)}
          @sl-input=${(e: Event) => (this.copyCount = Math.max(1, Math.min(500, Number((e.target as HTMLInputElement).value) || 1)))}
        ></sl-input>
        <label>${tr("Find in name")}</label
        ><sl-input
          size="small"
          value=${this.copyFind}
          @sl-input=${(e: Event) => (this.copyFind = (e.target as HTMLInputElement).value)}
        ></sl-input>
        <label>${tr("Replace with")}</label
        ><sl-input
          size="small"
          value=${this.copyReplace}
          @sl-input=${(e: Event) => (this.copyReplace = (e.target as HTMLInputElement).value)}
        ></sl-input>
        <label></label
        ><sl-checkbox
          size="small"
          ?checked=${this.copyGas}
          @sl-change=${(e: Event) => (this.copyGas = (e.target as HTMLInputElement).checked)}
          >${tr("Create group addresses for every copy")}</sl-checkbox
        >
        <label>${tr("Copy name")}</label
        ><span class="muted"
          >${src ? `${previewName} (copy${this.copyCount > 1 ? " 1…" + this.copyCount : ""})` : "–"}</span
        >
      </div>
      <sl-button
        variant="primary"
        size="small"
        ?disabled=${!src || this.busy}
        ?loading=${this.busy}
        @click=${() =>
          this.act(async () => {
            const r = await api.post<{
              created: number[];
              group_addresses: number;
              errors: string[];
            }>("api/tools/extended-copy", {
              device_id: this.copySource,
              count: this.copyCount,
              find: this.copyFind,
              replace: this.copyReplace,
              create_group_addresses: this.copyGas,
            });
            return `${r.created.length} cop${r.created.length === 1 ? "y" : "ies"} created${r.group_addresses ? `, ${r.group_addresses} group addresses` : ""}${r.errors.length ? `\n${r.errors.join("\n")}` : ""}`;
          })}
        >${tr("Copy")}</sl-button
      >
    `;
  }

  // --- replace device -----------------------------------------------------------------------

  private async loadPreview(): Promise<void> {
    if (
      this.replTarget === null ||
      this.replTemplate === null ||
      this.replTarget === this.replTemplate
    ) {
      this.preview = null;
      return;
    }
    try {
      this.preview = await api.get<ReplacePreview>(
        `api/tools/replace-preview?target=${this.replTarget}&template=${this.replTemplate}`,
      );
    } catch (e) {
      this.preview = null;
      this.status = e instanceof ApiError ? e.message : String(e);
    }
  }

  private pickList(
    key: "target" | "template",
    current: number | null,
    onPick: (id: number) => void,
  ) {
    const q = this.replFilter[key].trim().toLowerCase();
    return html` <sl-input
        size="small"
        placeholder=${tr("Filter")}
        clearable
        value=${this.replFilter[key]}
        @sl-input=${(e: Event) => (this.replFilter = { ...this.replFilter, [key]: (e.target as HTMLInputElement).value })}
        ><span slot="prefix">${icon("search", 14)}</span></sl-input
      >
      <div class="list">
        ${this.devices
          .filter((d) => this.matchesDevice(d, q))
          .map(
            (d) =>
              html`<div
                class="item ${d.id === current ? "selected" : ""}"
                @click=${() => onPick(d.id)}
              >
                <span></span
                ><span class="addr">${d.individual_address ?? "-.-.-"}</span
                ><span>${d.name || d.product_name}</span
                ><span class="muted">${d.product_name}</span>
              </div>`,
          )}
      </div>`;
  }

  private renderReplace() {
    const p = this.preview;
    return html`
      <p class="desc">
        Replace a device by a copy of another project device (for example a
        newer application version or a different model) while keeping its name,
        address, room and group-address links. Objects are matched by number and
        size; unmatched links are reported.
      </p>
      <div class="cols">
        <div>
          <h4>${tr("Device to replace")}</h4>
          ${this.pickList("target", this.replTarget, (id) => {
            this.replTarget = id;
            void this.loadPreview();
          })}
        </div>
        <div>
          <h4>${tr("Replace with a copy of")}</h4>
          ${this.pickList("template", this.replTemplate, (id) => {
            this.replTemplate = id;
            void this.loadPreview();
          })}
        </div>
      </div>
      ${
        p
          ? html`<h4>${tr("Link mapping")}</h4>
              <div class="wrap">
                <table>
                  <tr>
                    <th>${tr("Object")}</th>
                    <th>${tr("Links")}</th>
                    <th>${tr("Becomes")}</th>
                  </tr>
                  ${p.pairs
                    .filter((x) => x.links)
                    .map(
                      (x) =>
                        html`<tr>
                          <td>
                            #${x.old.number} ${x.old.name}
                            <span class="muted">${x.old.function_text}</span>
                          </td>
                          <td>${x.links}</td>
                          <td class=${x.new ? "" : "bad"}>
                            ${x.new ? `#${x.new.number} ${x.new.name}` : "no matching object, links are lost"}
                          </td>
                        </tr>`,
                    )}
                </table>
              </div>
              <p class="muted">
                ${p.mapped} object${p.mapped === 1 ? "" : "s"} keep their
                links${p.lost ? html`, <span class="bad">${p.lost} lose them</span>` : ""}.
              </p>`
          : nothing
      }
      <sl-button
        variant="primary"
        size="small"
        ?disabled=${!p || this.busy}
        ?loading=${this.busy}
        @click=${() =>
          this.act(async () => {
            const r = await api.post<{
              device_id: number;
              mapped: number;
              errors: string[];
            }>("api/tools/replace-device", {
              target_id: this.replTarget,
              template_id: this.replTemplate,
            });
            this.replTarget = null;
            this.preview = null;
            store.select(r.device_id);
            return `Device replaced; ${r.mapped} object${r.mapped === 1 ? "" : "s"} relinked${r.errors.length ? `\n${r.errors.join("\n")}` : ""}`;
          })}
        >${tr("Replace device")}</sl-button
      >
    `;
  }

  // --- shared multi-select ------------------------------------------------------------------

  private toggle(id: number, on: boolean): void {
    const s = new Set(this.selected);
    if (on) s.add(id);
    else s.delete(id);
    this.selected = s;
    this.shiftDry = null;
  }

  private multiList(extra?: (d: DeviceSummary) => unknown) {
    const q = this.filter.trim().toLowerCase();
    const shown = this.devices.filter((d) => this.matchesDevice(d, q));
    return html` <div class="row">
        <sl-input
          size="small"
          placeholder=${tr("Filter")}
          clearable
          style="flex:1;max-width:320px"
          value=${this.filter}
          @sl-input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
          ><span slot="prefix">${icon("search", 14)}</span></sl-input
        >
        <sl-button
          size="small"
          @click=${() => {
            this.selected = new Set(shown.map((d) => d.id));
            this.shiftDry = null;
          }}
          >${tr("Select shown")}</sl-button
        >
        <sl-button
          size="small"
          @click=${() => {
            this.selected = new Set();
            this.shiftDry = null;
          }}
          >${tr("Clear")}</sl-button
        >
        <span class="muted">${this.selected.size} selected</span>
      </div>
      <div class="list">
        ${shown.map(
          (d) =>
            html`<div
              class="item ${this.selected.has(d.id) ? "selected" : ""}"
              @click=${() => this.toggle(d.id, !this.selected.has(d.id))}
            >
              <sl-checkbox
                size="small"
                ?checked=${this.selected.has(d.id)}
                @click=${(e: Event) => e.stopPropagation()}
                @sl-change=${(e: Event) => this.toggle(d.id, (e.target as HTMLInputElement).checked)}
              ></sl-checkbox>
              <span class="addr">${d.individual_address ?? "-.-.-"}</span
              ><span>${d.name || d.product_name}</span
              ><span>${extra ? extra(d) : nothing}</span>
            </div>`,
        )}
      </div>`;
  }

  // --- shift addresses ----------------------------------------------------------------------

  private renderShift() {
    const valid = [...this.selected].filter(
      (id) =>
        shiftedIa(
          this.devices.find((d) => d.id === id)?.individual_address ?? null,
          this.offset,
        ) !== null,
    ).length;
    return html`
      <p class="desc">
        Move a block of devices to other addresses on their line by adding an
        offset to the device number (e.g. +10 turns 1.1.5 into 1.1.15). The
        whole result is checked for range and collisions first; with a conflict
        nothing is written.
      </p>
      <div class="row">
        <label class="muted">${tr("Offset")}</label
        ><sl-input
          size="small"
          type="number"
          min="-254"
          max="254"
          style="width:120px"
          value=${String(this.offset)}
          @sl-input=${(e: Event) => {
            this.offset = Number((e.target as HTMLInputElement).value) || 0;
            this.shiftDry = null;
          }}
        ></sl-input>
      </div>
      ${this.multiList((d) => {
        if (!this.selected.has(d.id)) return nothing;
        const n = shiftedIa(d.individual_address, this.offset);
        return n
          ? html`<span class="addr">→ ${n}</span>`
          : html`<span class="bad">→ out of range</span>`;
      })}
      ${this.shiftDry?.errors.length ? html`<div class="status bad">${this.shiftDry.errors.join("\n")}</div>` : nothing}
      <div class="row">
        <sl-button
          size="small"
          ?disabled=${!valid || !this.offset || this.busy}
          @click=${() =>
            this.act(async () => {
              this.shiftDry = await api.post<ShiftResult>(
                "api/tools/shift-addresses",
                {
                  device_ids: [...this.selected],
                  offset: this.offset,
                  dry_run: true,
                },
              );
              return this.shiftDry.errors.length
                ? "Conflicts found, nothing changed"
                : `${this.shiftDry.preview.length} addresses can be shifted`;
            })}
          >${tr("Check")}</sl-button
        >
        <sl-button
          variant="primary"
          size="small"
          ?disabled=${!valid || !this.offset || this.busy}
          ?loading=${this.busy}
          @click=${() =>
            this.act(async () => {
              const r = await api.post<ShiftResult>(
                "api/tools/shift-addresses",
                {
                  device_ids: [...this.selected],
                  offset: this.offset,
                },
              );
              this.shiftDry = null;
              return `${r.applied} address${r.applied === 1 ? "" : "es"} shifted`;
            })}
          >${tr("Shift")} ${valid} address${valid === 1 ? "" : "es"}</sl-button
        >
      </div>
    `;
  }

  // --- labels -------------------------------------------------------------------------------

  private renderLabels() {
    const ids = [...this.selected];
    const q = ids.length ? `?devices=${ids.join(",")}` : "";
    return html`
      <p class="desc">
        ${tr("Device labels for the distribution board: address, name, order number, manufacturer, description and room as CSV (all devices when none are selected).")}
      </p>
      ${this.multiList()}
      <div class="row">
        <sl-button
          variant="primary"
          size="small"
          @click=${() =>
            this.act(async () => {
              const r = await api.get<{ csv: string; rows: string[][] }>(
                `api/tools/labels${q}`,
              );
              this.download("device-labels.csv", r.csv);
              return `${r.rows.length} label${r.rows.length === 1 ? "" : "s"} exported`;
            })}
          >${icon("download", 14)} ${tr("Download CSV")}</sl-button
        >
        <sl-button
          size="small"
          @click=${() =>
            this.act(async () => {
              const r = await api.get<{ csv: string; rows: string[][] }>(
                `api/tools/labels${q}`,
              );
              await navigator.clipboard.writeText(r.csv);
              return `${r.rows.length} label${r.rows.length === 1 ? "" : "s"} copied to the clipboard`;
            })}
          >${tr("Copy to clipboard")}</sl-button
        >
      </div>
    `;
  }

  private download(name: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // --- topology check -----------------------------------------------------------------------

  private async runTopology(): Promise<void> {
    await this.act(async () => {
      const r = await api.get<{ items: Finding[]; devices: number }>(
        "api/tools/topology-check",
      );
      this.findings = r.items;
      return r.items.length
        ? `${r.items.length} finding${r.items.length === 1 ? "" : "s"} in ${r.devices} devices`
        : `No problems in ${r.devices} devices`;
    });
  }

  private renderTopology() {
    return html`
      <p class="desc">
        ${tr("Check every device for a missing, malformed or duplicate individual address and for missing product data. Click a finding to open the device.")}
      </p>
      <sl-button
        variant="primary"
        size="small"
        ?loading=${this.busy}
        @click=${() => this.runTopology()}
        >${tr("Run check")}</sl-button
      >
      ${
        this.findings
          ? html`<div class="list" style="margin-top:12px">
              ${this.findings.length ? this.findings.map((f) => html`<div class="item" @click=${() => store.select(f.device_id)}><span class=${f.severity === "error" ? "bad" : "warn"}>●</span><span class="muted">${f.severity}</span><span>${f.message}</span><span></span></div>`) : html`<div class="item"><span class="ok">●</span><span></span><span>${tr("Every device has a valid, unique address.")}</span><span></span></div>`}
            </div>`
          : nothing
      }
    `;
  }

  render() {
    if (!store.project.open)
      return html`<div class="desc">${tr("Open a project first.")}</div>`;
    if (!this.devices.length)
      return html`<div class="desc">
        ${tr("The project has no devices yet.")}
      </div>`;
    return html`
      <sl-tab-group
        @sl-tab-show=${(e: CustomEvent<{ name: string }>) => {
          this.tab = e.detail.name as Tab;
          this.status = "";
        }}
      >
        <sl-tab slot="nav" panel="copy" ?active=${this.tab === "copy"}
          >${tr("Extended copy")}</sl-tab
        >
        <sl-tab slot="nav" panel="replace" ?active=${this.tab === "replace"}
          >${tr("Replace device")}</sl-tab
        >
        <sl-tab slot="nav" panel="shift" ?active=${this.tab === "shift"}
          >${tr("Shift addresses")}</sl-tab
        >
        <sl-tab slot="nav" panel="labels" ?active=${this.tab === "labels"}
          >${tr("Labels")}</sl-tab
        >
        <sl-tab slot="nav" panel="topology" ?active=${this.tab === "topology"}
          >${tr("Topology check")}</sl-tab
        >
        <sl-tab-panel name="copy" ?active=${this.tab === "copy"}
          >${this.tab === "copy" ? this.renderCopy() : nothing}</sl-tab-panel
        >
        <sl-tab-panel name="replace" ?active=${this.tab === "replace"}
          >${this.tab === "replace" ? this.renderReplace() : nothing}</sl-tab-panel
        >
        <sl-tab-panel name="shift" ?active=${this.tab === "shift"}
          >${this.tab === "shift" ? this.renderShift() : nothing}</sl-tab-panel
        >
        <sl-tab-panel name="labels" ?active=${this.tab === "labels"}
          >${this.tab === "labels" ? this.renderLabels() : nothing}</sl-tab-panel
        >
        <sl-tab-panel name="topology" ?active=${this.tab === "topology"}
          >${this.tab === "topology" ? this.renderTopology() : nothing}</sl-tab-panel
        >
      </sl-tab-group>
      ${this.status ? html`<div class="status">${this.status}</div>` : nothing}
    `;
  }
}
