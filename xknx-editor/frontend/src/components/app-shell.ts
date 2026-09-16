import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api, ApiError, type Job } from "../api.js";
import { icon } from "../icons.js";
import {
  store,
  type BottomTab,
  type CenterTab,
  type LeftTab,
  type RightTab,
} from "../store.js";
import {
  LANGUAGES,
  initLanguage,
  language,
  setLanguage,
  t as tr,
} from "../i18n.js";
import { DPT_STYLES, dptStyle, setDptStyle, type DptStyle } from "../dpt-format.js";

const LEFT: { id: LeftTab; label: string }[] = [
  { id: "buildings", label: "Buildings" },
  { id: "topology", label: "Topology" },
  { id: "devices", label: "Devices" },
  { id: "group-addresses", label: "Group addresses" },
];
const CENTER: { id: CenterTab; label: string }[] = [
  { id: "editor", label: "Editor" },
  { id: "overview", label: "Device overview" },
  { id: "masslink", label: "Mass link" },
  { id: "tools", label: "Tools" },
  { id: "recover", label: "Recover" },
  { id: "secure", label: "Secure" },
  { id: "docs", label: "Documents" },
  { id: "ai", label: "AI" },
  { id: "network", label: "Network" },
  { id: "compare", label: "Compare" },
  { id: "manufacturers", label: "Manufacturers" },
  { id: "objects", label: "Group objects" },
];
/** The tables the File menu exports as CSV (reports.EXPORTS on the backend). */
const CSV_EXPORTS: { id: string; label: string }[] = [
  { id: "devices", label: "Devices" },
  { id: "group-addresses", label: "Group addresses" },
  { id: "group-objects", label: "Group objects" },
  { id: "topology", label: "Topology" },
  { id: "locations", label: "Buildings" },
  { id: "manufacturers", label: "Manufacturers" },
];
const RIGHT: { id: RightTab; label: string }[] = [
  { id: "history", label: "History" },
  { id: "project", label: "Project" },
  { id: "health", label: "Health" },
];
/** What a backup can hold, matching backup.CATEGORIES on the backend. */
const BACKUP_CATEGORIES: { id: string; label: string }[] = [
  { id: "catalog", label: "Product data (catalog)" },
  { id: "docs", label: "Documents" },
  { id: "settings", label: "Gateway settings" },
  { id: "keys", label: "Keys" },
  { id: "logs", label: "Project logs" },
  { id: "telegrams", label: "Recorded telegrams" },
];

const BOTTOM: { id: BottomTab; label: string }[] = [
  { id: "monitor", label: "Group monitor" },
  { id: "charts", label: "Charts" },
  { id: "stats", label: "Statistics" },
  { id: "catalog", label: "Catalog" },
];

@customElement("xknx-app")
export class AppShell extends LitElement {
  static styles = css`
    sl-button::part(label) {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    :host {
      display: grid;
      grid-template-rows: auto 1fr;
      height: 100%;
    }
    header {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 0 8px;
      height: 38px;
      background: var(--ha-card);
      border-bottom: 1px solid var(--ha-divider);
    }
    header .logo {
      width: 20px;
      height: 20px;
      border-radius: 5px;
      margin-right: 8px;
      vertical-align: -5px;
    }
    header .title {
      font-weight: 500;
      margin: 0 12px 0 4px;
    }
    header .menu {
      border: 0;
      background: transparent;
      color: var(--ha-text);
      font: inherit;
      padding: 6px 10px;
      border-radius: 6px;
      cursor: pointer;
    }
    header .menu:hover {
      background: color-mix(in srgb, var(--ha-text) 8%, transparent);
    }
    header .project {
      margin-left: auto;
      color: var(--ha-text-2);
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 40%;
    }
    /* A pane the user closed must collapse completely; the 160px reserve below is there to keep
       a pane usable while dragging, and would otherwise leave a strip of empty space. */
    sl-split-panel.collapsed {
      --min: 0px;
      --max: 100%;
    }
    sl-split-panel {
      height: 100%;
      min-height: 0;
      min-width: 0;
      --divider-width: 5px;
      --divider-hit-area: 18px;
      --min: 160px;
      --max: calc(100% - 160px);
    }
    sl-split-panel::part(divider) {
      background: var(--ha-divider);
    }
    sl-split-panel[disabled]::part(divider) {
      display: none;
    }
    sl-split-panel > [slot] {
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
    .pane[hidden] {
      display: none;
    }
    .pane {
      display: grid;
      grid-template-rows: auto 1fr;
      min-height: 0;
      min-width: 0;
      border-right: 1px solid var(--ha-divider);
    }
    .pane.bottom {
      border-top: 1px solid var(--ha-divider);
      border-right: 0;
    }
    .pane.right {
      border-right: 0;
      border-left: 1px solid var(--ha-divider);
    }
    .tabs {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 4px 6px 0;
      background: var(--ha-card);
      border-bottom: 1px solid var(--ha-divider);
      overflow-x: auto;
    }
    .tabs button {
      border: 0;
      border-bottom: 2px solid transparent;
      background: transparent;
      color: var(--ha-text-2);
      font: inherit;
      font-size: 13px;
      padding: 6px 12px;
      cursor: pointer;
      white-space: nowrap;
    }
    .tabs button.active {
      color: var(--ha-primary);
      border-bottom-color: var(--ha-primary);
    }
    .tabs .close {
      margin-left: auto;
      padding: 4px 8px;
      color: var(--ha-text-2);
    }
    .body {
      min-height: 0;
      min-width: 0;
      overflow: auto;
    }
    .toast {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 20;
      min-width: 240px;
      max-width: min(560px, calc(100vw - 32px));
    }
    .toast::part(message) {
      white-space: pre-line;
      line-height: 1.45;
    }
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 8px 0;
      flex-wrap: wrap;
    }
    sl-select,
    sl-input {
      flex: 1;
      min-width: 240px;
    }
    .hint {
      color: var(--ha-text-2);
      font-size: 12px;
    }
    .empty {
      padding: 24px;
      color: var(--ha-text-2);
    }
  `;

  @state() private dialog:
    | "open"
    | "new"
    | "import"
    | "import-password"
    | "import-share"
    | "save-copy"
    | "backup"
    | "restore"
    | "export"
    | "about"
    | "signing"
    | "logkey"
    | "licences"
    | null = null;
  @state() private signing: {
    placeholder: boolean;
    bits: number;
    modulus_preview: string;
    stored: boolean;
    extract_powershell: string;
  } | null = null;
  @state() private logKey: {
    present: boolean;
    key_preview: string;
    marker_codes: string;
    extract_powershell: string;
  } | null = null;
  @state() private licences: {
    items: {
      name: string;
      version: string;
      licence: string;
      ours: boolean;
    }[];
    frontend: { name: string; licence: string }[];
  } | null = null;
  @state() private uiLang = language();
  @state() private about: {
    upstream_ref?: string;
    version?: string;
    mcp?: { enabled: boolean; port: number | null; tools: string[] };
  } | null = null;
  @state() private importPath = "";
  @state() private uploading = false;
  @state() private restoreBrowse = false;
  @state() private backupResult: { path: string; bytes: number } | null = null;
  @state() private busy: string | null = null;
  @state() private tick = 0;
  @state() private pos = { left: 24, right: 78, bottom: 70 };
  private unsubscribe = () => {};

  /** The backup categories ticked in the given dialog. */
  private checkedCategories(prefix: "backup" | "restore"): string[] {
    return BACKUP_CATEGORIES.filter(
      (c) =>
        (
          this.renderRoot.querySelector(
            `#${prefix}-${c.id}`,
          ) as HTMLInputElement | null
        )?.checked,
    ).map((c) => c.id);
  }

  /** Send the chosen .knxproj to the add-on, then continue with the password step. */
  private async uploadProject(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    this.uploading = true;
    try {
      const res = await fetch(
        `api/project/upload?name=${encodeURIComponent(file.name)}`,
        { method: "PUT", body: file },
      );
      const body = (await res.json()) as { path?: string; error?: string };
      if (!res.ok || !body.path)
        throw new ApiError(res.status, body.error ?? res.statusText);
      this.importPath = body.path;
      this.dialog = "import-password";
    } catch (err) {
      store.say(err instanceof ApiError ? err.message : String(err), "danger");
    } finally {
      this.uploading = false;
    }
  }

  private savePos(key: "left" | "right" | "bottom", e: Event): void {
    if (e.target !== e.currentTarget) return; // a nested panel's reposition bubbling up
    const p = (e.target as HTMLElement & { position: number }).position;
    if (typeof p !== "number" || p === this.pos[key]) return;
    this.pos = { ...this.pos, [key]: p };
    try {
      localStorage.setItem("xknx.split", JSON.stringify(this.pos));
    } catch {
      /* storage unavailable */
    }
  }

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = store.subscribe(() => {
      this.tick++;
    });
    store.start();
    void api.get<{ language?: string }>("api/status").then(
      (s) => {
        this.uiLang = initLanguage(s.language);
      },
      () => undefined,
    );
    try {
      const saved = JSON.parse(localStorage.getItem("xknx.split") ?? "null");
      if (saved && typeof saved.left === "number") this.pos = saved;
    } catch {
      /* ignore */
    }
    window.addEventListener("keydown", this.onKey);
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    window.removeEventListener("keydown", this.onKey);
    super.disconnectedCallback();
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey && store.project.can_undo) {
      e.preventDefault();
      void this.run("undo", () => api.post("api/project/undo"));
    } else if (
      (k === "y" || (k === "z" && e.shiftKey)) &&
      store.project.can_redo
    ) {
      e.preventDefault();
      void this.run("redo", () => api.post("api/project/redo"));
    } else if (k === "o") {
      e.preventDefault();
      this.dialog = "open";
    }
  };

  private async run(label: string, fn: () => Promise<unknown>): Promise<void> {
    this.busy = label;
    try {
      await fn();
      await store.refresh();
      this.dialog = null;
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    } finally {
      this.busy = null;
    }
  }

  private value(id: string): string {
    return (
      (this.renderRoot.querySelector(`#${id}`) as HTMLInputElement | null)
        ?.value ?? ""
    );
  }

  private onMenu(e: CustomEvent<{ item: HTMLElement }>): void {
    const action = e.detail.item.getAttribute("value") ?? "";
    if (action.startsWith("recent:")) {
      const r = store.project.recent?.[Number(action.slice(7))];
      if (r)
        void this.run("open", () =>
          api.post("api/project/open", { path: r.path }),
        );
      return;
    }
    if (action === "recent-clear") {
      void this.run("recent-clear", async () => {
        await api.post("api/project/recent/forget", {});
      });
      return;
    }
    if (action.startsWith("csv:")) {
      const a = document.createElement("a");
      a.href = `api/export/${action.slice(4)}.csv`;
      a.download = "";
      document.body.append(a);
      a.click();
      a.remove();
      return;
    }
    if (action.startsWith("dpt:")) {
      setDptStyle(action.slice(4) as DptStyle);
      store.notify();
      this.requestUpdate();
      return;
    }
    if (action.startsWith("lang:")) {
      setLanguage(action.slice(5) as "en" | "nl" | "de");
      this.uiLang = language();
      store.notify();
      return;
    }
    switch (action) {
      case "new":
      case "open":
      case "import":
      case "save-copy":
      case "backup":
      case "restore":
      case "export":
        this.dialog = action;
        break;
      case "close":
        void this.run("close", () => api.post("api/project/close"));
        break;
      case "undo":
        void this.run("undo", () => api.post("api/project/undo"));
        break;
      case "redo":
        void this.run("redo", () => api.post("api/project/redo"));
        break;
      case "logkey":
        this.dialog = "logkey";
        void api.get<NonNullable<typeof this.logKey>>("api/ets-log-key").then(
          (s) => (this.logKey = s),
          () => undefined,
        );
        break;
      case "signing":
        this.dialog = "signing";
        void api.get<NonNullable<typeof this.signing>>("api/signing-key").then(
          (s) => (this.signing = s),
          () => undefined,
        );
        break;
      case "licences":
        this.dialog = "licences";
        void api.get<NonNullable<typeof this.licences>>("api/licences").then(
          (s) => (this.licences = s),
          () => undefined,
        );
        break;
      case "about":
        this.dialog = "about";
        void api.get<NonNullable<typeof this.about>>("api/status").then(
          (s) => (this.about = s),
          () => undefined,
        );
        break;
      case "toggle-right":
        store.toggleRight();
        break;
      case "toggle-bottom":
        store.toggleBottom();
        break;
      default:
        if (action.startsWith("left:"))
          store.setLeft(action.slice(5) as LeftTab);
        if (action.startsWith("center:"))
          store.setCenter(action.slice(7) as CenterTab);
        if (action.startsWith("right:"))
          store.setRight(action.slice(6) as RightTab);
        if (action.startsWith("bottom:"))
          store.setBottom(action.slice(7) as BottomTab);
    }
  }

  private tabs<T extends string>(
    items: { id: T; label: string }[],
    active: T,
    set: (id: T) => void,
    close?: () => void,
  ): TemplateResult {
    return html`<div class="tabs">
      ${items.map((t) => html`<button class=${active === t.id ? "active" : ""} @click=${() => set(t.id)}>${tr(t.label)}</button>`)}
      ${close ? html`<button class="close" title="Hide" @click=${close}>✕</button>` : nothing}
    </div>`;
  }

  render() {
    const p = store.project;
    const menu = (label: string, items: unknown) =>
      html`<sl-dropdown hoist
        ><button class="menu" slot="trigger">${label}</button
        ><sl-menu @sl-select=${this.onMenu}>${items}</sl-menu></sl-dropdown
      >`;
    const check = <T extends string>(
      prefix: string,
      items: { id: T; label: string }[],
      active: T,
    ) =>
      items.map(
        (t) =>
          html`<sl-menu-item
            value="${prefix}:${t.id}"
            type="checkbox"
            ?checked=${active === t.id}
            >${tr(t.label)}</sl-menu-item
          >`,
      );
    return html`
      <header>
        <span class="title"
          ><img class="logo" src="logo.svg" alt="" width="20" height="20" />XKNX
          Editor</span
        >
        ${menu(
          tr("File"),
          html` <sl-menu-item value="new">${tr("New project…")}</sl-menu-item>
            <sl-menu-item value="open"
              >${tr("Open project…")}
              <span slot="suffix" class="hint">Ctrl+O</span></sl-menu-item
            >
            <sl-menu-item value="import"
              >${tr("Import project (.knxproj)…")}</sl-menu-item
            >
            <sl-divider></sl-divider>
            <sl-menu-item value="save-copy" ?disabled=${!p.open}
              >${tr("Save a copy…")}</sl-menu-item
            >
            <sl-divider></sl-divider>
            <sl-menu-item value="backup"
              >${tr("Back up catalog and settings…")}</sl-menu-item
            >
            <sl-menu-item value="restore"
              >${tr("Restore from backup…")}</sl-menu-item
            >
            <sl-menu-item value="export" ?disabled=${!p.open}
              >${tr("Export project (.knxproj)…")}</sl-menu-item
            >
            <sl-menu-item ?disabled=${!p.open}
              >${tr("Export table as CSV")}
              <sl-menu slot="submenu">
                ${CSV_EXPORTS.map((x) => html`<sl-menu-item value="csv:${x.id}">${tr(x.label)}</sl-menu-item>`)}
              </sl-menu></sl-menu-item
            >
            <sl-menu-item disabled
              ><span class="hint"
                >${p.open && p.saved_at ? `${tr("Saved automatically")} · ${new Date(p.saved_at).toLocaleString()}` : tr("Edits are saved to the project file as you make them")}</span
              ></sl-menu-item
            >
            <sl-divider></sl-divider>
            <sl-menu-item value="close" ?disabled=${!p.open}
              >${tr("Close project")}</sl-menu-item
            >
            ${
              p.recent?.length
                ? html`<sl-divider></sl-divider>
                    <sl-menu-label>${tr("Recent projects")}</sl-menu-label>
                    ${p.recent.map((r, i) => html`<sl-menu-item value="recent:${i}" ?disabled=${r.open} title=${r.path}>${r.name}${r.open ? html` <span class="hint">(${tr("open")})</span>` : nothing}</sl-menu-item>`)}
                    <sl-menu-item value="recent-clear"
                      ><span class="hint"
                        >${tr("Clear list")}</span
                      ></sl-menu-item
                    >`
                : nothing
            }`,
        )}
        ${menu(
          tr("Edit"),
          html` <sl-menu-item value="undo" ?disabled=${!p.can_undo}
              >${tr("Undo")}
              <span slot="suffix" class="hint">Ctrl+Z</span></sl-menu-item
            >
            <sl-menu-item value="redo" ?disabled=${!p.can_redo}
              >${tr("Redo")}
              <span slot="suffix" class="hint">Ctrl+Y</span></sl-menu-item
            >`,
        )}
        ${menu(
          tr("View"),
          html` ${check("left", LEFT, store.left)}<sl-divider
            ></sl-divider> ${check("center", CENTER, store.center)}<sl-divider
            ></sl-divider>
            ${check("right", RIGHT, store.right)}
            <sl-menu-item
              value="toggle-right"
              type="checkbox"
              ?checked=${store.rightOpen}
              >${tr("Show right panel")}</sl-menu-item
            >
            <sl-divider></sl-divider>
            ${check("bottom", BOTTOM, store.bottom)}
            <sl-menu-item
              value="toggle-bottom"
              type="checkbox"
              ?checked=${store.bottomOpen}
              >${tr("Show bottom panel")}</sl-menu-item
            >
            <sl-divider></sl-divider>
            <sl-menu-label>${tr("Datapoint types")}</sl-menu-label>
            ${DPT_STYLES.map((x) => html`<sl-menu-item value="dpt:${x.id}" type="checkbox" ?checked=${dptStyle() === x.id}>${tr(x.label)}</sl-menu-item>`)}
            <sl-divider></sl-divider>
            <sl-menu-label>${tr("Language")}</sl-menu-label>
            ${LANGUAGES.map((l) => html`<sl-menu-item value="lang:${l.id}" type="checkbox" ?checked=${this.uiLang === l.id}>${l.label}</sl-menu-item>`)}`,
        )}
        ${menu(tr("Help"), html`<sl-menu-item value="signing">${tr("Signing key…")}</sl-menu-item><sl-menu-item value="logkey">${tr("Project log key…")}</sl-menu-item><sl-menu-item value="licences">${tr("Third-party licences…")}</sl-menu-item><sl-divider></sl-divider><sl-menu-item value="about">${tr("About XKNX Editor")}</sl-menu-item>`)}
        <span class="project" title=${p.path ?? ""}
          >${p.open ? html`${p.name} · ${p.device_count} ${tr("devices")}` : tr("No project open")}</span
        >
        <xknx-gateway-menu style="margin-left:12px"></xknx-gateway-menu>
      </header>
      <sl-split-panel
        class="docks"
        position=${this.pos.left}
        @sl-reposition=${(e: Event) => this.savePos("left", e)}
      >
        <div slot="start" class="pane">
          ${this.tabs(LEFT, store.left, (t) => store.setLeft(t))}
          <div class="body">${this.renderLeft()}</div>
        </div>
        <sl-split-panel
          slot="end"
          class=${store.rightOpen ? "" : "collapsed"}
          position=${store.rightOpen ? this.pos.right : 100}
          ?disabled=${!store.rightOpen}
          @sl-reposition=${(e: Event) => store.rightOpen && this.savePos("right", e)}
        >
          <sl-split-panel
            slot="start"
            vertical
            class=${store.bottomOpen ? "" : "collapsed"}
            position=${store.bottomOpen ? this.pos.bottom : 100}
            ?disabled=${!store.bottomOpen}
            @sl-reposition=${(e: Event) => store.bottomOpen && this.savePos("bottom", e)}
          >
            <div slot="start" class="pane" style="border-right:0">
              ${this.tabs(CENTER, store.center, (t) => store.setCenter(t))}
              <div class="body">${this.renderCenter()}</div>
            </div>
            <div slot="end" class="pane bottom" ?hidden=${!store.bottomOpen}>
              ${this.tabs(
                BOTTOM,
                store.bottom,
                (t) => store.setBottom(t),
                () => store.toggleBottom(),
              )}
              <div class="body">${this.renderBottom()}</div>
            </div>
          </sl-split-panel>
          <div slot="end" class="pane right" ?hidden=${!store.rightOpen}>
            ${this.tabs(
              RIGHT,
              store.right,
              (t) => store.setRight(t),
              () => store.toggleRight(),
            )}
            <div class="body">${this.renderRight()}</div>
          </div>
        </sl-split-panel>
      </sl-split-panel>
      ${store.toast ? html`<sl-alert class="toast" variant=${store.toast.variant} open closable @sl-after-hide=${() => store.dismiss()}>${store.toast.message}</sl-alert>` : nothing}
      ${this.renderDialog()}
    `;
  }

  private renderLeft() {
    switch (store.left) {
      case "topology":
        return html`<xknx-device-tree></xknx-device-tree>`;
      case "devices":
        return html`<xknx-devices-list></xknx-devices-list>`;
      case "buildings":
        return html`<xknx-spaces-view></xknx-spaces-view>`;
      case "group-addresses":
        return html`<xknx-ga-view></xknx-ga-view>`;
    }
  }

  private renderCenter() {
    switch (store.center) {
      case "editor":
        if (store.focus === "ga" && store.selectedGroupAddress !== null)
          return html`<xknx-ga-panel
            .gaId=${store.selectedGroupAddress}
          ></xknx-ga-panel>`;
        if (store.focus === "space" && store.selectedSpace !== null)
          return html`<xknx-space-panel
            .spaceId=${store.selectedSpace}
          ></xknx-space-panel>`;
        if (store.focus === "line" && store.selectedLine)
          return html`<xknx-line-panel
            .area=${store.selectedLine.area}
            .line=${store.selectedLine.line}
          ></xknx-line-panel>`;
        return store.selectedDevice !== null
          ? html`<xknx-device-panel
              .deviceId=${store.selectedDevice}
            ></xknx-device-panel>`
          : html`<div class="empty">
              ${store.project.open ? tr("Select a device, line, group address or building on the left.") : tr("Open, create or import a project from the File menu.")}
            </div>`;
      case "overview":
        return html`<xknx-overview-view></xknx-overview-view>`;
      case "masslink":
        return html`<xknx-mass-linker-view></xknx-mass-linker-view>`;
      case "tools":
        return html`<xknx-tools-view></xknx-tools-view>`;
      case "recover":
        return html`<xknx-recover-view></xknx-recover-view>`;
      case "secure":
        return html`<xknx-secure-view></xknx-secure-view>`;
      case "docs":
        return html`<xknx-docs-view></xknx-docs-view>`;
      case "ai":
        return html`<xknx-ai-view></xknx-ai-view>`;
      case "network":
        return html`<xknx-network-view></xknx-network-view>`;
      case "compare":
        return html`<xknx-compare-view></xknx-compare-view>`;
      case "manufacturers":
        return html`<xknx-manufacturers-view></xknx-manufacturers-view>`;
      case "objects":
        return html`<xknx-objects-view></xknx-objects-view>`;
    }
  }

  private renderBottom() {
    switch (store.bottom) {
      case "catalog":
        return html`<xknx-catalog-view
          style="height:100%;overflow:auto"
        ></xknx-catalog-view>`;
      case "charts":
        return html`<xknx-charts-view style="height:100%"></xknx-charts-view>`;
      case "stats":
        return html`<xknx-stats-view
          style="height:100%;overflow:auto"
        ></xknx-stats-view>`;
      default:
        return html`<xknx-monitor-view
          style="height:100%"
        ></xknx-monitor-view>`;
    }
  }

  private renderRight() {
    switch (store.right) {
      case "history":
        return html`<xknx-history-view></xknx-history-view>`;
      case "project":
        return html`<xknx-project-info></xknx-project-info>`;
      case "health":
        return html`<xknx-health-view></xknx-health-view>`;
    }
  }

  private renderDialog() {
    const chosen =
      (kind: "open" | "import") => (e: CustomEvent<{ path: string }>) => {
        if (kind === "open")
          void this.run("open", () =>
            api.post("api/project/open", { path: e.detail.path }),
          );
        else {
          this.importPath = e.detail.path;
          this.dialog = "import-password";
        }
      };
    return html`
      <xknx-file-dialog
        label=${tr("Open project")}
        ext=".xknx"
        confirmLabel="Open"
        ?open=${this.dialog === "open"}
        @file-chosen=${chosen("open")}
        @sl-after-hide=${() => this.dialog === "open" && (this.dialog = null)}
      ></xknx-file-dialog>
      <xknx-file-dialog
        label=${tr("Import project from /share")}
        ext=".knxproj"
        confirmLabel="Next"
        ?open=${this.dialog === "import-share"}
        @file-chosen=${chosen("import")}
        @sl-after-hide=${() => this.dialog === "import-share" && (this.dialog = null)}
      ></xknx-file-dialog>
      <sl-dialog
        label=${tr("Import project")}
        ?open=${this.dialog === "import"}
        @sl-after-hide=${() => this.dialog === "import" && (this.dialog = null)}
      >
        <p class="hint" style="margin-top:0">
          ${tr("Pick the .knxproj export on this computer; it is sent to the add-on and imported. Password-protected exports are fine, the password is asked next.")}
        </p>
        <input
          id="import-file"
          type="file"
          accept=".knxproj"
          hidden
          @change=${(e: Event) => this.uploadProject(e)}
        />
        <sl-button
          variant="primary"
          ?loading=${this.uploading}
          @click=${() => (this.renderRoot.querySelector("#import-file") as HTMLInputElement).click()}
          >${icon("upload", 14)}
          ${tr("Choose a .knxproj on this computer…")}</sl-button
        >
        <div class="hint" style="margin-top:12px">
          ${tr("Or take one that is already on the Home Assistant share:")}
          <sl-button size="small" @click=${() => (this.dialog = "import-share")}
            >${tr("Pick a file on /share…")}</sl-button
          >
        </div>
      </sl-dialog>
      <sl-dialog
        label=${tr("New project")}
        ?open=${this.dialog === "new"}
        @sl-after-hide=${() => (this.dialog = null)}
      >
        <div class="row">
          <sl-input
            id="new-name"
            label=${tr("Name")}
            value="New project"
          ></sl-input>
        </div>
        <div class="row">
          <sl-select
            id="new-style"
            label=${tr("Group address style")}
            value="ThreeLevel"
            hoist
          >
            <sl-option value="ThreeLevel"
              >${tr("Three level (1/2/3)")}</sl-option
            >
            <sl-option value="TwoLevel">${tr("Two level (1/2)")}</sl-option>
            <sl-option value="Free">${tr("Free")}</sl-option>
          </sl-select>
        </div>
        <span class="hint"
          >${tr("Created under /config/projects. Area 1 / line 1 are ready for devices.")}</span
        >
        <sl-button
          slot="footer"
          variant="primary"
          ?loading=${this.busy === "new"}
          @click=${() => this.run("new", () => api.post("api/project/new", { name: this.value("new-name"), style: this.value("new-style") }))}
          >${tr("Create")}</sl-button
        >
      </sl-dialog>
      <sl-dialog
        label=${tr("Import project")}
        ?open=${this.dialog === "import-password"}
        @sl-after-hide=${() => (this.dialog = null)}
      >
        <div class="row">
          <code style="font-size:12px;overflow-wrap:anywhere"
            >${this.importPath}</code
          >
        </div>
        <div class="row">
          <sl-input
            id="import-password"
            type="password"
            label=${tr("Project password (leave empty if the export is not protected)")}
            password-toggle
          ></sl-input>
        </div>
        <span class="hint"
          >Every device is read from the archive; large projects take a
          while.</span
        >
        <sl-button
          slot="footer"
          variant="primary"
          ?loading=${this.busy === "import"}
          @click=${() =>
            this.run("import", async () => {
              const job = await api.post<Job>("api/project/import", {
                path: this.importPath,
                password: this.value("import-password"),
              });
              await api.waitJob(job);
              store.say(tr("Project imported"), "success");
            })}
          >${tr("Import")}</sl-button
        >
      </sl-dialog>
      <sl-dialog
        label=${tr("Back up catalog and settings")}
        ?open=${this.dialog === "backup"}
        @sl-after-hide=${() => this.dialog === "backup" && (this.dialog = null)}
      >
        <p class="hint">
          ${tr("Everything under /config that is not a project, in one archive: the imported product data, the document library, the gateway settings, the keys, and the decrypted project logs. Projects are backed up with Save a copy.")}
        </p>
        <p class="hint" style="color:var(--ha-warning)">
          ${tr("With Settings and Keys included, the archive holds the signing key, the project log key and the keyring password in plain form. Treat it like a password file.")}
        </p>
        <sl-input
          id="backup-path"
          label=${tr("File")}
          placeholder="/share/xknx-editor-backups/xknx-editor-backup-<date>.zip"
        ></sl-input>
        <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:8px">
          ${BACKUP_CATEGORIES.map(
            (c) =>
              html`<sl-checkbox
                id=${`backup-${c.id}`}
                ?checked=${c.id !== "telegrams"}
                >${tr(c.label)}</sl-checkbox
              >`,
          )}
        </div>
        ${this.backupResult ? html`<p style="margin-top:12px">${tr("Written")}: ${this.backupResult.path} (${Math.round(this.backupResult.bytes / 1024)} kB) · <a href=${`api/backup/download?path=${encodeURIComponent(this.backupResult.path)}`} download>${tr("Download")}</a></p>` : nothing}
        <sl-button slot="footer" @click=${() => (this.dialog = null)}
          >${tr("Close")}</sl-button
        >
        <sl-button
          slot="footer"
          variant="primary"
          ?loading=${this.busy === "backup"}
          @click=${() =>
            this.run("backup", async () => {
              const job = await api.waitJob(
                await api.post<Job>("api/backup", {
                  path: this.value("backup-path") || undefined,
                  include: this.checkedCategories("backup"),
                }),
              );
              this.backupResult = job.result as { path: string; bytes: number };
              store.say(tr("Backup written"), "success");
            })}
          >${tr("Back up")}</sl-button
        >
      </sl-dialog>
      <sl-dialog
        label=${tr("Restore from backup")}
        ?open=${this.dialog === "restore"}
        @sl-after-hide=${() => this.dialog === "restore" && (this.dialog = null)}
      >
        <p class="hint">
          ${tr("Restoring adds what is in the archive; it never deletes anything already here. Product data is re-imported, so restoring an older backup over a newer catalog only fills gaps.")}
        </p>
        <div style="display:flex;gap:8px;align-items:end">
          <sl-input
            id="restore-path"
            label=${tr("Backup file on /share")}
            placeholder="/share/xknx-editor-backups/xknx-editor-backup-….zip"
            style="flex:1"
          ></sl-input>
          <sl-button size="small" @click=${() => (this.restoreBrowse = true)}
            >${icon("open", 14)} ${tr("Browse /share")}</sl-button
          >
        </div>
        <xknx-file-dialog
          label=${tr("Pick a backup")}
          ext=".zip"
          confirmLabel=${tr("Choose")}
          ?open=${this.restoreBrowse}
          @sl-after-hide=${() => (this.restoreBrowse = false)}
          @file-chosen=${(e: CustomEvent<{ path: string }>) => {
            this.restoreBrowse = false;
            (
              this.renderRoot.querySelector("#restore-path") as HTMLInputElement
            ).value = e.detail.path;
          }}
        ></xknx-file-dialog>
        <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:8px">
          ${BACKUP_CATEGORIES.map(
            (c) =>
              html`<sl-checkbox
                id=${`restore-${c.id}`}
                ?checked=${c.id !== "telegrams"}
                >${tr(c.label)}</sl-checkbox
              >`,
          )}
        </div>
        <sl-button slot="footer" @click=${() => (this.dialog = null)}
          >${tr("Cancel")}</sl-button
        >
        <sl-button
          slot="footer"
          variant="primary"
          ?loading=${this.busy === "restore"}
          @click=${() =>
            this.run("restore", async () => {
              const job = await api.waitJob(
                await api.post<Job>("api/backup/restore", {
                  path: this.value("restore-path"),
                  include: this.checkedCategories("restore"),
                }),
              );
              const r = job.result as { counts: Record<string, number> };
              store.say(
                `${tr("Restored")}: ${Object.entries(r.counts)
                  .map(([k, n]) => `${k} ${n}`)
                  .join(", ")}`,
                "success",
              );
              this.dialog = null;
            })}
          >${tr("Restore")}</sl-button
        >
      </sl-dialog>
      <sl-dialog
        label=${tr("Save a copy")}
        ?open=${this.dialog === "save-copy"}
        @sl-after-hide=${() => this.dialog === "save-copy" && (this.dialog = null)}
      >
        <p class="hint">
          ${tr("Every edit is written to the project file immediately, so this is for backups or for moving the project to another Home Assistant. Paths under /share are visible from the network share.")}
        </p>
        <sl-input
          id="copy-path"
          label="File"
          value=${`/share/${(store.project.name ?? "project").replace(/[^\w .-]+/g, "_")} copy.xknx`}
        ></sl-input>
        <sl-checkbox id="copy-overwrite" style="margin-top:8px"
          >${tr("Overwrite if it exists")}</sl-checkbox
        >
        <sl-button slot="footer" @click=${() => (this.dialog = null)}
          >${tr("Cancel")}</sl-button
        >
        <sl-button
          slot="footer"
          variant="primary"
          ?loading=${this.busy === "save-copy"}
          @click=${() =>
            this.run("save-copy", async () => {
              const r = await api.post<{ path: string; bytes: number }>(
                "api/project/save-copy",
                {
                  path: this.value("copy-path"),
                  overwrite:
                    (
                      this.renderRoot.querySelector(
                        "#copy-overwrite",
                      ) as HTMLInputElement | null
                    )?.checked ?? false,
                },
              );
              store.say(`Copy written to ${r.path}`, "success");
            })}
          >${tr("Save copy")}</sl-button
        >
      </sl-dialog>
      <sl-dialog
        label=${tr("Export project")}
        ?open=${this.dialog === "export"}
        @sl-after-hide=${() => this.dialog === "export" && (this.dialog = null)}
      >
        <p class="hint">
          Writes a .knxproj that imports, with the manufacturer data of every
          device bundled from the catalog. Devices whose product data is missing
          from the catalog are exported without it and the import may refuse the
          file; the result lists them.
        </p>
        <sl-input
          id="export-path"
          label="File"
          value=${`/share/${(store.project.name ?? "project").replace(/[^\w .-]+/g, "_")}.knxproj`}
        ></sl-input>
        <sl-select
          id="export-schema"
          label=${tr("Format")}
          value="20"
          hoist
          style="margin-top:8px"
        >
          <sl-option value="20">${tr("project/20 (recommended)")}</sl-option>
          <sl-option value="23">${tr("project/23")}</sl-option>
          <sl-option value="22">${tr("project/22")}</sl-option>
          <sl-option value="14">${tr("project/14 (older)")}</sl-option>
        </sl-select>
        <sl-checkbox id="export-overwrite" style="margin-top:8px"
          >${tr("Overwrite if it exists")}</sl-checkbox
        >
        <sl-button slot="footer" @click=${() => (this.dialog = null)}
          >${tr("Cancel")}</sl-button
        >
        <sl-button
          slot="footer"
          variant="primary"
          ?loading=${this.busy === "export"}
          @click=${() =>
            this.run("export", async () => {
              let job = await api.post<Job>("api/project/export", {
                path: this.value("export-path"),
                schema: this.value("export-schema") || "20",
                overwrite:
                  (
                    this.renderRoot.querySelector(
                      "#export-overwrite",
                    ) as HTMLInputElement | null
                  )?.checked ?? false,
              });
              while (job.status === "queued" || job.status === "running") {
                await new Promise((r) => setTimeout(r, 500));
                job = await api.get<Job>(`api/jobs/${job.id}`);
              }
              if (job.status === "failed")
                throw new ApiError(500, job.error ?? "Export failed");
              const r = job.result as {
                path: string;
                bytes: number;
                schema: string;
                skipped_refs: string[];
                missing_references: string[];
                unverifiable_folders: string[];
              };
              const warn = [
                ...(r.skipped_refs.length
                  ? [
                      `${r.skipped_refs.length} device program(s) without product data`,
                    ]
                  : []),
                ...(r.missing_references.length
                  ? [`${r.missing_references.length} missing reference(s)`]
                  : []),
                ...(r.unverifiable_folders.length
                  ? ["folders without a verifiable signature"]
                  : []),
              ];
              store.say(
                `Exported ${r.path} (project/${r.schema}, ${Math.round(r.bytes / 1024)} kB)${warn.length ? `; the import may complain: ${warn.join(", ")}` : ""}`,
                warn.length ? "primary" : "success",
              );
            })}
          >${tr("Export")}</sl-button
        >
      </sl-dialog>
      <sl-dialog
        label=${tr("Project log key")}
        ?open=${this.dialog === "logkey"}
        @sl-after-hide=${() => this.dialog === "logkey" && (this.dialog = null)}
        style="--width: 640px"
      >
        <p class="hint">
          ${tr(
            "Every comment in a project's log is encrypted. The key is a constant inside the commissioning tool itself, the same on every installation, so the add-on does not ship it. Extract it once from your own installation and paste the lines below. It is stored under /config only. With the key present the log reads normally, and entries the add-on writes stay readable when the project goes back.",
          )}
        </p>
        <p>
          ${this.logKey ? (this.logKey.present ? html`<span style="color:var(--ha-success)">${tr("Key stored")}</span> (${this.logKey.key_preview})` : html`<span style="color:var(--ha-warning)">${tr("No key stored.")}</span> ${tr("Without it the log can only be read from a file decrypted elsewhere and imported in the Project dock.")}`) : "…"}
        </p>
        <sl-details
          summary=${tr("Extract the key on the Windows PC (PowerShell)")}
        >
          <p class="hint">
            ${tr(
              "Adjust the folder if needed, run the line, and copy the key=, iv= and marker= lines:",
            )}
          </p>
          <pre
            style="white-space:pre-wrap;word-break:break-all;font-size:11px;background:color-mix(in srgb, var(--ha-text) 6%, transparent);padding:8px;border-radius:6px"
          >
${this.logKey?.extract_powershell ?? ""}</pre>
        </sl-details>
        <sl-textarea
          id="logkey-text"
          label=${tr("Key (key= / iv= / marker= lines)")}
          rows="4"
          placeholder="key=…&#10;iv=…&#10;marker=…"
          style="margin-top:8px"
        ></sl-textarea>
        <sl-button
          slot="footer"
          ?disabled=${!this.logKey?.present}
          @click=${() =>
            this.run("logkey-clear", async () => {
              this.logKey =
                await api.delete<NonNullable<typeof this.logKey>>(
                  "api/ets-log-key",
                );
              store.say(tr("Project log key removed"), "success");
            })}
          >${tr("Remove key")}</sl-button
        >
        <sl-button slot="footer" @click=${() => (this.dialog = null)}
          >${tr("Close")}</sl-button
        >
        <sl-button
          slot="footer"
          variant="primary"
          ?loading=${this.busy === "logkey"}
          @click=${() =>
            this.run("logkey", async () => {
              this.logKey = await api.post<NonNullable<typeof this.logKey>>(
                "api/ets-log-key",
                { text: this.value("logkey-text") },
              );
              store.say(tr("Project log key stored"), "success");
            })}
          >${tr("Save key")}</sl-button
        >
      </sl-dialog>
      <sl-dialog
        label=${tr("Signing key")}
        ?open=${this.dialog === "signing"}
        @sl-after-hide=${() => this.dialog === "signing" && (this.dialog = null)}
        style="--width: 640px"
      >
        <p class="hint">
          Exported .knxproj files are signed. The add-on ships only a
          placeholder key, which is accepted on import but not treated as a
          genuine signature. The genuine converter key sits in your own
          installation; read it there and paste the three lines below. It is
          stored under /config only and never written into a project.
        </p>
        <p>
          ${this.signing ? (this.signing.placeholder ? html`<span style="color:var(--ha-warning)">${tr("Placeholder key in use")}</span> (signatures are not accepted as genuine).` : html`<span style="color:var(--ha-success)">${tr("Genuine key set")}</span>: ${this.signing.bits}-bit RSA, modulus ${this.signing.modulus_preview}.`) : "…"}
        </p>
        <sl-details
          summary=${tr("Extract the key on the Windows PC (PowerShell)")}
        >
          <p class="hint">
            Adjust the folder if needed, run, and copy the MOD=, EXP= and D=
            lines:
          </p>
          <pre
            style="white-space:pre-wrap;word-break:break-all;font-size:11px;background:color-mix(in srgb, var(--ha-text) 6%, transparent);padding:8px;border-radius:6px"
          >
${this.signing?.extract_powershell ?? ""}</pre>
        </sl-details>
        <sl-textarea
          id="signing-text"
          label=${tr("Key (MOD= / EXP= / D= lines, or hex)")}
          rows="4"
          placeholder="MOD=…&#10;EXP=AQAB&#10;D=…"
          style="margin-top:8px"
        ></sl-textarea>
        <sl-button
          slot="footer"
          ?disabled=${!this.signing || this.signing.placeholder}
          @click=${() =>
            this.run("signing-clear", async () => {
              this.signing =
                await api.delete<NonNullable<typeof this.signing>>(
                  "api/signing-key",
                );
              store.say(tr("Reverted to the placeholder key"), "success");
            })}
          >${tr("Reset to placeholder")}</sl-button
        >
        <sl-button slot="footer" @click=${() => (this.dialog = null)}
          >${tr("Close")}</sl-button
        >
        <sl-button
          slot="footer"
          variant="primary"
          ?loading=${this.busy === "signing"}
          @click=${() =>
            this.run("signing", async () => {
              this.signing = await api.post<NonNullable<typeof this.signing>>(
                "api/signing-key",
                { text: this.value("signing-text") },
              );
              store.say(tr("Signing key stored"), "success");
            })}
          >${tr("Save key")}</sl-button
        >
      </sl-dialog>
      <sl-dialog
        label=${tr("Third-party licences")}
        ?open=${this.dialog === "licences"}
        @sl-after-hide=${() => this.dialog === "licences" && (this.dialog = null)}
        style="--width: 720px"
      >
        <p class="hint">
          Everything installed in this add-on's Python environment, read from
          package metadata, plus the frontend libraries. The add-on is
          GPL-2.0-only.
        </p>
        ${
          this.licences
            ? html`<div style="max-height:50vh;overflow:auto">
                <table
                  style="border-collapse:collapse;width:100%;font-size:12px"
                >
                  <tr>
                    <th style="text-align:left;padding:4px 8px">
                      ${tr("Package")}
                    </th>
                    <th style="text-align:left;padding:4px 8px">
                      ${tr("Version")}
                    </th>
                    <th style="text-align:left;padding:4px 8px">
                      ${tr("Licence")}
                    </th>
                  </tr>
                  ${this.licences.items.map(
                    (i) =>
                      html`<tr>
                        <td
                          style="padding:3px 8px;border-top:1px solid var(--ha-divider)"
                        >
                          ${i.name}
                        </td>
                        <td
                          style="padding:3px 8px;border-top:1px solid var(--ha-divider)"
                        >
                          ${i.version}
                        </td>
                        <td
                          style="padding:3px 8px;border-top:1px solid var(--ha-divider)"
                        >
                          ${i.licence}
                        </td>
                      </tr>`,
                  )}
                  ${this.licences.frontend.map(
                    (i) =>
                      html`<tr>
                        <td
                          style="padding:3px 8px;border-top:1px solid var(--ha-divider)"
                        >
                          ${i.name} <span class="hint">(frontend)</span>
                        </td>
                        <td
                          style="padding:3px 8px;border-top:1px solid var(--ha-divider)"
                        ></td>
                        <td
                          style="padding:3px 8px;border-top:1px solid var(--ha-divider)"
                        >
                          ${i.licence}
                        </td>
                      </tr>`,
                  )}
                </table>
              </div>`
            : html`<p class="hint">${tr("Loading…")}</p>`
        }
        <sl-button slot="footer" @click=${() => (this.dialog = null)}
          >${tr("Close")}</sl-button
        >
      </sl-dialog>
      <sl-dialog
        label="About XKNX Editor"
        ?open=${this.dialog === "about"}
        @sl-after-hide=${() => (this.dialog = null)}
        style="--width: 640px"
      >
        <p style="display:flex;align-items:center;gap:12px;margin-top:0">
          <img
            src="logo.svg"
            alt=""
            width="48"
            height="48"
            style="border-radius:11px"
          /><span
            ><strong>XKNX Editor</strong> add-on for Home Assistant<br /><span
              class="hint"
              >Add-on ${this.about?.version ?? ""}</span
            ></span
          >
        </p>
        <p>
          <strong
            >${tr("Experimental software. Not affiliated with the KNX Association.")}</strong
          >${tr("XKNX Editor comes with no stability or safety guarantees. It writes to real KNX hardware: a failed or interrupted download can leave a device unloaded until it is reprogrammed. Do not use it on an installation you cannot afford to take offline, and keep a known-good backup of any project before opening it here.")}
        </p>
        <p>
          Verified device coverage is small. The device-programming code is
          based on XKNX Toolkit, which describes itself as alpha software not
          intended for end users; the programming support here goes beyond it
          and has correspondingly less mileage. Large parts of the upstream
          editor were built using LLMs.
        </p>
        <p>
          "KNX" and "ETS" are trademarks of the KNX Association, used only to
          state this non-affiliation and to describe interoperability with the
          published standard and file formats. This is an independent project,
          not affiliated with, endorsed by, or connected to the KNX Association
          or its ETS software.
        </p>
        <p>
          <strong>Licence.</strong> Add-on: Copyright (C) 2026 Ron Klinkien
          (cyberjunky). Editor packages: Copyright (C) 2026 knx-ai (XKNX
          Editor), based on xknxtoolkit by kewde (GPL-2.0-only since
          2026-09-06). All GPL-2.0-only. The copyleft is inherited from
          xknxproject (.knxproj import). Built on the xknx library (MIT) and the
          MCP Python SDK (MIT). This program comes with ABSOLUTELY NO WARRANTY;
          it is free software and you are welcome to redistribute it under the
          terms of the GNU General Public License version 2. See the LICENSE
          files shipped in /usr/share/licenses inside the add-on.
        </p>
        <p class="hint">
          MCP server:
          ${this.about?.mcp?.enabled ? html`enabled at <code>http://&lt;home-assistant&gt;:${this.about.mcp.port ?? "<port>"}/mcp</code> with ${this.about.mcp.tools.length} tools (bearer token from the mcp_token option)` : "disabled; set the mcp_token add-on option to enable it"}.
        </p>
      </sl-dialog>
    `;
  }
}
