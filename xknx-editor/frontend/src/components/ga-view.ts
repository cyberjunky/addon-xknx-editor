import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api, ApiError, type GroupAddress, type GroupRange } from "../api.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { t as tr } from "../i18n.js";

/** Left-dock group address tree: collapsible main/middle groups, addresses open in the centre editor. */
@customElement("xknx-ga-view")
export class GaView extends LitElement {
  static styles = css`
    sl-button::part(label) {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    sl-button[circle] svg {
      display: block;
    }
    :host {
      display: block;
      height: 100%;
    }
    .tree {
      padding: 8px;
    }
    .toolbar {
      display: flex;
      gap: 6px;
      margin-bottom: 8px;
    }
    .toolbar sl-input {
      flex: 1;
    }
    .node {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 6px;
      border-radius: 6px;
      cursor: pointer;
      user-select: none;
      min-height: 24px;
    }
    .node:hover {
      background: color-mix(in srgb, var(--ha-text) 7%, transparent);
    }
    .node.folder {
      font-weight: 500;
    }
    .node.folder .chev {
      color: var(--ha-text-2);
      display: inline-flex;
    }
    .node.ga {
      padding-left: 26px;
    }
    .node.ga:hover .name {
      text-decoration: underline;
      text-decoration-color: var(--ha-primary);
    }
    .node.selected {
      background: color-mix(in srgb, var(--ha-primary) 18%, transparent);
    }
    .addr {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
      color: var(--ha-text-2);
      min-width: 4.5em;
    }
    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .count {
      color: var(--ha-text-2);
      font-size: 11px;
    }
    .children {
      margin-left: 14px;
      border-left: 1px solid var(--ha-divider);
      padding-left: 4px;
    }
    .dpt {
      color: var(--ha-text-2);
      font-size: 12px;
      margin-left: auto;
      font-family: ui-monospace, Menlo, Consolas, monospace;
    }
    .actions {
      margin-left: auto;
      display: inline-flex;
      gap: 2px;
      opacity: 0;
    }
    .node:hover .actions {
      opacity: 1;
    }
    .emptyfolder {
      color: var(--ha-text-2);
      font-size: 12px;
      padding: 2px 6px 4px 26px;
    }
    .emptyfolder a {
      color: var(--ha-primary);
      cursor: pointer;
    }
    .empty {
      padding: 24px;
      color: var(--ha-text-2);
    }
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 8px 0;
    }
  `;

  @state() private ranges: GroupRange[] = [];
  @state() private loose: GroupAddress[] = [];
  @state() private gaStyle = "ThreeLevel";
  @state() private selectedId: number | null = null;
  @state() private filter = "";
  @state() private collapsed = new Set<number>();
  @state() private dialog: "ga" | "range" | null = null;
  @state() private dialogParent: number | null = null;
  @state() private dialogRange: { id: number; label: string } | null = null;
  @state() private newDpt = "";
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

  updated(): void {
    if (store.selectedGroupAddress !== this.selectedId)
      this.selectedId = store.selectedGroupAddress;
  }

  private async sync(): Promise<void> {
    if (!store.project.open) {
      this.ranges = [];
      this.loose = [];
      return;
    }
    if (this.rev === store.revision) return;
    this.rev = store.revision;
    const [r, all] = await Promise.all([
      api.get<{ style: string; ranges: GroupRange[] }>(
        "api/group-addresses/ranges",
      ),
      api.get<{ items: GroupAddress[] }>("api/group-addresses"),
    ]);
    this.ranges = r.ranges;
    this.gaStyle = r.style;
    const inRanges = new Set<number>();
    const walk = (nodes: GroupRange[]) =>
      nodes.forEach((n) => {
        n.group_addresses.forEach((g) => inRanges.add(g.id));
        walk(n.children);
      });
    walk(r.ranges);
    this.loose = all.items.filter((g) => !inRanges.has(g.id));
  }

  private select(id: number): void {
    this.selectedId = id;
    store.selectGroupAddress(id);
  }

  private toggle(id: number): void {
    const next = new Set(this.collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.collapsed = next;
  }

  private async act(fn: () => Promise<unknown>, done?: string): Promise<void> {
    try {
      await fn();
      this.dialog = null;
      if (done) store.say(done, "success");
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    }
  }

  private value(id: string): string {
    return (
      (this.renderRoot.querySelector(`#${id}`) as HTMLInputElement | null)
        ?.value ?? ""
    );
  }

  private matchesFilter(g: GroupAddress): boolean {
    const q = this.filter.trim().toLowerCase();
    return (
      !q ||
      `${g.text} ${g.name} ${g.datapoint_type ?? ""}`.toLowerCase().includes(q)
    );
  }

  /** A group's own name (and its address) counts as a match: a search for "besch" usually means
   * the middle group called Beschattung, and then everything in it is what was wanted. */
  private rangeNameMatches(r: GroupRange, depth: number): boolean {
    const q = this.filter.trim().toLowerCase();
    return (
      !!q && `${this.rangeLabel(r, depth)} ${r.name}`.toLowerCase().includes(q)
    );
  }

  /** Whether a group is worth showing at all while filtering. */
  private rangeHasMatch(r: GroupRange, depth: number): boolean {
    if (!this.filter.trim()) return true;
    return (
      this.rangeNameMatches(r, depth) ||
      r.group_addresses.some((g) => this.matchesFilter(g)) ||
      r.children.some((c) => this.rangeHasMatch(c, depth + 1))
    );
  }

  private rangeLabel(r: GroupRange, depth: number): string {
    if (this.gaStyle === "Free") return `${r.range_start}–${r.range_end}`;
    const main = r.range_start >> 11;
    if (depth === 0) return `${main}`;
    return this.gaStyle === "ThreeLevel"
      ? `${main}/${(r.range_start >> 8) & 7}`
      : `${main}/${r.range_start & 0x7ff}`;
  }

  private countIn(r: GroupRange): number {
    return (
      r.group_addresses.length +
      r.children.reduce((n, c) => n + this.countIn(c), 0)
    );
  }

  private openCreate(r: GroupRange | null, depth: number): void {
    this.dialogRange = r
      ? { id: r.id, label: `${this.rangeLabel(r, depth)} ${r.name}` }
      : null;
    this.newDpt = "";
    this.dialog = "ga";
  }

  private range(r: GroupRange, depth: number): TemplateResult {
    // A group matched by its own name shows everything in it; otherwise only the addresses that
    // match themselves.
    const gas = this.rangeNameMatches(r, depth)
      ? r.group_addresses
      : r.group_addresses.filter((g) => this.matchesFilter(g));
    const open = !this.collapsed.has(r.id) || this.filter.trim() !== "";
    const canHaveMiddle = depth === 0 && this.gaStyle === "ThreeLevel";
    return html`
      <div class="node folder" @click=${() => this.toggle(r.id)}>
        <span class="chev">${icon(open ? "down" : "right", 14)}</span>
        <span class="addr">${this.rangeLabel(r, depth)}</span>
        <span class="name">${r.name || tr("Group")}</span>
        <span class="count">${this.countIn(r)}</span>
        <span class="actions">
          ${
            !canHaveMiddle
              ? html`<sl-tooltip content=${tr("New address in this group")}
                  ><sl-button
                    size="small"
                    circle
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      this.openCreate(r, depth);
                    }}
                    >${icon("plus", 12)}</sl-button
                  ></sl-tooltip
                >`
              : nothing
          }
          ${
            canHaveMiddle
              ? html`<sl-tooltip content=${tr("New middle group")}
                  ><sl-button
                    size="small"
                    circle
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      this.dialogParent = r.id;
                      this.dialog = "range";
                    }}
                    >${icon("newfolder", 12)}</sl-button
                  ></sl-tooltip
                >`
              : nothing
          }
          <sl-tooltip content=${tr("Delete group and its addresses")}
            ><sl-button
              size="small"
              circle
              @click=${(e: Event) => {
                e.stopPropagation();
                if (
                  confirm(
                    `Delete ${this.rangeLabel(r, depth)} ${r.name} and all addresses in it?`,
                  )
                )
                  void this.act(() => api.delete(`api/group-ranges/${r.id}`));
              }}
              >${icon("trash", 12)}</sl-button
            ></sl-tooltip
          >
        </span>
      </div>
      ${
        open
          ? html`<div class="children">
              ${r.children.filter((c) => this.rangeHasMatch(c, depth + 1)).map((c) => this.range(c, depth + 1))}
              ${gas.map(
                (g) =>
                  html`<div
                    class="node ga ${this.selectedId === g.id ? "selected" : ""}"
                    @click=${() => this.select(g.id)}
                  >
                    <span class="addr">${g.text}</span
                    ><span class="name">${g.name}</span
                    ><span class="dpt">${g.datapoint_type ?? ""}</span>
                  </div>`,
              )}
              ${
                !r.children.length && !gas.length && !this.filter.trim()
                  ? html`<div class="emptyfolder">
                      empty ·
                      <a @click=${() => this.openCreate(r, depth)}
                        >${tr("add an address")}</a
                      >
                    </div>`
                  : nothing
              }
            </div>`
          : nothing
      }
    `;
  }

  render() {
    if (!store.project.open)
      return html`<div class="empty">${tr("Open a project first.")}</div>`;
    return html`
      <div class="tree">
        <div class="toolbar">
          <sl-input
            size="small"
            placeholder=${tr("Filter")}
            clearable
            @sl-input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
            ><span slot="prefix">${icon("search", 14)}</span></sl-input
          >
          <sl-tooltip content=${tr("New group address (next free)")}
            ><sl-button size="small" @click=${() => this.openCreate(null, 0)}
              >${icon("plus", 14)}</sl-button
            ></sl-tooltip
          >
          ${
            this.gaStyle !== "Free"
              ? html`<sl-tooltip content=${tr("New main group")}
                  ><sl-button
                    size="small"
                    @click=${() => {
                      this.dialogParent = null;
                      this.dialog = "range";
                    }}
                    >${icon("newfolder", 14)}</sl-button
                  ></sl-tooltip
                >`
              : nothing
          }
        </div>
        ${this.ranges.filter((r) => this.rangeHasMatch(r, 0)).map((r) => this.range(r, 0))}
        ${
          this.loose.length
            ? html`<div class="node folder">
                  <span class="chev">${icon("down", 14)}</span
                  ><span class="addr"></span
                  ><span class="name">${tr("Without group")}</span>
                </div>
                <div class="children">
                  ${this.loose.filter((g) => this.matchesFilter(g)).map((g) => html`<div class="node ga ${this.selectedId === g.id ? "selected" : ""}" @click=${() => this.select(g.id)}><span class="addr">${g.text}</span><span class="name">${g.name}</span><span class="dpt">${g.datapoint_type ?? ""}</span></div>`)}
                </div>`
            : nothing
        }
        ${this.ranges.length || this.loose.length ? nothing : html`<div class="empty">${tr("No group addresses yet. Create a main group, then addresses inside it.")}</div>`}
      </div>
      <sl-dialog
        label=${this.dialogRange ? `New address in ${this.dialogRange.label}` : "New group address"}
        ?open=${this.dialog === "ga"}
        @sl-after-hide=${() => (this.dialog = null)}
      >
        <div class="row">
          <sl-input
            id="ga-name"
            label=${tr("Name")}
            style="flex:1"
            autofocus
          ></sl-input>
        </div>
        <div class="row">
          <xknx-dpt-picker
            style="flex:1"
            .value=${this.newDpt}
            @dpt-change=${(e: CustomEvent<{ value: string }>) => (this.newDpt = e.detail.value)}
          ></xknx-dpt-picker>
        </div>
        <div class="row">
          <sl-input
            id="ga-addr"
            label=${this.dialogRange ? "Address (empty = next free in this group)" : "Address (empty = next free)"}
            placeholder="1/2/3"
            style="flex:1"
          ></sl-input>
        </div>
        <sl-button
          slot="footer"
          variant="primary"
          @click=${() => this.act(() => api.post("api/group-addresses", { name: this.value("ga-name"), datapoint_type: this.newDpt || null, address: this.parseGa(this.value("ga-addr")), range_id: this.dialogRange?.id ?? null }), "Group address created")}
          >${tr("Create")}</sl-button
        >
      </sl-dialog>
      <sl-dialog
        label=${this.dialogParent === null ? "New main group" : "New middle group"}
        ?open=${this.dialog === "range"}
        @sl-after-hide=${() => (this.dialog = null)}
      >
        <div class="row">
          <sl-input
            id="range-name"
            label=${tr("Name")}
            style="flex:1"
            autofocus
          ></sl-input>
        </div>
        <sl-button
          slot="footer"
          variant="primary"
          @click=${() => this.act(() => api.post("api/group-ranges", { name: this.value("range-name"), parent_id: this.dialogParent }), "Group created")}
          >${tr("Create")}</sl-button
        >
      </sl-dialog>
    `;
  }

  private parseGa(text: string): number | null {
    const t = text.trim();
    if (!t) return null;
    const parts = t.split("/").map(Number);
    if (parts.some((n) => Number.isNaN(n))) return null;
    if (parts.length === 3)
      return (parts[0] << 11) | (parts[1] << 8) | parts[2];
    if (parts.length === 2) return (parts[0] << 11) | parts[1];
    return parts[0];
  }
}
