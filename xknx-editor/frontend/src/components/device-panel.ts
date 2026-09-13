import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  api,
  ApiError,
  type ComObject,
  type GroupAddress,
  type Job,
  type UiNode,
} from "../api.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import "./docs-view.js";
import { t as tr } from "../i18n.js";

type Device = {
  id: number;
  name: string;
  individual_address: string | null;
  product_ref_id?: string;
  hardware2program_ref_id?: string | null;
  product_name: string;
  manufacturer_name: string;
  order_number: string;
  hardware_name: string;
  description: string;
  serial_number?: string;
  last_download?: string | null;
  individual_address_loaded?: boolean;
  application_program_loaded?: boolean;
  parameters_loaded?: boolean;
  communication_part_loaded?: boolean;
  resolved: boolean;
  error?: string;
  application?: { id: string; name: string; version: string };
  dali?: boolean;
  parameter_count?: number;
  com_object_count?: number;
};

type Overview = {
  address: string;
  mask_version: string;
  manufacturer: string | null;
  application_number: number | null;
  application_version: number | null;
  serial_number: string | null;
  order_info: string | null;
  hardware_type: string | null;
  error_text: string | null;
  programming_mode: boolean | null;
};

type Preflight = {
  segments: {
    address: number;
    size: number;
    changed_bytes: number;
    ranges: { start: number; length: number }[];
    current: string;
    planned: string;
  }[];
  properties: {
    object_index: number;
    property_id: number;
    changed: boolean;
    current: string;
    planned: string;
  }[];
  changed_segments: number;
  changed_properties: number;
  changed_bytes: number;
};

type Memory = {
  segments: {
    id: string;
    base: number;
    size: number;
    hex: string;
    parameters: Record<string, { ref_id: string; value: string }>;
  }[];
};

const SCOPES: [string, string][] = [
  ["full", "Full download"],
  ["par", "Partial: parameters"],
  ["grp", "Partial: group communication"],
  ["ap1", "Application program"],
  ["unload", "Unload"],
];

/** Empty when the text is a valid KNX individual address, otherwise why it is not.
 * area 0-15, line 0-15, device 0-255; device 0 is the line coupler. */
export function individualAddressError(text: string): string {
  const value = text.trim();
  if (!value) return ""; // clearing the address is allowed
  const parts = value.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^\d{1,3}$/.test(p)))
    return tr("Use area.line.device, for example 1.1.5");
  const [area, line, device] = parts.map(Number);
  if (area > 15) return tr("Area must be 0-15");
  if (line > 15) return tr("Line must be 0-15");
  if (device > 255) return tr("Device must be 0-255");
  return "";
}

@customElement("xknx-device-panel")
export class DevicePanel extends LitElement {
  static styles = css`
    sl-button::part(label) {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    sl-button[circle] svg {
      display: block;
    }
    sl-input.invalid::part(form-control-help-text) {
      color: var(--ha-error);
    }

    :host {
      display: block;
      padding: 8px 16px 16px;
      font-size: 13px;
    }
    .grid {
      display: grid;
      grid-template-columns: 130px 1fr;
      gap: 6px 12px;
      align-items: center;
      max-width: 900px;
    }
    .grid label {
      color: var(--ha-text-2);
    }
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 8px 0;
      flex-wrap: wrap;
    }
    sl-details {
      margin: 10px 0;
    }
    sl-details::part(base) {
      background: var(--ha-card);
      border-radius: 8px;
    }
    table.info {
      border-collapse: collapse;
    }
    table.info th {
      text-align: left;
      font-weight: 400;
      color: var(--ha-text-2);
      padding: 2px 16px 2px 0;
      white-space: nowrap;
      vertical-align: top;
    }
    table.info td {
      padding: 2px 0;
      overflow-wrap: anywhere;
    }
    table.objects {
      border-collapse: collapse;
      width: 100%;
    }
    table.objects th,
    table.objects td {
      text-align: left;
      padding: 4px 8px;
      border-bottom: 1px solid var(--ha-divider);
      vertical-align: top;
      white-space: nowrap;
    }
    table.objects tr:hover td {
      background: color-mix(in srgb, var(--ha-text) 4%, transparent);
    }
    table.objects th {
      color: var(--ha-text-2);
      font-weight: 500;
      font-size: 12px;
    }
    td.num {
      font-variant-numeric: tabular-nums;
      color: var(--ha-text-2);
    }
    th.c,
    td.c {
      text-align: center;
    }
    .flags {
      display: inline-flex;
      gap: 2px;
    }
    .flag {
      width: 18px;
      height: 18px;
      border: 1px solid var(--ha-divider);
      border-radius: 4px;
      font-size: 11px;
      display: inline-grid;
      place-items: center;
      cursor: pointer;
      color: var(--ha-text-2);
      background: transparent;
      font-family: inherit;
    }
    .flag.on {
      background: color-mix(in srgb, var(--ha-primary) 22%, transparent);
      color: var(--ha-primary);
      border-color: transparent;
    }
    .flag:disabled {
      cursor: default;
      opacity: 0.5;
    }
    .ga {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 1px 6px;
      border-radius: 10px;
      background: color-mix(in srgb, var(--ha-text) 8%, transparent);
      margin: 1px 4px 1px 0;
      font-size: 12px;
    }
    .ga.sending {
      background: color-mix(in srgb, var(--ha-success) 22%, transparent);
    }
    .ga a {
      cursor: pointer;
      color: var(--ha-primary);
    }
    .ga button {
      border: 0;
      background: transparent;
      padding: 0;
      cursor: pointer;
      color: inherit;
      display: inline-flex;
    }
    .dpt {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .warn {
      color: var(--ha-warning);
      padding: 12px 0;
    }
    .muted {
      color: var(--ha-text-2);
    }
    pre.hex {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
      background: color-mix(in srgb, var(--ha-text) 6%, transparent);
      padding: 8px;
      border-radius: 6px;
      overflow: auto;
      max-height: 50vh;
      white-space: pre;
    }
    .diff {
      color: var(--ha-warning);
      font-weight: 600;
    }
  `;

  @property({ type: Number }) deviceId = 0;
  @state() private device: Device | null = null;
  @state() private tree: UiNode[] = [];
  @state() private comObjects: ComObject[] = [];
  @state() private gas: GroupAddress[] = [];
  @state() private linkFor: ComObject | null = null;
  @state() private paramFilter = "";
  @state() private scope = "full";
  @state() private busy: string | null = null;
  // Documents for this device: the panel shows the list open when there is something in it,
  // unless the user folded it away (`docsOpen` stays null until they touch it).
  @state() private docCount = 0;
  @state() private docsOpen: boolean | null = null;
  @state() private progress: { value: number | null; stage: string } | null =
    null;
  @state() private overview: Overview | null = null;
  @state() private preflight: Preflight | null = null;
  @state() private memory: Memory | null = null;
  @state() private confirmProgram = false;
  @state() private assignDialog = false;
  // Devices currently in programming mode, polled while the assign dialog is open: assigning by
  // programming button needs exactly one, and waiting for the press beats failing on the bus.
  @state() private inProgramming: string[] | null = null;
  @state() private assignSerial = "";
  private programmingPoll: number | undefined;
  @state() private addressError = "";
  private unsubscribe = () => {};
  private loaded = { id: -1, rev: -1 };

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = store.subscribe(() => {
      this.requestUpdate();
      void this.sync();
    });
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    this.watchProgramming(false);
    super.disconnectedCallback();
  }

  /** Poll for devices in programming mode while the assign dialog is open. */
  private watchProgramming(on: boolean): void {
    window.clearInterval(this.programmingPoll);
    this.programmingPoll = undefined;
    if (!on) {
      this.inProgramming = null;
      return;
    }
    const read = async () => {
      try {
        const r = await api.get<{ items: string[] }>(
          "api/bus/programming-mode",
        );
        this.inProgramming = r.items;
      } catch {
        this.inProgramming = [];
      }
    };
    void read();
    this.programmingPoll = window.setInterval(read, 3000);
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has("deviceId")) {
      this.addressError = "";
      this.overview = null;
      this.preflight = null;
      void this.sync(true);
    }
  }

  private syncToken = 0;

  private async sync(force = false): Promise<void> {
    if (
      !force &&
      this.loaded.id === this.deviceId &&
      this.loaded.rev === store.revision
    )
      return;
    this.loaded = { id: this.deviceId, rev: store.revision };
    // Responses can arrive out of order when the user clicks through devices quickly; only the
    // latest request may update the panel.
    const token = ++this.syncToken;
    const id = this.deviceId;
    try {
      const device = await api.get<Device>(`api/devices/${id}`);
      if (token !== this.syncToken) return;
      this.device = device;
      if (device.resolved) {
        const [p, c] = await Promise.all([
          api.get<{ tree: UiNode[] }>(`api/devices/${id}/parameters`),
          api.get<{ items: ComObject[] }>(`api/devices/${id}/com-objects`),
        ]);
        if (token !== this.syncToken) return;
        this.tree = p.tree;
        this.comObjects = c.items;
      } else {
        this.tree = [];
        this.comObjects = [];
      }
    } catch (e) {
      if (token !== this.syncToken) return;
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    }
  }

  private async act(fn: () => Promise<unknown>, done?: string): Promise<void> {
    try {
      await fn();
      if (done) store.say(done, "success");
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
      await this.sync(true);
    }
  }

  private async busAction(
    label: string,
    fn: () => Promise<unknown>,
  ): Promise<void> {
    this.busy = label;
    this.progress = null;
    try {
      await fn();
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    } finally {
      this.busy = null;
      this.progress = null;
    }
  }

  private async job(start: () => Promise<Job>): Promise<Job> {
    let job = await start();
    while (job.status === "queued" || job.status === "running") {
      await new Promise((r) => setTimeout(r, 500));
      job = await api.get<Job>(`api/jobs/${job.id}`);
      this.progress = { value: job.progress, stage: job.stage };
    }
    if (job.status === "failed") throw new ApiError(500, job.error ?? "failed");
    return job;
  }

  private onParam(e: CustomEvent<{ refId: string; value: string }>): void {
    void this.act(() =>
      api.post(`api/devices/${this.deviceId}/parameter`, {
        ref_id: e.detail.refId,
        value: e.detail.value,
      }),
    );
  }

  private async openLink(co: ComObject): Promise<void> {
    this.gas = (
      await api.get<{ items: GroupAddress[] }>("api/group-addresses")
    ).items;
    this.linkFor = co;
  }

  private link(sending: boolean): void {
    const sel = this.renderRoot.querySelector(
      "#link-ga",
    ) as HTMLSelectElement | null;
    const co = this.linkFor;
    if (!co || !sel?.value) return;
    this.linkFor = null;
    void this.act(
      () =>
        api.post(`api/devices/${this.deviceId}/com-objects/link`, {
          ref_id: co.ref_id,
          group_address_id: Number(sel.value),
          sending,
        }),
      "Linked",
    );
  }

  private filterTree(nodes: UiNode[]): UiNode[] {
    const q = this.paramFilter.trim().toLowerCase();
    if (!q) return nodes;
    const walk = (list: UiNode[]): UiNode[] =>
      list.flatMap((n) => {
        if (n.type === "parameter")
          return n.label.toLowerCase().includes(q) ? [n] : [];
        if (n.type === "tab" || n.type === "block") {
          const children = walk(n.children);
          return children.length ? [{ ...n, children } as UiNode] : [];
        }
        return [];
      });
    return walk(nodes);
  }

  private countParams(nodes: UiNode[]): number {
    return nodes.reduce(
      (n, x) =>
        n +
        (x.type === "parameter"
          ? 1
          : "children" in x
            ? this.countParams(x.children)
            : 0),
      0,
    );
  }

  private async fetchProduct(): Promise<void> {
    const d = this.device;
    if (!d?.hardware2program_ref_id) return;
    await this.busAction("fetch", async () => {
      const job = await this.job(() =>
        api.post<Job>("api/catalog/online/fetch-missing", {
          refs: [d.hardware2program_ref_id],
        }),
      );
      const r = job.result as {
        item_ids: string[];
        unmatched: string[];
        applications_added: string[];
      };
      if (r.item_ids.length) {
        store.say(
          `Downloaded ${r.item_ids.length} product(s), ${r.applications_added.length} application(s) added`,
          "success",
        );
        await store.refresh();
        await this.sync(true);
      } else {
        store.say(
          tr(
            "The KNX online catalog has no downloadable product for this program reference. Try the catalog search or upload the .knxprod from the manufacturer.",
          ),
          "primary",
        );
      }
    });
  }

  private async manual(): Promise<void> {
    await this.busAction("manual", async () => {
      const r = await api.get<{
        url: string | null;
        source: string;
        search: string;
      }>(`api/devices/${this.deviceId}/manual`);
      const url = r.url ?? r.search;
      window.open(url, "_blank", "noopener");
      if (!r.url)
        store.say(
          tr("No manual found; opened a web search for this device instead"),
          "primary",
        );
    });
  }

  render() {
    const d = this.device;
    if (!d) return html`<sl-spinner></sl-spinner>`;
    const connected = store.bus.state === "CONNECTED";
    const busTitle = connected ? "" : "Connect to a gateway first (top right)";
    return html`
      <div class="grid">
        <label>${tr("Name")}</label>
        <sl-input
          size="small"
          value=${d.name}
          @sl-change=${(e: Event) => this.act(() => api.patch(`api/devices/${d.id}`, { name: (e.target as HTMLInputElement).value }))}
        ></sl-input>
        <label>${tr("Individual address")}</label>
        <sl-input
          size="small"
          value=${d.individual_address ?? ""}
          placeholder="1.1.5"
          style="max-width:160px"
          help-text=${this.addressError}
          class=${this.addressError ? "invalid" : ""}
          @sl-input=${(e: Event) => (this.addressError = individualAddressError((e.target as HTMLInputElement).value))}
          @sl-change=${(e: Event) => {
            const value = (e.target as HTMLInputElement).value;
            const problem = individualAddressError(value);
            this.addressError = problem;
            if (problem) return; // keep the typed value on screen so it can be corrected
            void this.act(() =>
              api.patch(`api/devices/${d.id}`, { individual_address: value }),
            );
          }}
        ></sl-input>
        <label>${tr("Download")}</label>
        <sl-select
          size="small"
          value=${this.scope}
          hoist
          style="max-width:280px"
          @sl-change=${(e: Event) => (this.scope = (e.target as HTMLSelectElement).value)}
          >${SCOPES.map(([v, l]) => html`<sl-option value=${v}>${tr(l)}</sl-option>`)}</sl-select
        >
      </div>
      <div class="row">
        <sl-tooltip
          content=${busTitle || tr("Read the device and show every byte a download would change, without writing")}
        >
          <sl-button
            size="small"
            ?disabled=${!connected || !d.resolved || this.busy !== null}
            ?loading=${this.busy === "preflight"}
            @click=${() =>
              this.busAction("preflight", async () => {
                const j = await this.job(() =>
                  api.post<Job>(`api/devices/${d.id}/preflight`, {
                    scope: this.scope,
                  }),
                );
                this.preflight = j.result as Preflight;
              })}
            >${tr("Test before programming")}</sl-button
          >
        </sl-tooltip>
        <sl-tooltip
          content=${busTitle || tr("Write the configuration to the device")}
        >
          <sl-button
            size="small"
            variant="primary"
            ?disabled=${!connected || !d.resolved || this.busy !== null}
            @click=${() => (this.confirmProgram = true)}
            >${tr("Program device")}</sl-button
          >
        </sl-tooltip>
        <sl-button
          size="small"
          ?disabled=${!d.resolved}
          ?loading=${this.busy === "memory"}
          @click=${() =>
            this.busAction("memory", async () => {
              this.memory = await api.get<Memory>(`api/devices/${d.id}/memory`);
            })}
          >${tr("Preview memory")}</sl-button
        >
        ${this.progress ? html`<span class="muted">${this.progress.stage}${this.progress.value !== null ? ` ${Math.round(this.progress.value * 100)}%` : ""}</span>` : nothing}
      </div>

      <div class="row">
        <sl-tooltip
          content=${busTitle || tr("Read mask, application, serial number and error state from the device")}
        >
          <sl-button
            size="small"
            ?disabled=${!connected || this.busy !== null}
            ?loading=${this.busy === "read"}
            @click=${() =>
              this.busAction("read", async () => {
                this.overview = await api.post<Overview>(
                  `api/devices/${d.id}/read`,
                  {},
                );
              })}
            >${tr("Read from device")}</sl-button
          >
        </sl-tooltip>
        <sl-tooltip
          content=${busTitle || tr("Write this address into a device in programming mode (press its programming button first)")}
        >
          <sl-button
            size="small"
            ?disabled=${!connected || !d.individual_address || this.busy !== null}
            ?loading=${this.busy === "assign"}
            @click=${() => {
              this.assignSerial = "";
              this.assignDialog = true;
              this.watchProgramming(true);
            }}
            >${tr("Assign address")}</sl-button
          >
        </sl-tooltip>
        <sl-tooltip content=${busTitle || tr("Restart the device")}>
          <sl-button
            size="small"
            ?disabled=${!connected || this.busy !== null}
            ?loading=${this.busy === "restart"}
            @click=${() =>
              this.busAction("restart", async () => {
                await api.post(`api/devices/${d.id}/restart`, {});
                store.say(tr("Restart sent"), "success");
              })}
            >${tr("Restart")}</sl-button
          >
        </sl-tooltip>
        <sl-tooltip
          content=${tr("Unload the application (select scope Unload, then Program device)")}
          ><sl-button size="small" disabled
            >${tr("Reset…")}</sl-button
          ></sl-tooltip
        >
      </div>
      <sl-details summary=${tr("Manufacturer")} open>
        <table class="info">
          <tr>
            <th>${tr("Manufacturer")}</th>
            <td>${d.manufacturer_name || "-"}</td>
          </tr>
          <tr>
            <th>${tr("Application")}</th>
            <td>
              <code>${d.application?.id ?? "-"}</code
              >${d.application ? html` · ${d.application.name}` : nothing}
            </td>
          </tr>
          <tr>
            <th>${tr("Application version")}</th>
            <td>${d.application?.version ?? "-"}</td>
          </tr>
          <tr>
            <th>${tr("Order number")}</th>
            <td>${d.order_number || "-"}</td>
          </tr>
          <tr>
            <th>${tr("Hardware")}</th>
            <td>${d.hardware_name || "-"}</td>
          </tr>
          <tr>
            <th>${tr("Product")}</th>
            <td>${d.product_name || "-"}</td>
          </tr>
          <tr>
            <th>${tr("Description")}</th>
            <td>${d.description || "-"}</td>
          </tr>
          <tr>
            <th>${tr("Product ref")}</th>
            <td><code>${d.product_ref_id ?? "-"}</code></td>
          </tr>
          <tr>
            <th>${tr("Program ref")}</th>
            <td><code>${d.hardware2program_ref_id ?? "-"}</code></td>
          </tr>
          <tr>
            <th>${tr("Loaded")}</th>
            <td>
              ${(["individual_address_loaded", "application_program_loaded", "parameters_loaded", "communication_part_loaded"] as const).map((k) => html`<sl-badge variant=${d[k] ? "success" : "neutral"} pill>${tr(k.replace(/_loaded$/, "").replace(/_/g, " "))}</sl-badge> `)}${d.last_download ? html`<span class="muted">${tr("last download")} ${d.last_download.replace("T", " ").slice(0, 16)}</span>` : nothing}
            </td>
          </tr>
          ${
            d.serial_number
              ? html`<tr>
                  <th>${tr("Serial number")}</th>
                  <td>${d.serial_number}</td>
                </tr>`
              : nothing
          }
        </table>
        <details
          style="margin-top:10px"
          ?open=${this.docsOpen ?? this.docCount > 0}
          @toggle=${(e: Event) => (this.docsOpen = (e.target as HTMLDetailsElement).open)}
        >
          <summary style="cursor:pointer;color:var(--ha-text-2)">
            ${tr("Documents")} —
            ${d.order_number || d.name}${this.docCount ? ` (${this.docCount})` : ""}
          </summary>
          <xknx-docs-view
            compact
            tag=${d.order_number || ""}
            @docs-count=${(e: CustomEvent<{ count: number }>) => (this.docCount = e.detail.count)}
          ></xknx-docs-view>
        </details>
        <div class="row">
          <sl-button
            size="small"
            ?loading=${this.busy === "manual"}
            @click=${this.manual}
            >${icon("search", 14)} ${tr("Find manual")}</sl-button
          >
          <sl-button
            size="small"
            variant="danger"
            outline
            @click=${() => {
              if (
                !confirm(
                  `${tr("Remove")} ${d.individual_address ?? ""} ${d.name} ${tr("from the project? Its parameters and links are removed with it; the bus device is not touched.")}`,
                )
              )
                return;
              void this.act(async () => {
                await api.delete(`api/devices/${d.id}`);
                store.select(null);
              }, "Device removed");
            }}
            >${icon("trash", 14)} ${tr("Remove device from project")}</sl-button
          >
        </div>
      </sl-details>

      ${this.overview ? this.renderOverview(this.overview) : nothing}
      ${this.preflight ? this.renderPreflight(this.preflight) : nothing}
      ${
        d.resolved
          ? html`<sl-tab-group>
              <sl-tab slot="nav" panel="parameters"
                >${tr("Parameters")}
                (${d.parameter_count ?? this.countParams(this.tree)})</sl-tab
              >
              <sl-tab slot="nav" panel="objects"
                >${tr("Group objects")} (${this.comObjects.length})</sl-tab
              >
              ${d.dali ? html`<sl-tab slot="nav" panel="dali">${tr("DALI bus")}</sl-tab>` : nothing}
              <sl-tab-panel name="parameters">
                <sl-input
                  size="small"
                  placeholder=${tr("Filter parameters…")}
                  clearable
                  style="max-width:420px;margin-bottom:8px"
                  @sl-input=${(e: Event) => (this.paramFilter = (e.target as HTMLInputElement).value)}
                ></sl-input>
                <xknx-parameter-tree
                  .nodes=${this.filterTree(this.tree)}
                  @param-change=${this.onParam}
                ></xknx-parameter-tree>
              </sl-tab-panel>
              <sl-tab-panel name="objects"
                >${this.renderObjects()}</sl-tab-panel
              >
              ${d.dali ? html`<sl-tab-panel name="dali"><xknx-dali-panel .deviceId=${d.id}></xknx-dali-panel></sl-tab-panel>` : nothing}
            </sl-tab-group>`
          : html`<div class="warn">
              ${d.error ?? "Application not in the catalog."}
              <div class="row">
                <sl-button
                  size="small"
                  variant="primary"
                  ?loading=${this.busy === "fetch"}
                  @click=${this.fetchProduct}
                  >${icon("download", 14)}
                  ${tr("Fetch product data online")}</sl-button
                >
                <sl-button
                  size="small"
                  @click=${() => store.openCatalog(d.order_number || d.product_name, d.manufacturer_name)}
                  >${icon("search", 14)} Open catalog for
                  ${d.order_number || d.product_name}</sl-button
                >
              </div>
            </div>`
      }
      ${this.renderLinkDialog()} ${this.renderProgramDialog()}
      ${this.renderMemoryDialog()}
    `;
  }

  private renderOverview(o: Overview) {
    return html`<sl-details summary="Read from device ${o.address}" open>
      <table class="info">
        <tr>
          <th>${tr("Mask version")}</th>
          <td>${o.mask_version}</td>
        </tr>
        <tr>
          <th>${tr("Application")}</th>
          <td>
            ${o.manufacturer ?? "-"} · number ${o.application_number ?? "-"} ·
            version ${o.application_version ?? "-"}
          </td>
        </tr>
        <tr>
          <th>${tr("Serial number")}</th>
          <td>${o.serial_number ?? "-"}</td>
        </tr>
        <tr>
          <th>${tr("Order info")}</th>
          <td>${o.order_info ?? "-"}</td>
        </tr>
        <tr>
          <th>${tr("Hardware type")}</th>
          <td>${o.hardware_type ?? "-"}</td>
        </tr>
        <tr>
          <th>${tr("Error state")}</th>
          <td>${o.error_text ?? "-"}</td>
        </tr>
        <tr>
          <th>${tr("Programming mode")}</th>
          <td>
            ${o.programming_mode === null ? "-" : o.programming_mode ? "on" : "off"}
          </td>
        </tr>
      </table>
    </sl-details>`;
  }

  private renderPreflight(p: Preflight) {
    return html`<sl-details
      summary="Test result: ${p.changed_bytes} byte(s) in ${p.changed_segments} segment(s) and ${p.changed_properties} propert${p.changed_properties === 1 ? "y" : "ies"} would change"
      open
    >
      ${p.changed_bytes === 0 && p.changed_properties === 0 ? html`<p class="muted">${tr("The device already holds this configuration.")}</p>` : nothing}
      ${p.segments
        .filter((s) => s.changed_bytes)
        .map(
          (s) =>
            html`<p>
                <b>Segment 0x${s.address.toString(16).toUpperCase()}</b> ·
                ${s.size} bytes · ${s.changed_bytes} changed
              </p>
              <pre class="hex">
${this.hexDiff(s.current, s.planned, s.address)}</pre>`,
        )}
      ${p.properties.filter((x) => x.changed).map((x) => html`<p><b>${tr("Property")}</b> object ${x.object_index} · PID ${x.property_id}: <code>${x.current || "∅"}</code> → <code class="diff">${x.planned}</code></p>`)}
    </sl-details>`;
  }

  private hexDiff(current: string, planned: string, base: number) {
    const cur = current.match(/../g) ?? [];
    const pl = planned.match(/../g) ?? [];
    const lines = [];
    for (let i = 0; i < Math.max(cur.length, pl.length); i += 16) {
      const addr = (base + i).toString(16).toUpperCase().padStart(4, "0");
      const cells = [];
      for (let j = i; j < i + 16 && j < pl.length; j++) {
        const changed = cur[j] !== pl[j];
        cells.push(
          changed
            ? html`<span class="diff">${pl[j].toUpperCase()}</span>`
            : pl[j].toUpperCase(),
        );
        cells.push(" ");
      }
      lines.push(html`${addr} ${cells} `);
    }
    return lines;
  }

  private renderObjects() {
    const flag = (co: ComObject, key: string, letter: string, title: string) =>
      html`<button
        class="flag ${co.flags[key] ? "on" : ""}"
        title=${title}
        ?disabled=${co.locked[key] === true}
        @click=${() => this.act(() => api.post(`api/devices/${this.deviceId}/com-objects/flag`, { ref_id: co.ref_id, flag: key, value: !co.flags[key] }))}
      >
        ${co.flags[key] ? letter : "–"}
      </button>`;
    return html`<div style="overflow-x:auto">
      <table class="objects">
        <tr>
          <th>${tr("Number")}</th>
          <th>${tr("Name")}</th>
          <th>${tr("Object function")}</th>
          <th>${tr("Linked with")}</th>
          <th>${tr("Group address")}</th>
          <th>${tr("Length")}</th>
          <th class="c" title=${tr("Communication")}>C</th>
          <th class="c" title="Read">R</th>
          <th class="c" title=${tr("Write")}>W</th>
          <th class="c" title=${tr("Transmit")}>T</th>
          <th class="c" title=${tr("Update")}>U</th>
          <th>${tr("Data type")}</th>
          <th>${tr("Priority")}</th>
        </tr>
        ${this.comObjects.map(
          (co) =>
            html`<tr>
              <td class="num">${co.number}</td>
              <td>${co.name}</td>
              <td class="muted">
                ${co.function_text && co.function_text !== co.name ? co.function_text : ""}
              </td>
              <td>
                ${co.links.map((l) => html`<div>${l.name || html`<span class="muted">-</span>`}</div>`)}
              </td>
              <td>
                ${co.links.map(
                  (l) =>
                    html`<span
                      class="ga ${l.is_sending ? "sending" : ""}"
                      title=${l.is_sending ? "sending address" : "listening address"}
                      ><a
                        @click=${() => store.selectGroupAddress(l.group_address_id)}
                        >${l.text}</a
                      >
                      ${l.is_sending ? nothing : html`<button title=${tr("Make sending")} @click=${() => this.act(() => api.post(`api/links/${l.id}/sending`))}>S</button>`}
                      <button
                        title=${tr("Unlink")}
                        @click=${() => this.act(() => api.delete(`api/links/${l.id}`))}
                      >
                        ${icon("unlink", 12)}
                      </button></span
                    >`,
                )}
                <sl-button
                  size="small"
                  circle
                  title=${tr("Link a group address")}
                  @click=${() => this.openLink(co)}
                  >${icon("link", 12)}</sl-button
                >
              </td>
              <td class="muted">${co.object_size}</td>
              <td class="c">
                ${flag(co, "communication", "C", "Communication")}
              </td>
              <td class="c">${flag(co, "read", "R", "Read")}</td>
              <td class="c">${flag(co, "write", "W", "Write")}</td>
              <td class="c">${flag(co, "transmit", "T", "Transmit")}</td>
              <td class="c">${flag(co, "update", "U", "Update")}</td>
              <td class="dpt">
                ${co.dpt_codes.join(", ") || html`<span class="muted">-</span>`}
              </td>
              <td class="muted">${co.priority || "Low"}</td>
            </tr>`,
        )}
      </table>
    </div>`;
  }

  private renderLinkDialog() {
    const co = this.linkFor;
    return html`<sl-dialog
      label=${co ? `Link ${co.number} ${co.name}` : "Link"}
      ?open=${co !== null}
      @sl-after-hide=${() => (this.linkFor = null)}
    >
      <div class="row">
        <sl-select
          id="link-ga"
          hoist
          placeholder=${tr("Group address")}
          style="flex:1"
        >
          ${this.gas.map((g) => html`<sl-option value=${String(g.id)}>${g.text} ${g.name}${g.datapoint_type ? ` (${g.datapoint_type})` : ""}</sl-option>`)}
        </sl-select>
      </div>
      ${this.gas.length ? nothing : html`<span class="muted">No group addresses yet; create one under Group addresses.</span>`}
      <sl-button slot="footer" @click=${() => this.link(false)}
        >${tr("Link")}</sl-button
      >
      <sl-button slot="footer" variant="primary" @click=${() => this.link(true)}
        >${tr("Link as sending")}</sl-button
      >
    </sl-dialog>`;
  }

  /** What the bus says about programming mode, while the dialog waits for a button press. */
  private renderProgrammingState() {
    const found = this.inProgramming;
    if (found === null)
      return html`<p class="hint">
        ${tr("Looking for a device in programming mode…")}
      </p>`;
    if (found.length === 1)
      return html`<p class="hint" style="color:var(--ha-success)">
        ${tr("One device is in programming mode. It currently carries")}
        <strong>${found[0]}</strong>; ${tr("Assign writes")}
        <strong>${this.device?.individual_address ?? ""}</strong>
        ${tr("into it, replacing that address.")}
      </p>`;
    if (found.length > 1)
      return html`<p class="hint" style="color:var(--ha-warning)">
        ${found.length} ${tr("devices are in programming mode")}
        (${found.join(", ")}).
        ${tr("Leave exactly one, or give a serial number.")}
      </p>`;
    return html`<p class="hint">
      <sl-spinner style="font-size:12px;vertical-align:-1px"></sl-spinner>
      ${tr("Waiting: press the programming button on the device (its LED lights up). Nothing is written until one device answers.")}
    </p>`;
  }

  private renderProgramDialog() {
    const d = this.device;
    const scope = SCOPES.find(([v]) => v === this.scope)?.[1] ?? this.scope;
    return html`<sl-dialog
        label=${tr("Assign individual address")}
        ?open=${this.assignDialog}
        @sl-after-hide=${() => {
          this.assignDialog = false;
          this.watchProgramming(false);
        }}
      >
        <p class="hint">
          ${tr("Writes")}
          <strong>${this.device?.individual_address ?? ""}</strong>
          ${tr("into a device on the bus. Either press the programming button of exactly one device (its LED lights up) and leave the serial number empty, or enter the device's 6-byte serial number (printed on the device, e.g. 00 12 34 56 78 9A) to address it without programming mode.")}
        </p>
        <sl-input
          id="assign-serial"
          size="small"
          label=${tr("Serial number (optional)")}
          placeholder="001234 56789A"
          .value=${this.assignSerial}
          @sl-input=${(e: Event) => (this.assignSerial = (e.target as HTMLInputElement).value.trim())}
        ></sl-input>
        ${this.assignSerial ? nothing : this.renderProgrammingState()}
        <sl-button slot="footer" @click=${() => (this.assignDialog = false)}
          >${tr("Cancel")}</sl-button
        >
        <sl-button
          slot="footer"
          variant="primary"
          ?loading=${this.busy === "assign"}
          ?disabled=${!this.assignSerial && (this.inProgramming?.length ?? 0) !== 1}
          @click=${() => {
            const serial = this.assignSerial;
            this.assignDialog = false;
            this.watchProgramming(false);
            void this.busAction("assign", async () => {
              const r = await api.post<{ address: string; by_serial: boolean }>(
                `api/devices/${this.deviceId}/assign-address`,
                serial ? { serial } : {},
              );
              store.say(
                `Address ${r.address} written${r.by_serial ? " by serial number" : ""}`,
                "success",
              );
            });
          }}
          >${tr("Assign")}</sl-button
        >
      </sl-dialog>
      <sl-dialog
        label=${tr("Program device")}
        ?open=${this.confirmProgram}
        @sl-after-hide=${() => (this.confirmProgram = false)}
      >
        <p>
          ${scope} to <b>${d?.name}</b> at
          <code>${d?.individual_address ?? "no address"}</code> via
          ${store.bus.gateway?.name || store.bus.settings.gateway_ip || "the bus"}.
        </p>
        <p class="muted">
          This writes to the real device and cannot be undone. Run "Test before
          programming" first to see the changes.
        </p>
        ${this.scope === "full" ? html`<p class="muted">${tr("A full download also writes the individual address: if nothing answers at this address and exactly one device is in programming mode, that device is given the address first and then loaded.")}</p>` : nothing}
        <sl-button slot="footer" @click=${() => (this.confirmProgram = false)}
          >${tr("Cancel")}</sl-button
        >
        <sl-button
          slot="footer"
          variant="primary"
          ?loading=${this.busy === "program"}
          @click=${() => {
            this.confirmProgram = false;
            void this.busAction("program", async () => {
              await this.job(() =>
                api.post<Job>(`api/devices/${d!.id}/program`, {
                  scope: this.scope,
                }),
              );
              store.say(tr("Device programmed"), "success");
              this.preflight = null;
            });
          }}
          >${tr("Program")}</sl-button
        >
      </sl-dialog>`;
  }

  private renderMemoryDialog() {
    const m = this.memory;
    return html`<sl-dialog
      label=${tr("Memory preview")}
      ?open=${m !== null}
      style="--width: 860px"
      @sl-after-hide=${() => (this.memory = null)}
    >
      ${m?.segments.map(
        (s) =>
          html`<p>
              <b>${s.id}</b> · base 0x${s.base.toString(16).toUpperCase()} ·
              ${s.size} bytes · ${Object.keys(s.parameters).length} parameter(s)
            </p>
            <pre class="hex">${this.hexDump(s.hex, s.base)}</pre>`,
      )}
      ${m && !m.segments.length ? html`<p class="muted">${tr("This application has no memory segments to program (property based or none).")}</p>` : nothing}
    </sl-dialog>`;
  }

  private hexDump(hex: string, base: number): string {
    const bytes = hex.match(/../g) ?? [];
    const lines: string[] = [];
    for (let i = 0; i < bytes.length; i += 16) {
      const addr = (base + i).toString(16).toUpperCase().padStart(4, "0");
      const chunk = bytes.slice(i, i + 16);
      const ascii = chunk
        .map((b) => {
          const n = parseInt(b, 16);
          return n >= 32 && n < 127 ? String.fromCharCode(n) : ".";
        })
        .join("");
      lines.push(
        `${addr}  ${chunk
          .map((b) => b.toUpperCase())
          .join(" ")
          .padEnd(47)}  ${ascii}`,
      );
    }
    return lines.join("\n");
  }
}
