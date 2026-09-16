# Applied upstream patches

The vendored tree is upstream `main` at the commit in `../UPSTREAM_COMMIT` **plus** these open
upstream pull requests and cherry-picks from later upstream releases, applied with `git apply` (PR #4 with `patch --fuzz=3` after #13, which
touches the same file). Drop a patch here once upstream merges it; re-apply the rest when
re-vendoring: check out the commit in `../UPSTREAM_COMMIT`, `git apply` each patch in the order of
this table, and pack the tree.

| Patch | Upstream PR | Author | What it fixes |
| --- | --- | --- | --- |
| `upstream-pr-13.diff` | #13 | FezVrasta | Export certification ETS accepts: certificate named after the project id, `.validation` record |
| `upstream-pr-4.diff` | #4 | FezVrasta | MyKnx login no longer logs the password |
| `upstream-pr-8.diff` | #8 | FezVrasta | Preflight no longer hides missing programming data |
| `upstream-pr-9.diff` | #9 | FezVrasta | Truncated property compare responses are rejected |
| `upstream-pr-10.diff` | #10 | FezVrasta | Coupler filter tables include Unfiltered and AdditionalGroupAddresses pass-through (mirrored in `app/.../programming.py`) |
| `upstream-pr-12.diff` | #12 | FezVrasta | Module com-object instance refs survive import/export (adds `com_objects.instance_ref_id`, migrated on open) |
| `upstream-d67f9fd-storage.diff` | v0.1.1 | knx-ai | `ProjectStorageError` + `ensure_sqlite_writable`: a location SQLite cannot use (network share, read-only dir) fails fast with a clear message instead of "unable to open database file" mid-import. The add-on maps it onto HTTP 400 in `app/.../editor.py` |
| `upstream-5a16331-association-table.diff` | v0.1.4 | knx-ai | `DownloadImage.masked_writes` required a whole allocation to lie inside one image segment. The group-address and association tables declare their full capacity (513/511 octets) while the image holds only the used entries, so it returned `None`, the write path's `if runs:` skipped them, and the association table (the group-address links) was never written to the device. Now collects every overlapping segment clipped to the range |
| `upstream-issue-16-certificate-tail.diff` | issue #16 | (ours) | The exported `{pid}.certificate` ended with one CRLF where a genuine one ends with a blank line, 483 bytes against 485. The `certificate:` block inlined in `.validation` did carry the blank line, so the archive held two copies of the same certificate that disagreed by two bytes |
| `upstream-9c6a324-union-params.diff` | v0.1.2 | knx-ai | Union parameter members that overlap in memory no longer both render (duplicate parameter blocks, e.g. MDT Glas push button "Display mode"); a parameter's imported value survives a block being deactivated, so re-activating picks the right Choose branch; com-object section activeness matches on the object id rather than the full ref |
| `upstream-d67f9fd-preflight.diff` | v0.1.1 | knx-ai | Preflight no longer errors on an `LdCtrlAbsSegment` range the image does not cover (a RAM/system segment): the download allocates and leaves it unwritten, so the diff is allocate-only, not a failure |
| `ours-device-texts-and-download-state.diff` | - | (ours) | A device's `Comment` and `InstallationHints` are imported, stored (two new columns, added on open) and exported; `SetDeviceText` / `SetGroupAddressText` events edit device and group-address texts with undo. An edit clears the loaded tick of the part it changes (parameters, group communication, individual address) in the same undo step, so a device shows it needs a download again |

Not applied: #5/#6 (embedded MCP server, not used here), #7 (desktop settings file permissions;
the add-on writes `/config/settings.json` itself), #11 (README wording).
