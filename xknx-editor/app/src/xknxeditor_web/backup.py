"""Back up and restore the add-on's own state: everything under /config that is not a project.

A project is a single file you save a copy of. The rest is scattered and slow to rebuild: the
catalog is hours of imports, the documents are files you uploaded, the keys were extracted by hand.
One archive gathers it, in categories the user picks:

``catalog``   the imported ``.knxprod`` files (the source of truth; the SQLite catalog is derived
             from them and is rebuilt on restore by re-importing each, which the importer's
             content-hash dedup makes idempotent), plus ``knx_master.xml``.
``docs``      the document library with its index.
``settings``  the gateway/bus settings, and the keyring file when it was uploaded under /config.
``keys``      the .knxproj signing key and the project-log key.
``logs``      the decrypted project-log sidecars.

The archive carries the keys and the keyring password in plain form when those categories are
included: treat it like a password file. That is said in the dialog, and the categories are
opt-out for exactly that reason.

Restore only ever writes; it never deletes what is already there. A backup is meant to bring
state back, not to wipe a box, and a merge is the safe default when someone restores an older
archive over a newer catalog.
"""

from __future__ import annotations

import io
import contextlib
import json
import tempfile
import time
import zipfile
from pathlib import Path
from typing import TYPE_CHECKING, Any

from xknxeditor_web.errors import ApiError

if TYPE_CHECKING:
    from xknxeditor_web.editor import Editor

FORMAT = 1
CATEGORIES = ("catalog", "docs", "settings", "keys", "logs", "telegrams")
DEFAULT_DIR = "xknx-editor-backups"

KEY_FILES = ("signing_key.json", "ets_log_key.json")
SETTINGS_FILE = "settings.json"


def default_name() -> str:
    return time.strftime("xknx-editor-backup-%Y%m%d-%H%M%S.zip")


def _check_categories(include: list[str] | None) -> list[str]:
    chosen = list(include) if include else list(CATEGORIES)
    bad = [c for c in chosen if c not in CATEGORIES]
    if bad:
        raise ApiError(f"Unknown backup category: {', '.join(bad)}")
    return chosen


def _keyring_under_config(config_dir: Path) -> Path | None:
    """The keyring the bus is configured with, if it lives under /config (uploaded there)."""
    try:
        data = json.loads((config_dir / SETTINGS_FILE).read_text(encoding="utf-8"))
        raw = str(data.get("keyring_path") or "")
    except (OSError, ValueError):
        return None
    if not raw:
        return None
    path = Path(raw)
    try:
        path.resolve().relative_to(config_dir.resolve())
    except ValueError:
        return None
    return path if path.is_file() else None


def make_backup(editor: Editor, include: list[str] | None, dest: Path) -> dict[str, Any]:
    """Write the archive to ``dest`` and return what went in."""
    chosen = _check_categories(include)
    config = editor.settings.config_dir
    counts: dict[str, int] = {}
    dest.parent.mkdir(parents=True, exist_ok=True)

    def add_tree(z: zipfile.ZipFile, folder: Path, arc_prefix: str) -> int:
        n = 0
        if not folder.is_dir():
            return 0
        for f in sorted(folder.rglob("*")):
            if f.is_file():
                z.write(f, f"{arc_prefix}/{f.relative_to(folder).as_posix()}")
                n += 1
        return n

    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        if "catalog" in chosen:
            n = add_tree(z, config / "knxprod", "catalog/knxprod")
            master = config / "knx_master.xml"
            if master.is_file():
                z.write(master, "catalog/knx_master.xml")
                n += 1
            counts["catalog"] = n
        if "docs" in chosen:
            counts["docs"] = add_tree(z, config / "docs", "docs")
        if "settings" in chosen:
            n = 0
            settings_file = config / SETTINGS_FILE
            if settings_file.is_file():
                z.write(settings_file, f"settings/{SETTINGS_FILE}")
                n += 1
            keyring = _keyring_under_config(config)
            if keyring is not None:
                z.write(keyring, f"settings/keyring/{keyring.name}")
                n += 1
            counts["settings"] = n
        if "keys" in chosen:
            n = 0
            for name in KEY_FILES:
                f = config / name
                if f.is_file():
                    z.write(f, f"keys/{name}")
                    n += 1
            counts["keys"] = n
        if "logs" in chosen:
            counts["logs"] = add_tree(z, config / "project_logs", "logs")
        if "telegrams" in chosen:
            counts["telegrams"] = _add_telegrams(z, editor, config)
        manifest = {
            "format": FORMAT,
            "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "categories": chosen,
            "counts": counts,
        }
        z.writestr("manifest.json", json.dumps(manifest, indent=1))
    return {"path": str(dest), "bytes": dest.stat().st_size, "categories": chosen, "counts": counts}


def read_manifest(path: Path) -> dict[str, Any]:
    """The manifest of a backup archive, or an ApiError that says what is wrong with the file."""
    try:
        with zipfile.ZipFile(path) as z:
            if "manifest.json" not in z.namelist():
                raise ApiError(f"{path.name} is not an XKNX Editor backup (no manifest)")
            manifest = json.loads(z.read("manifest.json"))
    except zipfile.BadZipFile as exc:
        raise ApiError(f"{path.name} is not a zip archive") from exc
    except ValueError as exc:
        raise ApiError(f"{path.name} has an unreadable manifest") from exc
    if manifest.get("format") != FORMAT:
        raise ApiError(f"{path.name} is a format {manifest.get('format')} backup; this add-on reads format {FORMAT}")
    return manifest


def restore_backup(editor: Editor, path: Path, include: list[str] | None) -> dict[str, Any]:
    """Bring the chosen categories back from ``path``; returns what was restored."""
    manifest = read_manifest(path)
    available = list(manifest.get("categories") or CATEGORIES)
    chosen = [c for c in _check_categories(include) if c in available]
    config = editor.settings.config_dir
    counts: dict[str, int] = {}

    with zipfile.ZipFile(path) as z:
        names = z.namelist()

        def restore_tree(arc_prefix: str, folder: Path) -> int:
            n = 0
            for name in names:
                if name.startswith(arc_prefix + "/") and not name.endswith("/"):
                    rel = Path(name[len(arc_prefix) + 1 :])
                    if ".." in rel.parts:
                        continue
                    target = folder / rel
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(z.read(name))
                    n += 1
            return n

        if "catalog" in chosen:
            # Re-import rather than copy the database: the importer stores the file and ingests it,
            # and its content-hash dedup makes this idempotent over whatever is already there.
            n = 0
            for name in names:
                if name.startswith("catalog/knxprod/") and name.lower().endswith(".knxprod"):
                    editor.catalog.import_knxprod(z.read(name))
                    n += 1
            master = config / "knx_master.xml"
            if "catalog/knx_master.xml" in names and not master.is_file():
                master.write_bytes(z.read("catalog/knx_master.xml"))
            counts["catalog"] = n
            editor.invalidate_catalog()
        if "docs" in chosen:
            counts["docs"] = restore_tree("docs", config / "docs")
        if "settings" in chosen:
            n = 0
            if f"settings/{SETTINGS_FILE}" in names:
                (config / SETTINGS_FILE).write_bytes(z.read(f"settings/{SETTINGS_FILE}"))
                n += 1
            n += restore_tree("settings/keyring", config)
            counts["settings"] = n
        if "keys" in chosen:
            n = 0
            for name in KEY_FILES:
                if f"keys/{name}" in names:
                    (config / name).write_bytes(z.read(f"keys/{name}"))
                    n += 1
            counts["keys"] = n
            # The signer holds its key as module state and reports status from it, so the file
            # alone changes nothing until it is applied. The log key store reads from disk.
            from xknxeditor_web.signing import SigningKeyStore

            SigningKeyStore(config).apply_saved()
        if "logs" in chosen:
            counts["logs"] = restore_tree("logs", config / "project_logs")
        if "telegrams" in chosen and "telegrams/telegrams.db" in names:
            counts["telegrams"] = _restore_telegrams(z, editor, config)

    return {"path": str(path), "created": manifest.get("created"), "categories": chosen, "counts": counts}


def _add_telegrams(z: zipfile.ZipFile, editor: Editor, config: Path) -> int:
    """A consistent copy of the recorded telegrams, taken through the live recorder when there
    is one (the file alone may be mid-write). The count is telegrams, like restore's."""
    import sqlite3

    from xknxeditor_web.recorder import FILE_NAME

    live = getattr(editor, "recorder", None)
    src = config / FILE_NAME
    if live is None and not src.is_file():
        return 0
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / FILE_NAME
        if live is not None:
            live.export_to(copy)
        else:
            with contextlib.closing(sqlite3.connect(src)) as a, contextlib.closing(sqlite3.connect(copy)) as b:
                a.backup(b)
        with contextlib.closing(sqlite3.connect(copy)) as c:
            rows = int(c.execute("SELECT count(*) FROM telegrams").fetchone()[0])
        z.write(copy, f"telegrams/{FILE_NAME}")
    return rows


def _restore_telegrams(z: zipfile.ZipFile, editor: Editor, config: Path) -> int:
    from xknxeditor_web.recorder import FILE_NAME, TelegramRecorder

    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / FILE_NAME
        copy.write_bytes(z.read(f"telegrams/{FILE_NAME}"))
        live = getattr(editor, "recorder", None)
        if live is not None:
            return live.import_from(copy)
        rec = TelegramRecorder(config)
        try:
            return rec.import_from(copy)
        finally:
            rec.close()
