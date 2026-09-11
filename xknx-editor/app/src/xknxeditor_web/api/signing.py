"""The .knxproj signing key (status, set, clear)."""

from __future__ import annotations

from typing import Any

from starlette.requests import Request
from starlette.routing import Route

from xknxeditor_web.api import body, route
from xknxeditor_web.errors import ApiError
from xknxeditor_web.signing import SigningKeyStore, parse_key


def _store(request: Request) -> SigningKeyStore:
    return request.app.state.signing


async def status(request: Request) -> Any:
    return _store(request).status()


async def set_key(request: Request) -> Any:
    data = await body(request)
    try:
        modulus, private, public = parse_key(data)
    except ValueError as exc:
        raise ApiError(str(exc)) from exc
    store = _store(request)
    editor = request.app.state.editor
    await editor.worker.run(store.save, modulus, private, public)
    return store.status()


async def clear(request: Request) -> Any:
    store = _store(request)
    editor = request.app.state.editor
    await editor.worker.run(store.clear)
    return store.status()


def routes() -> list[Route]:
    return [
        route("/api/signing-key", status),
        route("/api/signing-key", set_key, ["POST", "PUT"]),
        route("/api/signing-key", clear, ["DELETE"]),
    ]
