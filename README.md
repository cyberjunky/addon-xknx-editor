<p align="center"><img src="docs/logo.png" alt="XKNX Editor" width="420"></p>

# Home Assistant add-on: XKNX Editor

A web-based KNX project editor for Home Assistant, built on the [xknx](https://github.com/XKNX/xknx)
library and the XKNX Editor packages (vendored under `xknx-editor/vendor`). Runs behind Home
Assistant Ingress, talks to the KNX bus through the host's network, and keeps its catalog and
projects under the add-on's config directory.

> [!WARNING]
> **Experimental software. Not affiliated with the KNX Association.**
>
> XKNX Editor comes with no stability or safety guarantees. It writes to real KNX hardware, and a
> failed or interrupted download can leave a device unloaded and its function unavailable until it
> is reprogrammed. Do not use it on a production installation you cannot afford to take offline, and
> keep a known-good backup of any project before opening it here.
>
> The device-programming implementation is based on [XKNX Toolkit](https://github.com/XKNX/xknxtoolkit),
> which describes itself as alpha, experimental software that is **not intended for end users** and
> that **cannot program devices**; the programming support here goes beyond it and has
> correspondingly less mileage behind it. Large parts of the upstream editor were built using LLMs.
>
> Verified device coverage is small. Please report what works and what does not.

**Status: 0.1.0, first public release.** Images are not published yet: add this repository to the
Home Assistant add-on store and the Supervisor builds it on your host, or place the `xknx-editor`
folder on the `/addons` share.

## What it does

- Import a `.knxproj` (password-protected too), or start a new project; export a `.knxproj`
  again, with the manufacturer data bundled from the catalog.
- Docked layout: buildings, topology, group addresses, devices and catalog on the left; editor,
  device overview, mass linker and tools in the centre; history, project and health on the right;
  group monitor, charts, statistics and catalog at the bottom. Undo/redo for every edit.
- Device editor with the parameter pages of the application program, the group objects table
  (C R W T U flags), preflight ("test before programming"), full/partial download, memory preview,
  read, restart, PDF manual.
- Product catalog from `.knxprod` files or the KNX online catalog, including "fetch the product
  data of this unresolved device".
- Gateway scan, tunnelling (plain, TCP, IP Secure with keyring), routing; group monitor with
  decoded values; read and write telegrams.
- Round-the-clock recording: every telegram goes to a SQLite archive under `/config`, so what
  happened on the bus at three in the morning can be looked up later. Archive view with filters
  (text, address or middle group, DPT, source), CSV export, retention by age and count.
- Charts of any group address's recorded values (up to four at once, live-updating), and
  statistics: telegrams over time, a weekday × hour activity heatmap, the busiest addresses and
  devices, and an availability report that explains every gap (quiet bus, link lost, add-on
  not running).
- Network view: devices and group addresses as a force-directed graph, pulsing with live
  traffic.
- Tools: extended copy, replace device, shift addresses, labels, topology check; mass linker.
- Recover a project from the bus (scan, identify, read back, verify, write into a project);
  assign individual addresses to devices in programming mode or by serial number.
- KNX Data Secure keyring viewer and converter; DALI bus commissioning on MDT gateways.
- MCP server for LLM clients (Claude Desktop, Home Assistant's MCP client), bearer-token
  protected, 80+ tools over the same live project and connection.
- UI fully in English, Dutch or German; product texts in the chosen product-data language.

User documentation for the add-on itself is in [xknx-editor/DOCS.md](xknx-editor/DOCS.md).

## Installing from the add-on store

1. Settings → Add-ons → Add-on Store → ⋮ → **Repositories**, add
   `https://github.com/cyberjunky/addon-xknx-editor`.
2. Open **XKNX Editor** in the new section and **Install**. No images are published yet, so the
   Supervisor builds the add-on on the host (a few minutes; `aarch64` and `amd64`).
3. Later versions arrive the usual way: ⋮ → _Check for updates_, then **Update** on the add-on
   page. The Supervisor compares `version` in `xknx-editor/config.yaml` with the installed one,
   so every release raises it and is tagged `v<version>`.

> [!NOTE]
> Installed before 0.2.0, while `config.yaml` still read `version: dev`? Home Assistant cannot
> compare `dev` with a release number — it is one of the special container tags, like `latest` —
> so the update dialog lists 0.2.0 but stays greyed out on "Up-to-date". The Supervisor itself has
> no such problem: run `ha addons update xknx_editor` in the Terminal & SSH add-on once, and every
> later update works from the UI. Reinstalling also works but drops the add-on's `/config` data
> (catalog, documents, keys, recorded telegrams), so back that up first from the File menu.

## Installing (local build)

1. Copy the `xknx-editor/` folder into your Home Assistant `addons` share as
   `\\<host>\addons\addon-xknx-editor\xknx-editor` (the layout the add-on store uses), or
   run `tools/deploy-local.ps1`, which packs the vendored sources, mirrors the folder and stamps the
   version with the git sha.
2. Settings → Add-ons → Add-on store → ⋮ → _Check for updates_. "XKNX Editor (dev)" appears under
   _Local add-ons_.
3. Install (the Supervisor builds the image on the host, a few minutes), start, open the sidebar
   panel.

Options: `log_level`, `ingress_only` (only Home Assistant's Ingress proxy may reach the add-on),
`mcp_token` (enables the MCP server at `/mcp` on the add-on port), `language` (product texts and UI).

## Connecting an LLM client (MCP)

The add-on speaks the Model Context Protocol, so a client such as Claude Desktop, Claude Code or
Home Assistant's own MCP client can read and edit the open project, browse the catalog and drive
the bus — the same live project and connection as the web UI, over 80 tools.

1. **Pick a token.** Any random string; it is the password of the endpoint, not something Home
   Assistant issues. On Windows:
   `-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 40 | % { [char]$_ })`
2. **Enable the server.** Add-on → _Configuration_ → `mcp_token` → paste it, save, restart. Empty
   keeps the server off.
3. **Publish the port.** The endpoint is `http://<home-assistant>:<add-on port>/mcp/` (the port is
   in the add-on log at start, 8099 by default). Ingress does not carry it, so the port has to be
   open under _Network_. `/mcp` is reachable even with `ingress_only` on: the token is what
   protects it.
4. **Point the client at it.** Every request needs `Authorization: Bearer <mcp_token>`. Mind the
   trailing slash: `/mcp` answers with a redirect to `/mcp/`, which not every client follows.

Claude Desktop (`claude_desktop_config.json`) and any client with the same shape:

```json
{
  "mcpServers": {
    "xknx": {
      "type": "http",
      "url": "http://homeassistant.local:8099/mcp/",
      "headers": { "Authorization": "Bearer <mcp_token>" }
    }
  }
}
```

Claude Code, if the CLI is on the path:

```
claude mcp add --transport http --scope user xknx http://homeassistant.local:8099/mcp/ \
  --header "Authorization: Bearer <mcp_token>"
```

Without the CLI, put the same `mcpServers` block at the top level of `~/.claude.json`
(`C:\Users\<you>\.claude.json`), next to `projects`, and restart the client. Keep it there rather
than in a project's `.mcp.json`, which would carry the token into the repository.

Programming and monitor writes act on the real bus and cannot be undone; project edits are
undoable. Treat the token like a password: anyone who reaches the port with it can program the
installation.

## Repository layout

```
xknx-editor/            the add-on: config.yaml, build.yaml, Dockerfile, rootfs/, app/ (backend),
                        frontend/ (Lit UI), vendor/ (upstream sources, patches, wheels)
.github/workflows/      lint + backend tests + image build per architecture
tools/                  pack-vendor.ps1, deploy-local.ps1
```

Development: backend tests `cd xknx-editor/app && pytest`, frontend `cd xknx-editor/frontend &&
npm run build`, deploy `tools/deploy-local.ps1`.

## Disclaimer

An independent, open-source project built on the xknx library. **Not affiliated with, endorsed
by, or connected to** the KNX Association or its ETS software. "KNX" and "ETS" are trademarks of
the KNX Association, used here only to state this non-affiliation and to describe interoperability
with the published standard and file formats.

## Acknowledgements

- [knx-ai](https://github.com/knx-ai) for XKNX Editor, the packages this add-on is built on.
- [kewde](https://github.com/kewde) for xknxtoolkit, which the device programming is based on.
- The [XKNX](https://github.com/XKNX) project for xknx and xknxproject.

## Licence

This add-on is licensed under the **GNU General Public License v2.0 only** (`GPL-2.0-only`), see
[LICENSE](LICENSE). Copyright (C) 2026 Ron Klinkien (cyberjunky).

The vendored XKNX Editor packages are Copyright (C) 2026 knx-ai, `GPL-2.0-only`, based on
[xknxtoolkit](https://github.com/XKNX/xknxtoolkit) by kewde, which is itself `GPL-2.0-only`
(licence added by its author on 2026-09-06). The copyleft is also inherited from
[xknxproject](https://github.com/XKNX/xknxproject) (`GPL-2.0-only`), used for `.knxproj` import:
as a combined, distributed work the add-on is therefore `GPL-2.0-only`. Other bundled libraries
are permissive: xknx (MIT), Starlette and uvicorn (BSD), the MCP Python SDK (MIT), Lit (BSD),
Shoelace (MIT), Lucide (ISC). No Apache-2.0 code is shipped in the image (the MCP SDK's optional
`python-multipart` dependency is left out on purpose).

Provenance: the editor packages derive from xknxtoolkit by kewde, which carries `GPL-2.0-only`
since 2026-09-06, and XKNX Editor by knx-ai is `GPL-2.0-only`; this add-on's own code is
`GPL-2.0-only` as well. The vendored snapshot commit is recorded in
`xknx-editor/vendor/UPSTREAM_COMMIT` and every local modification is a patch under
`xknx-editor/vendor/patches/`, as the licence asks. Container plumbing follows the layout of the Expaso
Home Assistant add-ons but was written fresh for this repository.

This program comes with ABSOLUTELY NO WARRANTY. This is free software, and you are welcome to
redistribute it under the terms of the GNU General Public License version 2.
