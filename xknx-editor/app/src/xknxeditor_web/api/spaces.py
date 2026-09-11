"""Buildings, floors, rooms: the location tree."""

from __future__ import annotations

from typing import Any

from starlette.requests import Request
from starlette.routing import Route

from xknxeditor_web.api import body, need, opt, query_int, route
from xknxeditor_web.editor import Editor


def _ed(request: Request) -> Editor:
    return request.app.state.editor


async def tree(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(ed.spaces, query_int(request, "installation", 0))


async def detail(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(ed.space_detail, request.path_params["id"], query_int(request, "installation", 0))


async def create(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    sid = await ed.worker.run(
        ed.create_space,
        opt(data, "installation", int, 0),
        opt(data, "space_type", str, "Room"),
        opt(data, "name", str, ""),
        opt(data, "parent_id", int),
    )
    return {"id": sid}


async def patch(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    sid = request.path_params["id"]
    if "name" in data:
        await ed.worker.run(ed.rename_space, sid, need(data, "name"))
    if "space_type" in data:
        await ed.worker.run(ed.set_space_type, sid, need(data, "space_type"))
    if "parent_id" in data:
        await ed.worker.run(ed.move_space, sid, opt(data, "parent_id", int))


async def delete(request: Request) -> Any:
    ed = _ed(request)
    await ed.worker.run(ed.remove_space, request.path_params["id"])


def routes() -> list[Route]:
    return [
        route("/api/spaces", tree),
        route("/api/spaces", create, ["POST"]),
        route("/api/spaces/{id:int}", detail),
        route("/api/spaces/{id:int}", patch, ["PATCH"]),
        route("/api/spaces/{id:int}", delete, ["DELETE"]),
    ]
