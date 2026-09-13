"""KNX bus: gateway discovery, connection settings, connect/disconnect, live telegrams, and the
recorded archive behind the Archive view, the charts and the statistics."""

from __future__ import annotations

import asyncio
import time
from typing import Any

from starlette.requests import Request
from starlette.responses import StreamingResponse
from starlette.routing import Route

from xknxeditor_web.api import body, need, query_int, route
from xknxeditor_web.bus import BusService
from xknxeditor_web.errors import ApiError
from xknxeditor_web.recorder import TelegramRecorder, parse_ga


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
    # The gateway hands out the tunnel's individual address. If a device in the project holds it,
    # every point-to-point exchange is at risk, so say it now rather than at the first download.
    own = result.get("own_address") or ""
    ed = request.app.state.editor
    clash = await ed.worker.run(ed.device_on_address, own) if own else ""
    if clash:
        result["address_warning"] = (
            f"The gateway gave this editor the address {own}, which {clash} in this project also "
            f"uses. Programming and reading devices will fail until the editor gets a free address "
            f"(Gateway settings -> Own individual address)."
        )
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


# --- recorded archive ---------------------------------------------------------------------------


def _recorder(request: Request) -> TelegramRecorder:
    rec = getattr(request.app.state, "recorder", None)
    if rec is None:
        raise ApiError("Telegram recording is not available", 503)
    return rec


def _query_float(request: Request, key: str) -> float | None:
    raw = request.query_params.get(key)
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except ValueError as exc:
        raise ApiError(f"Query parameter '{key}' must be a number (seconds since the epoch)") from exc


def _range(request: Request, default_seconds: float) -> tuple[float, float]:
    until = _query_float(request, "to")
    since = _query_float(request, "from")
    if until is None:
        until = time.time()
    if since is None:
        since = until - default_seconds
    if since > until:
        raise ApiError("'from' must be before 'to'")
    return since, until


async def _archive_filters(request: Request) -> dict[str, Any]:
    """The query string as recorder filters; a name search is turned into the matching addresses."""
    p = request.query_params
    filters: dict[str, Any] = {
        "since": _query_float(request, "from"),
        "until": _query_float(request, "to"),
        "source": p.get("source") or None,
        "kind": p.get("kind") or None,
        "q": (p.get("q") or "").strip() or None,
    }
    ga = (p.get("ga") or "").strip()
    if ga.endswith("/"):
        filters["ga_prefix"] = ga
    elif ga:
        value = parse_ga(ga)
        if value is None:
            raise ApiError(f"Not a group address: {ga}")
        filters["ga"] = value
    if filters["q"]:
        needle = filters["q"].lower()
        names = await _ga_names(request)
        matches = [parse_ga(text) for text, (name, _dpt) in names.items() if needle in (name or "").lower()]
        filters["ga_in"] = [m for m in matches if m is not None][:500]
    dpt = (p.get("dpt") or "").strip()
    if dpt:
        names = await _ga_names(request)
        matches = [parse_ga(text) for text, (_name, d) in names.items() if _dpt_matches(dpt, d)]
        filters["ga_any"] = [m for m in matches if m is not None][:2000]
    return filters


def _dpt_short(dpt: str) -> str:
    """``DPST-9-1`` → ``9.001``, ``DPT-9`` → ``9.xxx``."""
    parts = dpt.split("-")
    if parts[0] == "DPST" and len(parts) == 3:
        return f"{parts[1]}.{int(parts[2]):03d}" if parts[2].isdigit() else dpt
    if parts[0] == "DPT" and len(parts) == 2:
        return f"{parts[1]}.xxx"
    return dpt


def _dpt_matches(wanted: str, dpt: str | None) -> bool:
    """The same rule as the live monitor's DPT filter: ``9`` or ``9.`` is the main type, ``9.001``
    (or ``DPST-9-1``) the exact sub-type."""
    if not dpt:
        return False
    w = wanted.strip().lower()
    short = _dpt_short(dpt).lower()
    main = short.split(".")[0]
    if w.startswith("dpst-") or w.startswith("dpt-"):
        w = _dpt_short(w.upper()).lower()
    if w.isdigit():
        return main == w
    if w.endswith(".") and w[:-1].isdigit():
        return main == w[:-1]
    m = w.split(".")
    if len(m) == 2 and m[0].isdigit() and m[1].isdigit():
        return short == f"{m[0]}.{int(m[1]):03d}"
    return short.startswith(w)


async def _with_names(request: Request, items: list[dict[str, Any]]) -> None:
    names = await _ga_names(request)
    for t in items:
        info = names.get(t["destination"]) if t["destination_kind"] == "group" else None
        t["destination_name"] = info[0] if info else ""
        t["destination_dpt"] = info[1] if info else None


async def archive(request: Request) -> Any:
    rec = _recorder(request)
    filters = await _archive_filters(request)
    cursor = query_int(request, "cursor", 0) or None
    limit = query_int(request, "limit", 200)
    result = await asyncio.to_thread(rec.archive, cursor=cursor, limit=limit, **filters)
    await _with_names(request, result["items"])
    return result


async def archive_csv(request: Request) -> Any:
    rec = _recorder(request)
    filters = await _archive_filters(request)
    names = await _ga_names(request)
    by_value = {v: name for text, (name, _dpt) in names.items() if (v := parse_ga(text)) is not None}
    stamp = time.strftime("%Y%m%d-%H%M%S")
    return StreamingResponse(
        rec.csv_rows(by_value, **filters),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="telegrams-{stamp}.csv"'},
    )


async def archive_clear(request: Request) -> Any:
    await asyncio.to_thread(_recorder(request).clear)
    return _recorder(request).summary()


async def archive_summary(request: Request) -> Any:
    return await asyncio.to_thread(_recorder(request).summary)


async def series(request: Request) -> Any:
    rec = _recorder(request)
    text = (request.query_params.get("ga") or "").strip()
    ga = parse_ga(text) if text else None
    if ga is None:
        raise ApiError(f"Not a group address: {text or '(empty)'}")
    since, until = _range(request, 24 * 3600)
    points = query_int(request, "points", 600)
    result = await asyncio.to_thread(rec.series, ga, since, until, points)
    names = await _ga_names(request)
    info = names.get(text)
    result["destination"] = text
    result["name"] = info[0] if info else ""
    result["dpt"] = info[1] if info else None
    return result


async def stats(request: Request) -> Any:
    rec = _recorder(request)
    since, until = _range(request, 7 * 24 * 3600)
    text = (request.query_params.get("ga") or "").strip()
    ga = None
    if text:
        ga = parse_ga(text)
        if ga is None:
            raise ApiError(f"Not a group address: {text}")
    result = await asyncio.to_thread(rec.stats, since, until, ga)
    names = await _ga_names(request)
    for row in result["top_addresses"]:
        info = names.get(row["destination"])
        row["name"] = info[0] if info else ""
    result["availability"] = await asyncio.to_thread(rec.availability, since, until)
    return result


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
        route("/api/bus/archive", archive),
        route("/api/bus/archive.csv", archive_csv),
        route("/api/bus/archive/summary", archive_summary),
        route("/api/bus/archive/clear", archive_clear, ["POST"]),
        route("/api/bus/series", series),
        route("/api/bus/stats", stats),
        route("/api/bus/read", group_read, ["POST"]),
        route("/api/bus/write", group_write, ["POST"]),
    ]
