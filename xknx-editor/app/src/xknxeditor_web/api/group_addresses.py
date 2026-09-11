"""Group addresses and their range folders."""

from __future__ import annotations

from typing import Any

from starlette.requests import Request
from starlette.routing import Route

from xknxeditor_web.api import body, need, opt, query_int, route
from xknxeditor_web.editor import Editor


def _ed(request: Request) -> Editor:
    return request.app.state.editor


async def list_gas(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(ed.group_addresses)


async def ranges(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(ed.group_ranges, query_int(request, "installation", 0))


async def get_ga(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(ed.group_address, request.path_params["id"])


async def create_ga(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    return await ed.worker.run(
        ed.create_group_address,
        opt(data, "installation", int, 0),
        opt(data, "address", int),
        opt(data, "name", str, ""),
        opt(data, "datapoint_type", str),
        opt(data, "range_id", int),
    )


async def patch_ga(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    ga_id = request.path_params["id"]
    if "name" in data:
        await ed.worker.run(ed.rename_group_address, ga_id, need(data, "name"))
    if "datapoint_type" in data:
        await ed.worker.run(ed.set_group_address_dpt, ga_id, opt(data, "datapoint_type", str))
    return await ed.worker.run(ed.group_address, ga_id)


async def delete_ga(request: Request) -> Any:
    ed = _ed(request)
    await ed.worker.run(ed.remove_group_address, request.path_params["id"])


async def create_range(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    range_id = await ed.worker.run(
        ed.create_group_range, opt(data, "installation", int, 0), opt(data, "parent_id", int), opt(data, "name", str, "")
    )
    return {"id": range_id}


async def patch_range(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    await ed.worker.run(ed.rename_group_range, request.path_params["id"], need(data, "name"))


async def delete_range(request: Request) -> Any:
    ed = _ed(request)
    await ed.worker.run(ed.remove_group_range, request.path_params["id"])


async def dpts(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(ed.dpts)


def routes() -> list[Route]:
    return [
        route("/api/dpts", dpts),
        route("/api/group-addresses", list_gas),
        route("/api/group-addresses", create_ga, ["POST"]),
        route("/api/group-addresses/ranges", ranges),
        route("/api/group-addresses/{id:int}", get_ga),
        route("/api/group-addresses/{id:int}", patch_ga, ["PATCH"]),
        route("/api/group-addresses/{id:int}", delete_ga, ["DELETE"]),
        route("/api/group-ranges", create_range, ["POST"]),
        route("/api/group-ranges/{id:int}", patch_range, ["PATCH"]),
        route("/api/group-ranges/{id:int}", delete_range, ["DELETE"]),
    ]
