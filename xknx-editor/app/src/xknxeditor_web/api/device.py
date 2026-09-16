"""Devices: detail, parameters, com-objects, links, address, placement."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from starlette.requests import Request
from starlette.routing import Route

from xknxeditor_web.api import body, need, opt, route
from xknxeditor_web.editor import Editor
from xknxeditor_web.errors import ApiError
from xknxeditor_web.jobs import Job, JobManager


def _ed(request: Request) -> Editor:
    return request.app.state.editor


def _id(request: Request) -> int:
    return request.path_params["id"]


async def add_device(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    return await ed.worker.run(
        ed.add_device,
        need(data, "product_ref_id"),
        opt(data, "name", str, ""),
        opt(data, "segment_id", int),
        opt(data, "address", int),
    )


async def get_device(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(ed.device, _id(request))


async def patch_device(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    if "name" in data:
        await ed.worker.run(ed.rename_device, _id(request), need(data, "name"))
    if "individual_address" in data:
        await ed.worker.run(ed.set_individual_address, _id(request), need(data, "individual_address"))
    if "space_id" in data:
        await ed.worker.run(ed.set_device_space, _id(request), opt(data, "space_id", int))
    for field in ed.TEXT_FIELDS:
        if field in data:
            await ed.worker.run(ed.set_device_text, _id(request), field, opt(data, field, str, ""))
    return await ed.worker.run(ed.device, _id(request))


async def delete_device(request: Request) -> Any:
    ed = _ed(request)
    await ed.worker.run(ed.remove_device, _id(request))


async def parameters(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(ed.parameters, _id(request))


async def set_parameter(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    return await ed.worker.run(ed.set_parameter, _id(request), need(data, "ref_id"), str(need(data, "value", object)))


async def com_objects(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(ed.com_objects, _id(request))


async def set_flag(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    value = data.get("value")
    if value is not None and not isinstance(value, bool):
        value = bool(value)
    return await ed.worker.run(ed.set_flag, _id(request), need(data, "ref_id"), need(data, "flag"), value)


async def link(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    return await ed.worker.run(
        ed.link, _id(request), need(data, "ref_id"), need(data, "group_address_id", int), bool(data.get("sending", False))
    )


async def unlink(request: Request) -> Any:
    ed = _ed(request)
    await ed.worker.run(ed.unlink, request.path_params["link_id"])


async def set_sending(request: Request) -> Any:
    ed = _ed(request)
    await ed.worker.run(ed.set_sending, request.path_params["link_id"])


def _scope(data: dict[str, Any]) -> Any:
    from xknxeditor_web.programming import SCOPES

    raw = str(data.get("scope", "full"))
    if raw not in SCOPES:
        raise ApiError(f"scope must be one of {sorted(SCOPES)}")
    return SCOPES[raw]


def _keyring(request: Request) -> dict[str, Any]:
    s = request.app.state.bus.settings
    return {"keyring_path": s.keyring_path, "keyring_password": s.keyring_password}


def _xknx(request: Request) -> Any:
    bus = request.app.state.bus
    x = getattr(bus, "_xknx", None)
    if x is None:
        raise ApiError("Not connected to the bus. Connect to a gateway first (top right).", 409)
    return x


async def memory(request: Request) -> Any:
    from xknxeditor_web.programming import memory_preview

    ed = _ed(request)
    return await ed.worker.run(memory_preview, ed, _id(request))


async def manual(request: Request) -> Any:
    import asyncio

    from xknxeditor_web.manuals import resolve_manual

    ed = _ed(request)
    d = await ed.worker.run(ed.device, _id(request))
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None,
        resolve_manual,
        d.get("manufacturer_name"),
        d.get("order_number"),
        d.get("product_name") or d.get("hardware_name"),
        (d.get("application") or {}).get("name"),
        d.get("product_ref_id"),
    )


def _clash(request: Request) -> Callable[[str], Awaitable[str]]:
    """Who else is on the editor's own address, asked only when something failed: a device in the
    project, or - harder evidence - telegrams that arrived from that address."""
    ed: Editor = request.app.state.editor
    recorder = getattr(request.app.state, "recorder", None)

    async def lookup(address: str) -> str:
        device = await ed.worker.run(ed.device_on_address, address)
        if device:
            return f"The editor sends from {address}, which is also {device} in this project."
        if recorder is not None:
            import asyncio
            import time

            seen = await asyncio.to_thread(recorder.incoming_from, address, time.time() - 86400)
            if seen:
                return (
                    f"The editor sends from {address}, and {seen} telegram(s) arrived FROM that "
                    f"address in the last day - so something else on the bus uses it too (another "
                    f"tunnel, such as Home Assistant's KNX integration, or a device)."
                )
        return ""

    return lookup


async def preflight(request: Request) -> Any:
    from xknxeditor_web import programming as prog

    ed = _ed(request)
    jobs: JobManager = request.app.state.jobs
    data = await body(request)
    scope = _scope(data)
    xknx = _xknx(request)
    device_id = _id(request)

    async def run(job: Job) -> Any:
        jobs.report(job, None, "preparing the download")
        prepared = await ed.worker.run(prog.prepare, ed, device_id, _keyring(request))
        master = await ed.worker.run(prog.master_for, ed)
        jobs.report(job, None, "reading the device")
        async with prog.explained(xknx, prepared.address, _clash(request)):
            return await prog.run_preflight(xknx, prepared, scope, master)

    return jobs.submit_async("preflight", run, device_id=device_id, scope=scope.value).to_dict()


async def program(request: Request) -> Any:
    from xknxeditor_web import programming as prog

    ed = _ed(request)
    jobs: JobManager = request.app.state.jobs
    data = await body(request)
    scope = _scope(data)
    xknx = _xknx(request)
    device_id = _id(request)

    async def run(job: Job) -> Any:
        jobs.report(job, None, "preparing the download")
        prepared = await ed.worker.run(prog.prepare, ed, device_id, _keyring(request))
        master = await ed.worker.run(prog.master_for, ed)
        jobs.report(job, 0.0, "programming")

        def progress(done: int, total: int) -> None:
            # "Load control" is the name of the procedure in the KNX spec, not something to
            # report at: what the user watches is how far the download has got.
            jobs.report(job, done / total if total else None, f"writing to the device, step {done} of {total}")

        async def download() -> None:
            async with prog.explained(xknx, prepared.address, _clash(request)):
                await prog.run_download(xknx, prepared, scope, master, progress)

        try:
            await download()
        except ApiError as exc:
            # A full download is a commissioning step: when nothing answers at the project's
            # address and exactly one device is in programming mode, that device is the one meant,
            # so write the address into it first and then load the application. A partial download
            # never touches the address.
            if exc.status != 504 or scope is not prog.DownloadScope.FULL:
                raise
            found = await prog.programming_mode_devices(xknx)
            if len(found) != 1:
                raise
            jobs.report(job, None, f"assigning {prepared.address} (device answers on {found[0]})")
            await prog.assign_individual_address(xknx, prepared.address)
            await asyncio.sleep(3)  # the device restarts after taking its new address
            jobs.report(job, 0.0, "programming")
            await download()
            return {"assigned": prepared.address, "was": found[0]}
        await ed.worker.run(ed.mark_programmed, device_id, scope.value)
        return {"device_id": device_id, "scope": scope.value, "address": prepared.address}

    return jobs.submit_async("program", run, device_id=device_id, scope=scope.value).to_dict()


async def read_device(request: Request) -> Any:
    from xknxeditor_web import programming as prog

    ed = _ed(request)
    xknx = _xknx(request)
    d = await ed.worker.run(ed.device, _id(request))
    if not d.get("individual_address"):
        raise ApiError("The device has no individual address", 409)
    try:
        async with prog.explained(xknx, d["individual_address"], _clash(request)):
            return await prog.read_overview(xknx, d["individual_address"])
    except Exception as exc:  # noqa: BLE001 - bus errors surface as 502
        raise ApiError(f"Read failed: {type(exc).__name__}: {exc}", 502) from exc


async def assign_address(request: Request) -> Any:
    """Write the device's project address into it: the one device in programming mode, or by serial."""
    from xknxeditor_web import programming as prog

    ed = _ed(request)
    xknx = _xknx(request)
    data = await body(request)
    device_id = _id(request)
    d = await ed.worker.run(ed.device, device_id)
    if not d.get("individual_address"):
        raise ApiError("Give the device an individual address in the project first", 409)
    try:
        result = await prog.assign_individual_address(xknx, d["individual_address"], opt(data, "serial", str))
    except prog.ProgrammingError as exc:
        raise ApiError(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - bus errors surface as 502
        raise ApiError(f"Address assignment failed: {type(exc).__name__}: {exc}", 502) from exc
    await ed.worker.run(ed.mark_programmed, device_id, "individual_address")
    return result


async def dali(request: Request) -> Any:
    """Run one DALI commissioning operation on an MDT gateway as a job."""
    from xknxeditor_web import dali as dali_mod
    from xknxeditor_web import programming as prog

    ed = _ed(request)
    jobs: JobManager = request.app.state.jobs
    xknx = _xknx(request)
    device_id = _id(request)
    op_name = request.path_params["op"]
    if op_name not in dali_mod.OPERATIONS:
        raise ApiError(f"Unknown DALI operation {op_name}; one of {', '.join(dali_mod.OPERATIONS)}", 404)
    data = await body(request)
    d = await ed.worker.run(ed.device, device_id)
    if not d.get("individual_address"):
        raise ApiError("The device has no individual address", 409)
    if not d.get("dali"):
        raise ApiError("This device is not an MDT DALI Control gateway", 409)
    channel = opt(data, "channel", int, 0)

    async def run(job: Job) -> Any:
        jobs.report(job, None, op_name)
        prepared = await ed.worker.run(prog.prepare, ed, device_id, _keyring(request), with_groups=False)
        return await dali_mod.run_dali_operation(
            xknx, d["individual_address"], prepared.security, channel, dali_mod.operation(op_name, data, lambda s: jobs.report(job, None, s))
        )

    return jobs.submit_async(f"dali-{op_name}", run, device_id=device_id, channel=channel).to_dict()


async def restart_device(request: Request) -> Any:
    from xknxeditor_web import programming as prog

    ed = _ed(request)
    xknx = _xknx(request)
    d = await ed.worker.run(ed.device, _id(request))
    if not d.get("individual_address"):
        raise ApiError("The device has no individual address", 409)
    try:
        async with prog.explained(xknx, d["individual_address"], _clash(request)):
            await prog.restart(xknx, d["individual_address"])
    except Exception as exc:  # noqa: BLE001
        raise ApiError(f"Restart failed: {type(exc).__name__}: {exc}", 502) from exc
    return {"restarted": d["individual_address"]}


async def _address(request: Request, device_id: int) -> str:
    ed = _ed(request)
    d = await ed.worker.run(ed.device, device_id)
    if not d.get("individual_address"):
        raise ApiError("The device has no individual address", 409)
    return d["individual_address"]


async def _on_device(request: Request, what: str, call: Callable[[Any, str], Awaitable[Any]]) -> Any:
    """Run one management exchange with the selected device, with the usual explanations."""
    from xknxeditor_web import programming as prog

    xknx = _xknx(request)
    address = await _address(request, _id(request))
    try:
        async with prog.explained(xknx, address, _clash(request)):
            return await call(xknx, address)
    except ApiError:
        raise
    except prog.ProgrammingError as exc:
        raise ApiError(str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - bus errors surface as 502
        raise ApiError(f"{what} failed: {type(exc).__name__}: {exc}", 502) from exc


async def ping_device(request: Request) -> Any:
    from xknxeditor_web import programming as prog

    xknx = _xknx(request)
    address = await _address(request, _id(request))
    try:
        return await prog.ping(xknx, address)
    except Exception as exc:  # noqa: BLE001
        raise ApiError(f"Ping failed: {type(exc).__name__}: {exc}", 502) from exc


async def identify_device(request: Request) -> Any:
    from xknxeditor_web import programming as prog

    data = await body(request)
    seconds = max(1, min(opt(data, "seconds", int, 6), 30))
    return await _on_device(request, "Identify", lambda x, a: prog.identify(x, a, seconds))


async def memory_read(request: Request) -> Any:
    from xknxeditor_web import programming as prog

    data = await body(request)
    start, count = need(data, "start", int), need(data, "count", int)
    return await _on_device(request, "Memory read", lambda x, a: prog.read_memory(x, a, start, count))


async def memory_write(request: Request) -> Any:
    from xknxeditor_web import programming as prog

    data = await body(request)
    start = need(data, "start", int)
    try:
        payload = prog.parse_hex(need(data, "data"))
    except prog.ProgrammingError as exc:
        raise ApiError(str(exc)) from exc
    return await _on_device(request, "Memory write", lambda x, a: prog.write_memory(x, a, start, payload))


async def property_read(request: Request) -> Any:
    from xknxeditor_web import programming as prog

    data = await body(request)
    obj, pid = need(data, "object_index", int), need(data, "property_id", int)
    count, start = opt(data, "count", int, 1), opt(data, "start_index", int, 1)
    return await _on_device(request, "Property read", lambda x, a: prog.read_property(x, a, obj, pid, count, start))


async def property_write(request: Request) -> Any:
    from xknxeditor_web import programming as prog

    data = await body(request)
    obj, pid = need(data, "object_index", int), need(data, "property_id", int)
    count, start = opt(data, "count", int, 1), opt(data, "start_index", int, 1)
    try:
        payload = prog.parse_hex(need(data, "data"))
    except prog.ProgrammingError as exc:
        raise ApiError(str(exc)) from exc
    return await _on_device(request, "Property write", lambda x, a: prog.write_property(x, a, obj, pid, payload, count, start))


async def connections(request: Request) -> Any:
    from xknxeditor_web.reports import device_connections

    ed = _ed(request)
    return await ed.worker.run(device_connections, ed, _id(request))


async def compare(request: Request) -> Any:
    from xknxeditor_web.reports import compare_devices

    ed = _ed(request)
    raw = request.query_params.get("ids", "")
    try:
        ids = [int(v) for v in raw.split(",") if v.strip()]
    except ValueError as exc:
        raise ApiError("ids must be comma-separated device ids") from exc
    return await ed.worker.run(compare_devices, ed, ids)


async def unassign(request: Request) -> Any:
    ed = _ed(request)
    await ed.worker.run(ed.unassign_address, _id(request))
    return await ed.worker.run(ed.device, _id(request))


async def _verify_one(request: Request, device_id: int) -> dict[str, Any]:
    from xknxeditor_web import programming as prog

    ed = _ed(request)
    xknx = _xknx(request)
    prepared = await ed.worker.run(prog.prepare, ed, device_id, _keyring(request))
    master = await ed.worker.run(prog.master_for, ed)
    async with prog.explained(xknx, prepared.address, _clash(request)):
        report = await prog.run_preflight(xknx, prepared, prog.DownloadScope.FULL, master)
    return prog.verdict(report)


async def verify(request: Request) -> Any:
    """Read the device and compare it with what the project would write (nothing is written)."""
    jobs: JobManager = request.app.state.jobs
    _xknx(request)
    device_id = _id(request)

    async def run(job: Job) -> Any:
        jobs.report(job, None, "reading the device and comparing it with the project")
        return await _verify_one(request, device_id)

    return jobs.submit_async("verify", run, device_id=device_id).to_dict()


def _device_ids(data: dict[str, Any]) -> list[int]:
    raw = data.get("device_ids")
    if not isinstance(raw, list) or not raw:
        raise ApiError("device_ids must be a non-empty list")
    try:
        return [int(v) for v in raw]
    except (TypeError, ValueError) as exc:
        raise ApiError("device_ids must be a list of device ids") from exc


async def ping_many(request: Request) -> Any:
    """Ping devices one after the other: the online check of an installation."""
    from xknxeditor_web import programming as prog

    ed = _ed(request)
    jobs: JobManager = request.app.state.jobs
    data = await body(request)
    ids = _device_ids(data)
    xknx = _xknx(request)

    async def run(job: Job) -> Any:
        summaries = {d["id"]: d for d in await ed.worker.run(ed.devices)}
        items: list[dict[str, Any]] = []
        for n, device_id in enumerate(ids):
            d = summaries.get(device_id)
            address = d["individual_address"] if d else None
            jobs.report(job, n / len(ids), f"pinging {address or device_id} ({n + 1} of {len(ids)})")
            if not address:
                items.append({"device_id": device_id, "address": None, "reachable": None, "error": "no individual address"})
                continue
            try:
                items.append({"device_id": device_id, **await prog.ping(xknx, address), "error": None})
            except Exception as exc:  # noqa: BLE001 - reported per device
                items.append({"device_id": device_id, "address": address, "reachable": None, "error": f"{type(exc).__name__}: {exc}"})
        return {"items": items, "reachable": sum(1 for i in items if i.get("reachable")), "count": len(items)}

    return jobs.submit_async("ping", run, count=len(ids)).to_dict()


async def verify_many(request: Request) -> Any:
    ed = _ed(request)
    jobs: JobManager = request.app.state.jobs
    data = await body(request)
    ids = _device_ids(data)
    _xknx(request)

    async def run(job: Job) -> Any:
        summaries = {d["id"]: d for d in await ed.worker.run(ed.devices)}
        items: list[dict[str, Any]] = []
        for n, device_id in enumerate(ids):
            d = summaries.get(device_id) or {}
            jobs.report(job, n / len(ids), f"verifying {d.get('individual_address') or device_id} ({n + 1} of {len(ids)})")
            try:
                r = await _verify_one(request, device_id)
                items.append(
                    {
                        "device_id": device_id,
                        "address": d.get("individual_address"),
                        "matches": r["matches"],
                        "changed_bytes": r["changed_bytes"],
                        "changed_properties": r["changed_properties"],
                        "compared": r["compared"],
                        "error": None,
                    }
                )
            except Exception as exc:  # noqa: BLE001 - reported per device
                items.append({"device_id": device_id, "address": d.get("individual_address"), "matches": None, "error": str(exc)})
        return {"items": items, "matches": sum(1 for i in items if i["matches"]), "count": len(items)}

    return jobs.submit_async("verify-many", run, count=len(ids)).to_dict()


def routes() -> list[Route]:
    return [
        route("/api/devices/ping", ping_many, ["POST"]),
        route("/api/devices/compare", compare),
        route("/api/devices/{id:int}/connections", connections),
        route("/api/devices/verify", verify_many, ["POST"]),
        route("/api/devices/{id:int}/ping", ping_device, ["POST"]),
        route("/api/devices/{id:int}/identify", identify_device, ["POST"]),
        route("/api/devices/{id:int}/verify", verify, ["POST"]),
        route("/api/devices/{id:int}/memory/read", memory_read, ["POST"]),
        route("/api/devices/{id:int}/memory/write", memory_write, ["POST"]),
        route("/api/devices/{id:int}/property/read", property_read, ["POST"]),
        route("/api/devices/{id:int}/property/write", property_write, ["POST"]),
        route("/api/devices/{id:int}/unassign", unassign, ["POST"]),
        route("/api/devices/{id:int}/memory", memory),
        route("/api/devices/{id:int}/manual", manual),
        route("/api/devices/{id:int}/preflight", preflight, ["POST"]),
        route("/api/devices/{id:int}/program", program, ["POST"]),
        route("/api/devices/{id:int}/read", read_device, ["POST"]),
        route("/api/devices/{id:int}/restart", restart_device, ["POST"]),
        route("/api/devices/{id:int}/assign-address", assign_address, ["POST"]),
        route("/api/devices/{id:int}/dali/{op:str}", dali, ["POST"]),
        route("/api/devices", add_device, ["POST"]),
        route("/api/devices/{id:int}", get_device),
        route("/api/devices/{id:int}", patch_device, ["PATCH"]),
        route("/api/devices/{id:int}", delete_device, ["DELETE"]),
        route("/api/devices/{id:int}/parameters", parameters),
        route("/api/devices/{id:int}/parameter", set_parameter, ["POST"]),
        route("/api/devices/{id:int}/com-objects", com_objects),
        route("/api/devices/{id:int}/com-objects/flag", set_flag, ["POST"]),
        route("/api/devices/{id:int}/com-objects/link", link, ["POST"]),
        route("/api/links/{link_id:int}", unlink, ["DELETE"]),
        route("/api/links/{link_id:int}/sending", set_sending, ["POST"]),
    ]
