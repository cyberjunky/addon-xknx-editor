# Applied upstream patches

The vendored tree is upstream `main` at the commit in `../UPSTREAM_COMMIT` (v0.1.5) **plus** these
local changes, applied with `git apply` in the order of this table.

Upstream rewrote its history on 2026-09-06: today's `main` is a squashed, one-commit-per-release
line whose root is *"XKNX Editor - initial release"*, and the old commits (including the one this
add-on first vendored) are no longer ancestors of anything. So a re-vendor does **not** check out
`UPSTREAM_COMMIT` and replay: take the `main` tarball
(`https://codeload.github.com/knx-ai/xknx-editor/tar.gz/refs/heads/main`), record its sha in
`UPSTREAM_COMMIT`, apply the patches below and run the packages' own tests.

| Patch | Upstream PR | Author | What it fixes |
| --- | --- | --- | --- |
| `ours-device-texts-and-download-state.diff` | - | (ours) | A device's `InstallationHints` is imported, stored and exported (upstream keeps `Description` and `Comment` but not this one); `SetDeviceText` / `SetGroupAddressText` events edit a device's and a group address's free texts with undo, and `DeviceInfo` carries them. An edit clears the loaded tick of the part it changes (parameters, group communication, individual address) in the same undo step, so a device shows it needs a download again |
| `upstream-issue-16-certificate-tail.diff` | issue #16 | (ours) | The exported `{pid}.certificate` ends with one CRLF where a genuine one ends with a blank line, 483 bytes against 485. The `certificate:` block inlined in `.validation` does carry the blank line, so the archive held two copies of the same certificate that disagreed by two bytes. Upstream still emits the single CRLF, so this also adjusts the three tests that pin it |

Everything else this add-on used to carry is now in upstream `main` and was dropped with the
re-vendor to v0.1.5: PRs #4 (MyKnx login no longer logs the password), #8 (preflight no longer hides
missing programming data), #9 (truncated property compare responses are rejected), #10 (coupler
filter tables include the pass-through addresses), #12 (module com-object instance refs survive
import/export), #13 (export certification ETS accepts), and the cherry-picks
`d67f9fd-storage` (`ProjectStorageError`), `d67f9fd-preflight`, `5a16331-association-table`,
`9c6a324-union-params` and `2b60e07-signing-key`. GitHub shows those PRs as "closed, not merged"
because of the history rewrite, not because they were refused: their content is in `main`.

Not applied: #5/#6 (embedded MCP server, not used here), #7 (desktop settings file permissions; the
add-on writes `/config/settings.json` itself), #11 (README wording).
