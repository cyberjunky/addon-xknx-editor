import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { api, ApiError } from "../api.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { dropProduct, isProductDrag } from "../product-drop.js";
import { t as tr } from "../i18n.js";

type SpaceDevice = {
  id: number;
  name: string;
  individual_address: string | null;
  product_name: string;
};
type Space = {
  id: number;
  name: string;
  space_type: string;
  number: string;
  children: Space[];
  devices: SpaceDevice[];
};

const TYPES = [
  "Building",
  "BuildingPart",
  "Floor",
  "Room",
  "DistributionBoard",
  "Stairway",
  "Corridor",
  "Area",
  "Ground",
  "Segment",
];

@customElement("xknx-spaces-view")
export class SpacesView extends LitElement {
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
      padding: 12px 16px;
    }
    .node {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 6px;
      border-radius: 6px;
    }
    .node {
      cursor: pointer;
    }
    .node:hover {
      background: color-mix(in srgb, var(--ha-text) 6%, transparent);
    }
    .node.selected {
      background: color-mix(in srgb, var(--ha-primary) 18%, transparent);
    }
    .folders {
      margin: 0 0 8px;
      padding: 0 0 8px;
      border-bottom: 1px solid var(--ha-divider);
    }
    .folders .node {
      color: var(--ha-text-2);
    }
    .badge {
      background: color-mix(in srgb, var(--ha-text) 10%, transparent);
      border-radius: 10px;
      padding: 0 7px;
      font-size: 11px;
    }
    .type {
      color: var(--ha-text-2);
      font-size: 12px;
    }
    .children {
      margin-left: 22px;
    }
    .device {
      color: var(--ha-text-2);
      cursor: pointer;
    }
    .device .addr {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .actions {
      margin-left: auto;
      display: inline-flex;
      gap: 2px;
      opacity: 0;
    }
    .node.drop {
      outline: 2px solid var(--ha-primary);
      outline-offset: -2px;
    }
    .node:hover .actions {
      opacity: 1;
    }
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 8px 0;
    }
    .empty {
      color: var(--ha-text-2);
      padding: 12px 0;
    }
    h3 {
      margin: 16px 0 6px;
      font-size: 14px;
      color: var(--ha-text-2);
      font-weight: 500;
    }
  `;

  @state() private tree: Space[] = [];
  @state() private unassigned: SpaceDevice[] = [];
  @state() private dropTarget: number | null = null;
  @state() private downloadRequired = 0;
  @state() private dialog: { parent: number | null } | null = null;
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
    const [r, all] = await Promise.all([
      api.get<{ tree: Space[]; unassigned: SpaceDevice[] }>("api/spaces"),
      api.get<{ items: { download_required?: boolean }[] }>(
        "api/project/devices",
      ),
    ]);
    this.tree = r.tree;
    this.unassigned = r.unassigned;
    this.downloadRequired = all.items.filter((d) => d.download_required).length;
  }

  private async act(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
      this.dialog = null;
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

  private flat(nodes: Space[], depth = 0): { id: number; label: string }[] {
    return nodes.flatMap((s) => [
      { id: s.id, label: `${"  ".repeat(depth)}${s.name} (${s.space_type})` },
      ...this.flat(s.children, depth + 1),
    ]);
  }

  /** Assign a device dropped onto a space. The overview is the drag source. */
  private onDrop(e: DragEvent, spaceId: number): void {
    e.preventDefault();
    this.dropTarget = null;
    if (isProductDrag(e)) {
      void dropProduct(e, spaceId).then(() => void this.sync());
      return;
    }
    const id = Number(e.dataTransfer?.getData("text/plain"));
    if (!id) return;
    void this.act(() => api.patch(`api/devices/${id}`, { space_id: spaceId }));
  }

  private space(s: Space): TemplateResult {
    return html`
      <div
        class="node ${store.selectedSpace === s.id ? "selected" : ""} ${this.dropTarget === s.id ? "drop" : ""}"
        @click=${() => store.selectSpace(s.id)}
        @dragover=${(e: DragEvent) => {
          e.preventDefault();
          this.dropTarget = s.id;
        }}
        @dragleave=${() => {
          if (this.dropTarget === s.id) this.dropTarget = null;
        }}
        @drop=${(e: DragEvent) => this.onDrop(e, s.id)}
      >
        ${icon("building", 14)}<span>${s.name || s.space_type}</span
        ><span class="type"
          >${s.space_type}${s.number ? ` ${s.number}` : ""}</span
        >
        <span class="actions">
          <sl-tooltip content=${tr("Add child space")}
            ><sl-button
              size="small"
              circle
              @click=${(e: Event) => {
                e.stopPropagation();
                this.dialog = { parent: s.id };
              }}
              >${icon("plus", 12)}</sl-button
            ></sl-tooltip
          >
          <sl-tooltip content=${tr("Remove")}
            ><sl-button
              size="small"
              circle
              @click=${(e: Event) => {
                e.stopPropagation();
                void this.act(() => api.delete(`api/spaces/${s.id}`));
              }}
              >${icon("trash", 12)}</sl-button
            ></sl-tooltip
          >
        </span>
      </div>
      <div class="children">
        ${s.children.map((c) => this.space(c))}
        ${s.devices.map(
          (d) =>
            html`<div
              class="node device"
              @click=${() => {
                store.select(d.id);
                store.setView("project");
              }}
            >
              ${icon("cpu", 12)}<span class="addr"
                >${d.individual_address ?? "-.-.-"}</span
              >${d.name}<span class="actions"
                ><sl-button
                  size="small"
                  circle
                  title=${tr("Unassign")}
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    void this.act(() =>
                      api.patch(`api/devices/${d.id}`, { space_id: null }),
                    );
                  }}
                  >${icon("close", 12)}</sl-button
                ></span
              >
            </div>`,
        )}
      </div>
    `;
  }

  render() {
    if (!store.project.open)
      return html`<div class="empty">${tr("Open a project first.")}</div>`;
    return html`
      <div class="folders">
        <div class="node" @click=${() => store.showOverview("download")}>
          ${icon("search", 14)}<span>${tr("Download required")}</span
          ><span class="badge">${this.downloadRequired}</span>
        </div>
        <div class="node" @click=${() => store.showOverview("unassigned")}>
          ${icon("search", 14)}<span>${tr("Not assigned to a room")}</span
          ><span class="badge">${this.unassigned.length}</span>
        </div>
      </div>
      <div class="row">
        <sl-button size="small" @click=${() => (this.dialog = { parent: null })}
          >${icon("plus", 14)} ${tr("New building")}</sl-button
        >
      </div>
      ${this.tree.map((s) => this.space(s))}
      ${this.tree.length ? nothing : html`<div class="empty">${tr("No buildings yet.")}</div>`}
      <sl-dialog
        label=${tr("New space")}
        ?open=${this.dialog !== null}
        @sl-after-hide=${() => (this.dialog = null)}
      >
        <div class="row">
          <sl-input
            id="space-name"
            label=${tr("Name")}
            style="flex:1"
          ></sl-input>
        </div>
        <div class="row">
          <sl-select
            id="space-type"
            label=${tr("Type")}
            value=${this.dialog?.parent === null ? "Building" : "Room"}
            hoist
            style="flex:1"
            >${TYPES.map((t) => html`<sl-option value=${t}>${t}</sl-option>`)}</sl-select
          >
        </div>
        <sl-button
          slot="footer"
          variant="primary"
          @click=${() => this.act(() => api.post("api/spaces", { name: this.value("space-name"), space_type: this.value("space-type"), parent_id: this.dialog?.parent ?? null }))}
          >${tr("Create")}</sl-button
        >
      </sl-dialog>
    `;
  }
}
