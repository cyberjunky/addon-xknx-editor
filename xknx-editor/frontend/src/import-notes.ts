/**
 * What an imported .knxproj carried that the project cannot fully hold. Recorded on import, kept on
 * the project and echoed on export, so the file written back can be trusted for what it says and
 * questioned for what it cannot carry. The backend keeps them machine-readable (code + count).
 */
import { t as tr } from "./i18n.js";

export type ImportNote = { code: string; count: number; detail: string };

/** One sentence per note, in the user's language. An unknown code prints as itself. */
export function importNoteText(note: ImportNote): string {
  const n = note.count;
  switch (note.code) {
    case "multiple_installations":
      return `${tr("The file holds")} ${n} ${tr("installations; only the first one is in this project, and only that one is exported.")}`;
    case "multi_segment":
      return `${n} ${tr("line(s) have more than one segment (a line repeater). They are imported, but check the segments after a round trip.")}`;
    case "dropped_duplicate_lines":
      return `${n} ${tr("line(s) had an address another line already used and were dropped on import.")}`;
    case "unassigned_devices":
      return `${n} ${tr("device(s) were not on a line.")}`;
    case "com_object_text_overrides":
      return `${n} ${tr("group object(s) carried a name or description of their own.")}`;
    case "ip_config":
      return `${n} ${tr("device(s) carried IP settings.")}`;
    default:
      return `${note.code}${n ? ` (${n})` : ""}${note.detail ? `: ${note.detail}` : ""}`;
  }
}
