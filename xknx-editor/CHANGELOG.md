# Changelog

## 0.4.4 (2026-09-19)

- The connection diagram no longer cuts names off. Every column is measured and drawn as wide as its
  own longest line, so a device, a group address and the value in a telegram's bubble are read in
  full; the diagram scrolls sideways when that makes it wide.
- Picking a room in the Device overview no longer opens the device instead: the row's click is the
  one that selects, and the Room cell keeps its own.
- A product without an application program (a power supply) is no longer counted as a device left
  out of the Group objects view for want of catalog data. It has no group objects because it has no
  application, which is not the same as missing data.
- MCP gained project_add_missing_com_objects, the tool form of 0.4.3's "Add them" button, and
  project_list_com_objects now reports `missing` alongside the items. Without it an assistant could
  see that a device's objects had no row but had nothing to do about it.

## 0.4.3 (2026-09-19)

- Group objects a device has switched on but that the project never gave a row are listed above the
  Group objects table, with a button that adds them so they can be linked. An imported device only
  carries what ETS instantiated, and until now those objects stayed out of reach for good - the
  reconcile on a parameter edit only adds what that edit itself switches on.
- A product without an application program (a power supply) is no longer counted among the products
  whose data is missing, in the catalog's list or in the topology: nothing is missing.

## 0.4.2 (2026-09-19)

- The README's MCP examples gained one more: having a device's configuration reviewed (the case that
  found a line coupler parameterised as a coupler while sitting at a device address).

## 0.4.1 (2026-09-19)

- What a project lost when it was imported is shown: the Project dock lists it ("2 lines have more
  than one segment", "the file holds 3 installations"), and an export repeats it, since the file
  written back cannot carry what the project never held. Upstream records these notes; they were
  stored and never shown.

## 0.4.0 (2026-09-19)

- The vendored editor packages are upstream v0.1.5. A project keeps far more of itself through an
  import and export: line and area couplers, the IP settings of IP interfaces and routers,
  devices not yet on a line, the group-object tree, and custom names and descriptions on group
  objects. The exported file is checked against the schema, undo no longer breaks on a device's
  binary data (the MDT DALI backup), and the MyKnx project hash is the signature itself rather
  than a guess at its digest.
- Devices with repeated channel modules - MDT push buttons above all - show all their group
  objects again. A com-object is matched by its qualified per-instance ref; the stored ref has the
  module instance stripped, so every channel collapsed onto one object, rows went missing and a
  reconcile could delete and recreate them with their links (upstream issue #17).
- Eleven of the thirteen local patches are gone: upstream carries them now. A new project is
  seeded with a building named after it, as upstream does.

## 0.3.19 (2026-09-18)

- The README shows what an LLM client can do over MCP, with worked examples (getting a device's
  unused functions working, filling in datapoint types, checking the installation against the bus).

## 0.3.18 (2026-09-18)

- A device whose product has no application program (a power supply) is no longer shown in the
  warning colour, and its note is plain text: nothing is missing, unlike a device whose product data
  is not in the catalog.
- The README explains how to connect an LLM client to the MCP server, including the `~/.claude.json`
  route for Claude Code without the CLI.

## 0.3.17 (2026-09-18)

- A line repeater's second segment survives the import: every device lands on the segment ETS put it
  on ("TP buiten segment"), and the topology tree shows the segments of a line that has more than
  one. The importer reads them from the raw project XML, since xknxproject flattens them.

## 0.3.16 (2026-09-18)

- Removing a device no longer reports "No device with id 22": the editor refetched the device it
  had just deleted and showed the 404. The selection is dropped instead.

## 0.3.15 (2026-09-18)

- The MCP server reports the add-on's version in `serverInfo` instead of the MCP SDK's ("1.28.1"),
  which is what a client showed when it connected.

## 0.3.14 (2026-09-18)

- A device without an individual address reads "4.1.-", the line it sits on, the way ETS writes it,
  instead of "-.-.-" - in the topology tree, the device lists, the buildings and the device editor.

## 0.3.13 (2026-09-18)

- A device without an application program (a power supply, a plain coupler) is added without an
  individual address: it is not programmed, and ETS leaves it without one too. Give an existing one
  back its "-.-.-" with Unassign address.

## 0.3.12 (2026-09-18)

- Open project lists the add-on's own projects folder, where every project is saved. The picker
  only offered /share, so the only way back into a project was the recent list.
- A product without an application program (a power supply, a plain coupler) can be added to the
  project again, for the topology and the bus load; opening its parameters says why it has none.
- The device tab has a Room field; until now a device could only be put in a room by dragging it in
  the Buildings dock or through the Device overview.
- Installation hints written by ETS are shown as the text they carry, like comments, instead of raw
  RTF; the CSV export follows.

## 0.3.11 (2026-09-17)

- About shows the add-on's real version instead of 0.1.0: the Supervisor's build version is handed
  to the backend.
- The page is served with `Cache-Control: no-cache`, so a browser picks up the new UI after an
  update instead of running the previous one until a hard reload.

## 0.3.10 (2026-09-17)

- Charts: every open group address is a tab of its own (plus All, to overlay them); the chart on
  show keeps growing live without losing a zoom, including addresses read from their payloads, and
  hovering the line shows the time and value.
- Datapoint types carry their unit (°C, m³, l/h ...), from the master data or xknx. Every place a
  DPT is picked - the group address editor, the new-address dialog, the monitor's DPT filter -
  searches number, name and unit in a dropdown; Help → Datapoint types lists them all.
- Read from device also reads an IP device's IP address, MAC address and name, with a link to its
  web interface - where a device such as the Gira S1 is configured.
- Parameter pages and blocks with nothing to show (SERV_CNTRL, LTE) are hidden, as in ETS; an ETS
  script button is shown, disabled, instead of silently left out.
- Device pictures: add one on the device's first tab (kept in Documents, tagged with the order
  number); it shows there and as a thumbnail in the topology tree.
- The right dock reads Project, History, Health; the Diagnostics tab has bold headings and a
  tighter layout, and so do the device editor's sections.

## 0.3.9 (2026-09-17)

- A parameter block without a title of its own no longer shows its internal name ("Grid") as a
  heading.

## 0.3.8 (2026-09-16)

- Device tools: Ping (does it answer, how fast), Identify (flashes the programming LED), Verify
  against project (reads the device and compares it with what a download would write), Unassign
  address, and a Diagnostics tab for reading and writing raw memory and interface-object properties.
- Assign address lists the devices in programming mode with their serial numbers, and finds the
  address a serial number carries.
- Device overview: select devices, ping or verify them in one go (online / verified columns), or
  compare them.
- Compare: two to eight devices side by side, every parameter and group object, differences
  highlighted.
- A device's Connections tab draws its group addresses and every other device on them; telegrams
  light up the address they are sent to. Devices and group addresses get a Telegrams tab, live and
  recorded.
- New centre views: Manufacturers (manufacturer → product → devices) and Group objects (every
  object of the project).
- Descriptions, comments and installation hints of devices, and descriptions and comments of group
  addresses, are editable and survive import and export; ETS's RTF comments are shown as text.
- Editing a device's parameters, links or address clears what it had loaded, so it shows it needs a
  download again (undo restores it).
- File → Export table as CSV: devices, group addresses, group objects, topology, buildings,
  manufacturers.
- Tools → Labels prints Avery label sheets or a legend sheet for the distribution board door.
- The group monitor has a Δ column and a timeline; View → Datapoint types shows DPTs numeric,
  formal or by name.
- The device editor opens on a tab named after the device (the Overview tab is gone), never shows a
  blank page after switching devices, and shows the product name when a device has no name of its
  own.

## 0.3.7 (2026-09-13)

- An address the project never typed can still be charted: its payloads are read the way the
  monitor reads them (1-bit switches, two-octet and IEEE floats), and the chart says the values
  were read from the payloads.
- The monitor drops the `~` in front of such a value; the italics already say it is a reading.
- Importing product data from a project names the manufacturer folders it could not take - one
  without `Hardware.xml` carries no product data, which used to pass silently and leave a device
  unresolved.

## 0.3.6 (2026-09-13)

- Fix 0.3.3/0.3.5: BCU 1, BCU 2 and BIM M112 devices are no longer refused. Commissioning one of
  them does work; the management model is now only named in the failure when a load step is
  actually rejected.
- The parameter pages of a device stand in a list down the side instead of a row of tabs, so a
  product with many pages needs no scrolling to reach them.
- Product data is taken out of a project one manufacturer at a time: an archive the catalog cannot
  read no longer costs the others, and the import result names the one that failed.

## 0.3.5 (2026-09-13)

- Linking a group object gives the address its datapoint type: a newly created address is typed
  from the object, and an existing address without a type takes the object's. Without a type the
  monitor can only guess what a telegram means.
- Which devices cannot be programmed is now read from the master data's management model (BCU 1,
  BCU 2, BIM M112 drive their load state machine through memory) instead of a hand-written list of
  masks.

## 0.3.4 (2026-09-13)

- Searching the group addresses matches the names of the groups themselves, not only of single
  addresses: a search for a middle group shows that group with everything in it, and groups
  without a match are left out instead of filling the tree with "no match".

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
