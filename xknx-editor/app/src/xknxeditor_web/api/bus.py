"""KNX bus: gateway discovery, connection settings, connect/disconnect, live telegrams."""

from __future__ import annotations

from typing import Any

from starlette.requests import Request
from starlette.routing import Route

from xknxeditor_web.api import body, need, query_int, route
from xknxeditor_web.bus import BusService
from xknxeditor_web.errors import ApiError


def _bus(request: Request) -> BusService:
    return request.app.state.bus


async def scan(request: Request) -> Any:
    items = await _bus(request).scan()
    return {"gateways": items, "count": len(items)}


async def status(request: Request) -> Any:
    return _bus(request).status()


async def settings(request: Request) -> Any:
    bus = _bus(request)
    data = await body(request)
    if "user_id" in data and data["user_id"] in ("", "auto", None):
        data["user_id"] = None
    elif "user_id" in data:
        try:
            data["user_id"] = int(data["user_id"])
        except (TypeError, ValueError) as exc:
            raise ApiError("user_id must be a number") from exc
    try:
        bus.update(data)
    except ValueError as exc:
        raise ApiError(str(exc)) from exc
    return bus.status()


async def connect(request: Request) -> Any:
    bus = _bus(request)
    data = await body(request)
    if data:
        try:
            bus.update(data)
        except ValueError as exc:
            raise ApiError(str(exc)) from exc
    await _sync_dpts(request)
    result = await bus.connect()
    if result["state"] != "CONNECTED":
        raise ApiError(result.get("error") or "Connection failed", 502)
    return result


async def programming_mode(request: Request) -> Any:
    """Individual addresses of the devices currently in programming mode."""
    from xknxeditor_web.programming import programming_mode_devices

    bus = _bus(request)
    x = getattr(bus, "_xknx", None)
    if x is None:
        raise ApiError("Not connected to the bus", 409)
    try:
        items = await programming_mode_devices(x)
    except Exception as exc:  # noqa: BLE001
        raise ApiError(f"Read failed: {type(exc).__name__}: {exc}", 502) from exc
    return {"items": items, "count": len(items)}


async def disconnect(request: Request) -> Any:
    return await _bus(request).disconnect()


async def telegrams(request: Request) -> Any:
    bus = _bus(request)
    items = bus.telegrams(query_int(request, "since", 0), query_int(request, "limit", 500))
    names = await _ga_names(request)
    for t in items:
        info = names.get(t["destination"]) if t["destination_kind"] == "group" else None
        t["destination_name"] = info[0] if info else ""
        t["destination_dpt"] = info[1] if info else None
    return {"items": items, "count": len(items)}


async def clear(request: Request) -> Any:
    _bus(request).clear()


async def group_read(request: Request) -> Any:
    data = await body(request)
    try:
        await _bus(request).group_read(need(data, "address"))
    except RuntimeError as exc:
        raise ApiError(str(exc), 409) from exc
    return {"status": "queued"}


async def group_write(request: Request) -> Any:
    data = await body(request)
    address = need(data, "address")
    if "raw" in data:
        raw = data["raw"]
        if isinstance(raw, int):
            payload: Any = raw
            small = raw <= 63
        elif isinstance(raw, str):
            payload = bytes.fromhex(raw.replace(" ", ""))
            small = False
        else:
            raise ApiError("raw must be an int (6-bit value) or a hex string")
    else:
        raise ApiError("Provide raw (int for 1-6 bit values, or hex string for byte payloads)")
    try:
        await _bus(request).group_write_raw(address, payload, small)
    except (RuntimeError, ValueError) as exc:
        raise ApiError(str(exc), 409) from exc
    return {"status": "queued"}


async def _ga_names(request: Request) -> dict[str, tuple[str, str | None]]:
    editor = request.app.state.editor
    cache = request.app.state.__dict__.setdefault("_ga_name_cache", {"rev": -1, "names": {}})
    if cache["rev"] != editor.worker.revision:
        cache["rev"] = editor.worker.revision
        names: dict[str, tuple[str, str | None]] = {}
        if editor.pid is not None:
            gas = await editor.worker.run(editor.group_addresses)
            names = {g["text"]: (g["name"], g["datapoint_type"]) for g in gas["items"]}
        cache["names"] = names
    return cache["names"]


async def _sync_dpts(request: Request) -> None:
    await sync_dpts(request.app.state.editor, _bus(request))


async def sync_dpts(editor: Any, bus: Any) -> None:
    """Hand the open project's names and DPTs to the bus service for telegram decoding."""
    bus.apply_table(await editor.worker.run(editor.monitor_table))


async def keyring_upload(request: Request) -> Any:
    """Store a .knxkeys sent as the raw body under /config/keyrings and select it."""
    bus = _bus(request)
    settings = request.app.state.settings
    content = await request.body()
    if not content or len(content) > 5 * 1024 * 1024:
        raise ApiError("Upload a .knxkeys file (empty or too large)")
    if b"<Keyring" not in content[:4096]:
        raise ApiError("This is not a KNX keyring (.knxkeys) file")
    name = request.query_params.get("name", "project.knxkeys")
    safe = "".join(c for c in name if c.isalnum() or c in "._- ").strip() or "project.knxkeys"
    if not safe.lower().endswith(".knxkeys"):
        safe += ".knxkeys"
    folder = settings.config_dir / "keyrings"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / safe
    path.write_bytes(content)
    bus.update({"keyring_path": str(path)})
    return bus.status()


async def keyring_check(request: Request) -> Any:
    bus = _bus(request)
    data = await body(request)
    pw = data.get("password")
    if pw in ("***", ""):
        pw = None  # use the stored password
    if "keyring_path" in data:
        bus.update({"keyring_path": str(data["keyring_path"])})
    return await bus.keyring_summary(pw if isinstance(pw, str) else None)


def routes() -> list[Route]:
    return [
        route("/api/bus", status),
        route("/api/bus/settings", settings, ["POST"]),
        route("/api/bus/keyring", keyring_upload, ["PUT", "POST"]),
        route("/api/bus/keyring/check", keyring_check, ["POST"]),
        route("/api/bus/scan", scan, ["POST", "GET"]),
        route("/api/bus/connect", connect, ["POST"]),
        route("/api/bus/disconnect", disconnect, ["POST"]),
        route("/api/bus/programming-mode", programming_mode),
        route("/api/bus/telegrams", telegrams),
        route("/api/bus/telegrams/clear", clear, ["POST"]),
        route("/api/bus/read", group_read, ["POST"]),
        route("/api/bus/write", group_write, ["POST"]),
    ]
