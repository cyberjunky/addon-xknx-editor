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

// --- printable labels -------------------------------------------------------------------------

/** An A4 label sheet; all sizes in mm. */
type Sheet = {
  id: string;
  name: string;
  w: number;
  h: number;
  cols: number;
  rows: number;
  top: number;
  left: number;
  pitchX: number;
  pitchY: number;
};

const SHEETS: Sheet[] = [
  { id: "L4730", name: "Avery L4730", w: 17.8, h: 10, cols: 10, rows: 27, top: 13.5, left: 4.8, pitchX: 20.3, pitchY: 10 },
  { id: "L4731", name: "Avery L4731", w: 25.4, h: 10, cols: 7, rows: 27, top: 13.5, left: 8.6, pitchX: 27.9, pitchY: 10 },
  { id: "L4732", name: "Avery L4732", w: 35.6, h: 16.9, cols: 5, rows: 16, top: 13.3, left: 11, pitchX: 38.1, pitchY: 16.9 },
  { id: "L6008", name: "Avery L6008", w: 25.4, h: 10, cols: 7, rows: 27, top: 13.5, left: 8.6, pitchX: 27.9, pitchY: 10 },
  { id: "L7636", name: "Avery L7636", w: 45.7, h: 21.2, cols: 4, rows: 12, top: 21.3, left: 9.7, pitchX: 48.3, pitchY: 21.2 },
  { id: "L7651", name: "Avery L7651", w: 38.1, h: 21.2, cols: 5, rows: 13, top: 10.7, left: 4.7, pitchX: 40.6, pitchY: 21.2 },
  { id: "L7656", name: "Avery L7656", w: 46, h: 11.1, cols: 4, rows: 21, top: 16, left: 7.6, pitchX: 49.6, pitchY: 12.7 },
];
const LEGEND = "legend";

/** Label fields in the order of the api/tools/labels columns; the address (0) is always printed. */
type LabelField = "name" | "order" | "manufacturer" | "description" | "room";
const FIELD_COLUMN: Record<LabelField, number> = {
  name: 1,
  order: 2,
  manufacturer: 3,
  description: 4,
  room: 5,
};
const FIELD_ORDER: LabelField[] = ["name", "room", "order", "manufacturer", "description"];

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** One label: text shrunk (in mm) so every line fits the height and the longest line the width. */
function labelHtml(row: string[], sheet: Sheet, fields: LabelField[]): string {
  const lines = [row[0] || "-.-.-", ...fields.map((f) => row[FIELD_COLUMN[f]] ?? "").filter((s) => s)];
  const pad = Math.min(1, sheet.h * 0.08);
  const byHeight = (sheet.h - 2 * pad) / (lines.length * 1.15);
  const longest = Math.max(...lines.map((s, i) => s.length * (i === 0 ? 0.62 : 0.55)));
  const byWidth = (sheet.w - 2 * pad) / Math.max(1, longest);
  const fs = r2(Math.max(1.3, Math.min(byHeight, byWidth, sheet.h * 0.34, 4.5)));
  return `<div class="in" style="padding:${r2(pad)}mm;font-size:${fs}mm">${lines
    .map((s, i) => `<div class="${i === 0 ? "ia" : "ln"}">${escapeHtml(s)}</div>`)
    .join("")}</div>`;
}

function labelsDocument(
  rows: string[][],
  sheet: Sheet,
  fields: LabelField[],
  skip: number,
  opts: { preview: boolean; title: string },
): string {
  const perPage = sheet.cols * sheet.rows;
  const slots = [...Array<null>(skip).fill(null), ...rows];
  const pages = Math.max(1, Math.ceil(slots.length / perPage));
  const out: string[] = [];
  for (let p = 0; p < (opts.preview ? 1 : pages); p++) {
    const boxes = slots
      .slice(p * perPage, (p + 1) * perPage)
      .map((row, i) => {
        const col = i % sheet.cols;
        const line = Math.floor(i / sheet.cols);
        const x = r2(sheet.left + col * sheet.pitchX);
        const y = r2(sheet.top + line * sheet.pitchY);
        const style = `left:${x}mm;top:${y}mm;width:${sheet.w}mm;height:${sheet.h}mm`;
        return row
          ? `<div class="label" style="${style}">${labelHtml(row, sheet, fields)}</div>`
          : opts.preview
            ? `<div class="label used" style="${style}"></div>`
            : "";
      })
      .join("");
    out.push(`<div class="page">${boxes}</div>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(opts.title)}</title>
<style>
@page { size: A4; margin: 0 }
* { box-sizing: border-box }
html, body { margin: 0; padding: 0; background: #fff; color: #000 }
body { font-family: Arial, Helvetica, sans-serif }
.page { position: relative; width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; break-after: page }
.page:last-child { page-break-after: auto; break-after: auto }
.label { position: absolute; overflow: hidden }
.in { width: 100%; height: 100%; display: flex; flex-direction: column; justify-content: center; line-height: 1.15 }
.ia { font-weight: bold }
.ia, .ln { white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
${opts.preview ? ".label { outline: 0.2mm dashed #bbb } .used { background: #eee }" : ""}
</style></head><body>${out.join("")}${
    opts.preview
      ? ""
      : `<script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print();},200);});</script>`
  }</body></html>`;
}

function legendDocument(rows: string[][], opts: { preview: boolean; title: string }): string {
  const noRoom = tr("No room");
  const groups = new Map<string, string[][]>();
  for (const row of rows) {
    const room = row[5] || noRoom;
    if (!groups.has(room)) groups.set(room, []);
    groups.get(room)!.push(row);
  }
  const rooms = [...groups.keys()].sort((a, b) =>
    a === noRoom ? 1 : b === noRoom ? -1 : a.localeCompare(b, undefined, { numeric: true }),
  );
  const cmp = (a: string[], b: string[]) =>
    (a[0] || "9.9.999").localeCompare(b[0] || "9.9.999", undefined, { numeric: true });
  const head = `<tr><th>${escapeHtml(tr("Individual address"))}</th><th>${escapeHtml(tr("Name"))}</th><th>${escapeHtml(tr("Order number"))}</th></tr>`;
  const body = rooms
    .map(
      (room) =>
        `<tbody><tr class="room"><td colspan="3">${escapeHtml(room)}</td></tr>${groups
          .get(room)!
          .sort(cmp)
          .map(
            (r) =>
              `<tr><td class="ia">${escapeHtml(r[0] || "-.-.-")}</td><td>${escapeHtml(r[1] ?? "")}</td><td>${escapeHtml(r[2] ?? "")}</td></tr>`,
          )
          .join("")}</tbody>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(opts.title)}</title>
<style>
@page { size: A4; margin: 12mm }
* { box-sizing: border-box }
html, body { margin: 0; padding: 0; background: #fff; color: #000 }
body { font-family: Arial, Helvetica, sans-serif; font-size: 9pt }
${opts.preview ? "body { width: 210mm; padding: 12mm }" : ""}
h1 { font-size: 14pt; margin: 0 0 4mm }
table { width: 100%; border-collapse: collapse }
th, td { text-align: left; padding: 1mm 2mm; border-bottom: 0.2mm solid #999 }
thead th { border-bottom: 0.4mm solid #000; font-size: 8pt }
thead { display: table-header-group }
tr { page-break-inside: avoid; break-inside: avoid }
.room td { font-weight: bold; background: #eee; padding-top: 2mm; -webkit-print-color-adjust: exact; print-color-adjust: exact }
td.ia { font-family: Consolas, Menlo, monospace; white-space: nowrap; width: 22mm }
</style></head><body><h1>${escapeHtml(opts.title)}</h1><table><thead>${head}</thead>${body}</table>${
    opts.preview
      ? ""
      : `<script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print();},200);});</script>`
  }</body></html>`;
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
    .print {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 16px;
      align-items: start;
    }
    @media (max-width: 700px) {
      .print {
        grid-template-columns: 1fr;
      }
    }
    .print-opts {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .print-opts > label {
      margin-top: 6px;
    }
    .preview {
      margin-top: 4px;
      border: 1px solid var(--ha-divider);
      overflow: hidden;
      background: #fff;
      box-shadow: 0 1px 4px rgb(0 0 0 / 20%);
    }
    .preview iframe {
      width: 794px;
      height: 1123px;
      border: 0;
      transform-origin: 0 0;
      background: #fff;
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
  // label printing
  @state() private printOpen = false;
  @state() private printRows: string[][] | null = null;
  @state() private printFormat = "L4731";
  @state() private printFields = new Set<LabelField>(["name", "room"]);
  @state() private printSkip = 0;
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
        <sl-button
          size="small"
          ?disabled=${this.busy}
          @click=${() =>
            this.act(async () => {
              const r = await api.get<{ rows: string[][] }>(
                `api/tools/labels${q}`,
              );
              this.printRows = r.rows;
              this.printOpen = true;
              return "";
            })}
          >${tr("Print labels…")}</sl-button
        >
      </div>
      ${this.renderPrintDialog()}
    `;
  }

  private printDocument(preview: boolean): string {
    const rows = this.printRows ?? [];
    const title = store.project.name || tr("Device labels");
    if (this.printFormat === LEGEND) return legendDocument(rows, { preview, title });
    const sheet = SHEETS.find((s) => s.id === this.printFormat) ?? SHEETS[0];
    const fields = FIELD_ORDER.filter((f) => this.printFields.has(f));
    const skip = Math.max(0, Math.min(sheet.cols * sheet.rows - 1, this.printSkip));
    return labelsDocument(rows, sheet, fields, skip, { preview, title });
  }

  private print(): void {
    const w = window.open("", "_blank");
    if (!w) {
      store.say(tr("The browser blocked the print window; allow pop-ups for this page."), "danger");
      return;
    }
    w.document.open();
    w.document.write(this.printDocument(false));
    w.document.close();
  }

  private renderPrintDialog() {
    const legend = this.printFormat === LEGEND;
    const sheet = SHEETS.find((s) => s.id === this.printFormat);
    const count = this.printRows?.length ?? 0;
    const fieldLabels: Record<LabelField, string> = {
      name: tr("Name"),
      room: tr("Room"),
      order: tr("Order number"),
      manufacturer: tr("Manufacturer"),
      description: tr("Description"),
    };
    const scale = 0.4;
    return html`<sl-dialog
      label=${tr("Print labels")}
      style="--width: 760px"
      ?open=${this.printOpen}
      @sl-after-hide=${(e: Event) => {
        if (e.target === e.currentTarget) this.printOpen = false;
      }}
    >
      ${
        this.printOpen
          ? html`<div class="print">
              <div class="print-opts">
                <label class="muted">${tr("Sheet format")}</label>
                <sl-select
                  size="small"
                  hoist
                  value=${this.printFormat}
                  @sl-change=${(e: Event) => (this.printFormat = (e.target as HTMLSelectElement).value)}
                >
                  ${SHEETS.map(
                    (s) =>
                      html`<sl-option value=${s.id}
                        >${s.name} (${s.w}×${s.h} mm, ${s.cols * s.rows}
                        ${tr("per sheet")})</sl-option
                      >`,
                  )}
                  <sl-option value=${LEGEND}
                    >${tr("Legend sheet (A4 table for the distribution board door)")}</sl-option
                  >
                </sl-select>
                ${
                  legend
                    ? html`<p class="muted" style="margin:0">
                        ${tr("A table of all devices grouped by room, with address, name and order number.")}
                      </p>`
                    : html`<label class="muted">${tr("Fields on a label")}</label>
                        <sl-checkbox size="small" checked disabled
                          >${tr("Individual address")}</sl-checkbox
                        >
                        ${FIELD_ORDER.map(
                          (f) =>
                            html`<sl-checkbox
                              size="small"
                              ?checked=${this.printFields.has(f)}
                              @sl-change=${(e: Event) => {
                                const s = new Set(this.printFields);
                                if ((e.target as HTMLInputElement).checked) s.add(f);
                                else s.delete(f);
                                this.printFields = s;
                              }}
                              >${fieldLabels[f]}</sl-checkbox
                            >`,
                        )}
                        <label class="muted">${tr("Skip first labels")}</label>
                        <sl-input
                          size="small"
                          type="number"
                          min="0"
                          max=${String((sheet ? sheet.cols * sheet.rows : 1) - 1)}
                          style="width:120px"
                          help-text=${tr("For a partly used sheet")}
                          value=${String(this.printSkip)}
                          @sl-input=${(e: Event) =>
                            (this.printSkip = Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value) || 0)))}
                        ></sl-input>`
                }
                <p class="muted" style="margin:4px 0 0">
                  ${count} ${count === 1 ? tr("device") : tr("devices")}${
                    sheet
                      ? html`, ${Math.max(1, Math.ceil((count + Math.min(this.printSkip, sheet.cols * sheet.rows - 1)) / (sheet.cols * sheet.rows)))}
                        ${tr("sheet(s)")}`
                      : nothing
                  }
                </p>
              </div>
              <div>
                <label class="muted">${tr("Preview (first page)")}</label>
                <div
                  class="preview"
                  style="width:${Math.round(794 * scale)}px;height:${Math.round(1123 * scale)}px"
                >
                  <iframe
                    sandbox=""
                    title=${tr("Preview (first page)")}
                    style="transform:scale(${scale})"
                    .srcdoc=${this.printDocument(true)}
                  ></iframe>
                </div>
              </div>
            </div>`
          : nothing
      }
      <sl-button slot="footer" size="small" @click=${() => (this.printOpen = false)}
        >${tr("Cancel")}</sl-button
      >
      <sl-button
        slot="footer"
        variant="primary"
        size="small"
        ?disabled=${!count}
        @click=${() => this.print()}
        >${tr("Print")}</sl-button
      >
    </sl-dialog>`;
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
