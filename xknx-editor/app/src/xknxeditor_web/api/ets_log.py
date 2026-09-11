"""The project-log key (status, set, clear)."""

from __future__ import annotations

from typing import Any

from starlette.requests import Request
from starlette.routing import Route

from xknxeditor_web.api import body, route
from xknxeditor_web.errors import ApiError
from xknxeditor_web.ets_log import LogKeyStore, parse_key


def _store(request: Request) -> LogKeyStore:
    return request.app.state.log_key


async def status(request: Request) -> Any:
    return _store(request).status()


async def set_key(request: Request) -> Any:
    data = await body(request)
    try:
        values = parse_key(data)
    except ApiError:
        raise
    except ValueError as exc:
        raise ApiError(str(exc)) from exc
    store = _store(request)
    editor = request.app.state.editor
    result = await editor.worker.run(store.save, values)
    editor.worker.bump(structural=False)  # the Project dock can decrypt now
    return result


async def clear(request: Request) -> Any:
    store = _store(request)
    editor = request.app.state.editor
    result = await editor.worker.run(store.clear)
    editor.worker.bump(structural=False)
    return result


def routes() -> list[Route]:
    return [
        route("/api/ets-log-key", status),
        route("/api/ets-log-key", set_key, ["POST", "PUT"]),
        route("/api/ets-log-key", clear, ["DELETE"]),
    ]
