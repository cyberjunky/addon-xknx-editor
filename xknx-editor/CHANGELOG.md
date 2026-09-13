# Changelog

## 0.3.3 (2026-09-13)

- A device from the early BCU families (masks 0010-0025) is refused before anything is written,
  with the reason: its load state machine is memory mapped, while the download engine drives the
  property-based one, so every load step came back rejected
  (`object 5 property 5 returned 0 elements`).

## 0.3.2 (2026-09-13)

- Importing a `.knxproj` now takes the manufacturer data it bundles into the catalog as well, so
  its devices resolve straight away instead of reading "application not in the catalog" until the
  same file was imported a second time through the catalog.
- The device editor has its tabs at the top: Overview (name, address, download, the bus buttons,
  product data and documents), Parameters and Group objects, with the device's address and name in
  the tab bar.
- Closing the right or bottom panel gives the centre the whole space; 160 px stayed reserved for
  the closed pane.
- The charts picker offers the addresses the recorder has seen, busiest first and with their
  telegram count, so traffic can be charted without a project or for addresses the project does
  not know.
- A device that refuses a step of the load procedure is explained (a partial download needs the
  device to accept load control; a full download is the way round it) instead of reporting
  `VerificationError`.

## 0.3.1 (2026-09-13)

- Programming reports its progress in plain words ("writing to the device, step 3 of 12") instead
  of the KNX procedure's own name ("load control 3/12").

## 0.3.0 (2026-09-13)

- Linking a group object: the address picker is a search box over address and name instead of a
  dropdown of everything, and typing an address that does not exist yet offers to create it and
  link it in one go (double-click links as sending).

## 0.2.9 (2026-09-13)

- A full download writes the individual address when it has to: if nothing answers at the
  project's address and exactly one device is in programming mode, that device is given the
  address and then loaded, in one job. Partial downloads never touch the address.
- Read from device, Assign address and Restart moved above the manufacturer block, where they can
  be found without scrolling past the product data.

## 0.2.8 (2026-09-13)

- The Assign address dialog says which address the device in programming mode carries now and
  which one Assign will write into it, so there is no doubt about what changes.

## 0.2.7 (2026-09-13)

- When nothing answers at a device's address, the add-on looks for a device in programming mode
  and says so: an address changed in the project is not in the device until Assign address writes
  it there.

## 0.2.6 (2026-09-13)

- A duplicate individual address is now proven rather than suggested: telegrams that arrive FROM
  the address the editor sends from can only come from something else using it, and both the
  connection warning and a refused download say so, with the count.
- The group monitor shows connection control as well (`TConnect`, `TDisconnect`, `TAck`), so a
  failed download can be followed telegram by telegram in the archive.

## 0.2.5 (2026-09-13)

- Assign individual address waits for the programming button: the dialog reports how many devices
  are in programming mode and only lets the address be written when exactly one is (or when a
  serial number is given, which needs no button).

## 0.2.4 (2026-09-13)

- The group monitor reads a payload whose address has no datapoint type: the payload length leaves
  one likely reading, shown greyed and in italics (`≈ 38`, `14.xxx`) so it is never mistaken for
  the project's own value.
- A dropped management connection names the likely cause when it can: if the address the editor
  sends from belongs to a device in the project, the message says so. Connecting warns about the
  same clash right away instead of waiting for the first download.

## 0.2.3 (2026-09-13)

- Messages at the bottom right have a close button, and an error stays until it is closed instead
  of fading after a few seconds - the programming errors are long enough to want reading twice.
- "Remove from project" is "Remove device from project" and asks first.

## 0.2.2 (2026-09-13)

- Fix 0.2.1: a failing job reported "failed" with no message at all (test before programming,
  programming, read from device). The new error formatting used `ApiError` without importing it,
  so the error handler itself broke before it could say what went wrong. CI now checks for
  undefined names, which would have caught it.

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
