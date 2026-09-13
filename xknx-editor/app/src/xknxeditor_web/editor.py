"""The editor: one open project, the catalog, and the device views on top of both.

Every method runs on the editor thread (see :mod:`xknxeditor_web.worker`); the API layer never
touches the upstream services directly. Reads return plain dicts ready for JSON; mutations bump
the revision so connected clients refetch.
"""

from __future__ import annotations

import zipfile
import logging
import re
from pathlib import Path
from typing import Any

from xknxeditor.catalog import CatalogService
from xknxeditor.prod import Application
from xknxeditor.proj import (
    ProjectService,
    ProjectStorageError,
    ensure_sqlite_writable,
    import_knxproj,
)
from xknxeditor.proj.core.addressing import GroupAddressStyle

from xknxeditor_web.config import Settings
from xknxeditor_web.device_view import FLAG_COLUMNS, DeviceView, instance_ref_from_row
from xknxeditor_web.errors import ApiError, NoProject, NotFound
from xknxeditor_web.online_catalog import OnlineCatalog
from xknxeditor_web import backup as backup_mod
from xknxeditor_web.knxproj_products import NotAProject, manufacturer_folders, product_archives
from xknxeditor_web.product_files import KNXPROJ_SUFFIX, check_importable
from xknxeditor_web.serialize import plain, tree_dict
from xknxeditor_web.storage import refuse_network_location
from xknxeditor_web.worker import EditorWorker

log = logging.getLogger(__name__)

FLAG_NAMES = {
    "communication": "communication_flag",
    "read": "read_flag",
    "write": "write_flag",
    "transmit": "transmit_flag",
    "update": "update_flag",
    "read_on_init": "read_on_init_flag",
}


_B64_RUN = re.compile(r"[A-Za-z0-9+/]{32,}={0,2}")


def _looks_encrypted(comment: str) -> bool:
    """Project-trace comments are stored encrypted; the importer keeps the raw text. Detect the
    typical shape: control characters, or a long base64 run (often behind a short garbled prefix
    such as ``ä () ö(ᅲ): ``) so the UI can say so instead of showing bytes."""
    if not comment:
        return False
    if any(ord(c) < 32 and c not in "\r\n\t" for c in comment):
        return True
    return _B64_RUN.search(comment) is not None


class Editor:
    def __init__(self, settings: Settings, worker: EditorWorker) -> None:
        self.settings = settings
        self.worker = worker
        settings.config_dir.mkdir(parents=True, exist_ok=True)
        settings.projects_dir.mkdir(parents=True, exist_ok=True)
        self.catalog = CatalogService(settings.catalog_path)
        self._hardware_by_program: dict[str, dict[str, Any]] | None = None
        self._application_names_cache: dict[str, str] | None = None
        self.projects = ProjectService()
        self.pid: str | None = None
        self.path: Path | None = None
        self._program_to_app: dict[str, str] | None = None
        self._app_cache: dict[str, Application] = {}
        self._views: dict[int, DeviceView] = {}
        self._online: OnlineCatalog | None = None

    # --- helpers ------------------------------------------------------------

    def _pid(self) -> str:
        if self.pid is None:
            raise NoProject()
        return self.pid

    def _bump(self, **detail: Any) -> None:
        self.worker.bump(**detail)

    def _safe_path(self, raw: str) -> Path:
        path = Path(raw).resolve()
        for base in (self.settings.share_dir, self.settings.config_dir):
            try:
                path.relative_to(base.resolve())
                return path
            except ValueError:
                continue
        raise ApiError(f"{raw} is outside {self.settings.share_dir} and {self.settings.config_dir}")

    def files(self, suffixes: tuple[str, ...]) -> list[str]:
        found: list[str] = []
        for base in (self.settings.share_dir, self.settings.config_dir):
            if not base.is_dir():
                continue
            for pattern in ("*", "*/*"):
                for p in sorted(base.glob(pattern)):
                    if p.is_file() and p.suffix.lower() in suffixes:
                        found.append(str(p))
        return found

    # --- project lifecycle --------------------------------------------------

    def open(self, raw: str) -> dict[str, Any]:
        path = self._safe_path(raw)
        if not path.is_file():
            raise NotFound(f"{path} does not exist")
        # A live project on an SMB/NFS mount can pass the write probe and then hang on the first
        # lock, which would freeze the worker thread and with it the whole add-on.
        refusal = refuse_network_location(path, "open")
        if refusal is not None:
            raise ApiError(refusal)
        self.close()
        try:
            self.pid = self.projects.open(path)
        except ProjectStorageError as e:
            raise ApiError(str(e)) from e
        self.path = path
        self._remember(path)
        self._bump(structural=True, project=self.pid)
        return self.info()

    def _saved_at(self) -> str | None:
        """When the project file was last written (every edit commits at once)."""
        import datetime as _dt

        if self.path is None:
            return None
        try:
            ts = self.path.stat().st_mtime
        except OSError:
            return None
        return _dt.datetime.fromtimestamp(ts, tz=_dt.UTC).isoformat(timespec="seconds")

    # --- last project + copies -----------------------------------------------

    @property
    def _last_file(self) -> Path:
        return self.settings.config_dir / "last_project.txt"

    @property
    def _recent_file(self) -> Path:
        return self.settings.config_dir / "recent_projects.json"

    RECENT_MAX = 10

    def recent_projects(self) -> list[dict[str, Any]]:
        """Most recently opened projects (newest first); entries whose file is gone are dropped."""
        import json

        try:
            data = json.loads(self._recent_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return []
        items = [d for d in data if isinstance(d, dict) and d.get("path") and Path(d["path"]).is_file()] if isinstance(data, list) else []
        current = str(self.path) if self.path else None
        for d in items:
            d["open"] = d["path"] == current
        return items[: self.RECENT_MAX]

    def _push_recent(self, path: Path, name: str) -> None:
        import json
        import time

        items = [d for d in self.recent_projects() if d.get("path") != str(path)]
        items.insert(0, {"path": str(path), "name": name, "opened_at": time.strftime("%Y-%m-%dT%H:%M:%S")})
        try:
            self._recent_file.write_text(json.dumps([{k: v for k, v in d.items() if k != "open"} for d in items[: self.RECENT_MAX]], indent=1), encoding="utf-8")
        except OSError as exc:  # pragma: no cover - best effort
            log.warning("could not update recent projects: %s", exc)

    def forget_recent(self, raw: str | None = None) -> list[dict[str, Any]]:
        """Drop one entry (by path) or the whole list."""
        import json

        items = [] if raw is None else [d for d in self.recent_projects() if d.get("path") != raw]
        try:
            self._recent_file.write_text(json.dumps([{k: v for k, v in d.items() if k != "open"} for d in items], indent=1), encoding="utf-8")
        except OSError as exc:  # pragma: no cover
            log.warning("could not update recent projects: %s", exc)
        return self.recent_projects()

    def _remember(self, path: Path | None) -> None:
        try:
            if path is None:
                self._last_file.unlink(missing_ok=True)
            else:
                self._last_file.write_text(str(path), encoding="utf-8")
                name = path.stem
                if self.pid is not None:
                    try:
                        stored = self.projects.project(self.pid).name
                        if stored and stored != "New project":
                            name = stored
                    except Exception:  # noqa: BLE001
                        pass
                self._push_recent(path, name)
        except OSError as exc:  # pragma: no cover - best effort
            log.warning("could not remember last project: %s", exc)

    def reopen_last(self) -> dict[str, Any] | None:
        """Reopen the project that was open when the add-on last stopped (edits are saved as they
        happen, so this restores the session). Returns the project info, or None."""
        try:
            raw = self._last_file.read_text(encoding="utf-8").strip()
        except OSError:
            return None
        if not raw or not Path(raw).is_file():
            return None
        try:
            return self.open(raw)
        except Exception as exc:  # noqa: BLE001 - a broken last project must not stop the add-on
            log.warning("could not reopen %s: %s", raw, exc)
            return None

    def program_refs(self) -> set[str]:
        """Distinct hardware-program refs (fallback: product refs) of the project's devices."""
        refs: set[str] = set()
        for row in self.projects.devices(self._pid()):
            ref = row.hardware2program_ref_id or row.product_ref_id
            if ref:
                refs.add(ref)
        return refs

    def export_knxproj(self, raw: str, schema: str = "20", overwrite: bool = False) -> dict[str, Any]:
        """Write the open project as a ``.knxproj`` (under /share or /config), bundling the
        manufacturer data of every device from the catalog's source .knxprod files."""
        from xknxeditor.proj import export_knxproj

        from xknxeditor_web.knxproj_bundle import collect_manufacturer_bundle

        if self.pid is None or self.path is None:
            raise NoProject()
        if schema not in ("14", "20", "22", "23"):
            raise ApiError("schema must be one of 14, 20, 22, 23")
        dest = self._safe_path(raw)
        if dest.suffix.lower() != ".knxproj":
            dest = dest.with_suffix(".knxproj")
        if dest.exists() and not overwrite:
            raise ApiError(f"{dest.name} already exists in {dest.parent}", 409)
        dest.parent.mkdir(parents=True, exist_ok=True)
        bundle = collect_manufacturer_bundle(self.program_refs(), self.catalog)
        result = export_knxproj(
            self.path,
            dest,
            schema=schema,
            extra_files=bundle.extra_files,
            master_xml=bundle.master_xml,
            project_name=dest.stem or None,
        )
        out = {
            "path": str(dest),
            "bytes": dest.stat().st_size,
            "schema": result.schema,
            "manufacturers": sorted(bundle.resolved_manufacturers),
            "skipped_refs": sorted(bundle.skipped_refs),
            "unverifiable_folders": list(result.unverifiable_folders),
            "missing_references": sorted(getattr(result, "missing_references", []) or []),
        }
        log.info("exported %s (schema %s, %d manufacturers, %d bytes)", dest, result.schema, len(bundle.resolved_manufacturers), out["bytes"])
        return out

    def save_copy(self, raw: str, overwrite: bool = False) -> dict[str, Any]:
        """Write a consistent copy of the open project file to ``raw`` (under /share or /config).
        Every edit is committed to the project file immediately; this is for backups and for
        moving a project to another Home Assistant."""
        import sqlite3

        if self.pid is None or self.path is None:
            raise NoProject()
        dest = self._safe_path(raw)
        if dest.suffix.lower() != ".xknx":
            dest = dest.with_suffix(".xknx")
        if dest.resolve() == self.path.resolve():
            raise ApiError("That is the open project file itself; pick another name", 409)
        if dest.exists() and not overwrite:
            raise ApiError(f"{dest.name} already exists in {dest.parent}", 409)
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            ensure_sqlite_writable(dest)
        except ProjectStorageError as e:
            raise ApiError(str(e)) from e
        src = sqlite3.connect(f"file:{self.path}?mode=ro", uri=True)
        try:
            dst = sqlite3.connect(dest)
            try:
                src.backup(dst)
            finally:
                dst.close()
        finally:
            src.close()
        return {"path": str(dest), "bytes": dest.stat().st_size}

    def create(self, name: str, style: str = "ThreeLevel") -> dict[str, Any]:
        safe = "".join(c for c in name if c.isalnum() or c in " -_").strip() or "New project"
        path = self.settings.projects_dir / f"{safe}.xknx"
        if path.exists():
            raise ApiError(f"{path.name} already exists in {self.settings.projects_dir}", 409)
        self.close()
        try:
            self.pid = self.projects.create(path, group_address_style=GroupAddressStyle(style))
        except ProjectStorageError as e:
            raise ApiError(str(e)) from e
        self.path = path
        self._remember(path)
        pid = self.pid
        # The seed only holds the backbone (area 0 / line 0). Give the project a usable first line
        # 1.1 with one segment, the way a fresh project starts.
        inst = self.projects.installations(pid)
        index = inst[0].index if inst else self.projects.add_installation(pid, name)
        areas = self.projects.topology(pid, index).areas
        if not any(a.address == 1 for a in areas):
            area = self.projects.create_area(pid, index, 1, "Area 1")
            line = self.projects.create_line(pid, area, 1, "Line 1")
            self.projects.add_segment(pid, line)
        self._bump(structural=True, project=pid)
        return self.info()

    def _default_segment(self, installation: int = 0) -> int:
        """The first segment of the lowest non-backbone line (1.1 in a fresh project)."""
        inst = self.projects.topology(self._pid(), installation)
        candidates = [
            (a.address, ln.address, ln.segments[0].id)
            for a in inst.areas
            for ln in a.lines
            if ln.segments
        ]
        if not candidates:
            raise ApiError("The project has no line to add the device to", 409)
        preferred = [c for c in candidates if c[0] != 0 and c[1] != 0] or candidates
        return min(preferred)[2]

    def import_knxproj(self, raw: str, password: str | None, progress: Any = None) -> dict[str, Any]:
        source = self._safe_path(raw)
        dest = self.settings.projects_dir / f"{source.stem}.xknx"
        self.close()
        try:
            ensure_sqlite_writable(dest)
            pid = import_knxproj(source, dest, password=password or None, language=self.settings.language)
        except ProjectStorageError as e:
            raise ApiError(str(e)) from e
        self.pid = self.projects.open(dest)
        self.path = dest
        self._remember(dest)
        log.info("imported %s as %s (%s)", source.name, pid, dest)
        # A .knxproj carries the manufacturer data of its own devices. Take it into the catalog in
        # the same step, or every device shows up as "application not in the catalog" until the
        # user imports the very same file a second time through the catalog.
        products = self._ingest_project_products(source, progress)
        self._bump(structural=True, project=self.pid, catalog=bool(products.get("applications_added")))
        return {**self.info(), "products": products}

    def _ingest_project_products(self, source: Path, progress: Any = None) -> dict[str, Any]:
        """Best effort: a project without bundled product data, or product data the catalog cannot
        read, must not fail an import that has already succeeded."""
        if callable(progress):
            progress(None, "importing the product data")
        try:
            result = self.import_project_products(source)
        except ApiError as exc:
            log.info("no product data taken from %s: %s", source.name, exc)
            return {"applications_added": [], "manufacturers": [], "note": str(exc)}
        except Exception as exc:  # noqa: BLE001 - the project is imported either way
            log.warning("product data in %s could not be imported: %s", source.name, exc, exc_info=True)
            return {"applications_added": [], "manufacturers": [], "note": f"{type(exc).__name__}: {exc}"}
        log.info(
            "took %d manufacturer archive(s) and %d application(s) from %s into the catalog",
            len(result["manufacturers"]), len(result["applications_added"]), source.name,
        )
        return result

    def close(self, forget: bool = True) -> None:
        if self.pid is not None:
            self.projects.close(self.pid)
            self.pid = None
            self.path = None
            self._views.clear()
            if forget:
                self._remember(None)
            self._bump(structural=True, project=None)

    def info(self) -> dict[str, Any]:
        if self.pid is None:
            return {"open": False, "revision": self.worker.revision, "recent": self.recent_projects()}
        pid = self.pid
        project = self.projects.project(pid)
        return {
            "open": True,
            "id": pid,
            "path": str(self.path),
            "saved_at": self._saved_at(),
            "recent": self.recent_projects(),
            "name": project.name,
            "group_address_style": project.group_address_style,
            "created_by": project.created_by,
            "last_modified": project.last_modified,
            "installations": [
                {"index": i.index, "name": i.name} for i in self.projects.installations(pid)
            ],
            "device_count": len(self.projects.devices(pid)),
            "can_undo": self.projects.can_undo(pid),
            "can_redo": self.projects.can_redo(pid),
            "revision": self.worker.revision,
        }

    # --- catalog resolution -------------------------------------------------

    def _hardware_facts(self) -> dict[str, dict[str, Any]]:
        """``hardware2program_ref_id -> {bus_current, is_power_supply, is_coupler, name}``.

        The catalog stores a device's bus current draw (mA) on its Hardware row, so a segment's
        total is only known for devices whose product data has been imported. Built once per
        catalog change and cached, like :meth:`_resolve_app`'s program map.
        """
        if self._hardware_by_program is None:
            facts: dict[str, dict[str, Any]] = {}
            for hw in self.catalog.list_hardware():
                for program in hw.programs:
                    application = program.application
                    facts[program.id] = {
                        "bus_current": hw.bus_current,
                        "is_power_supply": bool(hw.is_power_supply),
                        "is_coupler": bool(hw.is_coupler),
                        "secure": bool(application is not None and application.is_secure_enabled),
                        "name": hw.name or "",
                    }
            self._hardware_by_program = facts
        return self._hardware_by_program

    def _segment_load(self, devices: list[Any]) -> dict[str, Any]:
        """Bus load of one segment: the unit a KNX power supply actually feeds.

        ``current_ma`` counts only devices whose hardware is in the catalog; ``unknown`` says how
        many were left out, so a total is never quietly reported as complete. Devices that are
        themselves power supplies are listed rather than summed: their catalog bus current is what
        the device draws, not what it can deliver, and the .knxprod carries no rated output.
        """
        facts = self._hardware_facts()
        current = 0.0
        unknown = 0
        supplies: list[str] = []
        for d in devices:
            fact = facts.get(d.hardware2program_ref_id or "")
            if fact is None:
                unknown += 1
                continue
            if fact["is_power_supply"]:
                supplies.append(d.name or fact["name"])
                continue
            if fact["bus_current"] is None:
                unknown += 1
                continue
            current += float(fact["bus_current"])
        return {
            "device_count": len(devices),
            "current_ma": round(current, 1),
            "unknown": unknown,
            "power_supplies": supplies,
        }

    def _resolve_app(self, program_ref: str | None) -> Application | None:
        if program_ref is None:
            return None
        cached = self._app_cache.get(program_ref)
        if cached is not None:
            return cached
        if self._program_to_app is None:
            self._program_to_app = {
                p.hardware2program_ref_id: p.application_id
                for p in self.catalog.list_products()
                if p.application_id is not None
            }
        app_id = self._program_to_app.get(program_ref)
        app = self.catalog.get_application(app_id, self.settings.language) if app_id else None
        if app is not None:
            self._app_cache[program_ref] = app
        return app

    def invalidate_catalog(self) -> None:
        self._program_to_app = None
        self._hardware_by_program = None
        self._application_names_cache = None
        self._app_cache.clear()
        self._views.clear()
        self._bump(structural=True, catalog=True)

    def _row(self, device_id: int) -> Any:
        for row in self.projects.devices(self._pid()):
            if row.id == device_id:
                return row
        raise NotFound(f"No device with id {device_id}")

    def view(self, device_id: int) -> DeviceView:
        cached = self._views.get(device_id)
        if cached is not None:
            return cached
        row = self._row(device_id)
        app = self._resolve_app(row.hardware2program_ref_id)
        if app is None:
            raise ApiError(
                f"Application for device {device_id} is not in the catalog "
                f"(program {row.hardware2program_ref_id}); import its .knxprod first",
                422,
            )
        view = DeviceView(device_id, app, row)
        self._views[device_id] = view
        return view

    def _drop_views(self, *device_ids: int) -> None:
        if device_ids:
            for did in device_ids:
                self._views.pop(did, None)
        else:
            self._views.clear()

    # --- topology and devices ----------------------------------------------

    def topology(self, installation: int = 0) -> dict[str, Any]:
        pid = self._pid()
        inst = self.projects.topology(pid, installation)
        return {
            "index": inst.index,
            "name": inst.name,
            "areas": [
                {
                    "id": a.id,
                    "address": a.address,
                    "name": a.name,
                    "lines": [
                        {
                            "id": ln.id,
                            "address": ln.address,
                            "name": ln.name,
                            "segments": [
                                {
                                    "id": s.id,
                                    "number": s.number,
                                    "medium_type": s.medium_type,
                                    "name": s.name,
                                    "devices": [self._device_summary(d, a, ln) for d in s.devices],
                                    **self._segment_load(list(s.devices)),
                                }
                                for s in ln.segments
                            ],
                        }
                        for ln in a.lines
                    ],
                }
                for a in inst.areas
            ],
            "unresolved": sorted(
                {
                    d.hardware2program_ref_id
                    for d in self.projects.devices(pid)
                    if d.hardware2program_ref_id
                    and self._resolve_app(d.hardware2program_ref_id) is None
                }
            ),
        }

    def _device_summary(self, d: Any, area: Any, line: Any) -> dict[str, Any]:
        ia = f"{area.address}.{line.address}.{d.address}" if d.address is not None else None
        app = self._resolve_app(d.hardware2program_ref_id)
        return {
            "id": d.id,
            "name": d.name,
            "individual_address": ia,
            "address": d.address,
            "description": d.description,
            "product_name": d.product_name,
            "hardware_name": d.hardware_name,
            "manufacturer_name": d.manufacturer_name,
            "order_number": d.order_number,
            "serial_number": d.serial_number,
            "application_name": app.name if app is not None else "",
            "application_id": app.id if app is not None else "",
            "application_loaded": d.application_program_loaded,
            "individual_address_loaded": d.individual_address_loaded,
            "parameters_loaded": d.parameters_loaded,
            "communication_part_loaded": d.communication_part_loaded,
            "last_download": d.last_download,
            "space_id": d.space_id,
            "room": self._space_name(d.space_id),
            "download_required": not (
                d.individual_address_loaded and d.application_program_loaded and d.parameters_loaded and d.communication_part_loaded
            ),
            "resolved": app is not None,
        }

    def _space_name(self, space_id: int | None) -> str:
        if space_id is None or self.pid is None:
            return ""
        cache = self.__dict__.setdefault("_space_names", {"rev": -1, "names": {}})
        if cache["rev"] != self.worker.revision:
            names: dict[int, str] = {}

            def walk(nodes: list[Any]) -> None:
                for n in nodes:
                    names[n.id] = n.name
                    walk(n.children)

            for inst in self.projects.installations(self.pid):
                walk(self.projects.space_tree(self.pid, inst.index))
            cache["rev"] = self.worker.revision
            cache["names"] = names
        return cache["names"].get(space_id, "")

    def space_detail(self, space_id: int, installation: int = 0) -> dict[str, Any]:
        """A building/room with every device in it or below it (the building view)."""
        pid = self._pid()
        tree = self.projects.space_tree(pid, installation)

        def find(nodes: list[Any]) -> Any:
            for n in nodes:
                if n.id == space_id:
                    return n
                hit = find(n.children)
                if hit is not None:
                    return hit
            return None

        node = find(tree)
        if node is None:
            raise NotFound(f"No space {space_id}")
        ids: set[int] = set()
        functions: list[dict[str, Any]] = []
        parts: list[dict[str, Any]] = []

        def collect(n: Any, top: bool) -> None:
            ids.update(d.id for d in n.devices)
            for f in n.functions:
                functions.append({**plain(f), "space": n.name})
            if not top:
                parts.append({"id": n.id, "name": n.name, "space_type": n.space_type, "devices": len(n.devices), "children": len(n.children)})
            for c in n.children:
                collect(c, False)

        collect(node, True)
        devices = [d for d in self.devices() if d["id"] in ids]
        devices.sort(key=lambda d: [int(x) for x in d["individual_address"].split(".")] if d["individual_address"] else [999])
        return {
            "id": node.id,
            "name": node.name,
            "space_type": node.space_type,
            "number": node.number,
            "description": node.description,
            "devices": devices,
            "functions": functions,
            "parts": parts,
        }

    def device_on_address(self, address: str) -> str:
        """The name of the project device with this individual address, or "". Used to explain a
        dropped management connection: the editor must not send from an address a device holds."""
        if self.pid is None or not address:
            return ""
        for row in self.devices():
            if row["individual_address"] == address:
                return row["name"] or row["product_name"] or address
        return ""

    def devices(self) -> list[dict[str, Any]]:
        pid = self._pid()
        out: list[dict[str, Any]] = []
        for inst in self.projects.installations(pid):
            for a in inst.areas:
                for ln in a.lines:
                    for s in ln.segments:
                        out.extend(self._device_summary(d, a, ln) for d in s.devices)
        return out

    def device(self, device_id: int) -> dict[str, Any]:
        pid = self._pid()
        info = self.projects.device(pid, device_id)
        data = plain(info)
        try:
            view = self.view(device_id)
            data["application"] = {"id": view.app.id, "name": view.app.name, "version": view.app.version}
            from xknxeditor_web.dali import is_mdt_dali_app

            data["dali"] = is_mdt_dali_app(view.app.id)
            data["parameter_count"] = view.parameter_count()
            data["com_object_count"] = len(view.com_objects())
            data["resolved"] = True
        except ApiError as exc:
            data["resolved"] = False
            data["error"] = str(exc)
        data["space_id"] = self._row(device_id).space_id
        return data

    def parameters(self, device_id: int) -> dict[str, Any]:
        view = self.view(device_id)
        return {"device_id": device_id, "tree": tree_dict(view.ui_tree())}

    def com_objects(self, device_id: int) -> dict[str, Any]:
        pid = self._pid()
        view = self.view(device_id)
        gas = {g.id: g for g in self.projects.group_addresses(pid)}
        items = []
        for co in view.com_objects():
            links = []
            if co.db_id is not None:
                for link in self.projects.com_object_links(pid, co.db_id):
                    ga = gas.get(link.group_address_id)
                    links.append(
                        {
                            "id": link.id,
                            "group_address_id": link.group_address_id,
                            "text": ga.text if ga else "?",
                            "name": ga.name if ga else "",
                            "datapoint_type": ga.datapoint_type if ga else None,
                            "is_sending": link.is_sending,
                        }
                    )
            d = co.to_dict()
            d["links"] = links
            items.append(d)
        return {"device_id": device_id, "items": items, "count": len(items)}

    def set_parameter(self, device_id: int, ref_id: str, value: str) -> dict[str, Any]:
        """Set a parameter, reconciling the com-objects this edit activates or deactivates.

        Reconcile on the delta of the parameter-driven active set across this edit only, so an app
        the parser under-derives (empty set) or a pre-existing mismatch never removes objects."""
        pid = self._pid()
        view = self.view(device_id)
        before = view.active_com_object_ref_ids()
        view.set_parameter(ref_id, value)
        after = view.active_com_object_ref_ids()
        current = {co.ref_id for co in self._row(device_id).com_objects}
        add = (after - before) - current
        remove = (before - after) & current
        target = (current - remove) | add
        if target == current:
            self.projects.set_parameter(pid, device_id, ref_id, value)
            changed = False
        else:
            self.projects.set_parameter_and_sync_com_objects(
                pid, device_id, ref_id, value, [(r, None) for r in sorted(target)]
            )
            self._drop_views(device_id)
            changed = True
        self._bump(structural=changed, device=device_id)
        return {"device_id": device_id, "ref_id": ref_id, "value": value, "com_objects_changed": changed}

    def set_flag(self, device_id: int, ref_id: str, flag: str, value: bool | None) -> dict[str, Any]:
        pid = self._pid()
        column = FLAG_NAMES.get(flag)
        if column is None or column not in FLAG_COLUMNS:
            raise ApiError(f"Unknown flag {flag!r}; use one of {sorted(FLAG_NAMES)}")
        view = self.view(device_id)
        row = next((c for c in self._row(device_id).com_objects if c.ref_id == ref_id), None)
        if row is None:
            raise NotFound(f"Device {device_id} has no com-object {ref_id}")
        self.projects.set_com_object_flag(pid, row.id, column, value)
        row = next(c for c in self._row(device_id).com_objects if c.ref_id == ref_id)
        view.set_instance_ref(ref_id, instance_ref_from_row(row))
        self._bump(structural=False, device=device_id)
        return {"device_id": device_id, "ref_id": ref_id, "flag": flag, "value": value}

    def link(self, device_id: int, ref_id: str, group_address_id: int, sending: bool) -> dict[str, Any]:
        pid = self._pid()
        row = next((c for c in self._row(device_id).com_objects if c.ref_id == ref_id), None)
        if row is None:
            raise NotFound(f"Device {device_id} has no com-object {ref_id}")
        link_id = self.projects.link_com_object(pid, row.id, group_address_id, sending=sending)
        self._bump(structural=False, device=device_id)
        return {"link_id": link_id}

    def unlink(self, link_id: int) -> None:
        self.projects.unlink_com_object(self._pid(), link_id)
        self._bump(structural=False)

    def set_sending(self, link_id: int) -> None:
        self.projects.set_com_object_sending(self._pid(), link_id)
        self._bump(structural=False)

    def rename_device(self, device_id: int, name: str) -> None:
        self.projects.set_device_name(self._pid(), device_id, name)
        self._bump(structural=False, device=device_id)

    def set_individual_address(self, device_id: int, address: str) -> None:
        self.projects.set_individual_address(self._pid(), device_id, address)
        self._bump(structural=True, device=device_id)

    def remove_device(self, device_id: int) -> None:
        self.projects.remove_device(self._pid(), device_id)
        self._drop_views(device_id)
        self._bump(structural=True)

    def add_device(
        self, product_ref_id: str, name: str, segment_id: int | None, address: int | None
    ) -> dict[str, Any]:
        pid = self._pid()
        product = next(
            (p for p in self.catalog.list_products() if p.product_ref_id == product_ref_id), None
        )
        if product is None:
            raise NotFound(f"No catalog product {product_ref_id}")
        app = self._resolve_app(product.hardware2program_ref_id)
        if app is None:
            raise ApiError(f"Product {product_ref_id} has no importable application", 422)
        if segment_id is None:
            segment_id = self._default_segment()
        if address is None:
            try:
                address = self.projects.next_free_individual_address_for_segment(pid, segment_id)
            except ValueError:
                address = None

        class _Empty:
            parameters: list[Any] = []
            module_instances: list[Any] = []
            com_objects: list[Any] = []

        fresh = DeviceView(0, app, _Empty())
        device_id = self.projects.add_device(
            pid,
            segment_id,
            product_ref_id,
            address=address,
            name=name or product.name or "",
            hardware2program_ref_id=product.hardware2program_ref_id,
            com_objects=fresh.default_com_object_refs(),
            module_instances=fresh.module_instances(),
        )
        self._bump(structural=True, device=device_id)
        return self.device(device_id)

    # --- topology edits ------------------------------------------------------

    def create_area(self, installation: int, address: int, name: str) -> int:
        area = self.projects.create_area(self._pid(), installation, address, name)
        self._bump(structural=True)
        return area

    def create_line(self, area_id: int, address: int, name: str) -> int:
        pid = self._pid()
        line = self.projects.create_line(pid, area_id, address, name)
        self.projects.add_segment(pid, line)
        self._bump(structural=True)
        return line

    def rename_area(self, area_id: int, name: str) -> None:
        self.projects.rename_area(self._pid(), area_id, name)
        self._bump(structural=False)

    def rename_line(self, line_id: int, name: str) -> None:
        self.projects.rename_line(self._pid(), line_id, name)
        self._bump(structural=False)

    def remove_area(self, area_id: int) -> None:
        self.projects.remove_area(self._pid(), area_id)
        self._drop_views()
        self._bump(structural=True)

    def remove_line(self, line_id: int) -> None:
        self.projects.remove_line(self._pid(), line_id)
        self._drop_views()
        self._bump(structural=True)

    # --- group addresses ------------------------------------------------------

    def group_addresses(self) -> dict[str, Any]:
        pid = self._pid()
        return {"style": self.projects.project(pid).group_address_style, "items": plain(self.projects.group_addresses(pid))}

    def monitor_table(self) -> dict[str, Any]:
        """Names and datapoint types by group-address value for the bus monitor. A group address
        without a DPT of its own borrows the DPT of a linked group object (the commissioning tool often leaves the
        address untyped while every object on it is typed)."""
        if self.pid is None:
            return {"names": {}, "dpts": {}, "addresses": 0, "with_dpt": 0, "from_objects": 0}
        pid = self.pid
        gas = self.projects.group_addresses(pid)
        names = {g.address: g.name for g in gas}
        dpts = {g.address: g.datapoint_type for g in gas if g.datapoint_type}
        untyped = [g for g in gas if not g.datapoint_type]
        borrowed = 0
        if untyped:
            co_dpt: dict[int, str] = {}
            for row in self.projects.devices(pid):
                try:
                    for co in self.view(row.id).com_objects():
                        if co.db_id is not None and co.dpt_codes:
                            co_dpt[co.db_id] = co.dpt_codes[0]
                except ApiError:
                    continue  # product data missing: no object types to borrow
            for g in untyped:
                for link in self.projects.group_address_links(pid, g.id):
                    dpt = co_dpt.get(link.com_object_id)
                    if dpt:
                        dpts[g.address] = dpt
                        borrowed += 1
                        break
        return {"names": names, "dpts": dpts, "addresses": len(gas), "with_dpt": len(dpts), "from_objects": borrowed}

    def network(self) -> dict[str, Any]:
        """Devices and group addresses as a graph: one node per device (with its room) and per
        linked group address, one edge per link. Unlinked addresses are left out; they would only
        float. Feeds the Network view."""
        pid = self._pid()
        devices = self.projects.devices(pid)
        co_owner: dict[int, int] = {}
        for d in devices:
            for co in d.com_objects:
                co_owner[co.id] = d.id
        links: list[dict[str, Any]] = []
        used: set[int] = set()
        gas = self.projects.group_addresses(pid)
        for g in gas:
            for ln in self.projects.group_address_links(pid, g.id):
                device_id = co_owner.get(ln.com_object_id)
                if device_id is None:
                    continue
                links.append({"device": device_id, "ga": g.id, "sending": bool(ln.is_sending)})
                used.add(g.id)
        nodes = [
            {
                "kind": "device",
                "id": f"d{d.id}",
                "device_id": d.id,
                "name": d.name or d.product_name or "",
                "address": self.projects.individual_address(pid, d.id),
                "room": self._space_name(d.space_id),
                "product": d.product_name,
            }
            for d in devices
        ] + [
            {
                "kind": "ga",
                "id": f"g{g.id}",
                "ga_id": g.id,
                "ga": g.address,
                "address": g.text,
                "name": g.name,
                "dpt": g.datapoint_type,
            }
            for g in gas
            if g.id in used
        ]
        return {
            "nodes": nodes,
            "links": [{"source": f"d{ln['device']}", "target": f"g{ln['ga']}", "sending": ln["sending"]} for ln in links],
            "devices": len(devices),
            "addresses": len(used),
            "unlinked": len(gas) - len(used),
        }

    def group_ranges(self, installation: int = 0) -> dict[str, Any]:
        pid = self._pid()
        return {
            "style": self.projects.project(pid).group_address_style,
            "ranges": plain(self.projects.group_ranges(pid, installation)),
        }

    def group_address(self, ga_id: int) -> dict[str, Any]:
        pid = self._pid()
        try:
            ga = self.projects.group_address(pid, ga_id)
        except KeyError as exc:
            raise NotFound(str(exc)) from exc
        data = plain(ga)
        devices = {d.id: d for d in self.projects.devices(pid)}
        co_owner: dict[int, tuple[int, str]] = {}
        for d in devices.values():
            for co in d.com_objects:
                co_owner[co.id] = (d.id, co.ref_id)
        assignments = []
        names: dict[int, dict[str, tuple[int, str]]] = {}
        for ln in self.projects.group_address_links(pid, ga_id):
            device_id, ref_id = co_owner.get(ln.com_object_id, (None, ""))
            number, name = 0, ""
            if device_id is not None:
                if device_id not in names:
                    try:
                        names[device_id] = {co.ref_id: (co.number, co.name) for co in self.view(device_id).com_objects()}
                    except ApiError:
                        names[device_id] = {}
                number, name = names[device_id].get(ref_id, (0, ""))
            row = devices.get(device_id) if device_id is not None else None
            assignments.append(
                {
                    "link_id": ln.id,
                    "com_object_db_id": ln.com_object_id,
                    "device_id": device_id,
                    "device_name": row.name if row else "",
                    "device_address": self.projects.individual_address(pid, device_id) if device_id is not None else None,
                    "ref_id": ref_id,
                    "object_number": number,
                    "object_name": name,
                    "is_sending": ln.is_sending,
                }
            )
        data["assignments"] = assignments
        return data

    def create_group_address(
        self,
        installation: int,
        address: int | None,
        name: str,
        datapoint_type: str | None,
        range_id: int | None = None,
    ) -> dict[str, Any]:
        pid = self._pid()
        if address is None and range_id is not None:
            address = self._next_free_in_range(installation, range_id)
        if address is None:
            address = self.projects.next_free_group_address(pid, installation)
        ga_id = self.projects.create_group_address(pid, installation, address, name)
        if datapoint_type:
            self.projects.set_group_address_datapoint_type(pid, ga_id, datapoint_type)
        self._bump(structural=True)
        return self.group_address(ga_id)

    def _next_free_in_range(self, installation: int, range_id: int) -> int:
        """Lowest free address inside a main/middle group (its own sub-ranges' addresses count)."""
        pid = self._pid()

        def find(nodes: list[Any]) -> Any:
            for n in nodes:
                if n.id == range_id:
                    return n
                hit = find(n.children)
                if hit is not None:
                    return hit
            return None

        node = find(self.projects.group_ranges(pid, installation))
        if node is None:
            raise NotFound(f"No group range {range_id}")
        used = {g.address for g in self.projects.group_addresses(pid)}
        address = max(1, node.range_start)
        while address in used:
            address += 1
        if address > node.range_end:
            raise ApiError("This group has no free address left", 409)
        return address

    def rename_group_address(self, ga_id: int, name: str) -> None:
        self.projects.rename_group_address(self._pid(), ga_id, name)
        self._bump(structural=False)

    def set_group_address_dpt(self, ga_id: int, dpt: str | None) -> None:
        self.projects.set_group_address_datapoint_type(self._pid(), ga_id, dpt or None)
        self._bump(structural=False)

    def remove_group_address(self, ga_id: int) -> None:
        self.projects.remove_group_address(self._pid(), ga_id)
        self._bump(structural=True)

    def create_group_range(self, installation: int, parent_id: int | None, name: str) -> int | None:
        range_id = self.projects.create_group_range(self._pid(), installation, parent_id, name)
        self._bump(structural=True)
        return range_id

    def rename_group_range(self, range_id: int, name: str) -> None:
        self.projects.rename_group_range(self._pid(), range_id, name)
        self._bump(structural=False)

    def remove_group_range(self, range_id: int) -> None:
        self.projects.remove_group_range(self._pid(), range_id)
        self._bump(structural=True)

    # --- spaces (buildings) -------------------------------------------------

    def spaces(self, installation: int = 0) -> dict[str, Any]:
        pid = self._pid()
        return {
            "tree": plain(self.projects.space_tree(pid, installation)),
            "unassigned": plain(self.projects.unassigned_devices(pid, installation)),
        }

    def create_space(self, installation: int, space_type: str, name: str, parent_id: int | None) -> int:
        sid = self.projects.create_space(self._pid(), installation, space_type, name, parent_id)
        self._bump(structural=True)
        return sid

    def rename_space(self, space_id: int, name: str) -> None:
        self.projects.rename_space(self._pid(), space_id, name)
        self._bump(structural=False)

    def set_space_type(self, space_id: int, space_type: str) -> None:
        self.projects.set_space_type(self._pid(), space_id, space_type)
        self._bump(structural=False)

    def move_space(self, space_id: int, parent_id: int | None) -> None:
        self.projects.move_space(self._pid(), space_id, parent_id)
        self._bump(structural=True)

    def remove_space(self, space_id: int) -> None:
        self.projects.remove_space(self._pid(), space_id)
        self._bump(structural=True)

    def set_device_space(self, device_id: int, space_id: int | None) -> None:
        self.projects.set_device_space(self._pid(), device_id, space_id)
        self._bump(structural=True, device=device_id)

    def mark_programmed(self, device_id: int, scope: str) -> None:
        """Record a successful download in the device's commissioning state."""
        import datetime as _dt

        pid = self._pid()
        now = _dt.datetime.now(_dt.UTC).isoformat(timespec="seconds")
        flags: dict[str, Any] = {"last_download": now}
        if scope in ("full", "ap1"):
            flags.update(application_program_loaded=True, parameters_loaded=True, communication_part_loaded=True, individual_address_loaded=True)
        elif scope == "par":
            flags.update(parameters_loaded=True)
        elif scope == "grp":
            flags.update(communication_part_loaded=True)
        elif scope == "individual_address":
            flags.update(individual_address_loaded=True)
        elif scope == "unload":
            flags.update(application_program_loaded=False, parameters_loaded=False, communication_part_loaded=False)
        self.projects.set_device_commissioning(pid, device_id, **flags)
        self._bump(structural=False, device=device_id)

    def decrypt_traces(
        self, password: str, keyring: dict[str, Any] | None = None, signing: tuple[int, int, int] | None = None
    ) -> dict[str, Any]:
        """Experimental: try the known key derivations with the project password on the log,
        plus every raw key from the configured keyring (and the keyring password) and, when a
        genuine .knxproj signing key is set, keys derived from that RSA material."""
        import base64
        import hashlib

        from xknxeditor_web.traces import candidate_keys, keyring_keys, try_decrypt

        if self.pid is None:
            raise NoProject()
        project = self.projects.project(self.pid)
        traces = sorted(project.traces, key=lambda x: x.date, reverse=True)
        comments = [t.comment for t in traces]
        context = [project.guid, self.pid, project.created_by, project.name]
        extra: list[tuple[str, bytes]] = []
        if keyring and keyring.get("keyring_path"):
            try:
                extra.extend(keyring_keys(keyring["keyring_path"], keyring.get("keyring_password") or ""))
                for name, key, _ivs in candidate_keys(keyring.get("keyring_password") or "", context):
                    extra.append((f"keyring-password-{name}", key))
            except Exception as exc:  # noqa: BLE001 - the keyring is optional here
                log.info("keyring not usable for log decryption: %s", exc)
        if signing is not None:
            modulus, private, _public = signing
            for label, number in (("modulus", modulus), ("private-exponent", private)):
                raw = number.to_bytes((number.bit_length() + 7) // 8, "big")
                extra.extend(
                    [
                        (f"signing-{label}-raw16", raw[:16]),
                        (f"signing-{label}-raw32", raw[:32]),
                        (f"signing-{label}-sha256", hashlib.sha256(raw).digest()),
                        (f"signing-{label}-sha256-16", hashlib.sha256(raw).digest()[:16]),
                        (f"signing-{label}-sha1-16", hashlib.sha1(raw).digest()[:16]),
                        (f"signing-{label}-md5", hashlib.md5(raw).digest()),
                    ]
                )
                for text in (raw.hex(), base64.b64encode(raw).decode("ascii")):
                    for name, key, _ivs in candidate_keys(text, context):
                        extra.append((f"signing-{label}-text-{name}", key))
        result = try_decrypt(comments, password, context=context, extra_keys=extra)
        result["keyring_keys"] = len(extra)
        log.info(
            "project log decryption attempt: %d comments, scheme=%s, tried=%d",
            len(comments), result.get("scheme"), result.get("tried", 0),
        )
        if result.get("scheme"):
            result["items"] = [
                {"date": t.date, "user": t.user_name, "comment": text}
                for t, text in zip(traces, result.pop("texts"), strict=True)
            ][:200]
        return result

    # --- history --------------------------------------------------------------

    def undo(self) -> dict[str, Any]:
        pid = self._pid()
        done = self.projects.undo(pid)
        if done:
            self._drop_views()
            self._bump(structural=True)
        return {"undone": done, "can_undo": self.projects.can_undo(pid), "can_redo": self.projects.can_redo(pid)}

    def redo(self) -> dict[str, Any]:
        pid = self._pid()
        done = self.projects.redo(pid)
        if done:
            self._drop_views()
            self._bump(structural=True)
        return {"redone": done, "can_undo": self.projects.can_undo(pid), "can_redo": self.projects.can_redo(pid)}

    def history(self) -> dict[str, Any]:
        pid = self._pid()
        return {
            "cursor": self.projects.cursor(pid),
            "items": [plain(h) for h in self.projects.history(pid)],
        }

    def health(self) -> dict[str, Any]:
        from xknxeditor_web.health import run_checks

        items = [f.to_dict() for f in run_checks(self)]
        return {"items": items, "count": len(items), "errors": sum(1 for f in items if f["severity"] == "error")}

    @property
    def log_key(self) -> Any:
        """The stored project-log key (see xknxeditor_web.ets_log)."""
        from xknxeditor_web.ets_log import LogKeyStore

        if not hasattr(self, "_log_key"):
            self._log_key = LogKeyStore(self.settings.config_dir)
        return self._log_key

    @property
    def project_log(self) -> Any:
        """Sidecar store for a plaintext project log imported from elsewhere."""
        from xknxeditor_web.project_log import ProjectLogStore

        if not hasattr(self, "_project_log"):
            self._project_log = ProjectLogStore(self.settings.config_dir)
        return self._project_log

    def log_sidecar_id(self) -> str:
        """Identity of the open project for the sidecar: its project GUID, else the file name."""
        if self.pid is None:
            raise NoProject()
        guid = self.projects.project(self.pid).guid
        return guid or (self.path.stem if self.path else self.pid)

    def export_project_log(self) -> dict[str, Any]:
        """The project's log entries exactly as they were stored, for decrypting elsewhere.

        Reading them here rather than from the ``.knxproj`` means a password-protected project
        works too: the importer has already opened it, so the encrypted comments are at hand."""
        from xknxeditor_web.project_log import _key  # noqa: PLC2701 - same module's matching rule

        if self.pid is None:
            raise NoProject()
        project = self.projects.project(self.pid)
        items = [
            {"date": t.date, "user": t.user_name, "comment": t.comment}
            for t in sorted(project.traces, key=lambda x: x.date, reverse=True)
        ]
        return {
            "project": project.name,
            "guid": project.guid,
            "encrypted": sum(1 for i in items if _looks_encrypted(i["comment"])),
            "count": len(items),
            "items": items,
            "note": "Decrypt these entries on the PC that wrote them, then import the result.",
            "_keys": len({_key(i["date"], i["user"]) for i in items}),
        }

    def import_project_log(self, payload: dict[str, Any]) -> dict[str, Any]:
        result = self.project_log.store(self.log_sidecar_id(), payload)
        self._bump(structural=False)
        return result

    def clear_project_log(self) -> dict[str, Any]:
        self.project_log.clear(self.log_sidecar_id())
        self._bump(structural=False)
        return {"cleared": True}

    def project_detail(self) -> dict[str, Any]:
        info = self.info()
        if self.pid is None:
            return info
        project = self.projects.project(self.pid)
        info.update(
            {
                "guid": project.guid,
                "schema_version": project.schema_version,
                "tool_version": project.tool_version,
                "traces": [
                    {
                        "date": t.date,
                        "user": t.user_name,
                        "comment": t.comment,
                        "encrypted": _looks_encrypted(t.comment),
                    }
                    for t in sorted(project.traces, key=lambda x: x.date, reverse=True)
                ][:200],
            }
        )
        from xknxeditor_web.project_log import merge

        # With the Project log key stored, read the log directly; the sidecar import stays as a
        # fallback for anyone who decrypted elsewhere.
        info["log_decrypted"] = self.log_key.decrypt_all(info["traces"])
        key = project.guid or (self.path.stem if self.path else self.pid)
        info["log_import"] = self.project_log.summary(key)
        info["log_matched"] = merge(info["traces"], self.project_log.texts(key))
        return info

    def dpts(self) -> dict[str, Any]:
        from xknxeditor_web.dpts import DptCatalog

        if not hasattr(self, "_dpt_catalog"):
            self._dpt_catalog = DptCatalog(self.settings.config_dir)
        items = [d.to_dict() for d in self._dpt_catalog.dpts()]
        return {"items": items, "count": len(items), "source": "fallback" if self._dpt_catalog.error else "master", "error": self._dpt_catalog.error}

    # --- catalog ----------------------------------------------------------------

    def catalog_summary(self) -> dict[str, Any]:
        return {
            "path": str(self.settings.catalog_path),
            "manufacturers": len(self.catalog.list_manufacturers()),
            "applications": len(self.catalog.list_applications()),
            "products": len(self.catalog.list_products()),
        }

    def catalog_products(self, query: str = "", manufacturer_id: str | None = None) -> dict[str, Any]:
        q = query.strip().lower()
        # Order numbers are written with or without spaces/hyphens ("5WG1 257-3AB32" in a project,
        # "5WG1257-3AB32" in a .knxprod); compare a squeezed form as well as the plain text.
        squeeze = str.maketrans("", "", " -_/.")
        q_sq = q.translate(squeeze)
        names = self._application_names()
        items = []
        for p in self.catalog.list_products():
            if manufacturer_id and p.manufacturer_id != manufacturer_id:
                continue
            hay = " ".join(filter(None, (p.name, p.order_number, p.manufacturer_name))).lower()
            if q and q not in hay and (not q_sq or q_sq not in hay.translate(squeeze)):
                continue
            item = plain(p)
            # The application id ("M-0083_A-004D-12-E3F4") means nothing to a reader; the catalog
            # knows the program's real name, which is what a catalogue shows next to a product.
            item["application_name"] = names.get(p.application_id or "", "")
            items.append(item)
        return {"items": items, "count": len(items)}

    def _application_names(self) -> dict[str, str]:
        """``application_id -> application program name``, cached with the catalog."""
        if self._application_names_cache is None:
            self._application_names_cache = {a.application_id: a.name for a in self.catalog.list_applications()}
        return self._application_names_cache

    def catalog_manufacturers(self) -> dict[str, Any]:
        items = [{"id": m.id, "name": m.name} for m in self.catalog.list_manufacturers()]
        return {"items": items, "count": len(items)}

    def import_knxprod(self, raw: str) -> dict[str, Any]:
        path = self._safe_path(raw)
        check_importable(path.name)
        if path.suffix.lower() == KNXPROJ_SUFFIX:
            return self.import_project_products(path)
        before = {a.application_id for a in self.catalog.list_applications()}
        stored = self.catalog.import_knxprod(path.read_bytes())
        after = {a.application_id for a in self.catalog.list_applications()}
        self.invalidate_catalog()
        return {"stored": str(stored), "applications_added": sorted(after - before)}

    def import_knxprod_bytes(self, content: bytes, name: str = "upload.knxprod") -> dict[str, Any]:
        if name.lower().endswith(KNXPROJ_SUFFIX):
            # The project extractor opens a file on disk, so park the upload under /config briefly.
            import tempfile

            with tempfile.NamedTemporaryFile(suffix=KNXPROJ_SUFFIX, dir=self.settings.config_dir, delete=False) as tmp:
                tmp.write(content)
                parked = Path(tmp.name)
            try:
                return self.import_project_products(parked)
            finally:
                parked.unlink(missing_ok=True)
        before = {a.application_id for a in self.catalog.list_applications()}
        stored = self.catalog.import_knxprod(content)
        after = {a.application_id for a in self.catalog.list_applications()}
        self.invalidate_catalog()
        return {"stored": str(stored), "applications_added": sorted(after - before)}

    def import_project_products(self, path: Path) -> dict[str, Any]:
        """Add the product data bundled in a .knxproj to the catalog, one archive per manufacturer.

        The project itself is not imported; this is the way to get product data out of ETS when it
        only exists in a legacy .vd database, since ETS 6 has no product export of its own. No
        password is needed even for a protected project: only its nested project part is encrypted,
        and the manufacturer folders sit in the plain root zip.
        """
        before = {a.application_id for a in self.catalog.list_applications()}
        try:
            archives = product_archives(path)
        except NotAProject as exc:
            raise ApiError(str(exc)) from exc
        if not archives:
            raise ApiError(f"{path.name} bundles no manufacturer product data")
        # Per manufacturer: one archive the catalog cannot read must not cost the others, and the
        # caller is told which one it was instead of silently ending up with fewer products.
        stored: list[str] = []
        failed: list[str] = []
        for mid, blob in archives:
            try:
                stored.append(str(self.catalog.import_knxprod(blob)))
            except Exception as exc:  # noqa: BLE001 - reported, the rest still goes in
                failed.append(f"{mid}: {type(exc).__name__}: {exc}")
                log.warning("product data of %s in %s could not be imported: %s", mid, path.name, exc)
        after = {a.application_id for a in self.catalog.list_applications()}
        self.invalidate_catalog()
        if failed and not stored:
            raise ApiError(f"No product data could be imported from {path.name}: {failed[0]}")
        # A manufacturer folder without Hardware.xml carries no importable product data (the
        # catalog refuses the archive). Name it: "nothing happened" is otherwise indistinguishable
        # from "that manufacturer was not in the file".
        taken = {mid for mid, _blob in archives}
        skipped = [
            {"manufacturer": mid, "files": sorted(files)}
            for mid, files in sorted(manufacturer_folders(path).items())
            if mid not in taken
        ]
        return {
            "stored": stored,
            "manufacturers": sorted(taken),
            "failed": failed,
            "skipped": skipped,
            "applications_added": sorted(after - before),
        }

    # --- backup of the non-project state -------------------------------------------------

    def safe_path(self, raw: str) -> Path:
        """A path under /share or /config, for callers outside this class."""
        return self._safe_path(raw)

    def backup(self, raw: str | None, include: list[str] | None) -> dict[str, Any]:
        """Write a backup archive; without a path it goes to /share/xknx-editor-backups/."""
        if raw:
            dest = self._safe_path(raw)
            if dest.suffix.lower() != ".zip":
                dest = dest.with_suffix(".zip")
        else:
            dest = self.settings.share_dir / backup_mod.DEFAULT_DIR / backup_mod.default_name()
        return backup_mod.make_backup(self, include, dest)

    def inspect_backup(self, raw: str) -> dict[str, Any]:
        path = self._safe_path(raw)
        if not path.is_file():
            raise NotFound(f"{path} does not exist")
        return {"path": str(path), **backup_mod.read_manifest(path)}

    def restore_backup(self, raw: str, include: list[str] | None) -> dict[str, Any]:
        path = self._safe_path(raw)
        if not path.is_file():
            raise NotFound(f"{path} does not exist")
        result = backup_mod.restore_backup(self, path, include)
        self._bump(structural=True, catalog=True)
        return result

    # --- online catalog -------------------------------------------------------

    @property
    def online(self) -> OnlineCatalog:
        if self._online is None:
            self._online = OnlineCatalog(self.settings.config_dir / "online_catalog")
        return self._online

    def missing_program_refs(self) -> list[str]:
        """Hardware-program refs of project devices whose application is not in the catalog."""
        if self.pid is None:
            return []
        missing: list[str] = []
        for row in self.projects.devices(self.pid):
            ref = row.hardware2program_ref_id
            if ref and ref not in missing and self._resolve_app(ref) is None:
                missing.append(ref)
        return missing

    def online_manufacturers(self, refresh: bool = False) -> dict[str, Any]:
        items = [{"id": m.id, "name": m.name} for m in self.online.manufacturers(refresh)]
        return {"items": items, "count": len(items)}

    def online_items(self, manufacturer_id: int, query: str, refresh: bool = False) -> dict[str, Any]:
        if refresh:
            self.online.items(manufacturer_id, refresh=True)
        items = [i.to_dict() for i in self.online.search(manufacturer_id, query)]
        return {"items": items, "count": len(items)}

    def online_download(self, item_ids: list[str], language: str) -> dict[str, Any]:
        data = self.online.download(item_ids, language)
        result = self.import_knxprod_bytes(data)
        result["downloaded_bytes"] = len(data)
        return result

    def fetch_missing_products(self, language: str, refs: list[str] | None = None) -> dict[str, Any]:
        refs = [r for r in refs if r] if refs else self.missing_program_refs()
        if not refs:
            return {"missing": [], "item_ids": [], "unmatched": [], "applications_added": []}
        item_ids, unmatched = self.online.match_refs(refs)
        added: list[str] = []
        if item_ids:
            added = self.online_download(item_ids, language)["applications_added"]
        return {
            "missing": refs,
            "item_ids": item_ids,
            "unmatched": unmatched,
            "applications_added": added,
            "still_missing": self.missing_program_refs(),
        }
