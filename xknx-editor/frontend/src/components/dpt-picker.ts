import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { api } from "../api.js";
import { t as tr } from "../i18n.js";

type Dpt = {
  id: string;
  main: number;
  sub: number | null;
  name: string;
  text: string;
  main_text: string;
  size_bits: number | null;
};

let cache: Promise<Dpt[]> | null = null;
function loadDpts(): Promise<Dpt[]> {
  cache ??= api.get<{ items: Dpt[] }>("api/dpts").then((r) => r.items);
  return cache;
}

/** Datapoint type picker: type an id, number or name; emits `dpt-change` with `{ value }` (id or ""). */
@customElement("xknx-dpt-picker")
export class DptPicker extends LitElement {
  static styles = css`
    :host {
      display: inline-block;
      min-width: 220px;
    }
    label {
      display: block;
      font-size: 12px;
      color: var(--ha-text);
      margin-bottom: 4px;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      font: inherit;
      font-size: 13px;
      padding: 0 10px;
      height: 28px;
      border: 1px solid var(--sl-input-border-color, var(--ha-divider));
      border-radius: 8px;
      background: var(--ha-card);
      color: var(--ha-text);
    }
    input:focus {
      outline: 2px solid color-mix(in srgb, var(--ha-primary) 40%, transparent);
      border-color: var(--ha-primary);
    }
    .hint {
      font-size: 11px;
      color: var(--ha-text-2);
      margin-top: 2px;
      min-height: 14px;
    }
  `;

  @property() value = "";
  @property() label = "Datapoint type";
  @state() private dpts: Dpt[] = [];
  private listId = `dpts-${Math.random().toString(36).slice(2, 8)}`;

  connectedCallback(): void {
    super.connectedCallback();
    void loadDpts().then((d) => (this.dpts = d));
  }

  private display(id: string): string {
    const d = this.dpts.find((x) => x.id === id);
    return d ? `${d.id} ${d.text}` : id;
  }

  private commit(raw: string): void {
    const text = raw.trim();
    let id = "";
    if (text) {
      const lower = text.toLowerCase();
      const byId = this.dpts.find(
        (d) =>
          d.id.toLowerCase() === lower ||
          `${d.id} ${d.text}`.toLowerCase() === lower,
      );
      const m = /^(\d+)\.(\d{1,3})$/.exec(text);
      const byNumber = m
        ? this.dpts.find(
            (d) => d.main === Number(m[1]) && d.sub === Number(m[2]),
          )
        : undefined;
      const byText = this.dpts.find(
        (d) => d.text.toLowerCase() === lower || d.name.toLowerCase() === lower,
      );
      const prefix = this.dpts.find(
        (d) =>
          `${d.id} ${d.text}`.toLowerCase().startsWith(lower) && d.sub !== null,
      );
      id =
        (byId ?? byNumber ?? byText ?? prefix)?.id ??
        (/^DPS?T-\d+(-\d+)?$/i.test(text) ? text.toUpperCase() : "");
    }
    if (id !== this.value) {
      this.value = id;
      this.dispatchEvent(
        new CustomEvent("dpt-change", {
          detail: { value: id },
          bubbles: true,
          composed: true,
        }),
      );
    }
    this.requestUpdate();
  }

  render() {
    const d = this.dpts.find((x) => x.id === this.value);
    return html`
      <label>${this.label}</label>
      <input
        list=${this.listId}
        .value=${this.display(this.value)}
        placeholder=${tr("e.g. DPST-1-1, 9.001, temperature")}
        @change=${(e: Event) => this.commit((e.target as HTMLInputElement).value)}
      />
      <datalist id=${this.listId}>
        ${this.dpts.filter((x) => x.sub !== null).map((x) => html`<option value="${x.id} ${x.text}">${x.main_text}</option>`)}
      </datalist>
      <div class="hint">
        ${d ? `${d.name} · ${d.main_text}${d.size_bits ? ` · ${d.size_bits} bit` : ""}` : this.value ? "unknown type" : ""}
      </div>
    `;
  }
}
