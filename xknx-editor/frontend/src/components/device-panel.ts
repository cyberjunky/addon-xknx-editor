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
import { dptTitle, formatDpt, onDptNames } from "../dpt-format.js";
import { icon } from "../icons.js";
import { deviceAddress, pictureKey, store } from "../store.js";
import "./device-connections.js";
import "./docs-view.js";
import "./telegram-list.js";
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
  comment?: string;
  comment_text?: string;
  installation_hints?: string;
  installation_hints_text?: string;
  serial_number?: string;
  last_download?: string | null;
  individual_address_loaded?: boolean;
  application_program_loaded?: boolean;
  parameters_loaded?: boolean;
  communication_part_loaded?: boolean;
  resolved: boolean;
  /** The product has no application program at all (a power supply): not something to flag. */
  no_application?: boolean;
  error?: string;
  application?: { id: string; name: string; version: string };
  dali?: boolean;
  parameter_count?: number;
  com_object_count?: number;
  space_id?: number | null;
  line?: string | null;
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
  ip_address?: string | null;
  mac_address?: string | null;
  friendly_name?: string | null;
  web_url?: string | null;
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

type Verify = Preflight & { compared: number; matches: boolean };

type Ping = {
  address: string;
  reachable: boolean;
  refused: boolean;
  rtt_ms: number | null;
  mask_version: string | null;
};

type Serial = { address: string; serial_number: string | null; error: string | null };

/** Text ETS wrote as RTF; the editor shows it as plain text and says so. */
export function isRtf(text: string | null | undefined): boolean {
  return !!text && text.trimStart().startsWith("{\\rtf");
}

/** A group address as text ("1/2/3", "1/515" or "2563") to its raw 16-bit value. */
export function gaValue(text: string): number | null {
  const parts = text.split("/").map(Number);
  if (parts.some((n) => !Number.isInteger(n))) return null;
  if (parts.length === 3) return (parts[0] << 11) | (parts[1] << 8) | parts[2];
  if (parts.length === 2) return (parts[0] << 11) | parts[1];
  return parts.length === 1 ? parts[0] : null;
}

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
    .picture {
      float: right;
      margin: 0 0 8px 16px;
    }
    .picture img {
      display: block;
      max-width: 180px;
      max-height: 140px;
      object-fit: contain;
      border-radius: 8px;
      background: #fff;
    }
    .add-picture {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 18px 16px;
      border: 1px dashed var(--ha-divider);
      border-radius: 8px;
      color: var(--ha-text-2);
      cursor: pointer;
      font-size: 12px;
    }
    .add-picture:hover {
      color: var(--ha-primary);
      border-color: var(--ha-primary);
    }
    sl-details::part(header) {
      padding: 8px 12px;
      font-weight: 600;
    }
    sl-details::part(content) {
      padding: 0 12px 10px;
    }
    .diag h4 {
      margin: 14px 0 4px;
      font-size: 13px;
      font-weight: 600;
    }
    .diag .row {
      margin: 4px 0;
      align-items: flex-end;
    }
    .diag .field {
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-size: 11px;
      color: var(--ha-text-2);
    }
    .diag .note {
      font-size: 12px;
      color: var(--ha-text-2);
      margin: 0 0 4px;
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
    sl-tab-group.device {
      --padding: 12px 0 0;
    }
    .devname {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 0 14px 0 2px;
      font-weight: 500;
      white-space: nowrap;
    }
    .devname .addr {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      color: var(--ha-text-2);
    }
    .ga-list {
      margin-top: 8px;
      max-height: 260px;
      overflow: auto;
      border: 1px solid var(--ha-divider);
      border-radius: 8px;
    }
    .ga-row {
      padding: 5px 10px;
      cursor: pointer;
      white-space: nowrap;
    }
    .ga-row:hover {
      background: color-mix(in srgb, var(--ha-primary) 10%, transparent);
    }
    .ga-row.picked {
      background: color-mix(in srgb, var(--ha-primary) 18%, transparent);
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
  // The link dialog: what was typed, and which address is picked (null while nothing is chosen).
  @state() private linkQuery = "";
  @state() private linkPick: number | null = null;
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
  /** The tab on show; kept so a re-render never leaves the group without an active panel. */
  @state() private tab = "overview";
  @state() private verify: Verify | null = null;
  @state() private ping: Ping | null = null;
  @state() private serials: Serial[] | null = null;
  @state() private serialLookup: {
    address: string | null;
    project_device: string | null;
  } | null = null;
  @state() private confirmUnassign = false;
  /** Document id of the device's picture (an image tagged with its order number). */
  @state() private picture: string | null = null;
  private pictureFor = "";
  /** The project's rooms, flattened for the Room select. */
  @state() private spaces: { id: number; name: string }[] = [];
  private spacesRev = -1;
  // Diagnostics: raw memory and property access.
  @state() private diagOutput: { label: string; hex: string }[] = [];
  private unsubscribeDpt = () => {};
  private unsubscribe = () => {};
  private loaded = { id: -1, rev: -1 };

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = store.subscribe(() => {
      this.requestUpdate();
      void this.sync();
    });
    this.unsubscribeDpt = onDptNames(() => this.requestUpdate());
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    this.unsubscribeDpt();
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
      this.verify = null;
      this.ping = null;
      this.diagOutput = [];
      void this.sync(true);
    }
    this.keepTab();
  }

  private async uploadPicture(e: Event, orderNumber: string): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const q = new URLSearchParams({ name: file.name, tag: orderNumber, picture: "1" });
      const res = await fetch(`api/docs?${q}`, { method: "PUT", body: file });
      if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error ?? res.statusText);
      store.docsChanged();
    } catch (err) {
      store.say(err instanceof ApiError ? err.message : String(err), "danger");
    }
  }

  /** Shoelace's tab group loses its active tab when tabs come and go under it (a device whose
   * product data resolves, switching between devices); show the remembered one, or the first. */
  private keepTab(): void {
    const group = this.renderRoot.querySelector("sl-tab-group") as
      | (HTMLElement & { show(panel: string): void })
      | null;
    if (!group) return;
    const panels = [...group.querySelectorAll("sl-tab-panel")].map(
      (p) => (p as HTMLElement).getAttribute("name") ?? "",
    );
    const wanted = panels.includes(this.tab) ? this.tab : "overview";
    const active = group.querySelector("sl-tab[active]")?.getAttribute("panel");
    if (active !== wanted)
      requestAnimationFrame(() => {
        try {
          group.show(wanted);
        } catch {
          /* not upgraded yet */
        }
      });
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
      void this.loadSpaces();
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
      // The device is gone (removed here or elsewhere): drop the selection instead of reporting
      // the 404 the refetch ran into.
      if (e instanceof ApiError && e.status === 404) {
        this.device = null;
        this.tree = [];
        this.comObjects = [];
        if (store.selectedDevice === id) store.select(null);
        return;
      }
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    }
  }

  /** The building tree as a flat list ("Home / Ground floor / Hall"), like the Device overview. */
  private async loadSpaces(): Promise<void> {
    if (this.spacesRev === store.revision) return;
    this.spacesRev = store.revision;
    try {
      const flatten = (
        nodes: { id: number; name: string; space_type: string; children: unknown[] }[],
        prefix = "",
      ): { id: number; name: string }[] =>
        nodes.flatMap((s) => {
          const label = `${prefix}${s.name || s.space_type}`;
          return [
            { id: s.id, name: label },
            ...flatten(
              s.children as { id: number; name: string; space_type: string; children: unknown[] }[],
              `${label} / `,
            ),
          ];
        });
      this.spaces = flatten(
        (await api.get<{ tree: { id: number; name: string; space_type: string; children: unknown[] }[] }>("api/spaces")).tree,
      );
    } catch {
      this.spaces = [];
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
    this.linkQuery = "";
    this.linkPick = null;
  }

  /** Addresses matching what was typed: by address (1/2, 1/2/3) or by name. */
  private linkMatches(): GroupAddress[] {
    const q = this.linkQuery.trim().toLowerCase();
    const list = q
      ? this.gas.filter(
          (g) => g.text.startsWith(q) || g.name.toLowerCase().includes(q),
        )
      : this.gas;
    return list.slice(0, 50);
  }

  /** A three-level address typed in full that no group address uses yet. */
  private newAddress(): string {
    const q = this.linkQuery.trim();
    if (!/^\d{1,2}\/\d\/\d{1,3}$/.test(q)) return "";
    return this.gas.some((g) => g.text === q) ? "" : q;
  }

  /** Create the typed address, then link the object to it. */
  private async createAndLink(sending: boolean): Promise<void> {
    const text = this.newAddress();
    const co = this.linkFor;
    if (!text || !co) return;
    const [main, middle, sub] = text.split("/").map(Number);
    this.linkFor = null;
    const dpt = co.dpt_codes[0] ?? null;
    await this.act(
      async () => {
        const ga = await api.post<GroupAddress>("api/group-addresses", {
          address: (main << 11) | (middle << 8) | sub,
          name: co.name,
          // The object's own datapoint type, the way a commissioning tool proposes it: without one
          // the monitor can only guess what the telegrams mean.
          datapoint_type: dpt,
        });
        await api.post(`api/devices/${this.deviceId}/com-objects/link`, {
          ref_id: co.ref_id,
          group_address_id: ga.id,
          sending,
        });
      },
      `Created ${text}${dpt ? ` (${dpt})` : ""} and linked it`,
    );
  }

  private link(sending: boolean): void {
    const co = this.linkFor;
    if (!co) return;
    if (this.linkPick === null) {
      if (this.newAddress()) void this.createAndLink(sending);
      return;
    }
    const id = this.linkPick;
    const picked = this.gas.find((g) => g.id === id);
    const dpt = co.dpt_codes[0] ?? null;
    // An address nobody typed yet takes the object's datapoint type; one that already has a type
    // keeps it, since the project may mean something else by it.
    const adopt = !!dpt && !!picked && !picked.datapoint_type;
    this.linkFor = null;
    void this.act(
      async () => {
        await api.post(`api/devices/${this.deviceId}/com-objects/link`, {
          ref_id: co.ref_id,
          group_address_id: id,
          sending,
        });
        if (adopt)
          await api.patch(`api/group-addresses/${id}`, { datapoint_type: dpt });
      },
      adopt ? `Linked, and ${picked!.text} took the object's ${dpt}` : "Linked",
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
    const params = d.parameter_count ?? this.countParams(this.tree);
    const shown = d.name || d.product_name || d.hardware_name;
    const key = `${pictureKey(d.order_number)}#${store.docsRevision}`;
    if (key !== this.pictureFor) {
      this.pictureFor = key;
      const want = pictureKey(d.order_number);
      void store.pictures().then((m) => (this.picture = want ? (m[want] ?? null) : null));
    }
    const linkedGas = [
      ...new Set(
        this.comObjects.flatMap((co) =>
          co.links
            .map((l) => gaValue(l.text))
            .filter((v): v is number => v !== null),
        ),
      ),
    ];
    return html`
      <sl-tab-group
        class="device"
        @sl-tab-show=${(e: CustomEvent<{ name: string }>) => {
          if (e.target === e.currentTarget) this.tab = e.detail.name;
        }}
      >
        <sl-tab slot="nav" panel="overview" ?active=${this.tab === "overview"}
          ><span class="devname"
            ><span class="addr">${deviceAddress(d.individual_address, d.line)}</span>
            ${shown}</span
          ></sl-tab
        >
        ${d.resolved ? html`<sl-tab slot="nav" panel="parameters" ?active=${this.tab === "parameters"}>${tr("Parameters")} (${params})</sl-tab><sl-tab slot="nav" panel="objects" ?active=${this.tab === "objects"}>${tr("Group objects")} (${this.comObjects.length})</sl-tab><sl-tab slot="nav" panel="connections" ?active=${this.tab === "connections"}>${tr("Connections")}</sl-tab>` : nothing}
        <sl-tab slot="nav" panel="telegrams" ?active=${this.tab === "telegrams"}
          >${tr("Telegrams")}</sl-tab
        >
        <sl-tab
          slot="nav"
          panel="diagnostics"
          ?active=${this.tab === "diagnostics"}
          >${tr("Diagnostics")}</sl-tab
        >
        ${d.resolved && d.dali ? html`<sl-tab slot="nav" panel="dali" ?active=${this.tab === "dali"}>${tr("DALI bus")}</sl-tab>` : nothing}
        <sl-tab-panel name="overview">
          <div class="picture">
            ${
              this.picture
                ? html`<a href="api/docs/${this.picture}/raw" target="_blank" rel="noopener" title=${tr("Open the picture")}><img src="api/docs/${this.picture}/raw" alt=${shown} /></a>`
                : d.order_number
                  ? html`<label class="add-picture" title=${tr("Upload a product picture; it is kept in Documents, tagged with the order number, and shown for every device with this order number")}>
                      ${icon("upload", 16)} ${tr("Add picture")}
                      <input type="file" accept="image/*" hidden @change=${(e: Event) => this.uploadPicture(e, d.order_number)} />
                    </label>`
                  : nothing
            }
          </div>
          <div class="grid">
            <label>${tr("Name")}</label>
            <sl-input
              size="small"
              value=${d.name}
              placeholder=${d.name ? "" : `${shown} (${tr("product name, the device has no name of its own")})`}
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
                  api.patch(`api/devices/${d.id}`, {
                    individual_address: value,
                  }),
                );
              }}
            ></sl-input>
            <label>${tr("Room")}</label>
            <sl-select
              size="small"
              hoist
              value=${d.space_id ?? ""}
              placeholder=${this.spaces.length ? tr("No room") : tr("No rooms in the project yet; add them in the Buildings tab")}
              style="max-width:280px"
              ?disabled=${!this.spaces.length}
              @sl-change=${(e: Event) => {
                const v = (e.target as HTMLSelectElement).value;
                void this.act(() => api.patch(`api/devices/${d.id}`, { space_id: v === "" ? null : Number(v) }));
              }}
            >
              <sl-option value="">${tr("No room")}</sl-option>
              ${this.spaces.map((sp) => html`<sl-option value=${String(sp.id)}>${sp.name}</sl-option>`)}
            </sl-select>
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
                  this.memory = await api.get<Memory>(
                    `api/devices/${d.id}/memory`,
                  );
                })}
              >${tr("Preview memory")}</sl-button
            >
            ${this.progress ? html`<span class="muted">${this.progress.stage}${this.progress.value !== null ? ` ${Math.round(this.progress.value * 100)}%` : ""}</span>` : nothing}
          </div>

          <div class="row">
            <sl-tooltip
              content=${busTitle || tr("Read mask, application, serial number, error state and, for IP devices, the IP address from the device")}
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
                  this.serials = null;
                  this.serialLookup = null;
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
          <div class="row">
            <sl-tooltip
              content=${busTitle || tr("Check that something answers at this address, and how fast")}
            >
              <sl-button
                size="small"
                ?disabled=${!connected || !d.individual_address || this.busy !== null}
                ?loading=${this.busy === "ping"}
                @click=${() =>
                  this.busAction("ping", async () => {
                    this.ping = await api.post<Ping>(
                      `api/devices/${d.id}/ping`,
                      {},
                    );
                  })}
                >${tr("Ping")}</sl-button
              >
            </sl-tooltip>
            <sl-tooltip
              content=${busTitle || tr("Flash the programming LED for a few seconds, to find the device in the cabinet")}
            >
              <sl-button
                size="small"
                ?disabled=${!connected || !d.individual_address || this.busy !== null}
                ?loading=${this.busy === "identify"}
                @click=${() =>
                  this.busAction("identify", async () => {
                    await api.post(`api/devices/${d.id}/identify`, {
                      seconds: 6,
                    });
                    store.say(tr("The programming LED flashed"), "success");
                  })}
                >${tr("Identify")}</sl-button
              >
            </sl-tooltip>
            <sl-tooltip
              content=${busTitle || tr("Read the device and compare it with what the project would write; nothing is written")}
            >
              <sl-button
                size="small"
                ?disabled=${!connected || !d.resolved || this.busy !== null}
                ?loading=${this.busy === "verify"}
                @click=${() =>
                  this.busAction("verify", async () => {
                    const j = await this.job(() =>
                      api.post<Job>(`api/devices/${d.id}/verify`, {}),
                    );
                    this.verify = j.result as Verify;
                  })}
                >${tr("Verify against project")}</sl-button
              >
            </sl-tooltip>
            <sl-tooltip
              content=${tr("Compare this device with other devices, parameter by parameter")}
            >
              <sl-button
                size="small"
                ?disabled=${!d.resolved}
                @click=${() => store.openCompare([d.id])}
                >${tr("Compare…")}</sl-button
              >
            </sl-tooltip>
            <sl-tooltip
              content=${tr("Take the individual address away in the project (the device stays on its line; the bus device is not touched)")}
            >
              <sl-button
                size="small"
                ?disabled=${!d.individual_address}
                @click=${() => (this.confirmUnassign = true)}
                >${tr("Unassign address")}</sl-button
              >
            </sl-tooltip>
          </div>
          ${this.ping ? this.renderPing(this.ping) : nothing}
          ${this.verify ? this.renderVerify(this.verify) : nothing}
          <sl-details summary=${tr("Description and notes")} ?open=${!!(d.description || d.comment || d.installation_hints)}>
            <div class="grid">
              <label>${tr("Description")}</label>
              <sl-input
                size="small"
                value=${d.description ?? ""}
                @sl-change=${(e: Event) => this.act(() => api.patch(`api/devices/${d.id}`, { description: (e.target as HTMLInputElement).value }))}
              ></sl-input>
              <label>${tr("Comment")}</label>
              <sl-textarea
                size="small"
                rows="3"
                resize="auto"
                value=${d.comment_text ?? d.comment ?? ""}
                help-text=${isRtf(d.comment) ? tr("Formatted in ETS; saving an edit keeps the text and drops the formatting.") : ""}
                @sl-change=${(e: Event) => this.act(() => api.patch(`api/devices/${d.id}`, { comment: (e.target as HTMLTextAreaElement).value }))}
              ></sl-textarea>
              <label>${tr("Installation hints")}</label>
              <sl-textarea
                size="small"
                rows="2"
                resize="auto"
                value=${d.installation_hints_text ?? d.installation_hints ?? ""}
                help-text=${isRtf(d.installation_hints) ? tr("Formatted in ETS; saving an edit keeps the text and drops the formatting.") : ""}
                @sl-change=${(e: Event) => this.act(() => api.patch(`api/devices/${d.id}`, { installation_hints: (e.target as HTMLTextAreaElement).value }))}
              ></sl-textarea>
            </div>
          </sl-details>
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
                >${icon("trash", 14)}
                ${tr("Remove device from project")}</sl-button
              >
            </div>
          </sl-details>

          ${this.overview ? this.renderOverview(this.overview) : nothing}
          ${this.preflight ? this.renderPreflight(this.preflight) : nothing}
          ${
            d.resolved
              ? nothing
              : d.no_application
                ? html`<div class="muted" style="padding:12px 0">
                    ${tr("This product has no application program (a power supply or a plain coupler, for instance): it carries no parameters and no group objects, and is in the project for the topology and the bus load.")}
                  </div>`
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
        </sl-tab-panel>
        ${
          d.resolved
            ? html`<sl-tab-panel name="parameters">
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
                <sl-tab-panel name="connections"
                  >${this.tab === "connections" ? html`<xknx-device-connections .deviceId=${d.id}></xknx-device-connections>` : nothing}</sl-tab-panel
                >
                ${d.dali ? html`<sl-tab-panel name="dali"><xknx-dali-panel .deviceId=${d.id}></xknx-dali-panel></sl-tab-panel>` : nothing}`
            : nothing
        }
        <sl-tab-panel name="telegrams"
          >${this.tab === "telegrams" ? html`<xknx-telegram-list .deviceId=${d.id} .address=${d.individual_address ?? ""} .gas=${linkedGas}></xknx-telegram-list>` : nothing}</sl-tab-panel
        >
        <sl-tab-panel name="diagnostics"
          >${this.tab === "diagnostics" ? this.renderDiagnostics(d, connected, busTitle) : nothing}</sl-tab-panel
        >
      </sl-tab-group>
      ${this.renderLinkDialog()} ${this.renderProgramDialog()}
      ${this.renderMemoryDialog()} ${this.renderUnassignDialog()}
    `;
  }

  private renderPing(p: Ping) {
    const text = !p.reachable
      ? tr("Nothing answered at this address.")
      : p.refused
        ? tr("Something is there, but it refused the connection (busy, or another tool has it open).")
        : `${tr("Answered in")} ${p.rtt_ms} ms · ${tr("mask")} ${p.mask_version}`;
    return html`<p class="row">
      <sl-badge variant=${p.reachable ? "success" : "danger"} pill
        >${p.reachable ? tr("reachable") : tr("no answer")}</sl-badge
      >
      <span class="addr">${p.address}</span> ${text}
    </p>`;
  }

  private renderVerify(v: Verify) {
    const summary = v.matches
      ? tr("The device holds what the project would write.")
      : v.compared === 0
        ? tr("Nothing could be compared: the application defines no memory or properties to read back.")
        : `${tr("The device differs from the project")}: ${v.changed_bytes} ${tr("byte(s) and")} ${v.changed_properties} ${tr("propert(y/ies)")}. ${tr("Program the device to bring it in line.")}`;
    return html`<sl-details open>
      <span slot="summary"
        ><sl-badge variant=${v.matches ? "success" : "warning"} pill
          >${v.matches ? tr("matches") : tr("differs")}</sl-badge
        >
        ${tr("Verified against the project")}</span
      >
      <p>${summary}</p>
      ${v.matches ? nothing : this.renderPreflightBody(v)}
    </sl-details>`;
  }

  private async diag(label: string, path: string, body: Record<string, unknown>): Promise<void> {
    await this.busAction("diag", async () => {
      const r = await api.post<{ hex?: string; verified?: boolean }>(
        `api/devices/${this.deviceId}/${path}`,
        body,
      );
      this.diagOutput = [
        { label, hex: r.hex ?? (r.verified ? tr("written and read back") : tr("written")) },
        ...this.diagOutput,
      ].slice(0, 20);
    });
  }

  private num(id: string): number {
    const raw = (this.renderRoot.querySelector(`#${id}`) as HTMLInputElement | null)?.value.trim() ?? "";
    return raw.toLowerCase().startsWith("0x") ? parseInt(raw, 16) : Number(raw);
  }

  private text(id: string): string {
    return (this.renderRoot.querySelector(`#${id}`) as HTMLInputElement | null)?.value.trim() ?? "";
  }

  private renderDiagnostics(d: Device, connected: boolean, busTitle: string) {
    const disabled = !connected || !d.individual_address || this.busy !== null;
    return html`<div class="diag">
      <p class="note">
        ${tr("Direct access to the device's memory and interface-object properties, for troubleshooting. Reads are harmless; writes change the device immediately and are not part of the project.")}
        ${busTitle ? html`<br />${busTitle}` : nothing}
      </p>
      <h4>${tr("Memory")}</h4>
        <div class="row">
          <label class="field">${tr("Start (hex with 0x)")}<sl-input id="mem-start" size="small" value="0x0000" style="width:140px"></sl-input></label>
          <label class="field">${tr("Bytes")}<sl-input id="mem-count" size="small" type="number" min="1" max="4096" value="16" style="width:100px"></sl-input></label>
          <sl-button size="small" ?disabled=${disabled} ?loading=${this.busy === "diag"}
            @click=${() => {
              const start = this.num("mem-start");
              const count = this.num("mem-count");
              void this.diag(`${tr("Memory")} 0x${start.toString(16).toUpperCase()} +${count}`, "memory/read", { start, count });
            }}>${tr("Read")}</sl-button>
        </div>
        <div class="row">
          <label class="field">${tr("Data to write (hex bytes)")}<sl-input id="mem-data" size="small" placeholder="01 02 FF" style="min-width:260px"></sl-input></label>
          <sl-button size="small" variant="danger" outline ?disabled=${disabled}
            @click=${() => {
              const start = this.num("mem-start");
              const data = this.text("mem-data");
              if (!data || !confirm(`${tr("Write")} ${data} ${tr("at")} 0x${start.toString(16).toUpperCase()} ${tr("into")} ${d.individual_address}? ${tr("This changes the device immediately.")}`)) return;
              void this.diag(`${tr("Memory write")} 0x${start.toString(16).toUpperCase()}`, "memory/write", { start, data });
            }}>${tr("Write")}</sl-button>
        </div>

      <h4>${tr("Property")}</h4>
        <div class="row">
          <label class="field">${tr("Object index")}<sl-input id="prop-obj" size="small" type="number" min="0" max="255" value="0" style="width:110px"></sl-input></label>
          <label class="field">${tr("Property id")}<sl-input id="prop-pid" size="small" type="number" min="0" max="255" value="11" style="width:110px"></sl-input></label>
          <label class="field">${tr("Count")}<sl-input id="prop-count" size="small" type="number" min="0" max="15" value="1" style="width:90px"></sl-input></label>
          <label class="field">${tr("Start index")}<sl-input id="prop-start" size="small" type="number" min="0" max="4095" value="1" style="width:100px"></sl-input></label>
          <sl-button size="small" ?disabled=${disabled} ?loading=${this.busy === "diag"}
            @click=${() => {
              const body = { object_index: this.num("prop-obj"), property_id: this.num("prop-pid"), count: this.num("prop-count"), start_index: this.num("prop-start") };
              void this.diag(`${tr("Property")} ${body.object_index}/${body.property_id}`, "property/read", body);
            }}>${tr("Read")}</sl-button>
        </div>
        <div class="row">
          <label class="field">${tr("Data to write (hex bytes)")}<sl-input id="prop-data" size="small" placeholder="01" style="min-width:260px"></sl-input></label>
          <sl-button size="small" variant="danger" outline ?disabled=${disabled}
            @click=${() => {
              const body = { object_index: this.num("prop-obj"), property_id: this.num("prop-pid"), count: Math.max(1, this.num("prop-count")), start_index: Math.max(1, this.num("prop-start")), data: this.text("prop-data") };
              if (!body.data || !confirm(`${tr("Write")} ${body.data} ${tr("to property")} ${body.object_index}/${body.property_id} ${tr("of")} ${d.individual_address}? ${tr("This changes the device immediately.")}`)) return;
              void this.diag(`${tr("Property write")} ${body.object_index}/${body.property_id}`, "property/write", body);
            }}>${tr("Write")}</sl-button>
        </div>
        <p class="note">${tr("Common Device Object (index 0) properties: 11 serial number, 12 manufacturer, 13 program version, 15 order info, 54 programming mode, 56 max APDU length, 78 hardware type.")}</p>

      ${this.diagOutput.length ? html`<pre class="hex">${this.diagOutput.map((o) => `${o.label}\n  ${o.hex.match(/.{1,2}/g)?.join(" ") ?? o.hex}\n`).join("")}</pre>` : nothing}
    </div>`;
  }

  private renderUnassignDialog() {
    const d = this.device;
    return html`<sl-dialog
      label=${tr("Unassign address")}
      ?open=${this.confirmUnassign}
      @sl-after-hide=${() => (this.confirmUnassign = false)}
    >
      <p>
        ${tr("Take the address")} <b>${d?.individual_address ?? ""}</b>
        ${tr("away from")} <b>${d?.name || d?.product_name}</b>?
        ${tr("The device stays in the project on its line, without an address, until it gets a new one. The device on the bus keeps its address until it is programmed.")}
      </p>
      <sl-button slot="footer" @click=${() => (this.confirmUnassign = false)}>${tr("Cancel")}</sl-button>
      <sl-button
        slot="footer"
        variant="primary"
        @click=${() => {
          this.confirmUnassign = false;
          void this.act(() => api.post(`api/devices/${this.deviceId}/unassign`), tr("Address unassigned"));
        }}
        >${tr("Unassign")}</sl-button
      >
    </sl-dialog>`;
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
        ${
          o.ip_address
            ? html`<tr>
                  <th>${tr("IP address")}</th>
                  <td>
                    ${o.ip_address}
                    ${o.web_url ? html` · <a href=${o.web_url} target="_blank" rel="noopener">${tr("Open web interface")}</a>` : nothing}
                  </td>
                </tr>
                ${o.mac_address ? html`<tr><th>${tr("MAC address")}</th><td>${o.mac_address}</td></tr>` : nothing}
                ${o.friendly_name ? html`<tr><th>${tr("Device name")}</th><td>${o.friendly_name}</td></tr>` : nothing}`
            : nothing
        }
      </table>
    </sl-details>`;
  }

  private renderPreflight(p: Preflight) {
    return html`<sl-details
      summary="Test result: ${p.changed_bytes} byte(s) in ${p.changed_segments} segment(s) and ${p.changed_properties} propert${p.changed_properties === 1 ? "y" : "ies"} would change"
      open
    >
      ${p.changed_bytes === 0 && p.changed_properties === 0 ? html`<p class="muted">${tr("The device already holds this configuration.")}</p>` : nothing}
      ${this.renderPreflightBody(p)}
    </sl-details>`;
  }

  private renderPreflightBody(p: Preflight) {
    return html`
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
    `;
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
              <td class="dpt" title=${co.dpt_codes.map((c) => dptTitle(c)).join("\n")}>
                ${co.dpt_codes.map((c) => formatDpt(c)).join(", ") || html`<span class="muted">-</span>`}
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
      <sl-input
        autofocus
        size="small"
        placeholder=${tr("Search an address or a name, or type a new address like 1/2/3")}
        clearable
        .value=${this.linkQuery}
        @sl-input=${(e: Event) => {
          this.linkQuery = (e.target as HTMLInputElement).value;
          this.linkPick = null;
        }}
        ><span slot="prefix">${icon("search", 14)}</span></sl-input
      >
      <div class="ga-list">
        ${this.linkMatches().map(
          (g) =>
            html`<div
              class=${this.linkPick === g.id ? "ga-row picked" : "ga-row"}
              @click=${() => (this.linkPick = g.id)}
              @dblclick=${() => this.link(true)}
            >
              <span class="addr">${g.text}</span> ${g.name}
              ${g.datapoint_type ? html`<span class="muted" title=${dptTitle(g.datapoint_type)}>${formatDpt(g.datapoint_type)}</span>` : nothing}
            </div>`,
        )}
        ${this.newAddress() ? html`<div class=${this.linkPick === null ? "ga-row picked" : "ga-row"} @click=${() => (this.linkPick = null)}>${icon("plus", 13)} ${tr("Create")} <span class="addr">${this.newAddress()}</span> ${tr("and link it")}</div>` : nothing}
        ${!this.linkMatches().length && !this.newAddress() ? html`<div class="muted" style="padding:8px">${this.gas.length ? tr("Nothing matches. Type a full address like 1/2/3 to create it.") : tr("No group addresses yet. Type one like 1/2/3 to create it.")}</div>` : nothing}
      </div>
      <sl-button
        slot="footer"
        ?disabled=${this.linkPick === null && !this.newAddress()}
        @click=${() => this.link(false)}
        >${tr("Link")}</sl-button
      >
      <sl-button
        slot="footer"
        variant="primary"
        ?disabled=${this.linkPick === null && !this.newAddress()}
        @click=${() => this.link(true)}
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
        <div class="row">
          <sl-button
            size="small"
            ?loading=${this.busy === "serials"}
            ?disabled=${this.busy !== null}
            title=${tr("Read the serial number of every device in programming mode")}
            @click=${() =>
              this.busAction("serials", async () => {
                this.serials = (await api.get<{ items: Serial[] }>("api/bus/programming-mode/serials")).items;
              })}
            >${tr("Read serial numbers")}</sl-button
          >
          <sl-button
            size="small"
            ?disabled=${!this.assignSerial || this.busy !== null}
            ?loading=${this.busy === "lookup"}
            title=${tr("Ask the bus which address the device with this serial number carries")}
            @click=${() =>
              this.busAction("lookup", async () => {
                this.serialLookup = await api.post(`api/bus/address-by-serial`, { serial: this.assignSerial });
              })}
            >${tr("Find address by serial")}</sl-button
          >
        </div>
        ${this.serialLookup ? html`<p class="hint">${this.serialLookup.address ? html`${tr("That device carries")} <strong>${this.serialLookup.address}</strong>${this.serialLookup.project_device ? html` (${this.serialLookup.project_device})` : nothing}.` : tr("No device answered with that serial number.")}</p>` : nothing}
        ${
          this.serials
            ? this.serials.length
              ? html`<div class="ga-list">
                  ${this.serials.map((s) => html`<div class="ga-row" title=${s.error ?? tr("Use this serial number")} @click=${() => s.serial_number && (this.assignSerial = s.serial_number)}><span class="addr">${s.address}</span> ${s.serial_number ?? html`<span class="muted">${s.error ?? tr("no serial number")}</span>`}</div>`)}
                </div>`
              : html`<p class="hint">${tr("No device is in programming mode.")}</p>`
            : nothing
        }
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
