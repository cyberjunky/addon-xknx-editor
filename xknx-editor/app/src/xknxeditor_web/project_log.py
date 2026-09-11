"""Plaintext project log, imported from elsewhere.

Every ``ProjectTrace`` comment is encrypted with AES-256-CBC under a key held by the tool
itself; the add-on deliberately does not carry that key. The documented workflow
asks the user's own commissioning tool to decrypt their own log and writes a JSON file, which is
imported here and kept as a sidecar under ``/config/project_logs``. The project document itself is
never modified, so an export still carries exactly what was written.

Entries are matched to the project's traces by date and user name, both of which are stored in the
clear.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from xknxeditor_web.errors import ApiError

_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def _key(date: str, user: str) -> str:
    """Match on the minute: seconds are written, and a hand-edited export may round them."""
    return f"{(date or '').strip()[:16]}|{(user or '').strip().lower()}"


class ProjectLogStore:
    def __init__(self, config_dir: Path) -> None:
        self.dir = config_dir / "project_logs"

    def _path(self, project_id: str) -> Path:
        return self.dir / f"{_SAFE.sub('_', project_id) or 'project'}.json"

    def load(self, project_id: str) -> dict[str, Any]:
        try:
            data = json.loads(self._path(project_id).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def texts(self, project_id: str) -> dict[str, str]:
        """``{date|user: comment}`` for the stored plaintext of this project."""
        data = self.load(project_id)
        items = data.get("items") if isinstance(data.get("items"), list) else []
        out: dict[str, str] = {}
        for item in items:
            if isinstance(item, dict) and item.get("comment"):
                out[_key(str(item.get("date", "")), str(item.get("user", "")))] = str(item["comment"])
        return out

    def summary(self, project_id: str) -> dict[str, Any] | None:
        data = self.load(project_id)
        if not data:
            return None
        return {
            "source": data.get("source", ""),
            "exported": data.get("exported", ""),
            "count": len(data.get("items") or []),
            "imported": data.get("imported", ""),
        }

    def store(self, project_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Take the JSON written by ``tools/decrypt-ets-log.ps1`` (or any ``{items:[...]}``)."""
        import time

        items = payload.get("items")
        if not isinstance(items, list) or not items:
            raise ApiError("The file has no 'items' list; use tools/decrypt-ets-log.ps1 to produce it")
        clean: list[dict[str, str]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            comment = str(item.get("comment") or "")
            if not comment:
                continue
            clean.append({"date": str(item.get("date") or ""), "user": str(item.get("user") or ""), "comment": comment})
        if not clean:
            raise ApiError("No usable entries in the file (each needs date, user and comment)")
        data = {
            "source": str(payload.get("source") or ""),
            "exported": str(payload.get("exported") or ""),
            "imported": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "items": clean,
        }
        self.dir.mkdir(parents=True, exist_ok=True)
        self._path(project_id).write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
        return {"stored": len(clean), **self.summary(project_id)}  # type: ignore[dict-item]

    def clear(self, project_id: str) -> None:
        self._path(project_id).unlink(missing_ok=True)


def merge(traces: list[dict[str, Any]], texts: dict[str, str]) -> int:
    """Replace encrypted comments with the imported plaintext in place; returns how many matched."""
    matched = 0
    for trace in traces:
        plain = texts.get(_key(str(trace.get("date", "")), str(trace.get("user", ""))))
        if plain:
            trace["comment"] = plain
            trace["encrypted"] = False
            trace["from_import"] = True
            matched += 1
    return matched
