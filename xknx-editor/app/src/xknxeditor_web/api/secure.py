"""KNX Data Secure: keyring contents and conversion."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from starlette.requests import Request
from starlette.routing import Route

from xknxeditor_web import secure
from xknxeditor_web.api import body, need, route
from xknxeditor_web.errors import ApiError


def _keyring(request: Request) -> tuple[str, str]:
    s = request.app.state.bus.settings
    return s.keyring_path, s.keyring_password


async def contents(request: Request) -> Any:
    path, password = _keyring(request)
    reveal = request.query_params.get("reveal") in ("1", "true")
    editor = request.app.state.editor
    return await editor.worker.run(secure.keyring_contents, path, password, reveal)


async def export(request: Request) -> Any:
    path, password = _keyring(request)
    data = await body(request)
    editor = request.app.state.editor
    dest = editor._safe_path(need(data, "path"))  # noqa: SLF001
    if dest.suffix.lower() != ".knxkeys":
        dest = dest.with_suffix(".knxkeys")
    if dest.exists() and not data.get("overwrite"):
        raise ApiError(f"{dest.name} already exists in {dest.parent}", 409)
    return await editor.worker.run(secure.export_keyring, path, password, Path(dest), need(data, "new_password"))


def routes() -> list[Route]:
    return [
        route("/api/secure/keyring", contents),
        route("/api/secure/export", export, ["POST"]),
    ]
