"""Recover a project from the bus: scan a line, identify each device against the catalog, read its
configuration back (tables, parameters), verify, and write the devices into a project.

Ported from the desktop app's recover plugin onto the add-on's services: bus work runs on the
asyncio loop against the live ``BusService`` connection; catalog lookups and project writes go
through the editor thread. All bus access is read-only.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from xknxeditor.proj.core.addressing import parse_ia

from xknxeditor_web.errors import ApiError

if TYPE_CHECKING:
    from xknxeditor.prod import Application
    from xknxeditor.recover import AppId, RecoveredDevice

    from xknxeditor_web.bus import BusService
    from xknxeditor_web.editor import Editor

log = logging.getLogger(__name__)

# Pause between devices so the KNXnet/IP tunnel settles before the next connect.
_SETTLE_SECONDS = 0.15


@dataclass
class Entry:
    address: str
    mask_version: int
    app_id: AppId | None = None
    product_ref_id: str | None = None
    hardware2program_ref_id: str | None = None
    product_name: str | None = None
    application: Application | None = None
    recovered: RecoveredDevice | None = None
    state: str = ""  # found | ambiguous | unprogrammed | no-product | recovered | error | exists | applied
    selected: bool = True
    ambiguous: bool = False
    candidates: int = 0
    verify_changed: int | None = None
    applied: bool = False
    error: str = ""

    @property
    def recoverable(self) -> bool:
        return self.application is not None

    def to_dict(self) -> dict[str, Any]:
        r = self.recovered
        return {
            "address": self.address,
            "mask_version": f"{self.mask_version:04X}",
            "app_id": None
            if self.app_id is None
            else {
                "manufacturer_id": self.app_id.manufacturer_id,
                "application_number": self.app_id.application_number,
                "application_version": self.app_id.application_version,
            },
            "product_ref_id": self.product_ref_id,
            "product_name": self.product_name,
            "state": self.state,
            "selected": self.selected,
            "ambiguous": self.ambiguous,
            "candidates": self.candidates,
            "recoverable": self.recoverable,
            "applied": self.applied,
            "error": self.error,
            "verify_changed": self.verify_changed,
            "recovered": None
            if r is None
            else {
                "group_addresses": len(r.group_addresses),
                "links": len(r.links),
                "parameters": len(r.parameters.values),
                "unknown": len(r.parameters.unknown),
                "serial_number": r.dossier.serial_number,
                "order_info": r.dossier.order_info,
                "hardware_type": r.dossier.hardware_type,
            },
        }


@dataclass
class Progress:
    done: int = 0
    total: int = 0
    current: str = ""
    stage: str = ""


class RecoverService:
    def __init__(self, editor: Editor, bus: BusService) -> None:
        self.editor = editor
        self.bus = bus
        self.entries: list[Entry] = []
        self.phase = "idle"  # idle | scanning | scanned | recovering | recovered | verifying
        self.error: str | None = None
        self.progress = Progress()
        self.apply_status = ""
        self._task: asyncio.Task[Any] | None = None
        self._cancel = False

    # --- state ------------------------------------------------------------------------------

    @property
    def busy(self) -> bool:
        return self._task is not None and not self._task.done()

    def status(self) -> dict[str, Any]:
        recovered = [e.recovered for e in self.entries if e.recovered is not None]
        totals = {
            "devices": len(recovered),
            "group_addresses": sum(len(r.group_addresses) for r in recovered),
            "links": sum(len(r.links) for r in recovered),
            "unknown": sum(len(r.parameters.unknown) for r in recovered),
        }
        return {
            "phase": self.phase,
            "busy": self.busy,
            "error": self.error,
            "connected": getattr(self.bus, "_xknx", None) is not None,
            "progress": {"done": self.progress.done, "total": self.progress.total, "current": self.progress.current, "stage": self.progress.stage},
            "entries": [e.to_dict() for e in self.entries],
            "totals": totals,
            "apply_status": self.apply_status,
            "warnings": self._warnings(),
        }

    def _warnings(self) -> list[dict[str, Any]]:
        from xknxeditor.recover import validate_group_communication

        recovered = [e.recovered for e in self.entries if e.recovered is not None]
        if not recovered:
            return []
        try:
            return [{"group_address": w.group_address, "kind": w.kind, "senders": w.senders, "receivers": w.receivers} for w in validate_group_communication(recovered)]
        except Exception:  # noqa: BLE001
            return []

    def _xknx(self) -> Any:
        x = getattr(self.bus, "_xknx", None)
        if x is None:
            raise ApiError("Not connected to the bus. Connect to a gateway first (top right).", 409)
        return x

    def _start(self, coro: Any, phase: str) -> None:
        if self.busy:
            raise ApiError("A recover operation is already running", 409)
        self._cancel = False
        self.error = None
        self.phase = phase
        self._task = asyncio.get_running_loop().create_task(coro)

    def stop(self) -> None:
        self._cancel = True

    def select(self, address: str, selected: bool) -> None:
        for e in self.entries:
            if e.address == address:
                e.selected = selected and e.recoverable

    def reset(self) -> None:
        if self.busy:
            raise ApiError("Stop the running operation first", 409)
        self.entries = []
        self.phase = "idle"
        self.error = None
        self.apply_status = ""
        self.progress = Progress()

    # --- scan + identify ----------------------------------------------------------------------

    def start_scan(self, start: str, end: str) -> None:
        from xknxeditor.recover import iter_addresses

        xknx = self._xknx()
        try:
            addresses = list(iter_addresses(start, end))
        except Exception as exc:  # noqa: BLE001 - bad address text
            raise ApiError(f"Invalid scan range: {exc}") from exc
        if len(addresses) > 4096:
            raise ApiError("Scan at most 16 lines (4096 addresses) at a time")
        self.entries = []
        self.progress = Progress(total=len(addresses))
        self._start(self._scan(xknx, addresses), "scanning")

    async def _scan(self, xknx: Any, addresses: list[Any]) -> None:
        from xknxeditor.recover import probe_and_identify

        try:
            for done, address in enumerate(addresses, start=1):
                if self._cancel:
                    break
                self.progress.current = str(address)
                self.progress.done = done
                device, app_id = await probe_and_identify(xknx, address)
                if device is None:
                    continue
                entry = Entry(address=device.address, mask_version=device.mask_version, app_id=app_id)
                await self.editor.worker.run(self._identify, entry)
                self.entries = [*self.entries, entry]
                log.info("recover: device at %s (mask %04X) %s", entry.address, entry.mask_version, entry.state)
                await asyncio.sleep(_SETTLE_SECONDS)
        except Exception as exc:  # noqa: BLE001
            self.error = f"{type(exc).__name__}: {exc}"
            log.warning("recover scan failed: %s", self.error)
        finally:
            self.progress.current = ""
            self.phase = "scanned"

    def _identify(self, entry: Entry) -> None:
        """Match the read application id against the local catalog (editor thread)."""
        if entry.app_id is None:
            entry.state = "unprogrammed"
            entry.selected = False
            return
        catalog = self.editor.catalog
        mask = f"MV-{entry.mask_version:04X}"
        exact = catalog.find_products_for_application(
            manufacturer_id=entry.app_id.manufacturer_id,
            application_number=entry.app_id.application_number,
            application_version=entry.app_id.application_version,
            mask_version=mask,
        )
        products = exact
        version_fallback = False
        if not products:
            products = catalog.find_products_for_application(
                manufacturer_id=entry.app_id.manufacturer_id,
                application_number=entry.app_id.application_number,
                mask_version=mask,
            )
            version_fallback = bool(products)
        if not products:
            entry.state = "no-product"
            entry.selected = False
            return
        refs = {p.product_ref_id for p in products}
        entry.candidates = len(refs)
        entry.ambiguous = version_fallback or len(refs) > 1
        product = products[0]
        entry.product_ref_id = product.product_ref_id
        entry.hardware2program_ref_id = product.hardware2program_ref_id
        entry.product_name = product.name or product.order_number
        if product.application_id is not None:
            entry.application = catalog.get_application(product.application_id, self.editor.settings.language)
        if not entry.recoverable:
            entry.state = "no-product"
            entry.selected = False
            return
        entry.state = "ambiguous" if entry.ambiguous else "found"
        entry.selected = not entry.ambiguous

    def reidentify(self) -> None:
        """Re-match every entry after the catalog changed (products imported)."""
        for e in self.entries:
            if e.recovered is None:
                self._identify(e)

    # --- read-back ----------------------------------------------------------------------------

    def start_recover(self) -> None:
        xknx = self._xknx()
        targets = [e for e in self.entries if e.selected and e.recoverable]
        if not targets:
            raise ApiError("No selected device has product data in the catalog", 409)
        self.progress = Progress(total=len(targets))
        self.apply_status = ""
        self._start(self._recover(xknx, targets), "recovering")

    async def _recover(self, xknx: Any, targets: list[Entry]) -> None:
        from xknxeditor.recover import recover_device_at

        try:
            for done, entry in enumerate(targets, start=1):
                if self._cancel:
                    break
                assert entry.application is not None
                self.progress.current = entry.address
                self.progress.done = done
                self.progress.stage = ""

                def stage(text: str) -> None:
                    self.progress.stage = text

                try:
                    entry.recovered = await recover_device_at(xknx, entry.address, entry.application, progress=stage)
                    entry.state = "recovered"
                    entry.error = ""
                    log.info(
                        "recover: %s read back (%d GAs, %d links, %d parameters, %d unknown)",
                        entry.address,
                        len(entry.recovered.group_addresses),
                        len(entry.recovered.links),
                        len(entry.recovered.parameters.values),
                        len(entry.recovered.parameters.unknown),
                    )
                except Exception as exc:  # noqa: BLE001 - one device failing must not abort the batch
                    entry.state = "error"
                    entry.error = f"{type(exc).__name__}: {exc}"
                    log.warning("recover: %s failed: %s", entry.address, entry.error)
                await asyncio.sleep(_SETTLE_SECONDS)
        finally:
            self.progress.current = ""
            self.progress.stage = ""
            self.phase = "recovered"

    # --- verify -------------------------------------------------------------------------------

    def start_verify(self) -> None:
        xknx = self._xknx()
        targets = [e for e in self.entries if e.recovered is not None]
        if not targets:
            raise ApiError("Nothing recovered yet", 409)
        self.progress = Progress(total=len(targets))
        self._start(self._verify(xknx, targets), "verifying")

    async def _verify(self, xknx: Any, targets: list[Entry]) -> None:
        from xknxeditor.recover import verify_recovered

        from xknxeditor_web.programming import master_for

        master = await self.editor.worker.run(master_for, self.editor)
        try:
            for done, entry in enumerate(targets, start=1):
                if self._cancel:
                    break
                if entry.recovered is None or entry.application is None:
                    continue
                self.progress.current = entry.address
                self.progress.done = done
                try:
                    report = await verify_recovered(xknx, entry.recovered, entry.application, master=master)
                    entry.verify_changed = report.total_changed_bytes
                except Exception as exc:  # noqa: BLE001
                    entry.verify_changed = None
                    entry.error = f"verify: {type(exc).__name__}: {exc}"
                await asyncio.sleep(_SETTLE_SECONDS)
        finally:
            self.progress.current = ""
            self.phase = "recovered"

    # --- apply to a project (editor thread) ---------------------------------------------------

    def apply(self, new_project: str | None = None) -> dict[str, Any]:
        ed = self.editor
        if new_project:
            ed.create(new_project)
            for e in self.entries:
                e.applied = False
        elif ed.pid is None:
            raise ApiError("Open a project first, or give a name to create a new one", 409)
        added = 0
        skipped: list[str] = []
        for entry in self.entries:
            if entry.applied or entry.recovered is None or entry.application is None or entry.product_ref_id is None:
                continue
            try:
                if self._add_recovered(entry):
                    added += 1
                else:
                    skipped.append(entry.address)
            except Exception as exc:  # noqa: BLE001 - one device must not abort the batch
                entry.applied = True
                entry.state = "error"
                entry.error = f"add to project: {type(exc).__name__}: {exc}"
                log.warning("recover: adding %s failed: %s", entry.address, entry.error, exc_info=True)
        ed._bump(structural=True)  # noqa: SLF001
        self.apply_status = f"{added} device{'s' if added != 1 else ''} added to {ed.path.name if ed.path else 'the project'}"
        return {"added": added, "skipped": skipped, "project": ed.info()}

    def _segment_for(self, area_no: int, line_no: int) -> int:
        ed = self.editor
        pid = ed._pid()  # noqa: SLF001
        inst = ed.projects.topology(pid, 0)
        area = next((a for a in inst.areas if a.address == area_no), None)
        if area is None:
            area_id = ed.projects.create_area(pid, 0, area_no, f"Area {area_no}")
            line_id = ed.projects.create_line(pid, area_id, line_no, f"Line {line_no}")
            return ed.projects.add_segment(pid, line_id)
        line = next((ln for ln in area.lines if ln.address == line_no), None)
        if line is None:
            line_id = ed.projects.create_line(pid, area.id, line_no, f"Line {line_no}")
            return ed.projects.add_segment(pid, line_id)
        if not line.segments:
            return ed.projects.add_segment(pid, line.id)
        return line.segments[0].id

    def _add_recovered(self, entry: Entry) -> bool:
        from xknxeditor.recover.recover import com_object_ref_by_number

        from xknxeditor_web.device_view import DeviceView

        ed = self.editor
        pid = ed._pid()  # noqa: SLF001
        recovered, app = entry.recovered, entry.application
        assert recovered is not None and app is not None and entry.product_ref_id is not None
        if any(d["individual_address"] == entry.address for d in ed.devices()):
            entry.applied = True
            entry.state = "exists"
            return False
        area_no, line_no, octet = parse_ia(entry.address)
        segment_id = self._segment_for(area_no, line_no)

        class _Empty:
            parameters: list[Any] = []
            module_instances: list[Any] = []
            com_objects: list[Any] = []

        fresh = DeviceView(0, app, _Empty())
        device_id = ed.projects.add_device(
            pid,
            segment_id,
            entry.product_ref_id,
            address=octet,
            name=entry.product_name or entry.address,
            hardware2program_ref_id=entry.hardware2program_ref_id,
            parameters=list(recovered.parameters.values.items()) or None,
            com_objects=fresh.default_com_object_refs(),
            module_instances=fresh.module_instances() or None,
        )
        ed._drop_views(device_id)  # noqa: SLF001
        view = ed.view(device_id)
        # The recovered parameters may activate other objects than the defaults: align the rows.
        active = view.active_com_object_ref_ids()
        current = {c.ref_id for c in ed._row(device_id).com_objects}  # noqa: SLF001
        if active and active != current:
            ed.projects.sync_device_com_objects(pid, device_id, [(r, None) for r in sorted(active)])
            ed._drop_views(device_id)  # noqa: SLF001
            view = ed.view(device_id)
        number_to_ref = recovered.com_object_refs or com_object_ref_by_number(app)
        by_ref = {co.ref_id: co for co in view.com_objects()}
        for number, go in recovered.group_objects.items():
            ref = number_to_ref.get(number)
            if ref is None or ref not in by_ref:
                continue
            for flag, value in (
                ("communication", go.communication),
                ("read", go.read),
                ("write", go.write),
                ("transmit", go.transmit),
                ("update", go.update),
                ("read_on_init", go.read_on_init),
            ):
                ed.set_flag(device_id, ref, flag, value)
        gas = {g.address: g.id for g in ed.projects.group_addresses(pid)}
        linked = 0
        for link in recovered.links:
            ref = number_to_ref.get(link.group_object_number)
            co = by_ref.get(ref) if ref else None
            if co is None or co.db_id is None:
                continue
            ga_id = gas.get(link.group_address)
            if ga_id is None:
                ga_id = ed.projects.create_group_address(pid, 0, link.group_address, "")
                gas[link.group_address] = ga_id
            ed.projects.link_com_object(pid, co.db_id, ga_id, sending=link.sending)
            linked += 1
        ed._drop_views(device_id)  # noqa: SLF001
        entry.applied = True
        entry.state = "applied"
        log.info("recover: %s added as device %d with %d links", entry.address, device_id, linked)
        return True

    def snapshot(self) -> str:
        from xknxeditor.recover import snapshots_json

        return snapshots_json([e.recovered for e in self.entries if e.recovered is not None])
