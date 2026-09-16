import { LitElement, css, html, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { TelegramRecord } from "../store.js";
import { t as tr } from "../i18n.js";

const HEIGHT = 140;
const LEFT = 64; // room for the lane labels
const RIGHT = 10;
const TOP = 6;
const AXIS = 18; // tick labels under the lanes
const MAX_LANES = 8;

/** The dot colour of an APCI. */
function colour(apci: string): string {
  if (apci === "GroupValueWrite") return "var(--ha-primary)";
  if (apci === "GroupValueResponse") return "var(--ha-success)";
  if (apci === "GroupValueRead") return "var(--ha-warning)";
  return "var(--ha-text-2)";
}

function clock(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** A tick step (seconds) giving roughly `count` ticks over `span`. */
function tickStep(span: number, count: number): number {
  const steps = [
    1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800,
    21600, 43200, 86400, 172800, 604800,
  ];
  const want = span / Math.max(1, count);
  return steps.find((s) => s >= want) ?? steps[steps.length - 1];
}

/** A strip of telegrams over time: one lane per sending device (the busiest few, the rest
 * together), a dot per telegram coloured by what it does. Clicking a dot fires `telegram-pick`. */
@customElement("xknx-telegram-timeline")
export class TelegramTimeline extends LitElement {
  static styles = css`
    :host {
      display: block;
      height: ${HEIGHT}px;
      border-bottom: 1px solid var(--ha-divider);
      overflow: hidden;
    }
    svg {
      display: block;
      width: 100%;
      height: ${HEIGHT}px;
      font-size: 10px;
    }
    .lane-label {
      fill: var(--ha-text-2);
      font-family: ui-monospace, Menlo, Consolas, monospace;
    }
    .tick {
      fill: var(--ha-text-2);
    }
    .grid {
      stroke: var(--ha-divider);
      stroke-width: 1;
    }
    circle {
      cursor: pointer;
      fill-opacity: 0.85;
    }
    circle:hover {
      fill-opacity: 1;
      stroke: var(--ha-text);
      stroke-width: 1;
    }
    .empty {
      fill: var(--ha-text-2);
      font-size: 12px;
    }
  `;

  @property({ attribute: false }) items: TelegramRecord[] = [];
  @state() private width = 600;
  private resize: ResizeObserver | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.resize = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0);
      if (w > 0 && w !== this.width) this.width = w;
    });
    this.resize.observe(this);
  }

  disconnectedCallback(): void {
    this.resize?.disconnect();
    this.resize = null;
    super.disconnectedCallback();
  }

  private pick(t: TelegramRecord): void {
    this.dispatchEvent(
      new CustomEvent<TelegramRecord>("telegram-pick", {
        detail: t,
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    const w = this.width;
    const items = this.items;
    if (!items.length)
      return html`<svg viewBox="0 0 ${w} ${HEIGHT}">
        <text class="empty" x=${w / 2} y=${HEIGHT / 2} text-anchor="middle">
          ${tr("No telegrams to show")}
        </text>
      </svg>`;

    // Lanes: the busiest sources, the rest in one "other" lane.
    const counts = new Map<string, number>();
    for (const t of items) counts.set(t.source, (counts.get(t.source) ?? 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const overflow = ranked.length > MAX_LANES;
    const named = ranked
      .slice(0, overflow ? MAX_LANES : ranked.length)
      .map(([s]) => s);
    const laneOf = new Map(named.map((s, i) => [s, i]));
    const lanes = overflow ? [...named, tr("other")] : named;

    let min = Infinity;
    let max = -Infinity;
    for (const t of items) {
      if (t.ts < min) min = t.ts;
      if (t.ts > max) max = t.ts;
    }
    if (max - min < 1) {
      min -= 0.5;
      max += 0.5;
    }
    const span = max - min;
    const plotW = Math.max(10, w - LEFT - RIGHT);
    const x = (ts: number) => LEFT + ((ts - min) / span) * plotW;
    const laneH = (HEIGHT - TOP - AXIS) / lanes.length;
    const y = (lane: number) => TOP + laneH * (lane + 0.5);
    const r = Math.max(2, Math.min(4, laneH / 3));

    const step = tickStep(span, Math.max(2, Math.floor(plotW / 90)));
    const ticks: number[] = [];
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);

    return html`<svg viewBox="0 0 ${w} ${HEIGHT}">
      ${lanes.map(
        (name, i) => svg`
          <line class="grid" x1=${LEFT} x2=${w - RIGHT} y1=${y(i)} y2=${y(i)}></line>
          <text class="lane-label" x=${LEFT - 6} y=${y(i) + 3} text-anchor="end">${name}</text>`,
      )}
      ${ticks.map(
        (v) => svg`
          <line class="grid" x1=${x(v)} x2=${x(v)} y1=${TOP} y2=${HEIGHT - AXIS} stroke-dasharray="2 3"></line>
          <text class="tick" x=${x(v)} y=${HEIGHT - 5} text-anchor="middle">${clock(v)}</text>`,
      )}
      ${items.map((t) => {
        const lane = laneOf.get(t.source) ?? lanes.length - 1;
        const value =
          t.value !== null && t.value !== undefined
            ? `${String(t.value)}${t.unit ? ` ${t.unit}` : ""}`
            : t.raw;
        const tip = [
          t.time,
          `${t.source} → ${t.destination}`,
          t.destination_name ?? "",
          `${t.apci}${value ? `: ${value}` : ""}`,
        ]
          .filter(Boolean)
          .join("\n");
        return svg`<circle cx=${x(t.ts)} cy=${y(lane)} r=${r} fill=${colour(t.apci)}
          @click=${() => this.pick(t)}><title>${tip}</title></circle>`;
      })}
    </svg>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "xknx-telegram-timeline": TelegramTimeline;
  }
}
