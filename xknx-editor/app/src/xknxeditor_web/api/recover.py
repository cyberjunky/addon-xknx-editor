"""Recover a project from the bus: scan, identify, read back, verify, apply."""

from __future__ import annotations

from typing import Any

from starlette.requests import Request
from starlette.responses import PlainTextResponse
from starlette.routing import Route

from xknxeditor_web.api import body, need, opt, route
from xknxeditor_web.recover import RecoverService


def _svc(request: Request) -> RecoverService:
    return request.app.state.recover


async def status(request: Request) -> Any:
    return _svc(request).status()


async def scan(request: Request) -> Any:
    data = await body(request)
    svc = _svc(request)
    svc.start_scan(need(data, "start"), need(data, "end"))
    return svc.status()


async def recover(request: Request) -> Any:
    svc = _svc(request)
    svc.start_recover()
    return svc.status()


async def verify(request: Request) -> Any:
    svc = _svc(request)
    svc.start_verify()
    return svc.status()


async def stop(request: Request) -> Any:
    svc = _svc(request)
    svc.stop()
    return svc.status()


async def reset(request: Request) -> Any:
    svc = _svc(request)
    svc.reset()
    return svc.status()


async def select(request: Request) -> Any:
    data = await body(request)
    svc = _svc(request)
    svc.select(need(data, "address"), bool(data.get("selected", True)))
    return svc.status()


async def reidentify(request: Request) -> Any:
    svc = _svc(request)
    await svc.editor.worker.run(svc.reidentify)
    return svc.status()


async def apply(request: Request) -> Any:
    data = await body(request)
    svc = _svc(request)
    return await svc.editor.worker.run(svc.apply, opt(data, "new_project", str))


async def snapshot(request: Request) -> Any:
    svc = _svc(request)
    return PlainTextResponse(
        svc.snapshot(), media_type="application/json", headers={"Content-Disposition": 'attachment; filename="recover-snapshot.json"'}
    )


def routes() -> list[Route]:
    return [
        route("/api/recover", status),
        route("/api/recover/scan", scan, ["POST"]),
        route("/api/recover/recover", recover, ["POST"]),
        route("/api/recover/verify", verify, ["POST"]),
        route("/api/recover/stop", stop, ["POST"]),
        route("/api/recover/reset", reset, ["POST"]),
        route("/api/recover/select", select, ["POST"]),
        route("/api/recover/reidentify", reidentify, ["POST"]),
        route("/api/recover/apply", apply, ["POST"]),
        route("/api/recover/snapshot", snapshot),
    ]
