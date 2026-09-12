/** Lucide icons (ISC) rendered as inline SVG for Lit templates. */
import { createElement, type IconNode } from "lucide";
import {
  Activity,
  Boxes,
  Building2,
  ChartLine,
  ChevronDown,
  ChevronRight,
  Cloud,
  Cpu,
  Download,
  FolderOpen,
  FolderPlus,
  Link2,
  Link2Off,
  Network,
  Plus,
  Redo2,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide";
import { html, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

const registry: Record<string, IconNode> = {
  activity: Activity,
  boxes: Boxes,
  chart: ChartLine,
  building: Building2,
  down: ChevronDown,
  right: ChevronRight,
  cloud: Cloud,
  cpu: Cpu,
  download: Download,
  open: FolderOpen,
  newfolder: FolderPlus,
  link: Link2,
  unlink: Link2Off,
  network: Network,
  plus: Plus,
  secure: ShieldCheck,
  redo: Redo2,
  search: Search,
  settings: Settings2,
  trash: Trash2,
  undo: Undo2,
  upload: Upload,
  close: X,
};

const cache = new Map<string, string>();

export function icon(name: keyof typeof registry, size = 18): TemplateResult {
  const key = `${name}:${size}`;
  let svg = cache.get(key);
  if (!svg) {
    const el = createElement(registry[name], {
      width: size,
      height: size,
      "stroke-width": 1.75,
    });
    el.setAttribute("aria-hidden", "true");
    // An inline SVG sits on the text baseline, which leaves the descender gap below it and makes
    // the glyph look lifted inside a button. Align its middle instead. Inert inside a flex
    // container, so this is safe everywhere an icon is used.
    el.setAttribute("style", "vertical-align: middle");
    svg = el.outerHTML;
    cache.set(key, svg);
  }
  return html`${unsafeHTML(svg)}`;
}
