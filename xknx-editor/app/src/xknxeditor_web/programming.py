"""Device programming over the bus: preflight, download, read-back, restart, memory preview.

Glue between a :class:`DeviceView` (which holds the live parameter evaluator) and the
``xknxeditor.download`` package. Image building happens on the editor thread (it reads the
evaluator); the bus part runs on the asyncio loop with the connected ``XKNX`` instance.
"""

from __future__ import annotations

import contextlib
import logging
import re
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

from xknxeditor.download.errors import VerificationError

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


async def _in_programming(xknx: XKNX) -> list[str]:
    """Who is in programming mode right now - asked only after a timeout, to tell an unassigned
    device apart from an unreachable one."""
    try:
        return await programming_mode_devices(xknx)
    except Exception:  # noqa: BLE001 - a diagnosis must not replace the original failure
        return []


def timeout_message(address: str, own: str, in_programming: list[str], detail: str) -> str:
    """What to tell the user when nothing answers at an address."""
    because = f" ({detail})" if detail else ""
    lead = (
        f"Nothing answered at {address}{because}. No device on the bus carries that address at the "
        f"moment."
    )
    if in_programming:
        found = ", ".join(in_programming)
        return (
            f"{lead} One device is in programming mode, answering on {found}: if that is this "
            f"device, write the address into it first with Assign address - changing the address "
            f"in the project does not change the device. Otherwise check that the device is "
            f"powered and that couplers pass point-to-point telegrams; the editor sends from {own}."
        )
    return (
        f"{lead} Either the device carries a different address than the project says - press its "
        f"programming button and use Assign address to write {address} into it - or it is off, "
        f"unreachable, or behind a coupler that does not pass point-to-point telegrams. The editor "
        f"sends from {own}."
    )


def verification_message(address: str, detail: str, note: str = "") -> str:
    """A device answering "no" to a step of the load procedure. The property the download writes
    to put an object into Load state is the usual one: not every device accepts a partial load."""
    if "property 5" in detail and "0 elements" in detail:
        return (
            f"{address} refused to start the load procedure ({detail}). The device rejected the "
            f"write to its load-state control, which a partial download needs. Try Download: full "
            f"instead - it loads the object from scratch, which such devices do accept - and check "
            f"that the application in the project is the one the device runs (Read from device "
            f"shows what it carries).{note}"
        )
    return (
        f"{address} answered unexpectedly during the download ({detail}). Run Test before "
        f"programming to see what the device reports, and check that the application in the "
        f"project matches the one the device runs.{note}"
    )


@contextlib.asynccontextmanager
async def explained(
    xknx: XKNX,
    address: str,
    clash: Callable[[str], Awaitable[str]] | None = None,
    note: str = "",
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
        raise ApiError(timeout_message(address, own, await _in_programming(xknx), str(exc)), 504) from exc
    except ManagementConnectionError as exc:
        raise ApiError(f"Management connection to {address} failed: {exc}", 502) from exc
    except VerificationError as exc:
        raise ApiError(verification_message(address, str(exc), note), 502) from exc

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


# How a mask version's load state machine is driven, from knx_master.xml's ManagementModel. The
# download engine writes load events to PID_LOAD_STATE_CONTROL (SystemB, PropertyBased); the other
# models drive the state machine through memory, which it does not implement.
MEMORY_MAPPED_MODELS = {"Bcu1", "Bcu2", "BimM112"}
_MODEL_NAMES = {"Bcu1": "BCU 1", "Bcu2": "BCU 2", "BimM112": "BIM M112"}
# Used when the master data is not at hand; the grouping is knx_master.xml's own (2026-09).
_FALLBACK_MODELS = {
    "Bcu1": ("0010", "0011", "0012", "0013", "0900", "0910", "0911", "0912", "091A", "1011", "1012", "1013"),
    "Bcu2": ("0020", "0021", "0025"),
    "BimM112": ("0700", "0701", "0705", "1900", "2705", "5705"),
}
_MASK_MODEL = re.compile(rb'<MaskVersion Id="MV-([0-9A-Fa-f]+)"[^>]*ManagementModel="([A-Za-z0-9]+)"')


def mask_of(application: Any) -> str:
    """``MV-07B0`` -> ``07B0``; "" when the application does not say."""
    raw = str(getattr(getattr(application, "program", None), "mask_version", "") or "")
    return raw.removeprefix("MV-").upper()


def management_model(mask: str, master: bytes | None = None) -> str:
    """The mask version's management model, from the master data when it is available."""
    if not mask:
        return ""
    if master:
        for found, model in _MASK_MODEL.findall(master):
            if found.decode().upper() == mask:
                return model.decode()
    for model, masks in _FALLBACK_MODELS.items():
        if mask in masks:
            return model
    return ""


def memory_mapped_note(application: Any, master: bytes | None = None) -> str:
    """A sentence about this device's management model, for when a load step is rejected. Not a
    refusal: commissioning such a device does work, it is a later step that can fail."""
    mask = mask_of(application)
    model = management_model(mask, master)
    if model not in MEMORY_MAPPED_MODELS:
        return ""
    name = _MODEL_NAMES.get(model, model)
    return (
        f" This device is a {name} (mask {mask}), whose load state machine is driven through "
        f"memory rather than through device properties; the download engine handles the memory "
        f"part but writes load events as properties, which such a device rejects. If the first "
        f"commissioning went through, program the whole application again (Download: full) rather "
        f"than a partial download, or use ETS for this device."
    )


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


def _master_bytes(editor: Editor) -> bytes | None:
    """The raw knx_master.xml, for the few checks that only need to look something up in it."""
    from xknxeditor_web.dpts import DptCatalog

    try:
        cat = getattr(editor, "_dpt_catalog", None) or DptCatalog(editor.settings.config_dir)
        editor._dpt_catalog = cat  # noqa: SLF001
        return cat.master_bytes()
    except Exception as exc:  # noqa: BLE001 - the fallback table covers the known masks
        log.info("master data unavailable for the mask check: %s", exc)
        return None


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


_PID_SERIAL_NUMBER = 11
# Where a BCU 1 / BCU 2 keeps its programming-mode bit (bit 0 of the RunError/ProgMode octet).
_BCU_PROGMODE_ADDRESS = 0x0060


def parse_serial(text: str) -> bytes:
    """``00:FA:12 34 56 78`` / ``00FA12345678`` -> 6 bytes."""
    cleaned = re.sub(r"[\s:.-]", "", text or "")
    if not re.fullmatch(r"[0-9A-Fa-f]{12}", cleaned):
        raise ProgrammingError("A KNX serial number has 6 bytes (12 hex digits)")
    return bytes.fromhex(cleaned)


def parse_hex(text: str) -> bytes:
    """``01 02 0a`` / ``01020A`` -> bytes; refuses anything that is not whole bytes."""
    cleaned = re.sub(r"[\s:,-]", "", text or "").removeprefix("0x")
    if not cleaned or len(cleaned) % 2 or not re.fullmatch(r"[0-9A-Fa-f]+", cleaned):
        raise ProgrammingError("Give the data as hex bytes, for example 01 FF 20")
    return bytes.fromhex(cleaned)


@contextlib.asynccontextmanager
async def _programmer(xknx: XKNX, address: str) -> AsyncIterator[Any]:
    """A DeviceProgrammer on a management connection that is always closed again."""
    from xknx.telegram import IndividualAddress
    from xknxeditor.download import DeviceProgrammer

    target = IndividualAddress(address)
    connection = await xknx.management.connect(target)
    try:
        yield DeviceProgrammer(connection)
    finally:
        with contextlib.suppress(Exception):
            await xknx.management.disconnect(target)


async def ping(xknx: XKNX, address: str) -> dict[str, Any]:
    """Is anything answering at ``address``? A device descriptor read on a management connection,
    timed. A device that refuses the connection is there too (it only says it is busy)."""
    import time

    start = time.monotonic()
    try:
        async with _programmer(xknx, address) as programmer:
            mask = await programmer.read_device_descriptor()
    except ManagementConnectionRefused:
        return {"address": address, "reachable": True, "refused": True, "rtt_ms": round((time.monotonic() - start) * 1000), "mask_version": None}
    except (ManagementConnectionTimeout, TimeoutError):
        return {"address": address, "reachable": False, "refused": False, "rtt_ms": None, "mask_version": None}
    return {
        "address": address,
        "reachable": True,
        "refused": False,
        "rtt_ms": round((time.monotonic() - start) * 1000),
        "mask_version": f"{mask:04X}" if isinstance(mask, int) else str(mask),
    }


async def identify(xknx: XKNX, address: str, seconds: float = 6.0, sleep: Callable[[float], Awaitable[None]] | None = None) -> dict[str, Any]:
    """Flash the programming LED so the device can be found in the cabinet: programming mode on
    and off once a second, and always off at the end. Property-based devices take it through the
    Device Object's PID_PROGMODE; a BCU 1 / BCU 2 only through its memory, which is the fallback."""
    import asyncio

    from xknx.exceptions import XKNXException
    from xknxeditor.download.errors import DownloadError

    wait = sleep or asyncio.sleep
    async with _programmer(xknx, address) as programmer:

        async def by_property(on: bool) -> None:
            await programmer.write_property(0, _PID_PROGMODE, bytes([1 if on else 0]))

        async def by_memory(on: bool) -> None:
            await programmer.write_memory(_BCU_PROGMODE_ADDRESS, bytes([1 if on else 0]))

        method = "property"
        setter = by_property
        try:
            await setter(True)
        except (DownloadError, XKNXException):
            method, setter = "memory", by_memory
            await setter(True)
        on = True
        try:
            for _ in range(max(1, round(seconds)) * 2 - 1):
                await wait(0.5)
                on = not on
                await setter(on)
        finally:
            if on:
                with contextlib.suppress(Exception):
                    await setter(False)
    return {"address": address, "method": method, "seconds": max(1, round(seconds))}


async def read_memory(xknx: XKNX, address: str, start: int, count: int) -> dict[str, Any]:
    if not 0 <= start <= 0xFFFFFFFF or not 1 <= count <= 4096:
        raise ProgrammingError("Memory: start 0-0xFFFFFFFF, 1-4096 bytes")
    async with _programmer(xknx, address) as programmer:
        data = await programmer.read_memory(start, count)
    return {"address": address, "start": start, "count": len(data), "hex": data.hex().upper()}


async def write_memory(xknx: XKNX, address: str, start: int, data: bytes) -> dict[str, Any]:
    """Write and read back: a lost write is reported rather than assumed."""
    if not 0 <= start <= 0xFFFFFFFF or not 1 <= len(data) <= 1024:
        raise ProgrammingError("Memory: start 0-0xFFFFFFFF, 1-1024 bytes")
    async with _programmer(xknx, address) as programmer:
        await programmer.write_memory(start, data, verify=True)
    return {"address": address, "start": start, "count": len(data), "verified": True}


async def read_property(xknx: XKNX, address: str, object_index: int, property_id: int, count: int = 1, start_index: int = 1) -> dict[str, Any]:
    if not 0 <= object_index <= 255 or not 0 <= property_id <= 255 or not 0 <= count <= 15 or not 0 <= start_index <= 4095:
        raise ProgrammingError("Property: object 0-255, property 0-255, count 0-15, start 0-4095")
    async with _programmer(xknx, address) as programmer:
        data = await programmer.read_property(object_index, property_id, count=count, start_index=start_index)
    return {"address": address, "object_index": object_index, "property_id": property_id, "count": count, "start_index": start_index, "hex": data.hex().upper()}


async def write_property(xknx: XKNX, address: str, object_index: int, property_id: int, data: bytes, count: int = 1, start_index: int = 1) -> dict[str, Any]:
    if not 0 <= object_index <= 255 or not 0 <= property_id <= 255 or not 1 <= count <= 255 or not 1 <= start_index <= 4095:
        raise ProgrammingError("Property: object 0-255, property 0-255, count 1-255, start 1-4095")
    async with _programmer(xknx, address) as programmer:
        result = await programmer.write_property(object_index, property_id, data, count=count, start_index=start_index)
    return {"address": address, "object_index": object_index, "property_id": property_id, "hex": result.hex().upper()}


async def programming_mode_serials(xknx: XKNX, timeout: float = 3.0) -> list[dict[str, Any]]:
    """The devices in programming mode with their serial numbers (read from the Device Object; a
    device that does not have the property, or refuses, is listed without one)."""
    items: list[dict[str, Any]] = []
    for address in await programming_mode_devices(xknx, timeout):
        serial: str | None = None
        error: str | None = None
        try:
            async with _programmer(xknx, address) as programmer:
                raw = await programmer.read_property(0, _PID_SERIAL_NUMBER)
                serial = raw.hex().upper() if raw else None
        except Exception as exc:  # noqa: BLE001 - one silent device must not hide the others
            error = f"{type(exc).__name__}: {exc}"
        items.append({"address": address, "serial_number": serial, "error": error})
    return items


async def address_by_serial(xknx: XKNX, serial: bytes, timeout: float = 3.0) -> str | None:
    """The individual address the device with this serial number carries (broadcast)."""
    from xknx.management.procedures.network.nm_individual_address_serial_number_read import (
        nm_individual_address_serial_number_read,
    )

    found = await nm_individual_address_serial_number_read(xknx, serial, timeout=timeout)
    return str(found) if found is not None else None


def verdict(report: dict[str, Any]) -> dict[str, Any]:
    """A preflight report read as a check: does the device hold what the project would write?"""
    compared = len(report.get("segments", [])) + len(report.get("properties", []))
    differs = report.get("changed_bytes", 0) or report.get("changed_properties", 0)
    return {
        **report,
        "compared": compared,
        "matches": compared > 0 and not differs,
    }
