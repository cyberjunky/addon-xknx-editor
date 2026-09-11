"""Tools and mass linker: extended copy, replace device, shift addresses, labels, topology check."""

from __future__ import annotations

from typing import Any

from starlette.requests import Request
from starlette.responses import PlainTextResponse
from starlette.routing import Route

from xknxeditor_web import tools
from xknxeditor_web.api import body, need, opt, route
from xknxeditor_web.editor import Editor
from xknxeditor_web.errors import ApiError


def _ed(request: Request) -> Editor:
    return request.app.state.editor


def _ids(value: Any, field: str = "device_ids") -> list[int]:
    if not isinstance(value, list):
        raise ApiError(f"{field} must be a list of device ids")
    try:
        return [int(v) for v in value]
    except (TypeError, ValueError) as exc:
        raise ApiError(f"{field} must be a list of device ids") from exc


def _query_ids(request: Request, key: str = "devices") -> list[int]:
    raw = request.query_params.get(key, "")
    try:
        return [int(v) for v in raw.split(",") if v.strip()]
    except ValueError as exc:
        raise ApiError(f"{key} must be comma-separated device ids") from exc


async def extended_copy(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    return await ed.worker.run(
        tools.extended_copy,
        ed,
        need(data, "device_id", int),
        opt(data, "count", int, 1),
        opt(data, "find", str, ""),
        opt(data, "replace", str, ""),
        bool(data.get("create_group_addresses", False)),
    )


async def replace_preview(request: Request) -> Any:
    ed = _ed(request)
    try:
        target = int(request.query_params["target"])
        template = int(request.query_params["template"])
    except (KeyError, ValueError) as exc:
        raise ApiError("target and template device ids are required") from exc
    return await ed.worker.run(tools.replace_preview, ed, target, template)


async def replace_device(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    return await ed.worker.run(
        tools.replace_device, ed, need(data, "target_id", int), need(data, "template_id", int)
    )


async def shift_addresses(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    result = await ed.worker.run(
        tools.shift_addresses,
        ed,
        _ids(data.get("device_ids", [])),
        need(data, "offset", int),
        bool(data.get("dry_run", False)),
    )
    if result["errors"] and not data.get("dry_run"):
        raise ApiError("; ".join(result["errors"]), 409)
    return result


async def labels(request: Request) -> Any:
    ed = _ed(request)
    ids = _query_ids(request)
    result = await ed.worker.run(tools.labels, ed, ids or None)
    if request.query_params.get("format") == "csv":
        return PlainTextResponse(
            result["csv"],
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="device-labels.csv"'},
        )
    return result


async def topology_check(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(tools.topology_check, ed)


async def objects(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(tools.objects_for, ed, _query_ids(request))


async def mass_link(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    pairs = data.get("pairs")
    if not isinstance(pairs, list):
        raise ApiError("pairs must be a list")
    return await ed.worker.run(tools.mass_link, ed, pairs)


async def mass_link_objects(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    pairs = data.get("pairs")
    if not isinstance(pairs, list):
        raise ApiError("pairs must be a list")
    return await ed.worker.run(tools.mass_link_objects, ed, pairs, opt(data, "installation", int, 0))


async def auto_create(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    refs = data.get("ref_ids")
    if refs is not None and not isinstance(refs, list):
        raise ApiError("ref_ids must be a list")
    created = await ed.worker.run(
        tools.auto_create_gas,
        ed,
        need(data, "device_id", int),
        set(str(r) for r in refs) if refs is not None else None,
        opt(data, "installation", int, 0),
    )
    return {"created": created}


def routes() -> list[Route]:
    return [
        route("/api/tools/extended-copy", extended_copy, ["POST"]),
        route("/api/tools/replace-preview", replace_preview),
        route("/api/tools/replace-device", replace_device, ["POST"]),
        route("/api/tools/shift-addresses", shift_addresses, ["POST"]),
        route("/api/tools/labels", labels),
        route("/api/tools/topology-check", topology_check),
        route("/api/tools/objects", objects),
        route("/api/tools/mass-link", mass_link, ["POST"]),
        route("/api/tools/mass-link-objects", mass_link_objects, ["POST"]),
        route("/api/tools/auto-create-group-addresses", auto_create, ["POST"]),
    ]
