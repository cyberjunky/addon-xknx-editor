"""Device programming over the bus: preflight, download, read-back, restart, memory preview.

Glue between a :class:`DeviceView` (which holds the live parameter evaluator) and the
``xknxeditor.download`` package. Image building happens on the editor thread (it reads the
evaluator); the bus part runs on the asyncio loop with the connected ``XKNX`` instance.
"""

from __future__ import annotations

import contextlib
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from xknxeditor.download import (
    DownloadScope,
    GroupCommunication,
    build_image,
    compute_coupler_filter_table,
    group_communication_from_device,
    is_coupler_address,
    load_device_security,
)
from xknxeditor.download.download import download, preflight

from xknx.exceptions import (
    ManagementConnectionError,
    ManagementConnectionRefused,
    ManagementConnectionTimeout,
)

from xknxeditor_web.errors import ApiError

if TYPE_CHECKING:
    from xknx import XKNX

    from xknxeditor.download import DeviceSecurity, DownloadImage, PreflightReport
    from xknxeditor_web.editor import Editor

log = logging.getLogger(__name__)


def refusal_message(address: str, own: str, clash: str, detail: str) -> str:
    """What to tell the user when a device drops the management connection."""
    because = f" ({detail})" if detail else ""
    if clash:
        return (
            f"{address} dropped the connection{because}. {clash} Two things on one individual "
            f"address break the point-to-point exchange, and the device disconnects. Give the "
            f"editor a free address under Gateway settings -> Own individual address (or reserve "
            f"the tunnel addresses in the gateway itself) and try again."
        )
    return (
        f"{address} refused the connection or dropped it{because}. Three things cause this: "
        f"something else on the bus uses this editor's address {own} - another tunnel (Home "
        f"Assistant's KNX integration takes one too) or a real device - which is set under Gateway "
        f"settings -> Own individual address; another tool has the device open, since it accepts "
        f"one management connection at a time; or the device does not carry {address} yet and "
        f"still answers on its default address, so assign it first with the programming button "
        f"pressed. The group monitor is not the cause: it only listens, on the same tunnel."
    )


@contextlib.asynccontextmanager
async def explained(
    xknx: XKNX, address: str, clash: Callable[[str], Awaitable[str]] | None = None
) -> AsyncIterator[None]:
    """Turn xknx's management errors into something a KNX installer can act on. ``clash`` is asked
    - only when something failed - whether the editor's own address belongs to a project device."""
    own = str(xknx.current_address)
    try:
        yield
    except ManagementConnectionRefused as exc:
        found = await clash(own) if clash is not None else ""
        raise ApiError(refusal_message(address, own, found, str(exc)), 502) from exc
    except ManagementConnectionTimeout as exc:
        raise ApiError(
            f"{address} did not answer in time ({exc}). Check that the device is powered and "
            f"reachable from this line: couplers must let point-to-point telegrams through, and "
            f"the editor sends from {own}.",
            504,
        ) from exc
    except ManagementConnectionError as exc:
        raise ApiError(f"Management connection to {address} failed: {exc}", 502) from exc

SCOPES = {s.value: s for s in DownloadScope}

_ERROR_CLASS = {
    0: "no fault", 1: "general device fault", 2: "communication fault", 3: "configuration fault",
    4: "hardware fault", 5: "software fault", 6: "insufficient non-volatile memory",
    7: "insufficient volatile memory", 8: "memory allocation with size 0", 9: "CRC error",
    10: "watchdog reset detected", 11: "invalid opcode detected", 12: "general protection fault",
    13: "maximal table length exceeded", 14: "undefined load command received",
    15: "group address table is not sorted", 16: "invalid connection number (TSAP)",
    17: "invalid group object number (ASAP)", 18: "group object type exceeds PID_MAX_APDU_LENGTH - 2",
}
_PID_ERROR_CODE = 28
_PID_PROGMODE = 54


class ProgrammingError(RuntimeError):
    pass


def parse_ia(text: str) -> int:
    area, line, dev = (int(p) for p in text.split("."))
    return (area << 12) | (line << 8) | dev


@dataclass
class Prepared:
    """Everything the bus side needs, assembled on the editor thread."""

    address: str
    image: DownloadImage
    application: Any
    security: DeviceSecurity | None


def prepare(editor: Editor, device_id: int, keyring: dict[str, Any] | None = None, *, with_groups: bool = True) -> Prepared:
    """Build the download image for a device from its current parameter state (editor thread)."""
    pid = editor._pid()  # noqa: SLF001
    row = editor._row(device_id)  # noqa: SLF001
    view = editor.view(device_id)
    ia = editor.projects.individual_address(pid, device_id)
    if not ia:
        raise ProgrammingError("The device has no individual address")
    if view._dyn is None:  # noqa: SLF001
        raise ProgrammingError("The application has no dynamic section to program")
    group_communication = None
    if with_groups:
        raw = parse_ia(ia)
        links = group_communication_from_device(row)
        filter_table = None
        if is_coupler_address(raw):
            # Pass-through addresses (Unfiltered flags, the line's AdditionalGroupAddresses) must
            # be part of the table or the coupler blocks what the project says it must route
            # (upstream PR #10).
            unfiltered: list[int] = []
            additional: list[int] = []
            pass_through = getattr(editor.projects, "coupler_pass_through", None)
            if pass_through is not None:
                unfiltered, additional = pass_through(pid, raw)
            filter_table = compute_coupler_filter_table(
                raw, _all_device_group_addresses(editor), unfiltered=unfiltered, additional=additional
            )
        group_communication = GroupCommunication(device_address=raw, links=links, filter_table=filter_table)
    image = build_image(view.app, ui=view._dyn, group_communication=group_communication)  # noqa: SLF001
    security = None
    if keyring and keyring.get("keyring_path"):
        try:
            security = load_device_security(keyring["keyring_path"], keyring.get("keyring_password") or "", ia)
        except Exception as exc:  # noqa: BLE001 - a device absent from the keyring is programmed in the clear
            log.info("no tool key for %s in keyring (%s); programming in the clear", ia, exc)
    return Prepared(address=ia, image=image, application=view.app, security=security)


def _all_device_group_addresses(editor: Editor) -> dict[int, set[int]]:
    pid = editor._pid()  # noqa: SLF001
    result: dict[int, set[int]] = {}
    for row in editor.projects.devices(pid):
        ia = editor.projects.individual_address(pid, row.id)
        if not ia:
            continue
        gas = {link.group_address.address for co in row.com_objects for link in co.links}
        result[parse_ia(ia)] = gas
    return result


def memory_preview(editor: Editor, device_id: int) -> dict[str, Any]:
    """Per-segment byte image of the current parameter state, with the parameter map."""
    view = editor.view(device_id)
    dyn = view._dyn  # noqa: SLF001
    if dyn is None:
        return {"segments": []}
    bases = dyn.segment_base_addrs()
    params = dyn.memory_param_map()
    segments = []
    for segment_id, data in dyn.encode_to_memory().items():
        base = bases.get(segment_id, 0)
        pmap = params.get(segment_id, {})
        segments.append(
            {
                "id": segment_id,
                "base": base,
                "size": len(data),
                "hex": data.hex(),
                "parameters": {str(off): {"ref_id": ref, "value": val} for off, (ref, val) in pmap.items()},
            }
        )
    return {"segments": segments}


def master_for(editor: Editor) -> Any | None:
    from xknxeditor.prod import parse_master_xml
    from xknxeditor_web.dpts import DptCatalog

    try:
        cat = getattr(editor, "_dpt_catalog", None) or DptCatalog(editor.settings.config_dir)
        editor._dpt_catalog = cat  # noqa: SLF001
        return parse_master_xml(cat.master_bytes())
    except Exception as exc:  # noqa: BLE001
        log.warning("master data unavailable for programming: %s", exc)
        return None


def report_dict(report: PreflightReport) -> dict[str, Any]:
    segs = []
    for s in report.segments:
        ranges = [{"start": r.start, "length": r.length} for r in s.changed_ranges()]
        segs.append(
            {
                "address": s.address,
                "size": len(s.planned),
                "changed_bytes": sum(r.length for r in ranges),
                "ranges": ranges[:200],
                "current": s.current.hex(),
                "planned": s.planned.hex(),
            }
        )
    props = []
    for p in report.properties:
        ranges = [{"start": r.start, "length": r.length} for r in p.changed_ranges()]
        props.append(
            {
                "object_index": p.object_index,
                "property_id": p.property_id,
                "changed": bool(ranges),
                "current": p.current.hex(),
                "planned": p.planned.hex(),
            }
        )
    return {
        "segments": segs,
        "properties": props,
        "changed_segments": sum(1 for s in segs if s["changed_bytes"]),
        "changed_properties": sum(1 for p in props if p["changed"]),
        "changed_bytes": sum(s["changed_bytes"] for s in segs),
    }


async def run_preflight(xknx: XKNX, prepared: Prepared, scope: DownloadScope, master: Any | None) -> dict[str, Any]:
    report = await preflight(
        xknx, prepared.address, prepared.application, master=master, image=prepared.image, scope=scope, security=prepared.security
    )
    return report_dict(report)


async def run_download(
    xknx: XKNX, prepared: Prepared, scope: DownloadScope, master: Any | None, progress: Callable[[int, int], None] | None
) -> None:
    await download(
        xknx,
        prepared.address,
        prepared.application,
        master=master,
        image=prepared.image,
        scope=scope,
        progress=progress,
        security=prepared.security,
    )


async def read_overview(xknx: XKNX, address: str) -> dict[str, Any]:
    """What the device reports about itself: mask, application id, dossier, error class, prog mode."""
    from xknx.exceptions import XKNXException
    from xknx.telegram import IndividualAddress
    from xknxeditor.download import DeviceProgrammer
    from xknxeditor.download.errors import DownloadError
    from xknxeditor.recover import read_application_id, read_dossier

    async def prop(programmer: Any, pid: int) -> bytes:
        try:
            return await programmer.read_property(0, pid)
        except (DownloadError, XKNXException):
            return b""

    target = IndividualAddress(address)
    connection = await xknx.management.connect(target)
    try:
        programmer = DeviceProgrammer(connection)
        mask = await programmer.read_device_descriptor()
        app = await read_application_id(programmer)
        dossier = await read_dossier(programmer)
        error_raw = await prop(programmer, _PID_ERROR_CODE)
        progmode_raw = await prop(programmer, _PID_PROGMODE)
    finally:
        with contextlib.suppress(Exception):
            await xknx.management.disconnect(target)
    manufacturer = app.manufacturer_id if app is not None else (f"M-{dossier.manufacturer_id:04X}" if dossier.manufacturer_id is not None else None)
    code = error_raw[0] if error_raw else None
    return {
        "address": address,
        "mask_version": f"{mask:04X}" if isinstance(mask, int) else str(mask),
        "manufacturer": manufacturer,
        "application_number": app.application_number if app is not None else None,
        "application_version": app.application_version if app is not None else None,
        "serial_number": dossier.serial_number,
        "order_info": dossier.order_info,
        "hardware_type": dossier.hardware_type,
        "error_code": code,
        "error_text": _ERROR_CLASS.get(code, f"error code {code}") if code is not None else None,
        "programming_mode": bool(progmode_raw[0] & 0x01) if progmode_raw else None,
    }


async def restart(xknx: XKNX, address: str) -> None:
    from xknx.telegram import IndividualAddress

    target = IndividualAddress(address)
    try:
        from xknx.management import procedures

        fn = getattr(procedures, "dm_restart", None)
        if fn is not None:
            await fn(xknx, target)
            return
    except ImportError:
        pass
    connection = await xknx.management.connect(target)
    try:
        await connection.restart()  # type: ignore[attr-defined]
    finally:
        with contextlib.suppress(Exception):
            await xknx.management.disconnect(target)


async def assign_individual_address(xknx: XKNX, address: str, serial_hex: str | None = None) -> dict[str, Any]:
    """Write ``address`` into the one device in programming mode (or the device with serial
    ``serial_hex``, no programming mode needed). Delegates to xknx's network management procedures."""
    from xknxeditor.download.commissioning import program_individual_address

    serial = bytes.fromhex(serial_hex.replace(":", "").replace(" ", "")) if serial_hex else None
    if serial is not None and len(serial) != 6:
        raise ProgrammingError("A KNX serial number has 6 bytes (12 hex digits)")
    await program_individual_address(xknx, address, serial_number=serial)
    return {"address": address, "by_serial": serial is not None}


async def programming_mode_devices(xknx: XKNX, timeout: float = 3.0) -> list[str]:
    """Individual addresses of the devices currently in programming mode (broadcast read)."""
    from xknx.management.procedures.network.nm_individual_address_read import nm_individual_address_read

    found = await nm_individual_address_read(xknx, timeout=timeout)
    return [str(a) for a in found]
