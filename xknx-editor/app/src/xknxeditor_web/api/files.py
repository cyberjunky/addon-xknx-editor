"""Server-side file browsing.

Two roots exist, with different jobs. /share is the in/out tray: the folder every add-on sees and
the user reaches over the network share, so it is the one place files are dropped and picked up,
and the only root the picker offers. /config is the add-on's own storage (catalog, projects,
documents, keys); paths under it stay valid for the API, because Open project and the internal
routes refer to /config/projects/..., but it is not somewhere a person browses for a file.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from starlette.requests import Request
from starlette.routing import Route

from xknxeditor_web.api import route
from xknxeditor_web.config import Settings
from xknxeditor_web.errors import ApiError, NotFound


def _roots(settings: Settings) -> list[tuple[str, Path]]:
    """Every root a path may resolve under."""
    return [("share", settings.share_dir), ("config", settings.config_dir)]


def _browse_roots(settings: Settings) -> list[tuple[str, Path]]:
    """The roots the picker offers: /share alone (see the module docstring)."""
    return [("share", settings.share_dir)]


def _resolve(settings: Settings, raw: str) -> tuple[str, Path]:
    """Map a request path onto one of the roots; refuse anything outside them."""
    target = Path(raw).resolve()
    for label, root in _roots(settings):
        root_r = root.resolve()
        try:
            target.relative_to(root_r)
            return label, target
        except ValueError:
            continue
    raise ApiError(f"{raw} is outside {settings.share_dir} and {settings.config_dir}")


async def browse(request: Request) -> Any:
    settings: Settings = request.app.state.settings
    raw = request.query_params.get("path", "")
    exts = tuple(e.strip().lower() for e in request.query_params.get("ext", "").split(",") if e.strip())
    if not raw:
        return {
            "path": None,
            "parent": None,
            "roots": [{"name": label, "path": str(root)} for label, root in _browse_roots(settings)],
            "entries": [
                {"name": label, "path": str(root), "is_dir": True, "size": None, "mtime": None}
                for label, root in _browse_roots(settings)
                if root.is_dir()
            ],
        }
    label, path = _resolve(settings, raw)
    if not path.is_dir():
        raise NotFound(f"{raw} is not a folder")
    root = dict(_roots(settings))[label].resolve()
    entries: list[dict[str, Any]] = []
    try:
        children = sorted(path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except PermissionError as exc:
        raise ApiError(f"Cannot read {raw}: {exc}", 403) from exc
    for child in children:
        if child.name.startswith("."):
            continue
        try:
            st = child.stat()
        except OSError:
            continue
        is_dir = child.is_dir()
        if not is_dir and exts and child.suffix.lower() not in exts:
            continue
        entries.append(
            {
                "name": child.name,
                "path": str(child),
                "is_dir": is_dir,
                "size": None if is_dir else st.st_size,
                "mtime": datetime.fromtimestamp(st.st_mtime, UTC).isoformat(timespec="seconds"),
            }
        )
    parent = None if path == root else str(path.parent)
    return {
        "path": str(path),
        "parent": parent,
        "root": {"name": label, "path": str(root)},
        "roots": [{"name": n, "path": str(r)} for n, r in _browse_roots(settings)],
        "entries": entries,
    }


def routes() -> list[Route]:
    return [route("/api/files/browse", browse)]
