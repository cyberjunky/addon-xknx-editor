import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { api, ApiError, type GroupAddress } from "../api.js";
import { icon } from "../icons.js";
import { store } from "../store.js";
import { t as tr } from "../i18n.js";

type Assignment = {
  link_id: number;
  device_id: number | null;
  device_name: string;
  device_address: string | null;
  ref_id: string;
  object_number: number;
  object_name: string;
  is_sending: boolean;
};
type Detail = GroupAddress & { assignments: Assignment[] };

/** Centre-dock editor for one group address: name, DPT, description, and its assignments. */
@customElement("xknx-ga-panel")
export class GaPanel extends LitElement {
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
    h3 {
      margin: 0 0 8px;
      font-weight: 500;
      font-family: ui-monospace, Menlo, Consolas, monospace;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 16px;
      max-width: 720px;
    }
    .grid .wide {
      grid-column: 1 / -1;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 13px;
      margin-top: 16px;
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
    .addr {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
      color: var(--ha-text-2);
    }
    a {
      color: var(--ha-primary);
      cursor: pointer;
      text-decoration: none;
    }
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 12px 0 0;
    }
    .empty {
      color: var(--ha-text-2);
      padding: 12px 0;
    }
  `;

  @property({ type: Number }) gaId = 0;
  @state() private detail: Detail | null = null;
  private unsubscribe = () => {};
  private loaded = { id: -1, rev: -1 };

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = store.subscribe(() => void this.sync());
  }

  disconnectedCallback(): void {
    this.unsubscribe();
    super.disconnectedCallback();
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has("gaId")) void this.sync(true);
  }

  private async sync(force = false): Promise<void> {
    if (
      !force &&
      this.loaded.id === this.gaId &&
      this.loaded.rev === store.revision
    )
      return;
    this.loaded = { id: this.gaId, rev: store.revision };
    try {
      this.detail = await api.get<Detail>(`api/group-addresses/${this.gaId}`);
    } catch (e) {
      this.detail = null;
      if (!(e instanceof ApiError && e.status === 404))
        store.say(e instanceof ApiError ? e.message : String(e), "danger");
    }
  }

  private async act(fn: () => Promise<unknown>, done?: string): Promise<void> {
    try {
      await fn();
      if (done) store.say(done, "success");
    } catch (e) {
      store.say(e instanceof ApiError ? e.message : String(e), "danger");
    }
  }

  render() {
    const d = this.detail;
    if (!d)
      return html`<div class="empty">
        ${tr("This group address no longer exists.")}
      </div>`;
    return html`
      <h3>${d.text}</h3>
      <div class="grid">
        <sl-input
          size="small"
          label=${tr("Name")}
          value=${d.name}
          @sl-change=${(e: Event) => this.act(() => api.patch(`api/group-addresses/${d.id}`, { name: (e.target as HTMLInputElement).value }))}
        ></sl-input>
        <xknx-dpt-picker
          .value=${d.datapoint_type ?? ""}
          @dpt-change=${(e: CustomEvent<{ value: string }>) => this.act(() => api.patch(`api/group-addresses/${d.id}`, { datapoint_type: e.detail.value || null }))}
        ></xknx-dpt-picker>
        ${d.description ? html`<div class="wide"><span class="addr">${tr("Description")}</span><br />${d.description}</div>` : nothing}
      </div>
      <table>
        <tr>
          <th>${tr("Device")}</th>
          <th>${tr("Address")}</th>
          <th>#</th>
          <th>${tr("Object")}</th>
          <th>${tr("Sending")}</th>
          <th></th>
        </tr>
        ${d.assignments.map(
          (a) =>
            html`<tr>
              <td>
                <a @click=${() => store.select(a.device_id)}
                  >${a.device_name || "?"}</a
                >
              </td>
              <td class="addr">${a.device_address ?? "-.-.-"}</td>
              <td class="addr">${a.object_number || ""}</td>
              <td title=${a.ref_id}>
                ${a.object_name || html`<span class="addr" style="color:var(--ha-warning)">object ${a.ref_id.split("_O-").pop()?.split("_")[0] ?? ""} · product data missing</span>`}
              </td>
              <td>
                ${a.is_sending ? "yes" : html`<sl-button size="small" @click=${() => this.act(() => api.post(`api/links/${a.link_id}/sending`))}>${tr("make sending")}</sl-button>`}
              </td>
              <td>
                <sl-tooltip content=${tr("Unlink")}
                  ><sl-button
                    size="small"
                    circle
                    @click=${() => this.act(() => api.delete(`api/links/${a.link_id}`))}
                    >${icon("unlink", 12)}</sl-button
                  ></sl-tooltip
                >
              </td>
            </tr>`,
        )}
      </table>
      ${d.assignments.length ? nothing : html`<div class="empty">${tr("Not linked to any group object. Link it from a device's Group objects tab.")}</div>`}
      <div class="row">
        <sl-button
          size="small"
          variant="danger"
          outline
          @click=${() =>
            this.act(async () => {
              await api.delete(`api/group-addresses/${d.id}`);
              store.selectGroupAddress(null);
            }, "Group address removed")}
          >${icon("trash", 14)} ${tr("Remove group address")}</sl-button
        >
      </div>
    `;
  }
}
