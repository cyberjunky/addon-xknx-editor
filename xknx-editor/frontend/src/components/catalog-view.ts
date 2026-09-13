import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api, ApiError, type Job, type Product } from "../api.js";

type OnlineItem = {
  id: string;
  name: string;
  order_number: string;
  downloadable: boolean;
  manufacturer_id: number;
  application_version: number | null;
  application_program_name: string;
};
// A .knxproj is accepted for the product data bundled inside it (the way out of a legacy .vd).
const PRODUCT_FILE_ACCEPT = ".knxprod,.knxproj,.vd1,.vd2,.vd3,.vd4,.vd5,.vdx";

type CatalogRow = {
  key: string;
  manufacturer: string;
  name: string;
  order_number: string;
  application: string;
  version: string;
  local?: Product;
  online?: OnlineItem;
};

const LANGUAGES = [
  "en-US",
  "en-GB",
  "de-DE",
  "nl-NL",
  "fr-FR",
  "it-IT",
  "es-ES",
  "pl-PL",
];
import { icon } from "../icons.js";
import { store } from "../store.js";
import { PRODUCT_MIME } from "../product-drop.js";
import { t as tr } from "../i18n.js";

// A commissioning tool shows each manufacturer's logo. Those images live in its own
// installation: the .knxprod
// carries only application help images (Baggages), and onlinecatalog.knx.org serves no logo, so
// there is nothing to fetch. A monogram in a colour derived from the name gives the same at-a-glance
// scanning without inventing artwork: the same manufacturer always gets the same colour.
function badge(name: string): TemplateResult {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const initials = name
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return html`<span
    class="badge"
    style=${`background:hsl(${hash % 360} 55% 42%)`}
    title=${name}
    >${initials || "?"}</span
  >`;
}

@customElement("xknx-catalog-view")
export class CatalogView extends LitElement {
  static styles = css`
    sl-button::part(label) {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    :host {
      display: block;
      padding: 12px 16px;
    }
    .toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .toolbar sl-input {
      flex: 1;
      min-width: 240px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 13px;
    }
    th,
    td {
      text-align: left;
      padding: 6px 8px;
      border-bottom: 1px solid var(--ha-divider);
    }
    th {
      color: var(--ha-text-2);
      font-weight: 500;
      font-size: 12px;
    }
    .muted {
      color: var(--ha-text-2);
    }
    input.mfr {
      font: inherit;
      font-size: 13px;
      padding: 0 10px;
      height: 28px;
      min-width: 260px;
      border: 1px solid var(--sl-input-border-color, var(--ha-divider));
      border-radius: 8px;
      background: var(--ha-card);
      color: var(--ha-text);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 4px;
      margin-right: 6px;
      color: #fff;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.02em;
      vertical-align: middle;
      flex: none;
    }
    tr.group td {
      background: color-mix(in srgb, var(--ha-text) 5%, transparent);
      font-weight: 500;
      white-space: nowrap;
    }
    td.flag {
      color: var(--ha-text-2);
      text-align: center;
      padding: 6px 2px;
    }
    .source {
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 10px;
      border: 1px solid var(--ha-divider);
      color: var(--ha-text-2);
    }
    .summary {
      display: flex;
      gap: 16px;
      color: var(--ha-text-2);
      font-size: 12px;
      margin-bottom: 8px;
    }
  `;

  @state() private products: Product[] = [];
  @state() private query = "";
  @state() private summary = { manufacturers: 0, applications: 0, products: 0 };
  @state() private browse = false;
  @state() private busy = false;
  @state() private online: { id: number; name: string }[] = [];
  @state() private onlineMfr = "";
  @state() private onlineQuery = "";
  @state() private onlineItems: OnlineItem[] = [];
  @state() private onlineBusy = false;
  @state() private language = "en-US";
  @state() private index = {
    cached_manufacturers: 0,
    total_manufacturers: null as number | null,
    products: 0,
  };
  @state() private indexing: { progress: number | null; stage: string } | null =
    null;
  @state() private mfrText = "";
  /** The search text matched a manufacturer name, so it must not also filter that brand's list. */
  private mfrConsumed = false;

  private async loadIndexStatus(): Promise<void> {
    try {
      this.index = await api.get<typeof this.index>("api/catalog/online/index");
    } catch {
      /* offline */
    }
  }

  private async buildIndex(): Promise<void> {
    this.indexing = { progress: 0, stage: "starting" };
    try {
      let job = await api.post<Job>("api/catalog/online/index", {});
      while (job.status === "queued" || job.status === "running") {
        await new Promise((r) => setTimeout(r, 1000));
        job = await api.get<Job>(`api/jobs/${job.id}`);
        this.indexing = { progress: job.progress, stage: job.stage };
      }
      if (job.status === "failed")
        throw new ApiError(500, job.error ?? "index failed");
      const r = job.result as { failed: number[]; products: number };
      store.say(
        `Index ready: ${r.products} products` +
          (r.failed.length
            ? `, ${r.failed.length} manufacturers failed (retry later)`
            : ""),
        "success",
      );
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    } finally {
      this.indexing = null;
      await this.loadIndexStatus();
    }
  }

  private pickManufacturer(text: string): void {
    this.mfrText = text;
    const q = text.trim().toLowerCase();
    const m =
      q.length >= 2
        ? this.online.find((x) => x.name.toLowerCase().startsWith(q))
        : undefined;
    this.onlineMfr = m ? String(m.id) : "";
    // The text named a brand, so it has been used up. Searching that brand's own products for it
    // as well would find nothing: no Merten product is called "merten".
    this.mfrConsumed = m !== undefined;
    this.onlineItems = [];
  }

  private async loadOnline(refresh = false): Promise<void> {
    this.onlineBusy = true;
    try {
      this.online = (
        await api.get<{ items: { id: number; name: string }[] }>(
          `api/catalog/online/manufacturers${refresh ? "?refresh=1" : ""}`,
        )
      ).items;
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    } finally {
      this.onlineBusy = false;
    }
  }

  private async searchOnline(): Promise<void> {
    if (!this.onlineMfr && this.onlineQuery.trim().length < 2) {
      this.onlineItems = [];
      return;
    }
    this.onlineBusy = true;
    try {
      const q = this.mfrConsumed ? "" : this.onlineQuery;
      const url = this.onlineMfr
        ? `api/catalog/online/items?manufacturer=${this.onlineMfr}&q=${encodeURIComponent(q)}`
        : `api/catalog/online/search?q=${encodeURIComponent(this.onlineQuery)}`;
      this.onlineItems = (await api.get<{ items: OnlineItem[] }>(url)).items;
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    } finally {
      this.onlineBusy = false;
    }
  }

  private download(item: OnlineItem): void {
    void this.job(() =>
      api.post<Job>("api/catalog/online/download", {
        ids: [item.id],
        language: this.language,
      }),
    );
  }

  connectedCallback(): void {
    super.connectedCallback();
    const q = store.catalogQuery;
    if (q) {
      store.catalogQuery = null;
      this.query = q.text;
      this.onlineQuery = q.text;
      this.pendingManufacturer = q.manufacturer;
    }
    void this.load();
    void this.loadOnline().then(() => {
      if (this.pendingManufacturer) {
        const want = this.pendingManufacturer.toLowerCase().split(/[\s-]/)[0];
        const m = this.online.find((x) => x.name.toLowerCase().includes(want));
        if (m) {
          this.mfrText = m.name;
          this.onlineMfr = String(m.id);
        }
        this.pendingManufacturer = "";
      }
      if (this.onlineQuery) void this.searchOnline();
    });
    void this.loadIndexStatus();
  }

  private pendingManufacturer = "";

  private async load(): Promise<void> {
    const [s, p] = await Promise.all([
      api.get<typeof this.summary>("api/catalog"),
      api.get<{ items: Product[] }>(
        `api/catalog/products?q=${encodeURIComponent(this.query)}`,
      ),
    ]);
    this.summary = s;
    this.products = p.items;
  }

  private async upload(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    await this.job(async () => {
      const res = await fetch(
        `api/catalog/upload?name=${encodeURIComponent(file.name)}`,
        { method: "PUT", body: file },
      );
      const body = (await res.json()) as Job & { error?: string };
      // fetch only rejects on a network failure, so a refused upload (a .vd file, say) would
      // otherwise be treated as a started job and blow up on its missing result.
      if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText);
      return body;
    });
    input.value = "";
  }

  private async job(start: () => Promise<Job>): Promise<void> {
    this.busy = true;
    try {
      const job = await api.waitJob(await start());
      const result = job.result as {
        applications_added?: string[];
        failed?: string[];
        skipped?: { manufacturer: string; files: string[] }[];
      } | null;
      const added = result?.applications_added?.length ?? 0;
      store.say(
        added ? `Imported ${added} application(s)` : "Already in the catalog",
        "success",
      );
      // A project can carry manufacturer folders the catalog cannot take (no Hardware.xml) or
      // that it refused; silence there looks like success and leaves a device unresolved.
      const problems = [
        ...(result?.failed ?? []),
        ...(result?.skipped ?? []).map(
          (s) =>
            `${s.manufacturer}: no product data in the project (${s.files.join(", ")})`,
        ),
      ];
      if (problems.length)
        window.setTimeout(
          () =>
            store.say(
              [tr("Not everything could be imported:"), ...problems].join("\n"),
              "danger",
            ),
          600,
        );
      await this.load();
    } catch (err) {
      store.say(err instanceof ApiError ? err.message : String(err), "danger");
    } finally {
      this.busy = false;
    }
  }

  private async add(p: Product): Promise<void> {
    try {
      const d = await api.post<{ id: number }>("api/devices", {
        product_ref_id: p.product_ref_id,
        name: p.name ?? "",
      });
      store.select(d.id);
      store.setView("project");
      store.say(tr("Device added"), "success");
    } catch (err) {
      store.say(err instanceof ApiError ? err.message : String(err), "danger");
    }
  }

  /** Imported products and online results as one list: what is already here wins over what
   * could be downloaded, so a product never appears twice. Matched on manufacturer plus order
   * number, the pair a KNX product is actually identified by in a catalogue. */
  /** One search box covers everything, so this drives the imported list and the online
   * index together. The online half only answers once the index has been downloaded. */
  private searchAll(value: string): void {
    this.query = value;
    this.onlineQuery = value;
    // Typing a manufacturer's name lists that whole brand, the way a catalogue reads, without needing the
    // full index; any other text searches the index (once downloaded) and the imported products.
    this.pickManufacturer(value);
    void this.load();
    void this.searchOnline();
  }

  /** Rows grouped under their manufacturer, the way a catalogue is normally listed. */
  private groups(): { manufacturer: string; rows: CatalogRow[] }[] {
    const groups = new Map<string, CatalogRow[]>();
    for (const row of this.rows()) {
      const list = groups.get(row.manufacturer);
      if (list) list.push(row);
      else groups.set(row.manufacturer, [row]);
    }
    return [...groups.entries()]
      .map(([manufacturer, rows]) => ({ manufacturer, rows }))
      .sort((a, b) => a.manufacturer.localeCompare(b.manufacturer));
  }

  private rows(): CatalogRow[] {
    const key = (mfr: string, order: string) =>
      `${mfr.toLowerCase()}|${order.trim().toLowerCase()}`;
    const rows = new Map<string, CatalogRow>();
    for (const p of this.products) {
      const manufacturer = p.manufacturer_name ?? p.manufacturer_id;
      const order = p.order_number ?? "";
      rows.set(key(manufacturer, order), {
        key: key(manufacturer, order),
        manufacturer,
        name: p.name ?? "",
        order_number: order,
        application: p.application_name || p.application_id || "-",
        version:
          p.application_version != null ? String(p.application_version) : "",
        local: p,
      });
    }
    for (const i of this.onlineItems.slice(0, 300)) {
      const manufacturer =
        this.online.find((m) => m.id === i.manufacturer_id)?.name ??
        String(i.manufacturer_id);
      const k = key(manufacturer, i.order_number);
      if (rows.has(k)) continue; // already imported
      rows.set(k, {
        key: k,
        manufacturer,
        name: i.name,
        order_number: i.order_number,
        application: i.application_program_name,
        version:
          i.application_version !== null ? String(i.application_version) : "",
        online: i,
      });
    }
    return [...rows.values()].sort(
      (a, b) =>
        a.manufacturer.localeCompare(b.manufacturer) ||
        a.name.localeCompare(b.name),
    );
  }

  private emptyNote(): TemplateResult | typeof nothing {
    if (this.rows().length || this.onlineBusy) return nothing;
    if (this.query.trim() || this.mfrText)
      return html`<p class="muted">
        ${tr("Nothing matches. Clear the filter, pick a manufacturer, or press Download to fetch the product lists from the KNX server.")}
      </p>`;
    return html`<p class="muted">
      ${tr("The catalog is empty. Import a .knxprod from the manufacturer, or press Download to fetch the product lists from the KNX server.")}
    </p>`;
  }

  render() {
    return html`
      <div class="summary">
        <span>${this.summary.manufacturers} ${tr("manufacturers")}</span
        ><sl-tooltip
          content=${tr("An application program is the configuration program a device runs; one product ships one, and several products can share the same one.")}
          ><span
            >${this.summary.applications} ${tr("application programs")}</span
          ></sl-tooltip
        ><span
          >${this.summary.products}
          ${tr("products local")}${this.index.cached_manufacturers ? `, ${this.index.products} ${tr("online")}` : ""}</span
        >
      </div>
      <div class="toolbar">
        <sl-button
          size="small"
          ?loading=${this.busy}
          @click=${() => (this.renderRoot.querySelector("#file") as HTMLInputElement).click()}
          >${icon("upload", 14)} ${tr("Import")}</sl-button
        >
        <sl-tooltip
          content=${tr("Fetch every manufacturer's product list from the KNX server once (a few minutes); afterwards the search covers every brand")}
        >
          <sl-button
            size="small"
            ?loading=${this.indexing !== null || this.onlineBusy}
            @click=${() => this.buildIndex()}
            >${icon("cloud", 14)} ${tr("Download")}</sl-button
          >
        </sl-tooltip>
        <sl-button
          size="small"
          ?loading=${this.busy}
          @click=${() => (this.browse = true)}
          >${icon("open", 14)} ${tr("From /share")}</sl-button
        >
        <sl-select
          size="small"
          hoist
          value=${this.language}
          style="min-width:110px;flex:0"
          @sl-change=${(e: Event) => (this.language = (e.target as HTMLSelectElement).value)}
          >${LANGUAGES.map((l) => html`<sl-option value=${l}>${l}</sl-option>`)}</sl-select
        >
        <sl-input
          size="small"
          placeholder=${tr("Search manufacturer, product, order number or application")}
          clearable
          .value=${this.query}
          @sl-input=${(e: Event) => this.searchAll((e.target as HTMLInputElement).value)}
          ><span slot="prefix">${icon("search", 14)}</span></sl-input
        >
        <input
          id="file"
          type="file"
          accept=${PRODUCT_FILE_ACCEPT}
          hidden
          @change=${this.upload}
        />
        <xknx-file-dialog
          label=${tr("Import product data")}
          ext=${PRODUCT_FILE_ACCEPT}
          confirmLabel=${tr("Import")}
          ?open=${this.browse}
          @sl-after-hide=${() => (this.browse = false)}
          @file-chosen=${(e: CustomEvent<{ path: string }>) => {
            this.browse = false;
            void this.job(() =>
              api.post<Job>("api/catalog/import", { path: e.detail.path }),
            );
          }}
        ></xknx-file-dialog>
      </div>
      ${this.indexing ? html`<div class="muted" style="margin:4px 0 8px"><sl-progress-bar value=${(this.indexing.progress ?? 0) * 100} style="--height:6px"></sl-progress-bar>${this.indexing.stage}</div>` : nothing}
      <table>
        <tr>
          <th style="width:24px"></th>
          <th>${tr("Name")}</th>
          <th>${tr("Order number")}</th>
          <th>${tr("Application")}</th>
          <th style="width:60px">${tr("Version")}</th>
          <th></th>
        </tr>
        ${this.groups().map(
          (g) => html`
            <tr class="group">
              <td colspan="6">${badge(g.manufacturer)}${g.manufacturer}</td>
            </tr>
            ${g.rows.map(
              (r) =>
                html`<tr
                  draggable=${r.local ? "true" : "false"}
                  title=${r.local ? tr("Drag onto Devices, Topology or a room to add it to the project") : ""}
                  @dragstart=${(e: DragEvent) => {
                    if (!r.local) return;
                    e.dataTransfer?.setData(
                      PRODUCT_MIME,
                      JSON.stringify({
                        product_ref_id: r.local.product_ref_id,
                        name: r.local.name ?? "",
                      }),
                    );
                  }}
                >
                  <td class="flag">
                    ${r.online ? html`<sl-tooltip content=${tr("Available from the KNX online catalog; not imported yet")}>${icon("cloud", 13)}</sl-tooltip>` : nothing}
                  </td>
                  <td>${r.name}</td>
                  <td class="muted">${r.order_number}</td>
                  <td class="muted">${r.application}</td>
                  <td class="muted">${r.version}</td>
                  <td>
                    ${
                      r.local
                        ? html`<sl-button
                            size="small"
                            ?disabled=${!store.project.open || !r.local.application_id}
                            @click=${() => this.add(r.local!)}
                            >${icon("plus", 12)}
                            ${tr("Add to project")}</sl-button
                          >`
                        : r.online!.downloadable
                          ? html`<sl-button
                              size="small"
                              ?loading=${this.busy}
                              @click=${() => this.download(r.online!)}
                              >${icon("download", 12)}
                              ${tr("Download")}</sl-button
                            >`
                          : html`<span class="muted"
                              >${tr("needs a manufacturer plug-in")}</span
                            >`
                    }
                  </td>
                </tr>`,
            )}
          `,
        )}
      </table>
      ${this.onlineBusy ? html`<sl-spinner></sl-spinner>` : nothing}
      ${this.emptyNote()}
    `;
  }
}
