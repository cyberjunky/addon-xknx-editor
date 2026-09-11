"""HTTP API: thin Starlette handlers that marshal JSON to and from the editor thread."""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from xknxeditor_web.errors import ApiError

Handler = Callable[[Request], Awaitable[Response]]


async def body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ApiError(f"Invalid JSON body: {exc}") from exc
    if not isinstance(data, dict):
        raise ApiError("JSON body must be an object")
    return data


def need(data: dict[str, Any], key: str, kind: type = str) -> Any:
    if key not in data or data[key] is None:
        raise ApiError(f"Missing field '{key}'")
    value = data[key]
    if kind is int and isinstance(value, bool):
        raise ApiError(f"Field '{key}' must be an integer")
    if kind is int and isinstance(value, str) and value.strip().lstrip("-").isdigit():
        value = int(value)
    if not isinstance(value, kind):
        raise ApiError(f"Field '{key}' must be {kind.__name__}")
    return value


def opt(data: dict[str, Any], key: str, kind: type, default: Any = None) -> Any:
    if key not in data or data[key] is None:
        return default
    return need(data, key, kind)


def query_int(request: Request, key: str, default: int) -> int:
    raw = request.query_params.get(key)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ApiError(f"Query parameter '{key}' must be an integer") from exc


def endpoint(fn: Callable[[Request], Awaitable[Any]]) -> Handler:
    """Wrap a coroutine returning JSON-able data; map editor errors to HTTP statuses."""

    async def handler(request: Request) -> Response:
        try:
            result = await fn(request)
        except ApiError as exc:
            return JSONResponse({"error": str(exc)}, status_code=exc.status)
        except KeyError as exc:
            return JSONResponse({"error": str(exc).strip("'")}, status_code=404)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        if isinstance(result, Response):
            return result
        return JSONResponse(result if result is not None else {"ok": True})

    handler.__name__ = fn.__name__
    return handler


def route(path: str, fn: Callable[[Request], Awaitable[Any]], methods: list[str] | None = None) -> Route:
    return Route(path, endpoint(fn), methods=methods or ["GET"])


def all_routes() -> list[Route]:
    from xknxeditor_web.api import backup, bus, catalog, device, docs, ets_log, files, group_addresses, jobs, project, recover, secure, signing, spaces, tools

    return [
        *project.routes(),
        *device.routes(),
        *group_addresses.routes(),
        *spaces.routes(),
        *catalog.routes(),
        *bus.routes(),
        *jobs.routes(),
        *files.routes(),
        *tools.routes(),
        *docs.routes(),
        *recover.routes(),
        *secure.routes(),
        *signing.routes(),
        *ets_log.routes(),
        *backup.routes(),
    ]
