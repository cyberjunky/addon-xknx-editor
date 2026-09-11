"""WebSocket channel: revision bumps and job progress, pushed to every connected client."""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any

from starlette.websockets import WebSocket, WebSocketDisconnect

from xknxeditor_web.worker import EditorWorker


async def websocket_endpoint(websocket: WebSocket) -> None:
    worker: EditorWorker = websocket.app.state.worker
    await websocket.accept()
    queue = worker.subscribe()
    try:
        await websocket.send_json({"type": "hello", "revision": worker.revision})
        receiver = asyncio.create_task(_drain(websocket))
        try:
            while not receiver.done():
                try:
                    event: dict[str, Any] = await asyncio.wait_for(queue.get(), timeout=25)
                except TimeoutError:
                    await websocket.send_json({"type": "ping"})
                    continue
                await websocket.send_json(event)
        finally:
            receiver.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await receiver
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        worker.unsubscribe(queue)


async def _drain(websocket: WebSocket) -> None:
    """Consume client frames so disconnects are noticed; clients send nothing meaningful yet."""
    with contextlib.suppress(WebSocketDisconnect, RuntimeError):
        while True:
            await websocket.receive_text()
