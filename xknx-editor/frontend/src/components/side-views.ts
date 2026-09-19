/** Right dock (History, Project, Health) and bottom dock (Logs) views. */
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api, ApiError } from "../api.js";
import { store } from "../store.js";
import { t as tr } from "../i18n.js";
import { importNoteText, type ImportNote } from "../import-notes.js";

const shared = css`
  :host {
    display: block;
    font-size: 13px;
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
    vertical-align: top;
  }
  th {
    color: var(--ha-text-2);
    font-weight: 500;
    font-size: 12px;
    white-space: nowrap;
  }
  .muted {
    color: var(--ha-text-2);
  }
  .empty {
    padding: 16px 12px;
    color: var(--ha-text-2);
  }
  .toolbar {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 6px 8px;
    border-bottom: 1px solid var(--ha-divider);
  }
`;

type HistoryEntry = {
  id: number;
  event_type: string;
  data: Record<string, unknown>;
  reverted: boolean;
};

@customElement("xknx-history-view")
export class HistoryView extends LitElement {
  static styles = [
    shared,
    css`
      sl-button::part(label) {
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }
      .item {
        display: flex;
        gap: 8px;
        padding: 4px 10px;
        border-bottom: 1px solid var(--ha-divider);
        cursor: pointer;
      }
      .item:hover {
        background: color-mix(in srgb, var(--ha-text) 6%, transparent);
      }
      .item.reverted {
        color: var(--ha-text-2);
        text-decoration: line-through;
      }
      .item .n {
        font-variant-numeric: tabular-nums;
        color: var(--ha-text-2);
        min-width: 2.5em;
      }
    `,
  ];
  @state() private items: HistoryEntry[] = [];
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
    if (!store.project.open || this.rev === store.revision) return;
    this.rev = store.revision;
    const r = await api.get<{ cursor: number; items: HistoryEntry[] }>(
      "api/project/history",
    );
    this.items = r.items.slice().reverse();
  }
  private label(e: HistoryEntry): string {
    const d = e.data as Record<string, unknown>;
    // Delete events carry a snapshot of what was removed (rows[0] is the object itself), so the
    // entry can say which device / address / space went, not just "Remove Device".
    const rows = Array.isArray(d.rows)
      ? (d.rows as Record<string, unknown>[])
      : [];
    const first = rows.length ? rows[0] : null;
    const src = first ?? d;
    let what = String(
      (src.name as string) || (first?.product_name as string) || "",
    );
    if (
      first &&
      typeof first.address === "number" &&
      first.__model__ === "Device"
    )
      what = `${what || "device"} (${first.address})`.trim();
    if (!what && d.ref_id) what = String(d.ref_id).split("_").pop() ?? "";
    if (
      !what &&
      typeof d.address === "number" &&
      e.event_type.includes("GroupAddress")
    )
      what = `#${d.address}`;
    const value =
      d.value !== undefined && e.event_type === "SetParameter"
        ? ` = ${String(d.value)}`
        : "";
    const kind = e.event_type.replace(/([a-z])([A-Z])/g, "$1 $2");
    return `${kind}${what ? `: ${what}` : ""}${value}`;
  }
  render() {
    if (!store.project.open)
      return html`<div class="empty">${tr("No project open.")}</div>`;
    return html`
      <div class="toolbar">
        <sl-button
          size="small"
          ?disabled=${!store.project.can_undo}
          @click=${() => api.post("api/project/undo")}
          >Undo</sl-button
        >
        <sl-button
          size="small"
          ?disabled=${!store.project.can_redo}
          @click=${() => api.post("api/project/redo")}
          >Redo</sl-button
        >
        <span class="muted">${this.items.length} edits</span>
      </div>
      ${this.items.map((e) => html`<div class="item ${e.reverted ? "reverted" : ""}" title=${JSON.stringify(e.data)}><span class="n">${e.id}</span><span>${this.label(e)}</span></div>`)}
      ${this.items.length ? nothing : html`<div class="empty">${tr("No edits yet. Every change can be undone here.")}</div>`}
    `;
  }
}

@customElement("xknx-project-info")
export class ProjectInfoView extends LitElement {
  static styles = [shared];
  @state() private detail: Record<string, unknown> | null = null;
  @state() private askPassword = false;
  @state() private decrypting = false;
  @state() private decrypted:
    { date: string; user: string; comment: string }[] | null = null;

  @state() private decryptResult = "";

  private async importLog(): Promise<void> {
    const path =
      (
        this.renderRoot.querySelector("#log-path") as HTMLInputElement | null
      )?.value.trim() ?? "";
    if (!path) {
      this.decryptResult = tr(
        "Give the path of the JSON file produced by the script.",
      );
      return;
    }
    this.decrypting = true;
    try {
      const r = await api.post<{ stored: number; count: number }>(
        "api/project/log/import",
        { path },
      );
      this.decryptResult = `${r.stored} ${tr("entries imported.")}`;
      store.say(`${r.stored} ${tr("entries imported.")}`, "success");
      await store.refresh();
    } catch (e) {
      this.decryptResult = e instanceof ApiError ? e.message : String(e);
    } finally {
      this.decrypting = false;
    }
  }

  private async clearLog(): Promise<void> {
    try {
      await api.delete("api/project/log");
      this.decryptResult = tr("Import removed.");
      await store.refresh();
    } catch (e) {
      this.decryptResult = e instanceof ApiError ? e.message : String(e);
    }
  }

  private async decrypt(): Promise<void> {
    const pw = "";
    this.decrypting = true;
    this.decryptResult = tr("Trying…");
    try {
      const r = await api.post<{
        scheme: string | null;
        tried: number;
        reason?: string;
        keyring_keys?: number;
        analysis?: {
          blobs: number;
          sizes?: number[];
          verdict?: string;
          prefixes?: string[];
          containers?: string[];
          first_bytes?: string;
        };
        items?: { date: string; user: string; comment: string }[];
      }>("api/project/traces/decrypt", { password: pw });
      if (r.scheme && r.items) {
        this.decrypted = r.items;
        this.decryptResult = `Decrypted with scheme ${r.scheme}.`;
        store.say(`Project log decrypted (${r.scheme})`, "success");
        this.askPassword = false;
      } else {
        this.decryptResult = r.reason
          ? `Nothing to decrypt: ${r.reason}.`
          : `No match: ${r.tried} keys tried${r.keyring_keys ? ` (${r.keyring_keys} from the keyring and signing key)` : ""}. The key it uses is still unknown.${r.analysis?.verdict ? ` Layout: ${r.analysis.verdict}. Blob sizes ${(r.analysis.sizes ?? []).join(", ")} bytes, first bytes ${r.analysis.first_bytes ?? "?"}.` : ""}`;
      }
    } catch (e) {
      this.decryptResult = `Request failed: ${e instanceof ApiError ? e.message : String(e)}`;
    } finally {
      this.decrypting = false;
    }
  }
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
      this.detail = null;
      return;
    }
    if (this.rev === store.revision) return;
    this.rev = store.revision;
    this.detail = await api.get<Record<string, unknown>>("api/project/detail");
  }
  render() {
    const d = this.detail;
    if (!store.project.open || !d)
      return html`<div class="empty">${tr("No project open.")}</div>`;
    const row = (k: string, v: unknown) =>
      html`<tr>
        <th>${k}</th>
        <td style="overflow-wrap:anywhere">
          ${v === null || v === undefined || v === "" ? html`<span class="muted">-</span>` : String(v)}
        </td>
      </tr>`;
    const traces =
      this.decrypted ??
      (d.traces as {
        date: string;
        user: string;
        comment: string;
        encrypted: boolean;
      }[]) ??
      [];
    const anyEncrypted =
      !this.decrypted &&
      traces.some((t) => (t as { encrypted?: boolean }).encrypted);
    return html`
      ${
        ((d.import_notes as ImportNote[]) ?? []).length
          ? html`<div class="note" style="margin-bottom:8px">
              <b>${tr("Kept back on import")}</b>
              <ul style="margin:4px 0 0;padding-left:18px">
                ${(d.import_notes as ImportNote[]).map((n) => html`<li>${importNoteText(n)}</li>`)}
              </ul>
            </div>`
          : nothing
      }
      <table>
        ${row(tr("Name"), d.name)}${row(tr("Group address style"), d.group_address_style)}${row(tr("Created by"), d.created_by)}${row(tr("Tool version"), d.tool_version)}
        ${row(tr("Schema version"), d.schema_version)}${row(tr("Last modified"), d.last_modified)}${row("GUID", d.guid)}${row(tr("Project ID"), d.id)}${row(tr("Devices"), d.device_count)}${row(tr("File"), d.path)}
      </table>
      ${
        traces.length
          ? html`<h4 style="margin:12px 8px 4px;font-weight:500">
                Project log
                ${d.log_import ? html`<span class="muted" style="font-weight:400">(${(d.log_import as { count: number }).count} ${tr("entries imported")}${d.log_matched ? `, ${d.log_matched} ${tr("matched")}` : ""})</span>` : anyEncrypted ? html`<span class="muted" style="font-weight:400">(${tr("comments are encrypted")})</span>` : nothing}
                ${anyEncrypted || d.log_import ? html`<sl-button size="small" @click=${() => (this.askPassword = true)}>${d.log_import ? tr("Log import…") : tr("Read the log…")}</sl-button>` : nothing}
              </h4>
              <sl-dialog
                label=${tr("Decrypt project log")}
                ?open=${this.askPassword}
                @sl-after-hide=${() => (this.askPassword = false)}
              >
                <p>
                  ${tr("Every log comment is encrypted with AES-256 under a key compiled into the commissioning tool itself, the same on every installation. The add-on does not ship that key. Store it once under Help → Project log key and the log reads here directly, including entries written back for import.")}
                </p>
                <p class="muted" style="margin:4px 0 8px">
                  ${tr("Without the key, decrypt the log on the PC that wrote it and import the result here instead:")}
                </p>
                <ol class="muted" style="padding-left:18px;line-height:1.6">
                  <li>
                    ${tr("Download the encrypted entries:")}
                    <a
                      href="api/project/log/export"
                      download="project-log-encrypted.json"
                      >project-log-encrypted.json</a
                    >
                  </li>
                  <li>
                    ${tr("Decrypt it there, then put project-log.json on the share and pick it below.")}
                  </li>
                </ol>
                <div
                  style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-top:8px"
                >
                  <sl-input
                    id="log-path"
                    size="small"
                    style="flex:1;min-width:240px"
                    label=${tr("File on /share")}
                    placeholder="/share/project-log.json"
                  ></sl-input>
                  <sl-button
                    size="small"
                    ?loading=${this.decrypting}
                    @click=${() => this.importLog()}
                    >${tr("Import")}</sl-button
                  >
                </div>
                ${d.log_import ? html`<p class="muted" style="margin-top:10px">${tr("Imported")}: ${(d.log_import as { source: string; imported: string }).source || "?"} · ${((d.log_import as { imported: string }).imported || "").replace("T", " ")} <sl-button size="small" @click=${() => this.clearLog()}>${tr("Remove import")}</sl-button></p>` : nothing}
                ${this.decryptResult ? html`<p style="margin:10px 0 0">${this.decryptResult}</p>` : nothing}
                <sl-button
                  slot="footer"
                  @click=${() => (this.askPassword = false)}
                  >${tr("Close")}</sl-button
                >
                <sl-button
                  slot="footer"
                  ?loading=${this.decrypting}
                  @click=${() => this.decrypt()}
                  >${tr("Try key derivations anyway")}</sl-button
                >
              </sl-dialog>
              <table>
                <tr>
                  <th>${tr("Date")}</th>
                  <th>${tr("User")}</th>
                  <th>${tr("Comment")}</th>
                </tr>
                ${traces.map(
                  (t) =>
                    html`<tr>
                      <td class="muted" style="white-space:nowrap">
                        ${t.date.replace("T", " ").slice(0, 16)}
                      </td>
                      <td>${t.user}</td>
                      <td style="overflow-wrap:anywhere">
                        ${(t as { encrypted?: boolean }).encrypted ? html`<span class="muted" title=${t.comment}>${tr("encrypted")}</span>` : t.comment}
                      </td>
                    </tr>`,
                )}
              </table>`
          : nothing
      }
    `;
  }
}

type Finding = {
  check: string;
  severity: "error" | "warning" | "info";
  message: string;
  device_id: number | null;
  group_address_id: number | null;
  subject: string;
};

@customElement("xknx-health-view")
export class HealthView extends LitElement {
  static styles = [
    shared,
    css`
      .f {
        display: grid;
        grid-template-columns: 8px 1fr;
        gap: 8px;
        padding: 6px 10px;
        border-bottom: 1px solid var(--ha-divider);
        cursor: pointer;
      }
      .f:hover {
        background: color-mix(in srgb, var(--ha-text) 6%, transparent);
      }
      .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        margin-top: 6px;
      }
      .error .dot {
        background: var(--ha-error);
      }
      .warning .dot {
        background: var(--ha-warning);
      }
      .info .dot {
        background: var(--ha-text-2);
      }
      .subject {
        font-weight: 500;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        padding: 6px 8px;
        border-bottom: 1px solid var(--ha-divider);
      }
      .chip {
        font: inherit;
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 10px;
        border: 1px solid var(--ha-divider);
        background: transparent;
        color: var(--ha-text-2);
        cursor: pointer;
      }
      .chip.on {
        border-color: var(--ha-primary);
        color: var(--ha-text);
        background: color-mix(in srgb, var(--ha-primary) 12%, transparent);
      }
      .chip .n {
        font-variant-numeric: tabular-nums;
        opacity: 0.7;
      }
    `,
  ];
  @state() private items: Finding[] = [];
  /** Check types the user has switched off. Empty means everything is shown. */
  @state() private hiddenChecks = new Set<string>();
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
      this.items = [];
      return;
    }
    if (this.rev === store.revision) return;
    this.rev = store.revision;
    try {
      this.items = (
        await api.get<{ items: Finding[] }>("api/project/health")
      ).items;
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    }
  }
  private go(f: Finding): void {
    if (f.device_id !== null) store.select(f.device_id);
    else if (f.group_address_id !== null)
      store.selectGroupAddress(f.group_address_id);
  }
  render() {
    if (!store.project.open)
      return html`<div class="empty">No project open.</div>`;
    // One chip per kind of finding, so a project full of notes can be narrowed to the kind
    // being worked on without hiding a whole severity.
    const kinds = new Map<string, number>();
    for (const f of this.items)
      kinds.set(f.check, (kinds.get(f.check) ?? 0) + 1);
    const shown = this.items.filter((f) => !this.hiddenChecks.has(f.check));
    const counts = { error: 0, warning: 0, info: 0 };
    for (const f of this.items) counts[f.severity]++;
    return html`
      <div class="toolbar">
        <span
          >${counts.error} errors · ${counts.warning} warnings · ${counts.info}
          notes</span
        >
      </div>
      ${
        kinds.size > 1
          ? html`<div class="chips">
              ${[...kinds.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(
                  ([check, n]) =>
                    html`<button
                      class="chip ${this.hiddenChecks.has(check) ? "" : "on"}"
                      title=${check}
                      @click=${() => {
                        const next = new Set(this.hiddenChecks);
                        if (next.has(check)) next.delete(check);
                        else next.add(check);
                        this.hiddenChecks = next;
                      }}
                    >
                      ${check.replace(/_/g, " ")} <span class="n">${n}</span>
                    </button>`,
                )}
              ${
                this.hiddenChecks.size
                  ? html`<button
                      class="chip"
                      @click=${() => (this.hiddenChecks = new Set())}
                    >
                      ${tr("Show all")}
                    </button>`
                  : nothing
              }
            </div>`
          : nothing
      }
      ${shown.map(
        (f) =>
          html`<div class="f ${f.severity}" @click=${() => this.go(f)}>
            <span class="dot"></span
            ><span
              ><span class="subject">${f.subject}</span><br /><span
                class="muted"
                >${f.message}</span
              ></span
            >
          </div>`,
      )}
      ${shown.length ? nothing : html`<div class="empty">${tr("No findings. The project looks consistent.")}</div>`}
    `;
  }
}
