"""Devices: detail, parameters, com-objects, links, address, placement."""

from __future__ import annotations

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
        jobs.report(job, None, "building image")
        prepared = await ed.worker.run(prog.prepare, ed, device_id, _keyring(request))
        master = await ed.worker.run(prog.master_for, ed)
        jobs.report(job, None, "reading device")
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
        jobs.report(job, None, "building image")
        prepared = await ed.worker.run(prog.prepare, ed, device_id, _keyring(request))
        master = await ed.worker.run(prog.master_for, ed)
        jobs.report(job, 0.0, "programming")

        def progress(done: int, total: int) -> None:
            jobs.report(job, done / total if total else None, f"load control {done}/{total}")

        async with prog.explained(xknx, prepared.address, _clash(request)):
            await prog.run_download(xknx, prepared, scope, master, progress)
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


def routes() -> list[Route]:
    return [
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
