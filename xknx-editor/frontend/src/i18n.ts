/**
 * UI strings. English is the source; Dutch and German cover the shell (menus, docks, dialogs,
 * gateway menu). Views fall back to English for keys that are not translated yet.
 * The language comes from the add-on option `language` (via /api/status) and can be overridden per
 * browser from the View menu.
 */

import { VIEWS_DE, VIEWS_NL } from "./i18n-views.js";

export type Lang = "en" | "nl" | "de";

const NL: Record<string, string> = {
  "Saved automatically": "Automatisch opgeslagen",
  File: "Bestand",
  Edit: "Bewerken",
  View: "Beeld",
  Gateway: "Gateway",
  Help: "Help",
  "New project…": "Nieuw project…",
  "Open project…": "Project openen…",
  "Import project (.knxproj)…": "Project importeren (.knxproj)…",
  "Save a copy…": "Kopie opslaan…",
  "Export project (.knxproj)…": "Project exporteren (.knxproj)…",
  "Edits are saved to the project file as you make them":
    "Wijzigingen worden direct in het projectbestand opgeslagen",
  "Close project": "Project sluiten",
  Undo: "Ongedaan maken",
  Redo: "Opnieuw",
  "Show right panel": "Rechterpaneel tonen",
  "Show bottom panel": "Onderpaneel tonen",
  Connect: "Verbinden",
  Disconnect: "Verbinding verbreken",
  "Group monitor": "Groepsmonitor",
  "Status page (scan, diagnostics)": "Statuspagina (scan, diagnose)",
  "About XKNX Editor": "Over XKNX Editor",
  "Signing key…": "Ondertekeningssleutel…",
  "Project log key…": "Projectlogboeksleutel…",
  "Third-party licences…": "Licenties van derden…",
  Buildings: "Gebouwen",
  Topology: "Topologie",
  "Group addresses": "Groepsadressen",
  Devices: "Apparaten",
  Catalog: "Catalogus",
  Editor: "Editor",
  "Device overview": "Apparaatoverzicht",
  "Mass link": "Massakoppeling",
  Tools: "Hulpmiddelen",
  Recover: "Herstellen van bus",
  Secure: "XKNX Secure",
  AI: "AI",
  Documents: "Documenten",
  "Recent projects": "Recente projecten",
  "Clear list": "Lijst wissen",
  open: "geopend",
  History: "Geschiedenis",
  Project: "Project",
  Health: "Controle",
  Logs: "Logboek",
  Status: "Status",
  Language: "Taal",
  "No project open": "Geen project geopend",
  devices: "apparaten",
  "No gateway": "Geen gateway",
  Settings: "Instellingen",
  "Scan for gateways": "Zoeken naar gateways",
  "Select a device, line, group address or building on the left.":
    "Kies links een apparaat, lijn, groepsadres of gebouw.",
  "Open, create or import a project from the File menu.":
    "Open, maak of importeer een project via het menu Bestand.",
};

const DE: Record<string, string> = {
  "Saved automatically": "Automatisch gespeichert",
  File: "Datei",
  Edit: "Bearbeiten",
  View: "Ansicht",
  Gateway: "Gateway",
  Help: "Hilfe",
  "New project…": "Neues Projekt…",
  "Open project…": "Projekt öffnen…",
  "Import project (.knxproj)…": "Projekt importieren (.knxproj)…",
  "Save a copy…": "Kopie speichern…",
  "Export project (.knxproj)…": "Projekt exportieren (.knxproj)…",
  "Edits are saved to the project file as you make them":
    "Änderungen werden sofort in der Projektdatei gespeichert",
  "Close project": "Projekt schließen",
  Undo: "Rückgängig",
  Redo: "Wiederholen",
  "Show right panel": "Rechtes Panel anzeigen",
  "Show bottom panel": "Unteres Panel anzeigen",
  Connect: "Verbinden",
  Disconnect: "Trennen",
  "Group monitor": "Gruppenmonitor",
  "Status page (scan, diagnostics)": "Statusseite (Scan, Diagnose)",
  "About XKNX Editor": "Über XKNX Editor",
  "Signing key…": "Signaturschlüssel…",
  "Project log key…": "Projektprotokollschlüssel…",
  "Third-party licences…": "Lizenzen Dritter…",
  Buildings: "Gebäude",
  Topology: "Topologie",
  "Group addresses": "Gruppenadressen",
  Devices: "Geräte",
  Catalog: "Katalog",
  Editor: "Editor",
  "Device overview": "Geräteübersicht",
  "Mass link": "Massenverknüpfung",
  Tools: "Werkzeuge",
  Recover: "Vom Bus wiederherstellen",
  Secure: "XKNX Secure",
  AI: "KI",
  Documents: "Dokumente",
  "Recent projects": "Zuletzt geöffnete Projekte",
  "Clear list": "Liste leeren",
  open: "geöffnet",
  History: "Verlauf",
  Project: "Projekt",
  Health: "Prüfung",
  Logs: "Protokoll",
  Status: "Status",
  Language: "Sprache",
  "No project open": "Kein Projekt geöffnet",
  devices: "Geräte",
  "No gateway": "Kein Gateway",
  Settings: "Einstellungen",
  "Scan for gateways": "Gateways suchen",
  "Select a device, line, group address or building on the left.":
    "Links ein Gerät, eine Linie, eine Gruppenadresse oder ein Gebäude wählen.",
  "Open, create or import a project from the File menu.":
    "Ein Projekt über das Menü Datei öffnen, anlegen oder importieren.",
};

const TABLES: Record<Lang, Record<string, string>> = {
  en: {},
  nl: { ...VIEWS_NL, ...NL },
  de: { ...VIEWS_DE, ...DE },
};

let current: Lang = "en";

/** Pick the UI language: an explicit per-browser choice wins over the add-on option. */
export function initLanguage(addonLanguage: string | undefined): Lang {
  let chosen: string | null = null;
  try {
    chosen = localStorage.getItem("xknx.lang");
  } catch {
    /* storage unavailable */
  }
  const code = (chosen || addonLanguage || "en").slice(0, 2).toLowerCase();
  current = code === "nl" || code === "de" ? code : "en";
  return current;
}

export function setLanguage(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem("xknx.lang", lang);
  } catch {
    /* ignore */
  }
}

export function language(): Lang {
  return current;
}

export function t(key: string): string {
  return TABLES[current][key] ?? key;
}

export const LANGUAGES: { id: Lang; label: string }[] = [
  { id: "en", label: "English" },
  { id: "nl", label: "Nederlands" },
  { id: "de", label: "Deutsch" },
];
