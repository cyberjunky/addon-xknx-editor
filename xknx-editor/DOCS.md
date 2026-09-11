# XKNX Editor add-on

A web-based KNX project editor: import or create a project, place devices from the product
catalog, set parameters, link group objects to group addresses, program devices over a KNX/IP
gateway, watch the bus, and export the result as a `.knxproj`. Everything runs inside Home
Assistant behind Ingress; projects and the catalog live under the add-on's config directory.

> **Experimental software. Not affiliated with the KNX Association.** It writes to real KNX
> hardware: a failed download can leave a device unloaded until it is reprogrammed. Keep a
> backup of every project you open here.

## Getting started

1. Put `.knxprod` product files (from the manufacturer or the KNX online catalog) and, if you have
   one, your `.knxproj` export on the `/share` folder (`\\<home-assistant>\share`).
2. Open the panel. File → _Import project_ or _New project_. The left dock has Buildings,
   Topology, Group addresses, Devices and Catalog; the centre shows what you select.
3. Catalog → import the product files, or use the online catalog search. Unresolved devices offer
   _Fetch product data online_.
4. Gateway (top right) → Scan, pick your KNX/IP gateway, Settings for IP Secure (upload the
   `.knxkeys` keyring, Check, choose a tunnel user) → Connect.
5. Select a device → _Test before programming_ shows what a download would change → _Program device_.

Edits are written to the project file immediately (undo/redo in the Edit menu and the History
dock). File → _Save a copy…_ writes a backup; File → _Export project_ writes a `.knxproj`.
The last open project is reopened when the add-on restarts.

## Centre tabs

- **Editor**: the selected device (parameters, group objects with C R W T U flags, programming),
  line, group address or building space.
- **Device overview**: every device with the usual columns; sortable.
- **Mass link**: pick devices, pair their objects with group addresses by name (datapoint types
  must agree) or sequentially from a start address; or connect two objects through a new address.
- **Recover**: rebuild a project from the bus. Scan a range of addresses, match each device's
  application against the catalog, read its tables and parameters back (read-only), verify, then
  add the devices to the open project or a new one. Unknown products: import their `.knxprod` in
  the Catalog tab, then _Re-identify_.
- **Secure**: what the configured `.knxkeys` keyring holds (interfaces, devices, group keys) and a
  converter that writes it under a new password.
- **Documents**: upload manuals, datasheets and drawings and open them later from the add-on;
  tag one with an order number and it shows up in that device's editor.
- **AI**: the MCP server's status, endpoint, client configuration and tool list.
- **Tools**: Extended copy (duplicate a device n times, rename copies, create a group address per
  object), Replace device (keep name, address, room and links), Shift addresses (offset a block of
  devices, all-or-nothing), Labels (CSV), Topology check (missing, duplicate or malformed addresses,
  missing product data).

## Device editor extras

- **Assign address**: writes the device's project address into the one device in programming
  mode (press its programming button first), or into the device with the given serial number.
- **DALI bus** tab (MDT DALI Control gateways only): scan the DALI bus, blink or switch a ballast
  to identify it, all on/off, new installation (renumbers every ballast) and post installation.
  Ported from upstream's new package; not yet verified on hardware.
- **Signing key** (Help menu): `.knxproj` exports are signed with a placeholder key unless you
  paste the converter key from your own ETS installation. The dialog shows a PowerShell one-liner
  that extracts it on a Windows PC with ETS (`Knx.Ets.XmlSigning.dll`). Stored under
  `/config/signing_key.json` only.

## Options

| Option         | Default | Meaning                                                                                                                                                                      |
| -------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `log_level`    | `info`  | uvicorn log level: debug, info, warning, error                                                                                                                               |
| `ingress_only` | `true`  | Only accept requests from the Supervisor's Ingress proxy (172.30.32.2). Turn off for direct access on the add-on port. `/mcp` is exempt (see below).                         |
| `mcp_token`    | empty   | Set a token to enable the MCP server. Empty keeps it off.                                                                                                                    |
| `language`     | `en-US` | Language for product texts (parameters, object names) and the UI language (English, Dutch, German; other codes fall back to English; View → Language overrides per browser). |

## MCP server

With `mcp_token` set, the add-on serves the Model Context Protocol over Streamable HTTP at
`http://<home-assistant>:<add-on port>/mcp` (the port is printed in the add-on log at start).
Every request needs `Authorization: Bearer <mcp_token>`. The 80+ tools cover the open project
(devices, parameters, group objects, group addresses, buildings, undo/redo, export), the catalog
(local and online), the bus connection, the group monitor and device programming, plus the Tools
operations. They act on the same live project and connection as the web UI.

Claude Desktop example (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "xknx-editor": {
      "type": "http",
      "url": "http://homeassistant.local:8099/mcp",
      "headers": { "Authorization": "Bearer <mcp_token>" }
    }
  }
}
```

Programming and monitor writes act on the real bus and are not undoable; the server's
instructions tell the model so. Treat the token like a password.

## Network

The add-on runs with `host_network: true` so KNX routing (multicast 224.0.23.12) and gateway
discovery work. If Home Assistant's own KNX integration already holds your gateway's only tunnel
slot, a second tunnel from the editor is refused; use routing, a multi-tunnel gateway, or another
tunnel user from the keyring (IP Secure).

## Files

| Inside the add-on             | On the host                                 | Content                                 |
| ----------------------------- | ------------------------------------------- | --------------------------------------- |
| `/config/catalog.xknxcatalog` | `/addon_configs/<slug>/catalog.xknxcatalog` | product catalog (SQLite)                |
| `/config/projects/*.xknx`     | `/addon_configs/<slug>/projects/`           | projects (SQLite, edits committed live) |
| `/config/docs/`               | `/addon_configs/<slug>/docs/`               | uploaded manuals, datasheets, drawings  |
| `/config/keyrings/`           | `/addon_configs/<slug>/keyrings/`           | uploaded `.knxkeys`                     |
| `/config/settings.json`       | `/addon_configs/<slug>/settings.json`       | gateway settings (keyring password too) |
| `/share`                      | `\\<home-assistant>\share`                  | your `.knxprod`, `.knxproj`, exports    |
