"""The editor thread.

The upstream services wrap SQLAlchemy sessions and per-device evaluators that are not thread-safe,
so every call into them runs on one dedicated thread. Request handlers submit a callable and await
the result; the thread also owns the revision counter and pushes events (revision bumps, job
progress) to WebSocket subscribers through the asyncio loop.
"""

from __future__ import annotations

import asyncio
import functools
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from typing import Any


class EditorWorker:
    def __init__(self) -> None:
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="editor")
        self._loop: asyncio.AbstractEventLoop | None = None
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._revision = 0
        self._lock = threading.Lock()

    # --- lifecycle ---------------------------------------------------------

    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def stop(self) -> None:
        self._pool.shutdown(wait=True, cancel_futures=True)

    # --- calls ------------------------------------------------------------

    async def run[T](self, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        """Run ``fn(*args, **kwargs)`` on the editor thread and return its result."""
        loop = self._loop or asyncio.get_running_loop()
        return await loop.run_in_executor(self._pool, functools.partial(fn, *args, **kwargs))

    def run_blocking[T](self, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T:
        """Run ``fn`` on the editor thread from a non-async context (tests, jobs)."""
        return self._pool.submit(fn, *args, **kwargs).result()

    # --- revision + events -----------------------------------------------

    @property
    def revision(self) -> int:
        return self._revision

    def bump(self, **detail: Any) -> int:
        """Advance the project revision and notify subscribers. Thread-safe."""
        with self._lock:
            self._revision += 1
            rev = self._revision
        self.emit({"type": "revision", "revision": rev, **detail})
        return rev

    def emit(self, event: dict[str, Any]) -> None:
        """Deliver an event to every WebSocket subscriber. Safe from any thread."""
        loop = self._loop
        if loop is None:
            return

        def _deliver() -> None:
            for queue in list(self._subscribers):
                queue.put_nowait(event)

        try:
            loop.call_soon_threadsafe(_deliver)
        except RuntimeError:
            pass  # loop closed during shutdown

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=1000)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers.discard(queue)
