import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { UiNode, Widget } from "../api.js";

/** Renders the application's parameter tree; one renderer per widget kind. Emits `param-change`. */
@customElement("xknx-parameter-tree")
export class ParameterTree extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .block {
      margin: 8px 0 12px;
      padding: 8px 12px;
      border: 1px solid var(--ha-divider);
      border-radius: var(--ha-radius);
      background: var(--ha-card);
    }
    .block > .title {
      font-weight: 500;
      margin: 0 0 6px;
    }
    .block.inline {
      border: 0;
      padding: 0 0 0 8px;
      margin: 4px 0;
    }
    .param {
      display: grid;
      grid-template-columns: minmax(180px, 40%) 1fr;
      gap: 8px 16px;
      align-items: center;
      padding: 4px 0;
    }
    .param label {
      color: var(--ha-text);
      overflow-wrap: anywhere;
    }
    .param.ro label {
      color: var(--ha-text-2);
    }
    .param .suffix {
      color: var(--ha-text-2);
      margin-left: 6px;
      font-size: 12px;
    }
    .sep {
      margin: 10px 0 4px;
      color: var(--ha-text-2);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    sl-select,
    sl-input {
      max-width: 420px;
    }
    .value {
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
      color: var(--ha-text-2);
    }
  `;

  @property({ attribute: false }) nodes: UiNode[] = [];

  private change(refId: string, value: string): void {
    this.dispatchEvent(
      new CustomEvent("param-change", {
        detail: { refId, value },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    const tabs = this.nodes.filter((n) => n.type === "tab") as Extract<
      UiNode,
      { type: "tab" }
    >[];
    if (tabs.length > 1 && tabs.length === this.nodes.length) {
      return html`<sl-tab-group>
        ${tabs.map((t, i) => html`<sl-tab slot="nav" panel="t${i}">${t.text || `Tab ${i + 1}`}</sl-tab>`)}
        ${tabs.map((t, i) => html`<sl-tab-panel name="t${i}">${t.children.map((c) => this.node(c))}</sl-tab-panel>`)}
      </sl-tab-group>`;
    }
    return html`${this.nodes.map((n) => this.node(n))}`;
  }

  private node(n: UiNode): TemplateResult | typeof nothing {
    switch (n.type) {
      case "tab":
        return html`<div class="block">
          <div class="title">${n.text}</div>
          ${n.children.map((c) => this.node(c))}
        </div>`;
      case "block":
        return html`<div class="block ${n.inline ? "inline" : ""}">
          ${n.text ? html`<div class="title">${n.text}</div>` : nothing}${n.children.map((c) => this.node(c))}
        </div>`;
      case "separator":
        return n.text ? html`<div class="sep">${n.text}</div>` : nothing;
      case "parameter":
        return this.parameter(n);
      default:
        return nothing;
    }
  }

  private parameter(p: Extract<UiNode, { type: "parameter" }>): TemplateResult {
    const ro = p.access !== "ReadWrite";
    const w = p.widget;
    const suffix = p.suffix
      ? html`<span class="suffix">${p.suffix}</span>`
      : nothing;
    return html`<div
      class="param ${ro ? "ro" : ""}"
      style="padding-left:${p.indent * 12}px"
    >
      <label title=${p.ref_id}>${p.label}</label>
      <div>${this.widget(p, w, ro)}${suffix}</div>
    </div>`;
  }

  private widget(
    p: Extract<UiNode, { type: "parameter" }>,
    w: Widget,
    ro: boolean,
  ): TemplateResult {
    const set = (e: Event) =>
      this.change(p.ref_id, String((e.target as HTMLInputElement).value));
    switch (w.type) {
      case "enum":
        return html`<sl-select
          size="small"
          value=${p.value}
          ?disabled=${ro}
          hoist
          @sl-change=${set}
        >
          ${w.choices.map((c) => html`<sl-option value=${String(c.value)}>${c.label}</sl-option>`)}
        </sl-select>`;
      case "checkbox":
        return html`<sl-checkbox
          size="small"
          ?checked=${p.value === "1" || p.value.toLowerCase() === "true"}
          ?disabled=${ro}
          @sl-change=${(e: Event) => this.change(p.ref_id, (e.target as HTMLInputElement).checked ? "1" : "0")}
        ></sl-checkbox>`;
      case "number":
      case "float":
      case "time":
        return html`<sl-input
          size="small"
          type="number"
          value=${p.value}
          min=${w.min}
          max=${w.max}
          step=${"increment" in w && w.increment ? w.increment : w.type === "float" ? "any" : 1}
          ?disabled=${ro}
          @sl-change=${set}
        ></sl-input>`;
      case "slider":
      case "float_slider":
        return html`<sl-range
          value=${Number(p.value)}
          min=${w.min}
          max=${w.max}
          step=${"increment" in w && w.increment ? w.increment : 1}
          ?disabled=${ro}
          @sl-change=${set}
        ></sl-range>`;
      case "text":
        return html`<sl-input
          size="small"
          value=${p.value}
          maxlength=${w.max_length ?? nothing}
          ?disabled=${ro}
          @sl-change=${set}
        ></sl-input>`;
      case "ip":
      case "date":
        return html`<sl-input
          size="small"
          value=${p.value}
          ?disabled=${ro}
          @sl-change=${set}
        ></sl-input>`;
      case "none":
        return html`<span class="value">${p.value}</span>`;
      default:
        return html`<span class="value" title=${w.type}>${p.value}</span>`;
    }
  }
}
