import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { ApiError, api } from "../api.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { t as tr } from "../i18n.js";

export type Doc = {
  id: string;
  name: string;
  ext: string;
  size: number;
  content_type: string;
  inline: boolean;
  tag: string;
  note: string;
  uploaded: string;
};

/** Open a stored document in a new browser tab, resolved against the ingress base. */
export function openDoc(id: string): void {
  window.open(
    new URL(`api/docs/${id}/raw`, document.baseURI).href,
    "_blank",
    "noopener",
  );
}

const ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.txt,.md,.csv,.xlsx,.xls,.docx,.doc,.zip,.vd1,.vd2,.vd3,.vd4,.vd5,.knxprod";

/** Centre-dock "Documents" view: upload manuals/datasheets/drawings and open them later. */
@customElement("xknx-docs-view")
export class DocsView extends LitElement {
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
      padding: 6px 8px;
      border-bottom: 1px solid var(--ha-divider);
      white-space: nowrap;
      vertical-align: middle;
    }
    th {
      color: var(--ha-text-2);
      font-weight: 500;
      font-size: 12px;
    }
    td.name {
      white-space: normal;
      cursor: pointer;
      color: var(--ha-primary);
    }
    td.name:hover {
      text-decoration: underline;
    }
    .muted {
      color: var(--ha-text-2);
    }
    .empty {
      color: var(--ha-text-2);
      padding: 16px 0;
    }
    .tag {
      display: inline-block;
      background: color-mix(in srgb, var(--ha-primary) 14%, transparent);
      border-radius: 10px;
      padding: 1px 8px;
      font-size: 12px;
    }
    input[type="file"] {
      display: none;
    }
  `;

  @property() tag = ""; // when set, the view is scoped to one device's documents
  @property({ type: Boolean }) compact = false;
  @state() private docs: Doc[] = [];
  @state() private filter = "";
  @state() private busy = false;

  connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  async load(): Promise<void> {
    try {
      const q = this.tag ? `?tag=${encodeURIComponent(this.tag)}` : "";
      this.docs = (await api.get<{ items: Doc[] }>(`api/docs${q}`)).items;
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    }
  }

  private async upload(files: FileList | null): Promise<void> {
    if (!files || !files.length) return;
    this.busy = true;
    try {
      for (const file of Array.from(files)) {
        const q = new URLSearchParams({ name: file.name, tag: this.tag });
        const res = await fetch(
          new URL(`api/docs?${q.toString()}`, document.baseURI).href,
          {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body: await file.arrayBuffer(),
          },
        );
        if (!res.ok)
          throw new ApiError(
            res.status,
            (await res.json().catch(() => ({}))).error ?? res.statusText,
          );
      }
      store.say(`${files.length} ${tr("document(s) uploaded")}`, "success");
      await this.load();
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    } finally {
      this.busy = false;
    }
  }

  private async removeDoc(d: Doc): Promise<void> {
    if (!window.confirm(`${tr("Delete")} ${d.name}?`)) return;
    try {
      await api.delete(`api/docs/${d.id}`);
      await this.load();
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    }
  }

  private async retag(d: Doc): Promise<void> {
    const tag = window.prompt(tr("Tag (e.g. order number or device)"), d.tag);
    if (tag === null) return;
    await api.patch(`api/docs/${d.id}`, { tag });
    await this.load();
  }

  private fmtSize(n: number): string {
    return n < 1024
      ? `${n} B`
      : n < 1024 * 1024
        ? `${Math.round(n / 1024)} kB`
        : `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  render() {
    const q = this.filter.trim().toLowerCase();
    const rows = this.docs.filter(
      (d) => !q || `${d.name} ${d.tag} ${d.note}`.toLowerCase().includes(q),
    );
    const pick = () =>
      (this.renderRoot.querySelector("#docfile") as HTMLInputElement).click();
    return html`
      ${
        this.compact
          ? nothing
          : html`<p class="desc">
              ${tr("Upload manuals, datasheets and drawings (PDF, images, spreadsheets, .vd files) and open them later from the add-on. Files are stored under /config/docs. Tag a document with an order number so it shows up on that device.")}
            </p>`
      }
      <div class="row">
        <sl-button
          size="small"
          variant="primary"
          ?loading=${this.busy}
          @click=${pick}
          >${icon("upload", 14)} ${tr("Upload documents")}</sl-button
        >
        <input
          id="docfile"
          type="file"
          accept=${ACCEPT}
          multiple
          @change=${(e: Event) => this.upload((e.target as HTMLInputElement).files)}
        />
        ${this.tag ? html`<span class="tag">${this.tag}</span>` : nothing}
        <span style="flex:1"></span>
        ${this.compact ? nothing : html`<sl-input size="small" placeholder=${tr("Filter")} clearable style="width:220px" @sl-input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}><span slot="prefix">${icon("search", 14)}</span></sl-input>`}
      </div>
      ${
        rows.length
          ? html`<table>
              <tr>
                <th>${tr("Name")}</th>
                <th>${tr("Tag")}</th>
                <th>${tr("Size")}</th>
                ${this.compact ? nothing : html`<th>${tr("Uploaded")}</th>`}
                <th></th>
              </tr>
              ${rows.map(
                (d) =>
                  html`<tr>
                    <td
                      class="name"
                      title=${tr("Open in a new tab")}
                      @click=${() => openDoc(d.id)}
                    >
                      ${icon(d.ext === ".pdf" ? "download" : "open", 14)}
                      ${d.name}
                    </td>
                    <td>
                      ${d.tag ? html`<span class="tag">${d.tag}</span>` : html`<span class="muted">–</span>`}
                    </td>
                    <td class="muted">${this.fmtSize(d.size)}</td>
                    ${this.compact ? nothing : html`<td class="muted">${d.uploaded.replace("T", " ")}</td>`}
                    <td style="text-align:right;white-space:nowrap">
                      <sl-button
                        size="small"
                        title=${tr("Tag")}
                        @click=${() => this.retag(d)}
                        >${icon("settings", 14)}</sl-button
                      >
                      <sl-button size="small" @click=${() => this.removeDoc(d)}
                        >${icon("trash", 14)}</sl-button
                      >
                    </td>
                  </tr>`,
              )}
            </table>`
          : html`<div class="empty">
              ${this.tag ? tr("No documents for this device yet. Upload its manual or datasheet.") : tr("No documents yet.")}
            </div>`
      }
    `;
  }
}
