/**
 * How datapoint types are shown: numeric ("9.001"), formal ("DPST-9-1") or friendly (the name,
 * "temperature (°C)"). A per-browser choice from the View menu; the stored value in the project is
 * always the formal id.
 */
import { api } from "./api.js";

export type DptStyle = "numeric" | "formal" | "friendly";
export const DPT_STYLES: { id: DptStyle; label: string }[] = [
  { id: "numeric", label: "Numeric (9.001)" },
  { id: "formal", label: "Formal (DPST-9-1)" },
  { id: "friendly", label: "Friendly (name)" },
];

export type Dpt = {
  id: string;
  main: number;
  sub: number | null;
  name: string;
  text: string;
  main_text: string;
  size_bits: number | null;
  unit: string | null;
  number: string;
};

let dpts: Promise<Dpt[]> | null = null;

/** Every datapoint type from the master data (one request per page load). */
export function loadDpts(): Promise<Dpt[]> {
  dpts ??= api
    .get<{ items: Dpt[] }>("api/dpts")
    .then((r) => r.items)
    .catch((e) => {
      dpts = null;
      throw e;
    });
  return dpts;
}

let style: DptStyle = "numeric";
try {
  const saved = localStorage.getItem("xknx.dptStyle");
  if (saved === "numeric" || saved === "formal" || saved === "friendly")
    style = saved;
} catch {
  /* storage unavailable */
}

let names: Map<string, string> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Load the DPT names once (for the friendly style); listeners re-render when they arrive. */
export function loadDptNames(): Promise<void> {
  loading ??= loadDpts()
    .then((items) => {
      names = new Map(
        items.map((d) => [d.id, `${d.text || d.name}${d.unit && !(d.text || "").includes(d.unit) ? ` (${d.unit})` : ""}`]),
      );
      for (const fn of listeners) fn();
    })
    .catch(() => {
      loading = null;
    });
  return loading;
}

export function onDptNames(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function dptStyle(): DptStyle {
  return style;
}

export function setDptStyle(next: DptStyle): void {
  style = next;
  try {
    localStorage.setItem("xknx.dptStyle", next);
  } catch {
    /* storage unavailable */
  }
  if (next === "friendly") void loadDptNames();
  for (const fn of listeners) fn();
}

/** "DPST-13-10" → "13.010", "DPT-1" → "1.xxx". */
function numeric(dpt: string): string {
  const m = /^DPST-(\d+)-(\d+)$/.exec(dpt);
  if (m) return `${m[1]}.${m[2].padStart(3, "0")}`;
  const n = /^DPT-(\d+)$/.exec(dpt);
  return n ? `${n[1]}.xxx` : dpt;
}

/** A datapoint type in the chosen style; "" for none. */
export function formatDpt(dpt: string | null | undefined): string {
  if (!dpt) return "";
  if (style === "formal") return dpt;
  if (style === "friendly") {
    if (!names) {
      void loadDptNames();
      return numeric(dpt);
    }
    return names.get(dpt) ?? numeric(dpt);
  }
  return numeric(dpt);
}

/** The other two styles, for a tooltip. */
export function dptTitle(dpt: string | null | undefined): string {
  if (!dpt) return "";
  const friendly = names?.get(dpt);
  return [dpt, numeric(dpt), friendly].filter(Boolean).join(" · ");
}
