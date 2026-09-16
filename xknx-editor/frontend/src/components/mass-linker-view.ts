import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import {
  ApiError,
  api,
  type DeviceSummary,
  type GroupAddress,
} from "../api.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { t as tr } from "../i18n.js";
import { dptTitle, formatDpt, onDptNames } from "../dpt-format.js";

type Obj = {
  device_id: number;
  device_name: string;
  individual_address: string | null;
  ref_id: string;
  number: number;
  name: string;
  function_text: string;
  dpt_codes: string[];
  dpt_major: number | null;
  object_size: string;
  links: {
    id: number;
    group_address_id: number;
    text: string;
    is_sending: boolean;
  }[];
};
type Status = "unmatched" | "ready" | "ambiguous" | "incompatible";
type Row = { obj: Obj; target: number | null; status: Status };
type Pair = { source: Obj; target: Obj; address: string; name: string };

function major(dpt: string | null): number | null {
  const m = /^DPS?T-(\d+)/.exec(dpt ?? "");
  return m ? Number(m[1]) : null;
}

/** Best existing group address for an object by name, constrained by DPT main type (desktop rule). */
export function autopair(
  name: string,
  objMajor: number | null,
  gas: GroupAddress[],
): { id: number | null; status: Status } {
  const key = name.trim().toLowerCase();
  if (!key) return { id: null, status: "unmatched" };
  const named = gas.filter((g) => g.name.trim());
  const exact = named.filter((g) => g.name.trim().toLowerCase() === key);
  const contains =
    key.length >= 3
      ? named.filter(
          (g) =>
            g.name.toLowerCase().includes(key) ||
            key.includes(g.name.trim().toLowerCase()),
        )
      : [];
  const cands = exact.length ? exact : contains;
  if (!cands.length) return { id: null, status: "unmatched" };
  if (objMajor === null) return { id: cands[0].id, status: "ambiguous" };
  const compatible = cands.filter((g) => major(g.datapoint_type) === objMajor);
  if (compatible.length === 1) return { id: compatible[0].id, status: "ready" };
  if (compatible.length > 1)
    return { id: compatible[0].id, status: "ambiguous" };
  const unknown = cands.filter((g) => major(g.datapoint_type) === null);
  if (unknown.length) return { id: unknown[0].id, status: "ambiguous" };
  return { id: null, status: "incompatible" };
}

/** Centre-dock "Mass link" view: link many objects to group addresses at once, or object to object via new addresses. */
@customElement("xknx-mass-linker-view")
export class MassLinkerView extends LitElement {
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
      max-width: 80ch;
    }
    .cols {
      display: grid;
      grid-template-columns: 280px 1fr;
      gap: 16px;
      align-items: start;
    }
    @media (max-width: 900px) {
      .cols {
        grid-template-columns: 1fr;
      }
    }
    .list {
      border: 1px solid var(--ha-divider);
      border-radius: 8px;
      max-height: 420px;
      overflow: auto;
    }
    .item {
      display: grid;
      grid-template-columns: 24px 4.5em 1fr;
      gap: 8px;
      padding: 4px 8px;
      align-items: center;
      border-bottom: 1px solid var(--ha-divider);
      cursor: pointer;
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
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      margin: 8px 0;
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
      white-space: nowrap;
      vertical-align: middle;
    }
    th {
      color: var(--ha-text-2);
      font-weight: 500;
      font-size: 12px;
    }
    td sl-select,
    td sl-input {
      min-width: 220px;
    }
    .wrap {
      overflow-x: auto;
    }
    .ready {
      color: var(--ha-success);
    }
    .ambiguous {
      color: var(--ha-warning);
    }
    .incompatible {
      color: var(--ha-error);
    }
    .status {
      margin-top: 12px;
      padding: 8px 12px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--ha-text) 5%, transparent);
      white-space: pre-line;
    }
    h4 {
      margin: 12px 0 6px;
      font-weight: 500;
    }
  `;

  @state() private tab: "ga" | "obj" = "ga";
  @state() private devices: DeviceSummary[] = [];
  @state() private gas: GroupAddress[] = [];
  @state() private selected = new Set<number>();
  @state() private filter = "";
  @state() private rows: Row[] = [];
  @state() private objects: Obj[] = [];
  @state() private start = "";
  @state() private status = "";
  @state() private busy = false;
  // object <-> object
  @state() private pairs: Pair[] = [];
  @state() private srcKey = "";
  @state() private dstKey = "";
  @state() private pairAddress = "";
  @state() private pairName = "";
  private unsubscribe = () => {};
  private unsubscribeDpt = () => {};
  private rev = -1;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribeDpt = onDptNames(() => this.requestUpdate());
    this.unsubscribe = store.subscribe(() => {
      this.requestUpdate();
      void this.sync();
    });
    void this.sync();
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    this.unsubscribeDpt();
    super.disconnectedCallback();
  }

  private async sync(): Promise<void> {
    if (!store.project.open) {
      this.devices = [];
      this.rows = [];
      return;
    }
    if (this.rev === store.revision) return;
    this.rev = store.revision;
    const [d, g] = await Promise.all([
      api.get<{ items: DeviceSummary[] }>("api/project/devices"),
      api.get<{ items: GroupAddress[] }>("api/group-addresses"),
    ]);
    this.devices = d.items.sort((a, b) =>
      (a.individual_address ?? "9.9.999").localeCompare(
        b.individual_address ?? "9.9.999",
        undefined,
        { numeric: true },
      ),
    );
    this.gas = g.items.sort((a, b) => a.address - b.address);
    const ids = new Set(this.devices.map((x) => x.id));
    this.selected = new Set([...this.selected].filter((id) => ids.has(id)));
    if (this.selected.size) await this.loadObjects();
    else this.objects = [];
  }

  private async loadObjects(): Promise<void> {
    const r = await api.get<{ items: Obj[] }>(
      `api/tools/objects?devices=${[...this.selected].join(",")}`,
    );
    this.objects = r.items;
    const keep = new Map(
      this.rows.map((row) => [`${row.obj.device_id}:${row.obj.ref_id}`, row]),
    );
    this.rows = r.items.map((obj) => {
      const old = keep.get(`${obj.device_id}:${obj.ref_id}`);
      return old ? { ...old, obj } : { obj, target: null, status: "unmatched" };
    });
  }

  private toggle(id: number, on: boolean): void {
    const s = new Set(this.selected);
    if (on) s.add(id);
    else s.delete(id);
    this.selected = s;
    void this.loadObjects();
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

  private setTarget(row: Row, id: number | null): void {
    const ga = this.gas.find((g) => g.id === id);
    let status: Status = "unmatched";
    if (ga) {
      const gm = major(ga.datapoint_type);
      status =
        gm === null || row.obj.dpt_major === null
          ? "ambiguous"
          : gm === row.obj.dpt_major
            ? "ready"
            : "incompatible";
    }
    this.rows = this.rows.map((r) =>
      r === row ? { ...r, target: id, status } : r,
    );
  }

  private autopairAll(onlyEmpty: boolean): void {
    this.rows = this.rows.map((r) => {
      if (onlyEmpty && r.target !== null) return r;
      const m = autopair(r.obj.name, r.obj.dpt_major, this.gas);
      return { ...r, target: m.id, status: m.status };
    });
  }

  private sequential(): void {
    const startGa = this.gas.find((g) => g.text === this.start.trim());
    if (!startGa) {
      this.status = `No group address ${this.start} in the project`;
      return;
    }
    const ordered = this.gas.filter((g) => g.address >= startGa.address);
    let i = 0;
    this.rows = this.rows.map((r) => {
      const ga = ordered[i++];
      if (!ga) return { ...r, target: null, status: "unmatched" };
      const gm = major(ga.datapoint_type);
      return {
        ...r,
        target: ga.id,
        status:
          gm === null || r.obj.dpt_major === null
            ? "ambiguous"
            : gm === r.obj.dpt_major
              ? "ready"
              : "incompatible",
      };
    });
  }

  private objLabel(o: Obj): string {
    return `${o.individual_address ?? "-.-.-"} ${o.device_name}  #${o.number} ${o.name}${o.function_text && o.function_text !== o.name ? ` (${o.function_text})` : ""}`;
  }

  private deviceList() {
    const q = this.filter.trim().toLowerCase();
    const shown = this.devices.filter(
      (d) =>
        !q ||
        `${d.name} ${d.individual_address ?? ""} ${d.product_name} ${d.room ?? ""}`
          .toLowerCase()
          .includes(q),
    );
    return html` <div class="row">
        <sl-input
          size="small"
          placeholder=${tr("Filter devices")}
          clearable
          style="flex:1"
          value=${this.filter}
          @sl-input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
          ><span slot="prefix">${icon("search", 14)}</span></sl-input
        >
        <sl-button
          size="small"
          @click=${() => {
            this.selected = new Set();
            this.objects = [];
            this.rows = [];
          }}
          >${tr("Clear")}</sl-button
        >
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
              ><span>${d.name || d.product_name}</span>
            </div>`,
        )}
      </div>`;
  }

  private renderGa() {
    const ready = this.rows.filter(
      (r) => r.target !== null && r.status !== "incompatible",
    );
    return html`
      <p class="desc">
        Pick devices on the left; their communication objects appear on the
        right. Choose a target group address per object, let the editor pair
        them by name (the datapoint type must agree), or assign existing
        addresses sequentially from a start address. Objects without a link yet
        get the address as their sending address.
      </p>
      <div class="cols">
        <div>${this.deviceList()}</div>
        <div>
          <div class="row">
            <sl-button
              size="small"
              ?disabled=${!this.rows.length}
              @click=${() => this.autopairAll(true)}
              >${tr("Auto-pair empty")}</sl-button
            >
            <sl-button
              size="small"
              ?disabled=${!this.rows.length}
              @click=${() => this.autopairAll(false)}
              >${tr("Auto-pair all")}</sl-button
            >
            <sl-input
              size="small"
              placeholder=${tr("Start address, e.g. 1/2/0")}
              style="width:180px"
              value=${this.start}
              @sl-input=${(e: Event) => (this.start = (e.target as HTMLInputElement).value)}
            ></sl-input>
            <sl-button
              size="small"
              ?disabled=${!this.rows.length || !this.start.trim()}
              @click=${() => this.sequential()}
              >${tr("Assign sequentially")}</sl-button
            >
            <sl-button
              size="small"
              ?disabled=${!this.rows.length}
              @click=${() => (this.rows = this.rows.map((r) => ({ ...r, target: null, status: "unmatched" })))}
              >${tr("Reset")}</sl-button
            >
          </div>
          <div class="wrap">
            <table>
              <tr>
                <th>${tr("Device")}</th>
                <th>#</th>
                <th>${tr("Object")}</th>
                <th>DPT</th>
                <th>${tr("Linked to")}</th>
                <th>${tr("Target group address")}</th>
                <th></th>
              </tr>
              ${this.rows.map(
                (r) =>
                  html`<tr>
                    <td>
                      <span class="addr"
                        >${r.obj.individual_address ?? "-.-.-"}</span
                      >
                      ${r.obj.device_name}
                    </td>
                    <td>${r.obj.number}</td>
                    <td>
                      ${r.obj.name}${r.obj.function_text && r.obj.function_text !== r.obj.name ? html` <span class="muted">${r.obj.function_text}</span>` : nothing}
                    </td>
                    <td class="muted" title=${dptTitle(r.obj.dpt_codes[0])}>
                      ${r.obj.dpt_codes[0] ? formatDpt(r.obj.dpt_codes[0]) : r.obj.object_size}
                    </td>
                    <td class="muted">
                      ${r.obj.links.map((l) => l.text).join(", ") || "–"}
                    </td>
                    <td>
                      <sl-select
                        size="small"
                        hoist
                        clearable
                        placeholder="–"
                        value=${r.target === null ? "" : String(r.target)}
                        @sl-change=${(e: Event) => {
                          const v = (e.target as HTMLSelectElement).value;
                          this.setTarget(r, v ? Number(v) : null);
                        }}
                      >
                        ${this.gas.map((g) => html`<sl-option value=${String(g.id)}>${g.text} ${g.name}${g.datapoint_type ? ` (${g.datapoint_type})` : ""}</sl-option>`)}
                      </sl-select>
                    </td>
                    <td class=${r.status}>
                      ${r.target === null ? "" : r.status === "ready" ? "ok" : r.status === "incompatible" ? "DPT mismatch" : "check DPT"}
                    </td>
                  </tr>`,
              )}
            </table>
          </div>
          ${this.rows.length ? nothing : html`<p class="muted">${tr("No objects. Select a device with product data on the left.")}</p>`}
          <div class="row">
            <sl-button
              variant="primary"
              size="small"
              ?disabled=${!ready.length || this.busy}
              ?loading=${this.busy}
              @click=${() =>
                this.act(async () => {
                  const r = await api.post<{
                    linked: number;
                    errors: string[];
                  }>("api/tools/mass-link", {
                    pairs: ready.map((x) => ({
                      device_id: x.obj.device_id,
                      ref_id: x.obj.ref_id,
                      group_address_id: x.target,
                    })),
                  });
                  this.rows = this.rows.map((x) => ({
                    ...x,
                    target: null,
                    status: "unmatched",
                  }));
                  return `${r.linked} link${r.linked === 1 ? "" : "s"} created${r.errors.length ? `\n${r.errors.join("\n")}` : ""}`;
                })}
              >${icon("link", 14)} Link ${ready.length}
              object${ready.length === 1 ? "" : "s"}</sl-button
            >
            ${this.rows.some((r) => r.status === "incompatible") ? html`<span class="incompatible">${tr("Rows with a DPT mismatch are skipped.")}</span>` : nothing}
          </div>
        </div>
      </div>
    `;
  }

  private objByKey(key: string): Obj | undefined {
    const [d, ...rest] = key.split(":");
    const ref = rest.join(":");
    return this.objects.find(
      (o) => o.device_id === Number(d) && o.ref_id === ref,
    );
  }

  private renderObj() {
    const options = this.objects.map(
      (o) =>
        html`<sl-option value=${`${o.device_id}:${o.ref_id}`}
          >${this.objLabel(o)}</sl-option
        >`,
    );
    const src = this.objByKey(this.srcKey);
    const dst = this.objByKey(this.dstKey);
    return html`
      <p class="desc">
        Connect two objects directly (a push button to an actuator channel,
        say): the editor creates a group address, gives it the sending object's
        datapoint type and links both. Leave the address empty for the first
        free one; the name defaults to the sending object's name.
      </p>
      <div class="cols">
        <div>${this.deviceList()}</div>
        <div>
          <h4>${tr("New pair")}</h4>
          <div class="row">
            <sl-select
              size="small"
              hoist
              placeholder=${tr("Sending object")}
              style="min-width:300px"
              value=${this.srcKey}
              @sl-change=${(e: Event) => (this.srcKey = (e.target as HTMLSelectElement).value)}
              >${options}</sl-select
            >
            <span class="muted">→</span>
            <sl-select
              size="small"
              hoist
              placeholder=${tr("Receiving object")}
              style="min-width:300px"
              value=${this.dstKey}
              @sl-change=${(e: Event) => (this.dstKey = (e.target as HTMLSelectElement).value)}
              >${options}</sl-select
            >
          </div>
          <div class="row">
            <sl-input
              size="small"
              placeholder=${tr("Address (auto)")}
              style="width:150px"
              value=${this.pairAddress}
              @sl-input=${(e: Event) => (this.pairAddress = (e.target as HTMLInputElement).value)}
            ></sl-input>
            <sl-input
              size="small"
              placeholder=${src ? `Name (${src.name})` : "Name"}
              style="width:260px"
              value=${this.pairName}
              @sl-input=${(e: Event) => (this.pairName = (e.target as HTMLInputElement).value)}
            ></sl-input>
            <sl-button
              size="small"
              ?disabled=${!src || !dst || src === dst}
              @click=${() => {
                if (src && dst) {
                  this.pairs = [
                    ...this.pairs,
                    {
                      source: src,
                      target: dst,
                      address: this.pairAddress.trim(),
                      name: this.pairName.trim(),
                    },
                  ];
                  this.pairAddress = "";
                  this.pairName = "";
                }
              }}
              >${icon("plus", 14)} ${tr("Add pair")}</sl-button
            >
            ${src && dst && src.dpt_major !== null && dst.dpt_major !== null && src.dpt_major !== dst.dpt_major ? html`<span class="incompatible">Datapoint types differ (${formatDpt(src.dpt_codes[0])} vs ${formatDpt(dst.dpt_codes[0])})</span>` : nothing}
          </div>
          ${
            this.pairs.length
              ? html`<h4>${tr("Pairs to create")}</h4>
                  <div class="wrap">
                    <table>
                      <tr>
                        <th>${tr("Sending")}</th>
                        <th>${tr("Receiving")}</th>
                        <th>${tr("Address")}</th>
                        <th>${tr("Name")}</th>
                        <th></th>
                      </tr>
                      ${this.pairs.map(
                        (p, i) =>
                          html`<tr>
                            <td>${this.objLabel(p.source)}</td>
                            <td>${this.objLabel(p.target)}</td>
                            <td class="addr">${p.address || "auto"}</td>
                            <td>${p.name || p.source.name}</td>
                            <td>
                              <sl-button
                                size="small"
                                @click=${() => (this.pairs = this.pairs.filter((_, j) => j !== i))}
                                >${icon("trash", 14)}</sl-button
                              >
                            </td>
                          </tr>`,
                      )}
                    </table>
                  </div>`
              : nothing
          }
          <div class="row">
            <sl-button
              variant="primary"
              size="small"
              ?disabled=${!this.pairs.length || this.busy}
              ?loading=${this.busy}
              @click=${() =>
                this.act(async () => {
                  const r = await api.post<{
                    created: { text: string; name: string }[];
                    errors: string[];
                  }>("api/tools/mass-link-objects", {
                    pairs: this.pairs.map((p) => ({
                      source: {
                        device_id: p.source.device_id,
                        ref_id: p.source.ref_id,
                      },
                      target: {
                        device_id: p.target.device_id,
                        ref_id: p.target.ref_id,
                      },
                      address: p.address,
                      name: p.name,
                    })),
                  });
                  this.pairs = [];
                  return `${r.created.length} group address${r.created.length === 1 ? "" : "es"} created: ${r.created.map((c) => `${c.text} ${c.name}`).join(", ")}${r.errors.length ? `\n${r.errors.join("\n")}` : ""}`;
                })}
              >${icon("link", 14)} Create ${this.pairs.length}
              link${this.pairs.length === 1 ? "" : "s"}</sl-button
            >
          </div>
        </div>
      </div>
    `;
  }

  render() {
    if (!store.project.open)
      return html`<div class="desc">${tr("Open a project first.")}</div>`;
    return html`
      <sl-tab-group
        @sl-tab-show=${(e: CustomEvent<{ name: string }>) => {
          this.tab = e.detail.name as "ga" | "obj";
          this.status = "";
        }}
      >
        <sl-tab slot="nav" panel="ga" ?active=${this.tab === "ga"}
          >${tr("Objects → group addresses")}</sl-tab
        >
        <sl-tab slot="nav" panel="obj" ?active=${this.tab === "obj"}
          >${tr("Object ↔ object")}</sl-tab
        >
        <sl-tab-panel name="ga" ?active=${this.tab === "ga"}
          >${this.tab === "ga" ? this.renderGa() : nothing}</sl-tab-panel
        >
        <sl-tab-panel name="obj" ?active=${this.tab === "obj"}
          >${this.tab === "obj" ? this.renderObj() : nothing}</sl-tab-panel
        >
      </sl-tab-group>
      ${this.status ? html`<div class="status">${this.status}</div>` : nothing}
    `;
  }
}
