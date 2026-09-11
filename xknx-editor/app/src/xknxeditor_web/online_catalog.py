"""Client for the anonymous KNX online catalog (onlinecatalog.knx.org).

Plain HTTP, no login:
- ``GET  /Download/Manufacturers``           XML list of ``<unsignedShort>`` manufacturer ids
- ``GET  /Download/Index/{manufacturer_id}`` JSON ``IndexFileData`` with an ``Entries`` array
- ``POST /Download/DownloadProduct``         ``{"CatalogIds": [...], "LanguageIds": [...]}`` → .knxprod

Manufacturer names come from the public master data file. Per-manufacturer indexes are cached
on disk (JSON with a fetch time) so browsing and "fetch missing" do not hit the network twice.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

BASE_URL = "https://onlinecatalog.knx.org"
MASTER_DATA_URL = "https://update.knx.org/data/XML/project-23/knx_master.xml"
TIMEOUT = 30.0
INDEX_TTL = 24 * 3600
LANGUAGES = ["en-US", "en-GB", "de-DE", "nl-NL", "fr-FR", "it-IT", "es-ES", "pl-PL"]


class OnlineCatalogError(Exception):
    pass


@dataclass(frozen=True)
class Manufacturer:
    id: int
    name: str


@dataclass(frozen=True)
class Item:
    id: str
    name: str
    order_number: str
    downloadable: bool
    manufacturer_id: int
    application_version: int | None
    application_program_name: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "xknx-editor-addon"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise OnlineCatalogError(f"{url}: {getattr(exc, 'reason', exc)}") from exc


# What the catalog service answers with a 400 and a JSON body ``{"Id": "<code>", ...}``.
_SERVER_CODES = {
    "NotInAnyMarket": (
        "the KNX online catalog does not offer this product for download (the manufacturer has not "
        "published it in any market); get the .knxprod from the manufacturer's website and import it "
        "with Upload .knxprod"
    ),
    "NotDownloadable": "the KNX online catalog marks this product as not downloadable",
    "NotFound": "the KNX online catalog does not know this catalog item",
}


def describe_server_error(status: int, reason: str, body: bytes) -> str:
    """Turn the service's ``400 {"Id": "NotInAnyMarket", ...}`` into a sentence a user can act on."""
    try:
        data = json.loads(body.decode("utf-8", "replace"))
    except ValueError:
        data = None
    code = data.get("Id") if isinstance(data, dict) else None
    if isinstance(code, str) and code in _SERVER_CODES:
        return _SERVER_CODES[code]
    if isinstance(code, str):
        return f"the KNX online catalog refused the download ({code})"
    return f"{status} {reason}"


def _post(url: str, body: bytes) -> bytes:
    req = urllib.request.Request(
        url, data=body, method="POST", headers={"Content-Type": "application/json", "User-Agent": "xknx-editor-addon"}
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT * 4) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        raise OnlineCatalogError(describe_server_error(exc.code, exc.reason, exc.read())) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise OnlineCatalogError(f"{url}: {getattr(exc, 'reason', exc)}") from exc


def _local(tag: object) -> str:
    return str(tag).rsplit("}", 1)[-1]


def parse_manufacturer_ids(xml_bytes: bytes) -> list[int]:
    root = ET.fromstring(xml_bytes)
    ids = [int(e.text) for e in root if _local(e.tag) == "unsignedShort" and (e.text or "").strip()]
    if not ids:
        raise OnlineCatalogError("manufacturer list is empty")
    return sorted(ids)


def parse_manufacturer_names(xml_bytes: bytes) -> dict[int, str]:
    names: dict[int, str] = {}
    for el in ET.fromstring(xml_bytes).iter():
        if _local(el.tag) != "Manufacturer":
            continue
        mid = el.get("KnxManufacturerId") or (el.get("Id") or "").removeprefix("M-")
        if mid.isdigit():
            names[int(mid)] = el.get("Name") or f"M-{int(mid):04d}"
    return names


def _ci(d: dict[str, Any], key: str) -> Any:
    for k, v in d.items():
        if k.lower() == key.lower():
            return v
    return None


def _app_version(ident: Any) -> int | None:
    if isinstance(ident, list) and ident and isinstance(ident[-1], int):
        return ident[-1]
    if isinstance(ident, str):
        parts = ident.split("-")
        if len(parts) >= 4:
            try:
                return int(parts[3], 16)
            except ValueError:
                return None
    return None


def parse_index(raw: bytes) -> list[Item]:
    try:
        data = json.loads(raw)
    except ValueError as exc:
        raise OnlineCatalogError(f"index is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise OnlineCatalogError("index has an unexpected shape")
    mid_raw = _ci(data, "ManufacturerId")
    mid = int(mid_raw) if isinstance(mid_raw, int) or (isinstance(mid_raw, str) and mid_raw.isdigit()) else 0
    items: list[Item] = []
    for entry in _ci(data, "Entries") or []:
        if not isinstance(entry, dict):
            continue
        cid = _ci(entry, "Id")
        if not isinstance(cid, str) or not cid:
            continue
        items.append(
            Item(
                id=cid,
                name=str(_ci(entry, "CatalogItemName") or _ci(entry, "ProductName") or cid),
                order_number=str(_ci(entry, "OrderNumber") or ""),
                downloadable=not (
                    bool(_ci(entry, "NoDownloadWithoutPlugin"))
                    or bool(_ci(entry, "DownloadInfoIncomplete"))
                    or bool(_ci(entry, "RequiresExternalSoftware"))
                ),
                manufacturer_id=mid,
                application_version=_app_version(_ci(entry, "ApplicationIdentifier")),
                application_program_name=str(_ci(entry, "ApplicationProgramName") or ""),
            )
        )
    items.sort(key=lambda i: i.name.lower())
    return items


def manufacturer_id_of(ref: str) -> int | None:
    """``M-0083_H-…`` → 131. The four hex digits after ``M-`` are the KNX manufacturer id."""
    try:
        return int(ref[2:6], 16) if ref.startswith("M-") else None
    except ValueError:
        return None


class OnlineCatalog:
    def __init__(self, cache_dir: Path, base_url: str = BASE_URL) -> None:
        self.cache_dir = cache_dir
        self.base_url = base_url
        cache_dir.mkdir(parents=True, exist_ok=True)
        self._manufacturers: list[Manufacturer] | None = None
        self._indexes: dict[int, list[Item]] = {}

    # --- manufacturers ------------------------------------------------------

    def manufacturers(self, refresh: bool = False) -> list[Manufacturer]:
        path = self.cache_dir / "online_manufacturers.json"
        if not refresh:
            if self._manufacturers is not None:
                return self._manufacturers
            if path.is_file():
                data = json.loads(path.read_text(encoding="utf-8"))
                self._manufacturers = [Manufacturer(int(d["id"]), str(d["name"])) for d in data]
                return self._manufacturers
        ids = parse_manufacturer_ids(_get(f"{self.base_url}/Download/Manufacturers"))
        try:
            names = parse_manufacturer_names(_get(MASTER_DATA_URL))
        except OnlineCatalogError:
            names = {}
        self._manufacturers = [Manufacturer(i, names.get(i, f"M-{i:04X}")) for i in ids]
        path.write_text(json.dumps([asdict(m) for m in self._manufacturers]), encoding="utf-8")
        return self._manufacturers

    # --- per-manufacturer index --------------------------------------------

    def items(self, manufacturer_id: int, refresh: bool = False) -> list[Item]:
        path = self.cache_dir / f"online_index_{manufacturer_id}.json"
        if not refresh:
            cached = self._indexes.get(manufacturer_id)
            if cached is not None:
                return cached
            if path.is_file() and time.time() - path.stat().st_mtime < INDEX_TTL:
                data = json.loads(path.read_text(encoding="utf-8"))
                self._indexes[manufacturer_id] = [Item(**d) for d in data]
                return self._indexes[manufacturer_id]
        items = parse_index(_get(f"{self.base_url}/Download/Index/{manufacturer_id}"))
        self._indexes[manufacturer_id] = items
        path.write_text(json.dumps([i.to_dict() for i in items]), encoding="utf-8")
        return items

    def search(self, manufacturer_id: int, query: str) -> list[Item]:
        q = query.strip().lower()
        items = self.items(manufacturer_id)
        if not q:
            return items
        return [i for i in items if q in f"{i.name} {i.order_number} {i.application_program_name}".lower()]

    # --- full index (every manufacturer, cached on disk) ------------------------

    def cached_manufacturer_ids(self) -> list[int]:
        out: list[int] = []
        for p in self.cache_dir.glob("online_index_*.json"):
            digits = p.stem.removeprefix("online_index_")
            if digits.isdigit():
                out.append(int(digits))
        return sorted(out)

    def index_status(self) -> dict[str, Any]:
        cached = self.cached_manufacturer_ids()
        products = 0
        for mid in cached:
            try:
                products += len(self.items(mid))
            except OnlineCatalogError:
                continue
        total = len(self._manufacturers) if self._manufacturers else None
        return {"cached_manufacturers": len(cached), "total_manufacturers": total, "products": products}

    def build_index(self, progress: Any = None) -> dict[str, Any]:
        """Fetch the index of every manufacturer not yet cached. Resumable; failures are skipped and
        retried on the next build. ``progress(done, total, name)`` is called per manufacturer."""
        manufacturers = self.manufacturers()
        cached = set(self.cached_manufacturer_ids())
        failed: list[int] = []
        total = len(manufacturers)
        for done, m in enumerate(manufacturers, start=1):
            if m.id not in cached:
                try:
                    self.items(m.id, refresh=True)
                except OnlineCatalogError:
                    failed.append(m.id)
            if progress is not None:
                progress(done, total, m.name)
        status = self.index_status()
        status["failed"] = failed
        return status

    def search_all(self, query: str, limit: int = 300) -> list[Item]:
        """Search every cached manufacturer index (name, order number, application name)."""
        q = query.strip().lower()
        if not q:
            return []
        words = q.split()
        out: list[Item] = []
        try:
            names = {m.id: m.name.lower() for m in self.manufacturers()}
        except OnlineCatalogError:
            names = {}
        for mid in self.cached_manufacturer_ids():
            mname = names.get(mid, "")
            try:
                items = self.items(mid)
            except OnlineCatalogError:
                continue
            for i in items:
                hay = f"{mname} {i.name} {i.order_number} {i.application_program_name}".lower()
                if all(w in hay for w in words):
                    out.append(i)
                    if len(out) >= limit:
                        return out
        return out

    # --- downloads ----------------------------------------------------------

    def download(self, catalog_item_ids: list[str], language: str = "en-US") -> bytes:
        if not catalog_item_ids:
            raise OnlineCatalogError("no catalog items given")
        body = json.dumps({"CatalogIds": catalog_item_ids, "LanguageIds": [language]}).encode("utf-8")
        data = _post(f"{self.base_url}/Download/DownloadProduct", body)
        if not data:
            raise OnlineCatalogError("empty download")
        return data

    def match_refs(self, refs: list[str]) -> tuple[list[str], list[str]]:
        """Map hardware-program refs to catalog item ids (the ref is a prefix of the item id).

        Returns ``(item_ids, unmatched_refs)``."""
        by_mfr: dict[int, list[str]] = {}
        unmatched: list[str] = []
        for ref in refs:
            mid = manufacturer_id_of(ref)
            if mid is None:
                unmatched.append(ref)
            else:
                by_mfr.setdefault(mid, []).append(ref)
        ids: list[str] = []
        for mid, mrefs in by_mfr.items():
            try:
                items = self.items(mid)
            except OnlineCatalogError:
                unmatched.extend(mrefs)
                continue
            for ref in mrefs:
                match = next((i for i in items if i.id.startswith(ref)), None)
                if match is None:
                    unmatched.append(ref)
                elif match.id not in ids:
                    ids.append(match.id)
        return ids, unmatched
