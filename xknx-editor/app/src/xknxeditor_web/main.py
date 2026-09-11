"""ASGI entry point: ``uvicorn xknxeditor_web.main:app``."""

from __future__ import annotations

import asyncio
import contextlib
import importlib.metadata as md
import logging
import os
import platform
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, Response
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles

from xknxeditor_web import __version__
from xknxeditor_web.api import all_routes, endpoint
from xknxeditor_web.bus import BusService
from xknxeditor_web.config import SUPERVISOR_IP, Settings
from xknxeditor_web.docs import DocStore
from xknxeditor_web.editor import Editor
from xknxeditor_web.ets_log import LogKeyStore
from xknxeditor_web.jobs import JobManager
from xknxeditor_web.recover import RecoverService
from xknxeditor_web.signing import SigningKeyStore
from xknxeditor_web.worker import EditorWorker
from xknxeditor_web.ws import websocket_endpoint

log = logging.getLogger(__name__)

PACKAGES = (
    "xknxeditor-namespaces",
    "xknxeditor-prod",
    "xknxeditor-catalog",
    "xknxeditor-proj",
    "xknxeditor-datasecure",
    "xknxeditor-download",
    "xknxeditor-recover",
    "xknxeditor-dali",
    "xknx",
    "xknxproject",
    "xknxeditor-web",
)


class IngressOnly(BaseHTTPMiddleware):
    """Accept requests only from the Supervisor's Ingress proxy unless ingress_only is off."""

    def __init__(self, app: Any, enabled: bool) -> None:
        super().__init__(app)
        self.enabled = enabled

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        client = request.client.host if request.client else ""
        path = request.url.path
        # /mcp carries its own bearer token, so LLM clients on the LAN may reach it directly.
        if self.enabled and client != SUPERVISOR_IP and path != "/health" and not path.startswith("/mcp"):
            return PlainTextResponse(
                f"Only Home Assistant Ingress may reach this add-on (request came from {client}). "
                "Set the add-on option ingress_only to false to allow direct access.",
                status_code=403,
            )
        return await call_next(request)


def _versions() -> dict[str, str]:
    out: dict[str, str] = {}
    for name in PACKAGES:
        try:
            out[name] = md.version(name)
        except md.PackageNotFoundError:
            out[name] = "not installed"
    return out


async def health(_: Request) -> Response:
    return JSONResponse({"status": "ok", "version": __version__})


async def status(request: Request) -> Any:
    settings: Settings = request.app.state.settings
    editor: Editor = request.app.state.editor
    project = await editor.worker.run(editor.info)
    try:
        catalog: dict[str, Any] = await editor.worker.run(editor.catalog_summary)
    except Exception as exc:  # noqa: BLE001 - reported, never fatal here
        catalog = {"error": f"{type(exc).__name__}: {exc}"}
    return {
        "version": __version__,
        "upstream_ref": settings.upstream_ref,
        "python": platform.python_version(),
        "machine": platform.machine(),
        "ingress_entry": settings.ingress_entry,
        "ingress_only": settings.ingress_only,
        "language": settings.language or "en-US",
        "signing": request.app.state.signing.status(),
        "ets_log_key": request.app.state.log_key.status()["present"],
        "mcp": {
            "enabled": bool(settings.mcp_token),
            "path": "/mcp",
            "port": settings.port or None,
            "tools": getattr(request.app.state, "mcp_tools", []),
        },
        "config_dir": str(settings.config_dir),
        "share_dir": str(settings.share_dir),
        "versions": _versions(),
        "project": project,
        "catalog": catalog,
        "revision": editor.worker.revision,
    }


async def _follow_project(worker: EditorWorker, bus: BusService) -> None:
    """Keep the bus decoder's DPT table in step with the project: after any revision (open,
    import, close, group-address or DPT edits) re-read the table, coalescing bursts."""
    queue = worker.subscribe()
    try:
        while True:
            event = await queue.get()
            if event.get("type") != "revision":
                continue
            await asyncio.sleep(0.3)
            while not queue.empty():  # drain a burst; one refresh covers it
                queue.get_nowait()
            with contextlib.suppress(Exception):
                await bus.refresh_dpts()
    except asyncio.CancelledError:
        pass
    finally:
        worker.unsubscribe(queue)


async def licences(_: Request) -> Any:
    from xknxeditor_web.licences import installed_licences

    return installed_licences()


def create_app(settings: Settings | None = None) -> Starlette:
    settings = settings or Settings.from_env()
    worker = EditorWorker()
    mcp: dict[str, Any] = {"server": None, "tools": []}

    @contextlib.asynccontextmanager
    async def lifespan(app: Starlette) -> AsyncIterator[None]:
        worker.start(asyncio.get_running_loop())
        async with contextlib.AsyncExitStack() as stack:
            if mcp["server"] is not None:
                await stack.enter_async_context(mcp["server"].session_manager.run())
            async with _services(app):
                yield

    @contextlib.asynccontextmanager
    async def _services(app: Starlette) -> AsyncIterator[None]:
        app.state.settings = settings
        app.state.worker = worker
        app.state.editor = await worker.run(Editor, settings, worker)
        app.state.jobs = JobManager(worker)
        app.state.bus = BusService(settings.config_dir, worker)
        editor: Editor = app.state.editor

        async def dpt_source() -> dict[str, Any]:
            return await worker.run(editor.monitor_table)

        app.state.bus.dpt_source = dpt_source
        app.state.dpt_task = asyncio.get_running_loop().create_task(_follow_project(worker, app.state.bus))
        app.state.docs = DocStore(settings.config_dir)
        app.state.log_key = LogKeyStore(settings.config_dir)
        app.state.recover = RecoverService(app.state.editor, app.state.bus)
        app.state.signing = SigningKeyStore(settings.config_dir)
        await worker.run(app.state.signing.apply_saved)
        reopened = await worker.run(app.state.editor.reopen_last)
        if reopened:
            log.info("reopened last project %s", reopened.get("name"))
            await app.state.bus.refresh_dpts()
        if app.state.bus.settings.auto_connect:
            # Opt-in only: Home Assistant's KNX integration usually owns the gateway's tunnel.
            asyncio.get_running_loop().create_task(app.state.bus.connect())
        app.state.mcp_tools = mcp["tools"]
        if mcp["server"] is not None:
            log.info("MCP server ready at /mcp with %d tools", len(mcp["tools"]))
        log.info("editor ready: config=%s share=%s", settings.config_dir, settings.share_dir)
        try:
            yield
        finally:
            app.state.dpt_task.cancel()
            with contextlib.suppress(Exception):
                await app.state.bus.shutdown()
            with contextlib.suppress(Exception):
                await worker.run(app.state.editor.close)
            worker.stop()

    static_dir = Path(os.environ.get("XKNX_STATIC_DIR", "/opt/xknx-editor/static"))
    spa_index = static_dir / "index.html"

    async def spa(_: Request) -> Response:
        return FileResponse(spa_index)

    async def no_ui(_: Request) -> Response:
        """Only reachable when the image was built without the frontend."""
        return PlainTextResponse("The XKNX Editor UI was not built into this image.", status_code=500)

    async def static_root(request: Request) -> Response:
        """Files Vite copies to the dist root (logo, favicon); assets/ has its own mount."""
        name = request.url.path.lstrip("/")
        target = static_dir / name
        if "/" in name or name.startswith(".") or not target.is_file():
            return PlainTextResponse("not found", status_code=404)
        return FileResponse(target)

    routes: list[Any] = [
        Route("/", spa if spa_index.is_file() else no_ui),
        Route("/health", health),
        Route("/api/status", endpoint(status)),
        Route("/api/licences", endpoint(licences)),
        *all_routes(),
        WebSocketRoute("/ws", websocket_endpoint),
    ]
    if static_dir.is_dir():
        # Built SPA assets (Vite output). API and WebSocket routes above take precedence.
        routes.append(Mount("/assets", app=StaticFiles(directory=static_dir / "assets"), name="assets"))
        routes.append(Route("/{name:str}.svg", static_root))
        routes.append(Route("/{name:str}.png", static_root))
        routes.append(Route("/{name:str}.ico", static_root))
    starlette = Starlette(
        routes=routes,
        middleware=[Middleware(IngressOnly, enabled=settings.ingress_only)],
        lifespan=lifespan,
    )
    if settings.mcp_token:
        try:
            from xknxeditor_web.mcp_server import build, tool_names
        except ImportError as exc:  # pragma: no cover - the SDK is part of the image
            log.warning("MCP server disabled: %s", exc)
        else:
            server, asgi = build(starlette, settings.mcp_token)
            mcp["server"] = server
            mcp["tools"] = tool_names(server)
            starlette.router.routes.append(Mount("/mcp", app=asgi, name="mcp"))
    return starlette


app = create_app()
