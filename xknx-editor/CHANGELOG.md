# Changelog

## 0.2.1 (2026-09-13)

- "Download PDF manual" is now "Find manual" and searches the web with whatever the device
  carries - manufacturer, order number, product, application, or an order number read out of
  the product reference. The KNX device database is no longer queried: its list page ignores the
  search term, so the fallback used to open an empty page.
- A device's documents are folded open when it has any, with their number next to the heading.
- A refused or timed-out management connection explains itself (another tool holding the device,
  or two clients sharing one individual address) instead of reporting
  `ManagementConnectionRefused`, and the gateway menu shows the address the editor sends from.
- The live group monitor keeps running while the bottom dock shows Charts, Statistics or the
  Catalog: its Start/Stop state moved to the shared store, since the dock unmounts the view.
- Telegrams recorded while no project was open are decoded as soon as one is (or as soon as an
  address gets a datapoint type), so the archive and the charts show their values instead of
  nothing.
- A chart with no numeric values says why. The statistics histogram no longer stretches its
  labels (they were drawn inside a horizontally scaled SVG), and availability shares below one
  per cent read "<1%" rather than "0%".

## 0.2.0 (2026-09-13)

- Picking a gateway from the list connects to it at once, and the gateway bubble says
  "· not connected" / "· connecting…" / "· reconnecting…" next to a chosen gateway instead of
  only changing the colour of the dot.
- Import project takes the `.knxproj` from this computer (uploaded to `/config/imports`, then
  imported like before, password step included); picking a file on `/share` stays as the second
  option.
- `repository.yaml` at the root, so the repository can be added to the Home Assistant add-on
  store by URL.
- The image builds from a plain git clone as well: the Dockerfile takes the vendored editor
  sources from `vendor/xknx-editor/` when the packed tarball is absent (an install from the add-on
  store failed on the missing tarball).

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
