"""A location SQLite cannot use (a network share) must answer 400 with the reason, not 500.

`.xknx` projects are live SQLite databases, so they need file locking and journal sidecars that
SMB/NFS mounts do not provide. /share in Home Assistant is often exactly such a mount, and both
"open a project from /share" and "save a copy to /share" hit it. Upstream added
:func:`ensure_sqlite_writable` / :class:`ProjectStorageError` for this (xknx-editor v0.1.1); these
tests cover the add-on's own mapping of that error onto the API.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from starlette.testclient import TestClient

from tests.conftest import KNXPROJ, wait_job
from xknxeditor.proj import ProjectStorageError, ensure_sqlite_writable
from xknxeditor_web import editor as editor_mod

MESSAGE = "Cannot open the project database /share/x.xknx. This is usually a network drive"


def test_probe_accepts_a_normal_directory(tmp_path: Path) -> None:
    ensure_sqlite_writable(tmp_path / "project.xknx")
    # The probe cleans up after itself; a leftover would end up in the user's project list.
    assert list(tmp_path.iterdir()) == []


def test_probe_rejects_a_directory_that_cannot_hold_a_database(tmp_path: Path) -> None:
    blocker = tmp_path / "not-a-directory"
    blocker.write_text("", encoding="utf-8")
    with pytest.raises(ProjectStorageError):
        ensure_sqlite_writable(blocker / "sub" / "project.xknx")


def test_open_reports_an_unusable_location(
    client: TestClient, dirs: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    _, share = dirs
    job = wait_job(client, client.post("/api/project/import", json={"path": str(share / KNXPROJ.name)}).json())
    assert job["status"] == "done", job
    path = client.get("/api/project/files").json()["projects"][0]
    client.post("/api/project/close")

    def boom(*args: object, **kwargs: object) -> None:
        raise ProjectStorageError(MESSAGE)

    monkeypatch.setattr(editor_mod.ProjectService, "open", boom)
    r = client.post("/api/project/open", json={"path": path})
    assert r.status_code == 400
    assert "network drive" in r.json()["error"]


def test_save_copy_reports_an_unusable_destination(
    client: TestClient, dirs: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    _, share = dirs
    job = wait_job(client, client.post("/api/project/import", json={"path": str(share / KNXPROJ.name)}).json())
    assert job["status"] == "done", job

    def boom(_path: Path) -> None:
        raise ProjectStorageError(MESSAGE)

    monkeypatch.setattr(editor_mod, "ensure_sqlite_writable", boom)
    r = client.post("/api/project/save-copy", json={"path": str(share / "copy.xknx")})
    assert r.status_code == 400
    assert "network drive" in r.json()["error"]
    assert not (share / "copy.xknx").exists()  # nothing half-written left behind
