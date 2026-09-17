import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { loadDpts, type Dpt } from "../dpt-format.js";
import { t as tr } from "../i18n.js";

/** What a search matches: number (9.001, 9.1, 9), id (DPST-9-1), name, text, unit. */
export function dptSearch(dpts: Dpt[], query: string, allowMain: boolean): Dpt[] {
  const q = query.trim().toLowerCase();
  const pool = allowMain ? dpts : dpts.filter((d) => d.sub !== null);
  if (!q) return pool;
  const num = /^(\d+)(?:\.(\d{0,3}))?$/.exec(q);
  return pool
    .map((d) => {
      let score = 0;
      if (num) {
        if (d.main === Number(num[1])) {
          if (num[2] === undefined || num[2] === "") score = d.sub === null ? 100 : 60;
          else if (d.sub === Number(num[2])) score = 100;
          else if (d.number.startsWith(`${num[1]}.${num[2]}`)) score = 40;
        }
      } else {
        const hay = [d.id, d.name, d.text, d.unit ?? "", d.main_text].map((x) => x.toLowerCase());
        if (hay[0] === q || (d.unit ?? "").toLowerCase() === q) score = 90;
        else if (hay[2].startsWith(q) || hay[1].startsWith(q)) score = 70;
        else if (hay.some((h) => h.includes(q))) score = 30;
      }
      return { d, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.d.main - b.d.main || (a.d.sub ?? -1) - (b.d.sub ?? -1))
    .map((x) => x.d);
}

/** Datapoint type picker: a search box over number, name and unit with a dropdown of matches.
 * Emits `dpt-change` with `{ value }`: the formal id (DPST-9-1, or DPT-9 with `allow-main`) or "". */
@customElement("xknx-dpt-picker")
export class DptPicker extends LitElement {
  static styles = css`
    :host {
      display: inline-block;
      min-width: 220px;
      position: relative;
    }
    label {
      display: block;
      font-size: 12px;
      color: var(--ha-text);
      margin-bottom: 4px;
    }
    .box {
      position: relative;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      font: inherit;
      font-size: 13px;
      padding: 0 26px 0 10px;
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
    .clear {
      position: absolute;
      right: 6px;
      top: 50%;
      transform: translateY(-50%);
      border: 0;
      background: none;
      color: var(--ha-text-2);
      cursor: pointer;
      font-size: 12px;
      padding: 2px;
    }
    .list {
      position: absolute;
      z-index: 50;
      top: calc(100% + 2px);
      left: 0;
      min-width: 100%;
      width: max-content;
      max-width: 520px;
      max-height: 280px;
      overflow: auto;
      background: var(--ha-card);
      border: 1px solid var(--ha-divider);
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
    }
    .row {
      display: grid;
      grid-template-columns: 62px 1fr auto;
      gap: 10px;
      padding: 4px 10px;
      cursor: pointer;
      font-size: 12px;
      white-space: nowrap;
    }
    .row.main {
      font-weight: 600;
    }
    .row.on,
    .row:hover {
      background: color-mix(in srgb, var(--ha-primary) 14%, transparent);
    }
    .num {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      color: var(--ha-text-2);
    }
    .unit {
      color: var(--ha-text-2);
    }
    .hint {
      font-size: 11px;
      color: var(--ha-text-2);
      margin-top: 2px;
      min-height: 14px;
    }
    :host([compact]) .hint,
    :host([compact]) label {
      display: none;
    }
  `;

  @property() value = "";
  @property() label = "Datapoint type";
  @property() placeholder = "";
  /** Offer main types (DPT-9, "every 9.xxx") too: for filters. */
  @property({ type: Boolean, attribute: "allow-main" }) allowMain = false;
  @property({ type: Boolean, reflect: true }) compact = false;
  @state() private dpts: Dpt[] = [];
  @state() private query: string | null = null;
  @state() private open = false;
  @state() private cursor = 0;

  connectedCallback(): void {
    super.connectedCallback();
    void loadDpts().then((d) => (this.dpts = d));
  }

  private label_(d: Dpt): string {
    return `${d.number} ${d.text}${d.unit ? ` (${d.unit})` : ""}`;
  }

  private found(): Dpt[] {
    return dptSearch(this.dpts, this.query ?? "", this.allowMain).slice(0, 80);
  }

  private pick(id: string): void {
    this.open = false;
    this.query = null;
    if (id !== this.value) {
      this.value = id;
      this.dispatchEvent(new CustomEvent("dpt-change", { detail: { value: id }, bubbles: true, composed: true }));
    }
  }

  /** Typed text without choosing from the list: take the best match, or a well-formed id. */
  private commitTyped(): void {
    if (this.query === null) return;
    const text = this.query.trim();
    if (!text) return this.pick("");
    const best = this.found()[0];
    if (best) return this.pick(best.id);
    if (/^DPS?T-\d+(-\d+)?$/i.test(text)) return this.pick(text.toUpperCase());
    this.query = null;
    this.open = false;
  }

  private onKey(e: KeyboardEvent): void {
    const list = this.found();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      this.open = true;
      this.cursor = Math.min(this.cursor + 1, list.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      this.cursor = Math.max(this.cursor - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (this.open && list[this.cursor]) this.pick(list[this.cursor].id);
      else this.commitTyped();
    } else if (e.key === "Escape") {
      this.open = false;
      this.query = null;
    }
  }

  updated(): void {
    if (!this.open) return;
    this.renderRoot.querySelector(".row.on")?.scrollIntoView({ block: "nearest" });
  }

  render() {
    const d = this.dpts.find((x) => x.id === this.value);
    const shown = this.query ?? (d ? this.label_(d) : this.value);
    const list = this.open ? this.found() : [];
    return html`
      <label>${tr(this.label)}</label>
      <div class="box">
        <input
          .value=${shown}
          placeholder=${this.placeholder || tr("Search: 9.001, temperature, °C, m³…")}
          @focus=${(e: Event) => {
            (e.target as HTMLInputElement).select();
            this.cursor = 0;
            this.open = true;
          }}
          @input=${(e: Event) => {
            this.query = (e.target as HTMLInputElement).value;
            this.cursor = 0;
            this.open = true;
          }}
          @keydown=${this.onKey}
          @blur=${() => {
            if (this.query) this.commitTyped();
            else {
              this.query = null;
              this.open = false;
            }
          }}
        />
        ${this.value ? html`<button class="clear" title=${tr("Clear")} @mousedown=${(e: Event) => e.preventDefault()} @click=${() => this.pick("")}>✕</button>` : nothing}
        ${
          list.length
            ? html`<div class="list" @mousedown=${(e: Event) => e.preventDefault()}>
                ${list.map(
                  (x, i) => html`<div
                    class="row ${x.sub === null ? "main" : ""} ${i === this.cursor ? "on" : ""}"
                    title=${`${x.id} · ${x.name} · ${x.main_text}${x.size_bits ? ` · ${x.size_bits} bit` : ""}`}
                    @click=${() => this.pick(x.id)}
                  >
                    <span class="num">${x.sub === null ? `${x.main}.xxx` : x.number}</span>
                    <span>${x.sub === null ? `${tr("every")} ${x.main_text}` : x.text}</span>
                    <span class="unit">${x.unit ?? ""}</span>
                  </div>`,
                )}
              </div>`
            : nothing
        }
      </div>
      <div class="hint">
        ${d ? `${d.id} · ${d.name} · ${d.main_text}${d.size_bits ? ` · ${d.size_bits} bit` : ""}` : this.value ? tr("unknown type") : ""}
      </div>
    `;
  }
}

/** Every datapoint type with number, name, size and unit, searchable. Help → Datapoint types. */
@customElement("xknx-dpt-table")
export class DptTable extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-size: 13px;
    }
    sl-input {
      margin-bottom: 8px;
    }
    .scroll {
      max-height: 60vh;
      overflow: auto;
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th,
    td {
      text-align: left;
      padding: 3px 8px;
      border-bottom: 1px solid var(--ha-divider);
      white-space: nowrap;
    }
    th {
      position: sticky;
      top: 0;
      background: var(--ha-card);
      color: var(--ha-text-2);
      font-weight: 600;
      font-size: 12px;
    }
    tr.main td {
      font-weight: 600;
      background: color-mix(in srgb, var(--ha-text) 5%, transparent);
    }
    .num {
      font-family: ui-monospace, Menlo, Consolas, monospace;
    }
    .muted {
      color: var(--ha-text-2);
    }
  `;

  @state() private dpts: Dpt[] = [];
  @state() private query = "";

  connectedCallback(): void {
    super.connectedCallback();
    void loadDpts().then((d) => (this.dpts = d));
  }

  render() {
    const rows = this.query.trim() ? dptSearch(this.dpts, this.query, true) : this.dpts;
    return html`
      <sl-input
        size="small"
        clearable
        placeholder=${tr("Search: 9.001, temperature, °C, m³…")}
        @sl-input=${(e: Event) => (this.query = (e.target as HTMLInputElement).value)}
      ></sl-input>
      <div class="scroll">
        <table>
          <tr>
            <th>${tr("Number")}</th>
            <th>ID</th>
            <th>${tr("Name")}</th>
            <th>${tr("Description")}</th>
            <th>${tr("Unit")}</th>
            <th>${tr("Size")}</th>
          </tr>
          ${rows.map(
            (d) => html`<tr class=${d.sub === null ? "main" : ""}>
              <td class="num">${d.sub === null ? `${d.main}.xxx` : d.number}</td>
              <td class="num muted">${d.id}</td>
              <td>${d.name}</td>
              <td>${d.text}</td>
              <td>${d.unit ?? ""}</td>
              <td class="muted">${d.size_bits ? `${d.size_bits} bit` : ""}</td>
            </tr>`,
          )}
        </table>
      </div>
      <p class="muted">${rows.length} ${tr("datapoint types")}</p>
    `;
  }
}
