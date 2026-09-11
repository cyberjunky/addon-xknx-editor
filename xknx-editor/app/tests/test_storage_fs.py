"""Refusing a project that lives on a network share.

Home Assistant mounts network storage under /share, and an SMB mount can accept the SQLite write
probe and still hang on the first real lock — which would freeze the single editor worker thread.
So the filesystem type decides, and the probe stays as the fallback (see storage.py).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from starlette.testclient import TestClient

from tests.conftest import KNXPROJ, wait_job
from xknxeditor_web import storage
from xknxeditor_web.storage import (
    NETWORK_FILESYSTEMS,
    filesystem_at,
    network_filesystem,
    refuse_network_location,
)

# Real /proc/self/mountinfo lines from a Home Assistant OS host with a CIFS share added under
# /share/nas, trimmed to the fields the parser reads.
MOUNTINFO = """\
24 30 0:22 / / rw,relatime shared:1 - overlay overlay rw,lowerdir=/x,upperdir=/y
31 24 0:25 / /proc rw,nosuid,nodev,noexec,relatime shared:5 - proc proc rw
44 24 8:1 /supervisor/share /share rw,relatime shared:9 - ext4 /dev/sda1 rw
58 44 0:52 / /share/nas rw,relatime shared:31 - cifs //192.0.2.9/backup rw,vers=3.1.1
61 44 0:55 / /share/nfsbox rw,relatime shared:33 - nfs4 192.0.2.9:/vol rw
"""


@pytest.fixture
def mountinfo(tmp_path: Path) -> Path:
    path = tmp_path / "mountinfo"
    path.write_text(MOUNTINFO, encoding="utf-8")
    return path


def test_longest_mount_point_wins(mountinfo: Path) -> None:
    assert filesystem_at("/share/projects/house.xknx", mountinfo) == "ext4"
    assert filesystem_at("/share/nas/house.xknx", mountinfo) == "cifs"
    assert filesystem_at("/share/nfsbox/deep/house.xknx", mountinfo) == "nfs4"
    # "/share/nascar" must not match the "/share/nas" mount point on a prefix.
    assert filesystem_at("/share/nascar/house.xknx", mountinfo) == "ext4"
    assert filesystem_at("/config/projects/house.xknx", mountinfo) == "overlay"


def test_only_network_filesystems_count(mountinfo: Path) -> None:
    assert filesystem_at("/share/projects/house.xknx", mountinfo) not in NETWORK_FILESYSTEMS
    assert filesystem_at("/share/nas/house.xknx", mountinfo) in NETWORK_FILESYSTEMS


def test_unreadable_mountinfo_is_not_a_refusal(tmp_path: Path) -> None:
    assert filesystem_at("/share/x.xknx", tmp_path / "missing") is None
    assert network_filesystem(Path("/share/x.xknx"), tmp_path / "missing") is None


def test_open_refuses_a_project_on_a_share(
    client: TestClient, dirs: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    _, share = dirs
    job = wait_job(client, client.post("/api/project/import", json={"path": str(share / KNXPROJ.name)}).json())
    assert job["status"] == "done", job
    path = client.get("/api/project/files").json()["projects"][0]
    client.post("/api/project/close")

    # Opening works while the location looks local.
    assert client.post("/api/project/open", json={"path": path}).status_code == 200
    client.post("/api/project/close")

    monkeypatch.setattr(storage, "network_filesystem", lambda _p, _m=None: "cifs")
    r = client.post("/api/project/open", json={"path": path})
    assert r.status_code == 400
    assert "network share (cifs)" in r.json()["error"]
    assert client.get("/api/project").json()["open"] is False  # nothing was opened halfway


def test_message_names_the_filesystem_and_the_way_out(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(storage, "network_filesystem", lambda _p, _m=None: "nfs4")
    message = refuse_network_location(Path("/share/nfsbox/house.xknx"), "open")
    assert message is not None
    assert "nfs4" in message and "/config" in message
    monkeypatch.setattr(storage, "network_filesystem", lambda _p, _m=None: None)
    assert refuse_network_location(Path("/config/projects/house.xknx"), "open") is None
