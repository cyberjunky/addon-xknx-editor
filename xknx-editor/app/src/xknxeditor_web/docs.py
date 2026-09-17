"""A small document library: upload manuals, datasheets and drawings for devices and open them
later from the add-on. Files live under ``/config/docs`` with a JSON index; nothing here parses a
file, it only stores and serves it (PDFs and images open inline in the browser).
"""

from __future__ import annotations

import json
import re
import time
import uuid
from pathlib import Path
from typing import Any

from xknxeditor_web.errors import ApiError, NotFound

# Extensions we accept and the content type we serve them with (inline where a browser can show it).
CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".zip": "application/zip",
    ".vd1": "application/octet-stream",
    ".vd2": "application/octet-stream",
    ".vd3": "application/octet-stream",
    ".vd4": "application/octet-stream",
    ".vd5": "application/octet-stream",
    ".knxprod": "application/octet-stream",
}
INLINE = {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".txt", ".md", ".csv"}
IMAGES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}
MAX_BYTES = 50 * 1024 * 1024
_SAFE = re.compile(r"[^A-Za-z0-9._ ()\-]+")


class DocStore:
    def __init__(self, config_dir: Path) -> None:
        self.dir = config_dir / "docs"
        self.index_path = self.dir / "index.json"

    def pictures(self) -> dict[str, str]:
        """``tag key -> document id`` of the picture for each tag (an order number, usually): the
        image marked as the picture, else the newest image with that tag."""
        out: dict[str, str] = {}
        marked: set[str] = set()
        for d in self.list():  # newest first
            if d.get("ext") not in IMAGES or not d.get("tag"):
                continue
            key = tag_key(d["tag"])
            if d.get("picture") and key not in marked:
                out[key] = d["id"]
                marked.add(key)
            elif key not in out:
                out[key] = d["id"]
        return out

    def _load(self) -> dict[str, dict[str, Any]]:
        try:
            data = json.loads(self.index_path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save(self, index: dict[str, dict[str, Any]]) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        self.index_path.write_text(json.dumps(index, indent=1), encoding="utf-8")

    def list(self, tag: str | None = None) -> list[dict[str, Any]]:
        items = [{"id": doc_id, **meta} for doc_id, meta in self._load().items() if self._file(doc_id, meta).is_file()]
        if tag:
            needle = tag.strip().lower()
            items = [d for d in items if needle and needle in (d.get("tag") or "").lower()]
        items.sort(key=lambda d: (d.get("uploaded", ""), d.get("uploaded_ns", 0)), reverse=True)
        return items

    def _file(self, doc_id: str, meta: dict[str, Any]) -> Path:
        return self.dir / f"{doc_id}{meta.get('ext', '')}"

    def add(self, filename: str, content: bytes, tag: str = "", note: str = "", picture: bool = False) -> dict[str, Any]:
        if not content:
            raise ApiError("Empty upload")
        if len(content) > MAX_BYTES:
            raise ApiError(f"File too large (limit {MAX_BYTES // (1024 * 1024)} MB)", 413)
        name = _SAFE.sub("_", Path(filename).name).strip() or "document"
        ext = Path(name).suffix.lower()
        if ext not in CONTENT_TYPES:
            raise ApiError(f"Unsupported file type {ext or '(none)'}; allowed: {', '.join(sorted(CONTENT_TYPES))}")
        doc_id = uuid.uuid4().hex
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / f"{doc_id}{ext}").write_bytes(content)
        index = self._load()
        index[doc_id] = {
            "name": name,
            "ext": ext,
            "size": len(content),
            "content_type": CONTENT_TYPES[ext],
            "inline": ext in INLINE,
            "tag": tag.strip(),
            "note": note.strip(),
            "uploaded": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "uploaded_ns": time.time_ns(),  # orders uploads within the same second
            "picture": bool(picture) and ext in IMAGES,
        }
        self._save(index)
        return {"id": doc_id, **index[doc_id]}

    def get(self, doc_id: str) -> tuple[Path, dict[str, Any]]:
        meta = self._load().get(doc_id)
        if meta is None:
            raise NotFound(f"No document {doc_id}")
        path = self._file(doc_id, meta)
        if not path.is_file():
            raise NotFound(f"Document {doc_id} file is missing")
        return path, meta

    def update(
        self, doc_id: str, tag: str | None = None, note: str | None = None, name: str | None = None, picture: bool | None = None
    ) -> dict[str, Any]:
        index = self._load()
        meta = index.get(doc_id)
        if meta is None:
            raise NotFound(f"No document {doc_id}")
        if picture is not None:
            if picture and meta.get("ext") not in IMAGES:
                raise ApiError("Only an image can be a device picture")
            if picture:
                # One picture per tag: the others with the same tag stop being it.
                key = tag_key(meta.get("tag") or "")
                for other in index.values():
                    if other is not meta and tag_key(other.get("tag") or "") == key:
                        other["picture"] = False
            meta["picture"] = bool(picture)
        if tag is not None:
            meta["tag"] = tag.strip()
        if note is not None:
            meta["note"] = note.strip()
        if name is not None and name.strip():
            new = _SAFE.sub("_", Path(name).name).strip()
            if Path(new).suffix.lower() != meta["ext"]:
                new += meta["ext"]
            meta["name"] = new
        self._save(index)
        return {"id": doc_id, **meta}

    def delete(self, doc_id: str) -> None:
        index = self._load()
        meta = index.pop(doc_id, None)
        if meta is None:
            raise NotFound(f"No document {doc_id}")
        self._file(doc_id, meta).unlink(missing_ok=True)
        self._save(index)


def tag_key(tag: str) -> str:
    """Order numbers are written with and without spaces or hyphens ("5WG1 257-3AB32"); compare a
    squeezed, lower-case form."""
    return re.sub(r"[\s\-_/.]+", "", tag or "").lower()
