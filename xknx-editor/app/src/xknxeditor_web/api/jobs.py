"""Background job status."""

from __future__ import annotations

from typing import Any

from starlette.requests import Request
from starlette.routing import Route

from xknxeditor_web.api import route
from xknxeditor_web.errors import NotFound
from xknxeditor_web.jobs import JobManager


async def list_jobs(request: Request) -> Any:
    jobs: JobManager = request.app.state.jobs
    items = [j.to_dict() for j in jobs.list()]
    return {"items": items, "count": len(items)}


async def get_job(request: Request) -> Any:
    jobs: JobManager = request.app.state.jobs
    job = jobs.get(request.path_params["id"])
    if job is None:
        raise NotFound(f"No job {request.path_params['id']}")
    return job.to_dict()


def routes() -> list[Route]:
    return [route("/api/jobs", list_jobs), route("/api/jobs/{id}", get_job)]
