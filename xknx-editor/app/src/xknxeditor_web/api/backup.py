"""Back up and restore the add-on's non-project state (catalog, documents, settings, keys, logs)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from starlette.requests import Request
from starlette.responses import FileResponse
from starlette.routing import Route

from xknxeditor_web.api import body, need, route
from xknxeditor_web.editor import Editor
from xknxeditor_web.errors import ApiError
from xknxeditor_web.jobs import Job, JobManager


def _ed(request: Request) -> Editor:
    return request.app.state.editor


async def create(request: Request) -> Any:
    """Write a backup archive, as a job (the catalog can be large). Defaults to /share."""
    ed = _ed(request)
    jobs: JobManager = request.app.state.jobs
    data = await body(request)
    include = data.get("include")
    raw = str(data.get("path") or "")

    def run(job: Job) -> Any:
        jobs.report(job, None, "archiving")
        return ed.backup(raw or None, include)

    return jobs.submit("backup", run, path=raw).to_dict()


async def restore(request: Request) -> Any:
    """Restore chosen categories from a backup under /share or /config, as a job."""
    ed = _ed(request)
    jobs: JobManager = request.app.state.jobs
    data = await body(request)
    raw = need(data, "path")
    include = data.get("include")

    def run(job: Job) -> Any:
        jobs.report(job, None, "restoring")
        return ed.restore_backup(raw, include)

    return jobs.submit("restore", run, path=raw).to_dict()


async def inspect(request: Request) -> Any:
    """What a backup archive contains, before restoring it."""
    ed = _ed(request)
    raw = request.query_params.get("path") or ""
    if not raw:
        raise ApiError("path is required")
    return await ed.worker.run(ed.inspect_backup, raw)


async def download(request: Request) -> Any:
    """Send a backup archive to the browser."""
    ed = _ed(request)
    raw = request.query_params.get("path") or ""
    if not raw:
        raise ApiError("path is required")
    path: Path = ed.safe_path(raw)
    if path.suffix.lower() != ".zip" or not path.is_file():
        raise ApiError(f"{path.name} is not a backup archive")
    return FileResponse(path, filename=path.name, media_type="application/zip")


def routes() -> list[Route]:
    return [
        route("/api/backup", create, ["POST"]),
        route("/api/backup/restore", restore, ["POST"]),
        route("/api/backup/inspect", inspect),
        route("/api/backup/download", download),
    ]
