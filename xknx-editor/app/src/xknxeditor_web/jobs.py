"""Background jobs (imports, later programming and recover scans) with progress events.

A job body runs on the editor thread because it mutates the catalog or project database; while it
runs, other editor calls queue behind it. Progress is reported through :class:`EditorWorker.emit`
as ``{"type": "job", ...}`` events and kept in memory for polling.
"""

from __future__ import annotations

import threading
import traceback
import uuid
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from typing import Any

from xknxeditor_web.worker import EditorWorker


@dataclass
class Job:
    id: str
    kind: str
    status: str = "queued"  # queued | running | done | failed
    progress: float | None = None
    stage: str = ""
    result: Any = None
    error: str | None = None
    detail: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class JobManager:
    def __init__(self, worker: EditorWorker) -> None:
        self._worker = worker
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def list(self) -> list[Job]:
        return list(self._jobs.values())

    def submit(self, kind: str, body: Callable[[Job], Any], **detail: Any) -> Job:
        """Queue ``body(job)`` on the editor thread; returns immediately with the job record."""
        job = Job(id=uuid.uuid4().hex[:12], kind=kind, detail=detail)
        with self._lock:
            self._jobs[job.id] = job
        self._emit(job)

        def _run() -> None:
            job.status = "running"
            self._emit(job)
            try:
                job.result = body(job)
                job.status = "done"
                job.progress = 1.0
            except Exception as exc:  # noqa: BLE001 - reported to the client
                job.status = "failed"
                job.error = f"{type(exc).__name__}: {exc}"
                job.detail["traceback"] = traceback.format_exc()
            self._emit(job)

        self._worker._pool.submit(_run)  # noqa: SLF001 - jobs are part of the worker's contract
        return job

    def submit_async(self, kind: str, body: Callable[[Job], Any], **detail: Any) -> Job:
        """Run an async ``body(job)`` as a task on the server loop (bus operations)."""
        import asyncio

        job = Job(id=uuid.uuid4().hex[:12], kind=kind, detail=detail)
        with self._lock:
            self._jobs[job.id] = job
        self._emit(job)

        async def _run() -> None:
            job.status = "running"
            self._emit(job)
            try:
                job.result = await body(job)
                job.status = "done"
                job.progress = 1.0
            except Exception as exc:  # noqa: BLE001 - reported to the client
                job.status = "failed"
                job.error = f"{type(exc).__name__}: {exc}"
                job.detail["traceback"] = traceback.format_exc()
            self._emit(job)

        asyncio.get_running_loop().create_task(_run())
        return job

    def report(self, job: Job, progress: float | None, stage: str = "") -> None:
        job.progress = progress
        job.stage = stage
        self._emit(job)

    def _emit(self, job: Job) -> None:
        self._worker.emit({"type": "job", "job": job.to_dict()})
