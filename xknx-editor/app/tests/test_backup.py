"""Back up the non-project state on one add-on, restore it on a fresh one.

The decisive test seeds a real catalog import, a document, both keys and a settings file through
the real API, writes the archive to /share, then stands up a second add-on with empty directories
and restores into it. What comes back is checked through that second add-on's API, not by peeking
at files, so the whole chain is exercised: archive, manifest, re-import, and the stores reading
what was put back.
"""

from __future__ import annotations

import base64
import json
import shutil
import zipfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from tests.conftest import KNXPROD, wait_job
from xknxeditor_web.backup import CATEGORIES, FORMAT, read_manifest
from xknxeditor_web.config import Settings
from xknxeditor_web.errors import ApiError
from xknxeditor_web.main import create_app

LOG_KEY = base64.b64encode(bytes(range(32))).decode()
LOG_IV = base64.b64encode(bytes(range(16))).decode()


def _signing_text() -> str:
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=1024)
    nums = key.private_numbers()
    b64 = lambda v: base64.b64encode(v.to_bytes((v.bit_length() + 7) // 8, "big")).decode()  # noqa: E731
    return f"MOD={b64(nums.public_numbers.n)}\nEXP={b64(nums.public_numbers.e)}\nD={b64(nums.d)}\n"


@pytest.fixture
def fresh(tmp_path: Path) -> Iterator[tuple[TestClient, Path, Path]]:
    """A second add-on with its own empty /config and /share."""
    config = tmp_path / "config2"
    share = tmp_path / "share2"
    config.mkdir()
    share.mkdir()
    settings = Settings(config_dir=config, share_dir=share, ingress_only=False, ingress_entry="", upstream_ref="t", language=None)
    with TestClient(create_app(settings)) as c:
        yield c, config, share


def _seed(client: TestClient, config: Path, share: Path) -> None:
    job = wait_job(client, client.post("/api/catalog/import", json={"path": str(share / KNXPROD.name)}).json())
    assert job["status"] == "done", job
    assert client.put("/api/docs", params={"name": "manual.pdf", "tag": "5192 00"}, content=b"%PDF-1.4 manual").status_code == 200
    assert client.post("/api/signing-key", json={"text": _signing_text()}).status_code == 200
    assert client.post("/api/ets-log-key", json={"text": f"key={LOG_KEY}\niv={LOG_IV}"}).status_code == 200
    (config / "settings.json").write_text(json.dumps({"gateway_ip": "192.0.2.7", "keyring_path": ""}), encoding="utf-8")
    (config / "project_logs").mkdir()
    (config / "project_logs" / "abc.json").write_text('{"entries": []}', encoding="utf-8")


def test_backup_then_restore_on_a_fresh_addon(
    client: TestClient, dirs: tuple[Path, Path], fresh: tuple[TestClient, Path, Path]
) -> None:
    config, share = dirs
    _seed(client, config, share)
    assert client.get("/api/catalog").json()["products"] == 1

    job = wait_job(client, client.post("/api/backup", json={}).json())
    assert job["status"] == "done", job
    result = job["result"]
    archive = Path(result["path"])
    assert archive.parent == share / "xknx-editor-backups" and archive.suffix == ".zip"
    assert result["counts"] == {"catalog": 1, "docs": 2, "settings": 1, "keys": 2, "logs": 1, "telegrams": 0}  # docs = file + index

    manifest = read_manifest(archive)
    assert manifest["format"] == FORMAT and manifest["categories"] == list(CATEGORIES)
    names = zipfile.ZipFile(archive).namelist()
    assert any(n.startswith("catalog/knxprod/") and n.endswith(".knxprod") for n in names)
    assert "keys/signing_key.json" in names and "keys/ets_log_key.json" in names

    # The archive can be fetched by the browser and inspected before restoring.
    r = client.get("/api/backup/download", params={"path": str(archive)})
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/zip")
    assert client.get("/api/backup/inspect", params={"path": str(archive)}).json()["counts"]["catalog"] == 1

    # A fresh add-on with nothing in it. The signing key is deliberately checked on disk here, not
    # through status: the vendored signer keeps its key as module-global state, so two add-ons in
    # one test process share it and the first one's POST above already set it. One add-on per
    # process in production, so that never bites a user; the log key store reads from disk per
    # app and can be asked directly.
    client2, config2, share2 = fresh
    assert client2.get("/api/catalog").json()["products"] == 0
    assert not (config2 / "signing_key.json").exists()
    assert client2.get("/api/ets-log-key").json()["present"] is False
    assert client2.get("/api/docs").json()["count"] == 0

    copied = share2 / archive.name
    shutil.copy(archive, copied)
    job2 = wait_job(client2, client2.post("/api/backup/restore", json={"path": str(copied)}).json())
    assert job2["status"] == "done", job2
    assert job2["result"]["counts"] == {"catalog": 1, "docs": 2, "settings": 1, "keys": 2, "logs": 1, "telegrams": 0}

    # Everything is back, seen through the second add-on's own API.
    assert client2.get("/api/catalog").json()["products"] == 1
    assert client2.get("/api/catalog/products").json()["items"][0]["order_number"]
    assert client2.get("/api/signing-key").json()["placeholder"] is False
    assert client2.get("/api/ets-log-key").json()["present"] is True
    docs = client2.get("/api/docs").json()
    assert docs["count"] == 1 and docs["items"][0]["tag"] == "5192 00"
    assert json.loads((config2 / "settings.json").read_text(encoding="utf-8"))["gateway_ip"] == "192.0.2.7"
    assert (config2 / "project_logs" / "abc.json").is_file()


def test_categories_are_honoured_and_restore_never_deletes(
    client: TestClient, dirs: tuple[Path, Path], fresh: tuple[TestClient, Path, Path]
) -> None:
    config, share = dirs
    _seed(client, config, share)
    job = wait_job(client, client.post("/api/backup", json={"include": ["catalog", "docs"]}).json())
    assert job["status"] == "done", job
    assert job["result"]["categories"] == ["catalog", "docs"]
    names = zipfile.ZipFile(job["result"]["path"]).namelist()
    assert not any(n.startswith("keys/") or n.startswith("settings/") for n in names)

    client2, config2, share2 = fresh
    # Something already on the target must survive a restore.
    (config2 / "docs").mkdir()
    (config2 / "docs" / "keep-me.txt").write_text("mine", encoding="utf-8")
    copied = share2 / "b.zip"
    shutil.copy(job["result"]["path"], copied)
    job2 = wait_job(client2, client2.post("/api/backup/restore", json={"path": str(copied), "include": ["docs"]}).json())
    assert job2["status"] == "done", job2
    assert job2["result"]["counts"] == {"docs": 2}
    assert (config2 / "docs" / "keep-me.txt").read_text(encoding="utf-8") == "mine"
    assert client2.get("/api/catalog").json()["products"] == 0  # catalog not asked for


def test_bad_archives_are_refused_plainly(client: TestClient, dirs: tuple[Path, Path], tmp_path: Path) -> None:
    _, share = dirs
    junk = share / "junk.zip"
    junk.write_bytes(b"not a zip")
    with pytest.raises(ApiError, match="not a zip"):
        read_manifest(junk)
    no_manifest = share / "plain.zip"
    with zipfile.ZipFile(no_manifest, "w") as z:
        z.writestr("hello.txt", "hi")
    with pytest.raises(ApiError, match="no manifest"):
        read_manifest(no_manifest)
    wrong = share / "future.zip"
    with zipfile.ZipFile(wrong, "w") as z:
        z.writestr("manifest.json", json.dumps({"format": FORMAT + 1}))
    with pytest.raises(ApiError, match="format"):
        read_manifest(wrong)
    assert client.post("/api/backup", json={"include": ["nonsense"]}).status_code in (200, 400)
    job = client.post("/api/backup/restore", json={"path": str(junk)}).json()
    assert wait_job(client, job)["status"] == "failed"
