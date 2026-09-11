import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { api, ApiError } from "../api.js";
import { icon } from "../icons.js";
import { t as tr } from "../i18n.js";

type Entry = {
  name: string;
  path: string;
  is_dir: boolean;
  size: number | null;
  mtime: string | null;
};
type Listing = {
  path: string | null;
  parent: string | null;
  root?: { name: string; path: string };
  roots: { name: string; path: string }[];
  entries: Entry[];
};

/**
 * Server-side file picker over /share, the in/out tray reachable from the network share: breadcrumbs, folders first, extension filter,
 * double-click to open a folder or choose a file. Emits `file-chosen` with `{ path }`.
 */
@customElement("xknx-file-dialog")
export class FileDialog extends LitElement {
  static styles = css`
    sl-button::part(label) {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .crumbs {
      display: flex;
      align-items: center;
      gap: 2px;
      flex-wrap: wrap;
      margin-bottom: 8px;
      font-size: 13px;
    }
    .crumbs button {
      border: 0;
      background: transparent;
      color: var(--ha-primary);
      cursor: pointer;
      font: inherit;
      padding: 2px 4px;
      border-radius: 4px;
    }
    .crumbs button:hover {
      background: color-mix(in srgb, var(--ha-primary) 12%, transparent);
    }
    .crumbs span {
      color: var(--ha-text-2);
    }
    .list {
      height: 340px;
      overflow: auto;
      border: 1px solid var(--ha-divider);
      border-radius: 8px;
    }
    .row {
      display: grid;
      grid-template-columns: 20px 1fr 90px 150px;
      gap: 8px;
      align-items: center;
      padding: 5px 10px;
      cursor: pointer;
      font-size: 13px;
      border-bottom: 1px solid var(--ha-divider);
      user-select: none;
    }
    .row:hover {
      background: color-mix(in srgb, var(--ha-text) 6%, transparent);
    }
    .row.selected {
      background: color-mix(in srgb, var(--ha-primary) 18%, transparent);
    }
    .row .meta {
      color: var(--ha-text-2);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
    .row .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .empty {
      padding: 24px;
      color: var(--ha-text-2);
      text-align: center;
    }
    .foot {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-top: 8px;
      font-size: 12px;
      color: var(--ha-text-2);
    }
    .foot code {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;

  @property({ type: Boolean, reflect: true }) open = false;
  @property() label = "Choose a file";
  /** Comma-separated extensions, e.g. ".knxproj,.xknx". Empty shows every file. */
  @property() ext = "";
  @property() confirmLabel = "Choose";
  @state() private listing: Listing | null = null;
  @state() private selected: Entry | null = null;
  @state() private error = "";
  private lastDir = "";

  updated(changed: Map<string, unknown>): void {
    if (changed.has("open") && this.open) void this.load(this.lastDir);
  }

  private async load(path: string): Promise<void> {
    this.error = "";
    this.selected = null;
    try {
      const q = new URLSearchParams({ path, ext: this.ext });
      this.listing = await api.get<Listing>(`api/files/browse?${q}`);
      this.lastDir = this.listing.path ?? "";
    } catch (e) {
      this.error = e instanceof ApiError ? e.message : String(e);
    }
  }

  private pick(entry: Entry): void {
    if (entry.is_dir) void this.load(entry.path);
    else this.choose(entry);
  }

  private choose(entry: Entry | null): void {
    if (!entry || entry.is_dir) return;
    this.dispatchEvent(
      new CustomEvent("file-chosen", {
        detail: { path: entry.path },
        bubbles: true,
        composed: true,
      }),
    );
    this.open = false;
  }

  private crumbs() {
    const l = this.listing;
    if (!l) return nothing;
    const parts: { label: string; path: string }[] = [
      { label: "Home Assistant", path: "" },
    ];
    if (l.path && l.root) {
      const rel = l.path
        .slice(l.root.path.length)
        .split(/[\\/]/)
        .filter(Boolean);
      let acc = l.root.path;
      parts.push({ label: l.root.name, path: acc });
      for (const seg of rel) {
        acc = `${acc}/${seg}`;
        parts.push({ label: seg, path: acc });
      }
    }
    return html`<div class="crumbs">
      ${parts.map((p, i) => html`${i ? html`<span>›</span>` : nothing}<button @click=${() => this.load(p.path)}>${p.label}</button>`)}
    </div>`;
  }

  private size(n: number | null): string {
    if (n === null) return "";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  render() {
    const l = this.listing;
    return html`<sl-dialog
      label=${this.label}
      ?open=${this.open}
      style="--width: 640px"
      @sl-after-hide=${() => (this.open = false)}
    >
      ${this.crumbs()}
      <div class="list">
        ${this.error ? html`<div class="empty">${this.error}</div>` : nothing}
        ${
          l?.parent !== null && l?.path
            ? html`<div
                class="row"
                @dblclick=${() => this.load(l.parent ?? "")}
                @click=${() => this.load(l.parent ?? "")}
              >
                ${icon("open", 14)}<span class="name">..</span><span></span
                ><span></span>
              </div>`
            : nothing
        }
        ${l?.entries.map(
          (e) =>
            html`<div
              class="row ${this.selected?.path === e.path ? "selected" : ""}"
              @click=${() => (e.is_dir ? this.load(e.path) : (this.selected = e))}
              @dblclick=${() => this.pick(e)}
            >
              ${icon(e.is_dir ? "open" : "cpu", 14)}<span
                class="name"
                title=${e.path}
                >${e.name}</span
              ><span class="meta">${this.size(e.size)}</span
              ><span class="meta"
                >${e.mtime ? e.mtime.replace("T", " ").slice(0, 16) : ""}</span
              >
            </div>`,
        )}
        ${l && !l.entries.length && !this.error ? html`<div class="empty">Empty folder${this.ext ? ` (showing ${this.ext})` : ""}</div>` : nothing}
      </div>
      <div class="foot">
        ${this.selected ? html`<code>${this.selected.path}</code>` : html`<span>Select a file${this.ext ? ` (${this.ext})` : ""}. Folders open on click.</span>`}
      </div>
      <sl-button slot="footer" @click=${() => (this.open = false)}
        >${tr("Cancel")}</sl-button
      >
      <sl-button
        slot="footer"
        variant="primary"
        ?disabled=${!this.selected}
        @click=${() => this.choose(this.selected)}
        >${this.confirmLabel}</sl-button
      >
    </sl-dialog>`;
  }
}
