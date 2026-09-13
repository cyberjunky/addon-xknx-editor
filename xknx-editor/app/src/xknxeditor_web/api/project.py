"""Project lifecycle, topology, history."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from starlette.requests import Request
from starlette.routing import Route

from xknxeditor_web.api import body, need, opt, query_int, route
from xknxeditor_web.editor import Editor
from xknxeditor_web.errors import ApiError
from xknxeditor_web.jobs import Job, JobManager


def _ed(request: Request) -> Editor:
    return request.app.state.editor


async def info(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(ed.info)


async def files(request: Request) -> Any:
    ed = _ed(request)
    listing = await ed.worker.run(ed.files, (".xknx", ".knxproj", ".knxprod", ".knxkeys"))
    return {
        "projects": [f for f in listing if f.endswith(".xknx")],
        "knxproj": [f for f in listing if f.endswith(".knxproj")],
        "knxprod": [f for f in listing if f.endswith(".knxprod")],
        "keyrings": [f for f in listing if f.endswith(".knxkeys")],
    }


async def open_project(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    return await ed.worker.run(ed.open, need(data, "path"))


async def new_project(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    return await ed.worker.run(ed.create, need(data, "name"), opt(data, "style", str, "ThreeLevel"))


async def save_copy(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    return await ed.worker.run(ed.save_copy, need(data, "path"), bool(data.get("overwrite", False)))


async def export_project(request: Request) -> Any:
    """Queue a .knxproj export (bundling manufacturer data takes a while); returns the job."""
    ed = _ed(request)
    jobs: JobManager = request.app.state.jobs
    data = await body(request)
    path = need(data, "path")
    schema = str(data.get("schema") or "20")
    overwrite = bool(data.get("overwrite", False))

    def run(job: Job) -> Any:
        jobs.report(job, None, "bundling manufacturer data")
        return ed.export_knxproj(path, schema, overwrite)

    return jobs.submit("export-knxproj", run, path=path, schema=schema).to_dict()


async def recent(request: Request) -> Any:
    ed = _ed(request)
    items = await ed.worker.run(ed.recent_projects)
    return {"items": items, "count": len(items)}


async def forget_recent(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    items = await ed.worker.run(ed.forget_recent, opt(data, "path", str))
    return {"items": items, "count": len(items)}


async def export_log(request: Request) -> Any:
    """The encrypted log entries as a JSON download, to be decrypted on the Windows PC that wrote them."""
    import json

    from starlette.responses import Response

    ed = _ed(request)
    data = await ed.worker.run(ed.export_project_log)
    data.pop("_keys", None)
    body_text = json.dumps(data, indent=1, ensure_ascii=True)  # escapes survive PowerShell's encoding guess
    return Response(
        body_text,
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="project-log-encrypted.json"'},
    )


async def import_log(request: Request) -> Any:
    """Take the JSON produced by tools/decrypt-ets-log.ps1 (raw body or {path: ...} under /share)."""
    ed = _ed(request)
    raw = await request.body()
    if raw:
        import json

        try:
            # PowerShell's Set-Content -Encoding UTF8 writes a BOM; utf-8-sig eats it either way.
            payload = json.loads(raw.decode("utf-8-sig"))
        except (ValueError, UnicodeDecodeError) as exc:
            raise ApiError(f"Not valid JSON: {exc}") from exc
        if not isinstance(payload, dict):
            raise ApiError("The file must be a JSON object with an 'items' list")
        if "path" in payload and "items" not in payload:
            path = await ed.worker.run(ed._safe_path, str(payload["path"]))  # noqa: SLF001
            try:
                payload = json.loads(Path(path).read_text(encoding="utf-8-sig"))
            except (OSError, ValueError) as exc:
                raise ApiError(f"Cannot read {path}: {exc}") from exc
    else:
        raise ApiError("Empty upload")
    return await ed.worker.run(ed.import_project_log, payload)


async def clear_log(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(ed.clear_project_log)


async def close_project(request: Request) -> Any:
    ed = _ed(request)
    await ed.worker.run(ed.close)
    return await ed.worker.run(ed.info)


async def import_project(request: Request) -> Any:
    """Queue a .knxproj import; returns the job. Poll /api/jobs/{id} or watch the WebSocket."""
    ed = _ed(request)
    jobs: JobManager = request.app.state.jobs
    data = await body(request)
    path = need(data, "path")
    password = opt(data, "password", str)

    def run(job: Job) -> Any:
        jobs.report(job, None, "parsing")
        return ed.import_knxproj(path, password)

    return jobs.submit("import-knxproj", run, path=path).to_dict()


MAX_PROJECT_UPLOAD = 200 * 1024 * 1024


async def upload_project(request: Request) -> Any:
    """Receive a .knxproj from the browser (raw body) into /config/imports and hand back the path
    the import route takes, so the password step and the job stay the same as for a file on /share."""
    settings = request.app.state.settings
    length = int(request.headers.get("content-length") or 0)
    if length > MAX_PROJECT_UPLOAD:
        raise ApiError("File too large", 413)
    content = await request.body()
    if not content:
        raise ApiError("Empty upload")
    name = request.query_params.get("name", "project.knxproj")
    safe = "".join(c for c in Path(name).name if c.isalnum() or c in "._- ").strip() or "project.knxproj"
    if not safe.lower().endswith(".knxproj"):
        raise ApiError("Pick a .knxproj export")
    if not content.startswith(b"PK"):
        raise ApiError("This is not a .knxproj file (not a zip archive)")
    folder = settings.config_dir / "imports"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / safe
    path.write_bytes(content)
    return {"path": str(path), "name": safe, "bytes": len(content)}


async def topology(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(ed.topology, query_int(request, "installation", 0))


async def devices(request: Request) -> Any:
    ed = _ed(request)
    items = await ed.worker.run(ed.devices)
    return {"items": items, "count": len(items)}


async def undo(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(ed.undo)


async def redo(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(ed.redo)


async def history(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(ed.history)


async def create_area(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    area_id = await ed.worker.run(
        ed.create_area, opt(data, "installation", int, 0), need(data, "address", int), opt(data, "name", str, "")
    )
    return {"id": area_id}


async def patch_area(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    await ed.worker.run(ed.rename_area, request.path_params["id"], need(data, "name"))


async def delete_area(request: Request) -> Any:
    ed = _ed(request)
    await ed.worker.run(ed.remove_area, request.path_params["id"])


async def create_line(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    line_id = await ed.worker.run(
        ed.create_line, need(data, "area_id", int), need(data, "address", int), opt(data, "name", str, "")
    )
    return {"id": line_id}


async def patch_line(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    await ed.worker.run(ed.rename_line, request.path_params["id"], need(data, "name"))


async def delete_line(request: Request) -> Any:
    ed = _ed(request)
    await ed.worker.run(ed.remove_line, request.path_params["id"])


async def health(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(ed.health)


async def detail(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(ed.project_detail)


async def decrypt_traces(request: Request) -> Any:
    ed = _ed(request)
    data = await body(request)
    s = request.app.state.bus.settings
    keyring = {"keyring_path": s.keyring_path, "keyring_password": s.keyring_password}
    from xknxeditor.proj.core.knxproj_signing import current_signing_key, signing_key_is_placeholder

    signing = None if signing_key_is_placeholder() else current_signing_key()
    return await ed.worker.run(ed.decrypt_traces, str(data.get("password") or ""), keyring, signing)


async def network(request: Request) -> Any:
    """Devices ↔ group addresses graph for the Network view."""
    ed = request.app.state.editor
    return await ed.worker.run(ed.network)


def routes() -> list[Route]:
    return [
        route("/api/project", info),
        route("/api/project/detail", detail),
        route("/api/project/traces/decrypt", decrypt_traces, ["POST"]),
        route("/api/project/health", health),
        route("/api/project/files", files),
        route("/api/project/open", open_project, ["POST"]),
        route("/api/project/new", new_project, ["POST"]),
        route("/api/project/close", close_project, ["POST"]),
        route("/api/project/save-copy", save_copy, ["POST"]),
        route("/api/project/log/export", export_log),
        route("/api/project/log/import", import_log, ["PUT", "POST"]),
        route("/api/project/log", clear_log, ["DELETE"]),
        route("/api/project/recent", recent),
        route("/api/project/recent/forget", forget_recent, ["POST"]),
        route("/api/project/export", export_project, ["POST"]),
        route("/api/project/import", import_project, ["POST"]),
        route("/api/project/upload", upload_project, ["PUT", "POST"]),
        route("/api/project/topology", topology),
        route("/api/project/devices", devices),
        route("/api/project/network", network),
        route("/api/project/undo", undo, ["POST"]),
        route("/api/project/redo", redo, ["POST"]),
        route("/api/project/history", history),
        route("/api/project/areas", create_area, ["POST"]),
        route("/api/project/areas/{id:int}", patch_area, ["PATCH"]),
        route("/api/project/areas/{id:int}", delete_area, ["DELETE"]),
        route("/api/project/lines", create_line, ["POST"]),
        route("/api/project/lines/{id:int}", patch_line, ["PATCH"]),
        route("/api/project/lines/{id:int}", delete_line, ["DELETE"]),
    ]
