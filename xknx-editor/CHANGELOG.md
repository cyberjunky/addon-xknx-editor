# Changelog

## Unreleased (2026-09-12)

- Round-the-clock telegram recording to `/config/telegrams.db` (on by default, retention by age
  and count, settings in the group monitor's Archive mode), with auto-connect retrying a gateway
  that is down at boot. The group monitor gained a Live / Archive toggle and one filter bar for
  both: text, address or middle group (`1/2/`), DPT (`9` or `9.001`); the archive adds time range,
  source, group/individual, paging and a CSV export.
- Charts dock: recorded values of up to four group addresses, line / steps / area, min / max /
  average / last, live-growing ranges; chart buttons on telegrams, on group addresses and in the
  statistics.
- Statistics dock: totals, telegrams over time, a weekday × hour activity heatmap, busiest
  addresses and devices, and an availability report (recording / link lost / add-on not running,
  plus quiet stretches) that explains gaps in the history.
- Network view: devices and group addresses as a force-directed graph (force-graph, MIT), pulsing
  with live traffic; devices by room, addresses by main group, arrows on sending links.
- MCP tools `monitor_archive`, `monitor_series`, `monitor_stats`; backup category "Recorded
  telegrams" (off by default).
- `tools/deploy-local.ps1` mirrors the add-on to `addons\addon-xknx-editor\xknx-editor`, the
  repository/add-on layout the add-on store uses, instead of a flat `addons\xknx-editor`.

## 0.1.0 (2026-09-11)

First public release. A web-based KNX project editor as a Home Assistant add-on, built on xknx and
the XKNX Editor packages.

- Projects: import a `.knxproj` (password-protected too), create new, open, save a copy, export a
  `.knxproj` with the manufacturer data bundled; the ten most recent projects in the File menu.
- Device editor: parameters, group objects with flags and links, preflight and download, memory
  read, restart, assign individual address by serial, per-device documents.
- Group addresses, buildings and rooms, topology with per-segment bus load.
- Catalog: import `.knxprod` files, browse and download from the KNX online catalog, and pull product
  data out of a `.knxproj`; drag a product onto Devices, Topology or a room to add it.
- Group monitor with decoded values and datapoint types, Start/Stop recording, read and write.
- Tools: extended copy, replace device, shift addresses, labels, topology check, mass linker,
  recover a project from the bus, KNX Secure keyring viewer and converter, DALI commissioning
  (unverified on hardware).
- Health: project consistency checks plus audit rules (datapoint conflicts, addresses nothing acts
  on, objects that never send, Secure without a keyring, parameter outliers, segment capacity and
  bus current), filterable by kind.
- Documents library for manuals and datasheets, opened from the add-on.
- Back up and restore the catalog, documents, settings, keys and project logs.
- MCP server (optional, token-protected) for LLM clients.
- Interface in English, Dutch and German.
