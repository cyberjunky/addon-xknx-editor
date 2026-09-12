# Changelog

## Unreleased (2026-09-12)

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
