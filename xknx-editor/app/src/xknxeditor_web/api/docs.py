"""Document library: upload, list, open (inline) and delete manuals/datasheets/drawings."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from starlette.requests import Request
from starlette.responses import FileResponse
from starlette.routing import Route

from xknxeditor_web.api import body, route
from xknxeditor_web.docs import DocStore
from xknxeditor_web.errors import ApiError


def _store(request: Request) -> DocStore:
    return request.app.state.docs


async def list_docs(request: Request) -> Any:
    tag = request.query_params.get("tag")
    items = _store(request).list(tag)
    return {"items": items, "count": len(items)}


async def upload(request: Request) -> Any:
    length = int(request.headers.get("content-length") or 0)
    if length > 50 * 1024 * 1024:
        raise ApiError("File too large", 413)
    content = await request.body()
    name = request.query_params.get("name", "document")
    tag = request.query_params.get("tag", "")
    note = request.query_params.get("note", "")
    picture = request.query_params.get("picture", "") in ("1", "true", "yes")
    return _store(request).add(name, content, tag, note, picture)


async def pictures(request: Request) -> Any:
    """Device pictures by order number (squeezed, lower case) -> document id."""
    return {"items": _store(request).pictures()}


async def get_raw(request: Request) -> Any:
    path, meta = _store(request).get(request.path_params["id"])
    disposition = "inline" if meta.get("inline") else "attachment"
    return FileResponse(
        path,
        media_type=meta.get("content_type") or "application/octet-stream",
        headers={"Content-Disposition": f"{disposition}; filename*=UTF-8''{quote(meta['name'])}"},
    )


async def patch_doc(request: Request) -> Any:
    data = await body(request)
    return _store(request).update(
        request.path_params["id"],
        tag=data.get("tag"),
        note=data.get("note"),
        name=data.get("name"),
        picture=data.get("picture") if isinstance(data.get("picture"), bool) else None,
    )


async def delete_doc(request: Request) -> Any:
    _store(request).delete(request.path_params["id"])
    return {"deleted": request.path_params["id"]}


def routes() -> list[Route]:
    return [
        route("/api/docs", list_docs),
        route("/api/docs/pictures", pictures),
        route("/api/docs", upload, ["PUT", "POST"]),
        route("/api/docs/{id:str}/raw", get_raw),
        route("/api/docs/{id:str}", patch_doc, ["PATCH"]),
        route("/api/docs/{id:str}", delete_doc, ["DELETE"]),
    ]
