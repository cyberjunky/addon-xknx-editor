"""Product catalog: browse and import .knxprod files."""

from __future__ import annotations

from typing import Any

from starlette.requests import Request
from starlette.routing import Route

from xknxeditor_web.api import body, need, route
from xknxeditor_web.editor import Editor
from xknxeditor_web.errors import ApiError
from xknxeditor_web.jobs import Job, JobManager
from xknxeditor_web.online_catalog import LANGUAGES, OnlineCatalogError
from xknxeditor_web.product_files import check_importable

MAX_UPLOAD = 200 * 1024 * 1024


def _ed(request: Request) -> Editor:
    return request.app.state.editor


async def summary(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(ed.catalog_summary)


async def manufacturers(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(ed.catalog_manufacturers)


async def products(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(
        ed.catalog_products, request.query_params.get("q", ""), request.query_params.get("manufacturer") or None
    )


async def import_path(request: Request) -> Any:
    """Import a .knxprod that already sits under /share or /config, as a job."""
    ed = _ed(request)
    jobs: JobManager = request.app.state.jobs
    data = await body(request)
    path = need(data, "path")
    # Answer a wrong file type straight away; inside the job it would only show up in the result.
    check_importable(path)

    def run(job: Job) -> Any:
        jobs.report(job, None, "ingesting")
        return ed.import_knxprod(path)

    return jobs.submit("import-knxprod", run, path=path).to_dict()


async def upload(request: Request) -> Any:
    """Import a .knxprod sent as the raw request body (``application/octet-stream``)."""
    ed = _ed(request)
    jobs: JobManager = request.app.state.jobs
    length = int(request.headers.get("content-length") or 0)
    if length > MAX_UPLOAD:
        raise ApiError("File too large", 413)
    content = await request.body()
    if not content:
        raise ApiError("Empty upload")
    name = request.query_params.get("name", "upload.knxprod")
    check_importable(name)

    def run(job: Job) -> Any:
        jobs.report(job, None, "ingesting")
        return ed.import_knxprod_bytes(content, name)

    return jobs.submit("import-knxprod", run, name=name, size=len(content)).to_dict()


def _language(request: Request, data: dict[str, Any] | None = None) -> str:
    lang = (data or {}).get("language") or request.query_params.get("language") or "en-US"
    if not isinstance(lang, str) or lang not in LANGUAGES:
        raise ApiError(f"language must be one of {LANGUAGES}")
    return lang


async def online_manufacturers(request: Request) -> Any:
    ed = _ed(request)
    refresh = request.query_params.get("refresh") == "1"
    try:
        return await ed.worker.run(ed.online_manufacturers, refresh)
    except OnlineCatalogError as exc:
        raise ApiError(f"Online catalog unavailable: {exc}", 502) from exc


async def online_items(request: Request) -> Any:
    ed = _ed(request)
    mid = request.query_params.get("manufacturer", "")
    if not mid.isdigit():
        raise ApiError("manufacturer (numeric id) is required")
    try:
        return await ed.worker.run(
            ed.online_items, int(mid), request.query_params.get("q", ""), request.query_params.get("refresh") == "1"
        )
    except OnlineCatalogError as exc:
        raise ApiError(f"Online catalog unavailable: {exc}", 502) from exc


async def online_index_status(request: Request) -> Any:
    ed = _ed(request)
    return await ed.worker.run(ed.online.index_status)


async def online_build_index(request: Request) -> Any:
    """Cache every manufacturer's product list so search works across brands, as a job."""
    ed = _ed(request)
    jobs: JobManager = request.app.state.jobs

    def run(job: Job) -> Any:
        def progress(done: int, total: int, name: str) -> None:
            jobs.report(job, done / total if total else None, name)

        return ed.online.build_index(progress)

    return jobs.submit("online-index", run).to_dict()


async def online_search(request: Request) -> Any:
    ed = _ed(request)
    q = request.query_params.get("q", "")
    try:
        items = await ed.worker.run(ed.online.search_all, q)
    except OnlineCatalogError as exc:
        raise ApiError(f"Online catalog unavailable: {exc}", 502) from exc
    out = [i.to_dict() for i in items]
    return {"items": out, "count": len(out)}


async def online_download(request: Request) -> Any:
    """Download the given online catalog items as one .knxprod and import it, as a job."""
    ed = _ed(request)
    jobs: JobManager = request.app.state.jobs
    data = await body(request)
    ids = data.get("ids")
    if not isinstance(ids, list) or not ids or not all(isinstance(i, str) for i in ids):
        raise ApiError("ids must be a non-empty list of catalog item ids")
    language = _language(request, data)

    def run(job: Job) -> Any:
        jobs.report(job, None, "downloading")
        return ed.online_download(ids, language)

    return jobs.submit("online-download", run, ids=ids, language=language).to_dict()


async def fetch_missing(request: Request) -> Any:
    """Resolve every project device whose application is missing via the online catalog, as a job."""
    ed = _ed(request)
    jobs: JobManager = request.app.state.jobs
    data = await body(request)
    language = _language(request, data)
    refs = data.get("refs")
    if refs is not None and (not isinstance(refs, list) or not all(isinstance(r, str) for r in refs)):
        raise ApiError("refs must be a list of program refs")

    def run(job: Job) -> Any:
        jobs.report(job, None, "matching")
        return ed.fetch_missing_products(language, refs)

    return jobs.submit("fetch-missing", run, language=language, refs=refs).to_dict()


async def missing(request: Request) -> Any:
    ed = _ed(request)
    refs = await ed.worker.run(ed.missing_program_refs)
    return {"items": refs, "count": len(refs)}


def routes() -> list[Route]:
    return [
        route("/api/catalog", summary),
        route("/api/catalog/manufacturers", manufacturers),
        route("/api/catalog/products", products),
        route("/api/catalog/import", import_path, ["POST"]),
        route("/api/catalog/upload", upload, ["PUT", "POST"]),
        route("/api/catalog/missing", missing),
        route("/api/catalog/online/manufacturers", online_manufacturers),
        route("/api/catalog/online/items", online_items),
        route("/api/catalog/online/download", online_download, ["POST"]),
        route("/api/catalog/online/index", online_index_status),
        route("/api/catalog/online/index", online_build_index, ["POST"]),
        route("/api/catalog/online/search", online_search),
        route("/api/catalog/online/fetch-missing", fetch_missing, ["POST"]),
    ]
