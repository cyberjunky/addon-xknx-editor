"""A failing job must report why. `ApiError` is used by name in both submit paths, so it has to be
imported there: without it the handler itself raised NameError and the job showed "failed" with an
empty message (0.2.1)."""

from __future__ import annotations

import asyncio

from xknxeditor_web.errors import ApiError
from xknxeditor_web.jobs import JobManager
from xknxeditor_web.worker import EditorWorker


def test_failed_jobs_carry_their_message() -> None:
    async def run() -> None:
        worker = EditorWorker()
        worker.start(asyncio.get_running_loop())
        jobs = JobManager(worker)
        try:
            job = jobs.submit("boom", lambda _job: (_ for _ in ()).throw(ApiError("the device refused")))
            for _ in range(200):
                if job.status in ("done", "failed"):
                    break
                await asyncio.sleep(0.01)
            assert job.status == "failed" and job.error == "the device refused"
            assert job.detail["traceback"]

            async def other(_job: object) -> None:
                raise ValueError("not an ApiError")

            job2 = jobs.submit_async("boom", other)
            for _ in range(200):
                if job2.status in ("done", "failed"):
                    break
                await asyncio.sleep(0.01)
            assert job2.status == "failed" and job2.error == "ValueError: not an ApiError"
        finally:
            worker.stop()

    asyncio.run(run())
