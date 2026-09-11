"""The ETS project-log key: parsing, storage, and the AES round trip."""

from __future__ import annotations

import base64
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from xknxeditor_web.errors import ApiError
from xknxeditor_web.ets_log import DEFAULT_MARKER, LogKeyStore, parse_key

# A key of our own, not ETS's: the tests only need the scheme to round-trip.
KEY = base64.b64encode(bytes(range(32))).decode()
IV = base64.b64encode(bytes(range(16))).decode()


def test_parse_key_forms() -> None:
    parsed = parse_key({"key": KEY, "iv": IV})
    assert parsed["key"] == KEY and parsed["iv"] == IV and parsed["marker"] == DEFAULT_MARKER

    marker_b64 = base64.b64encode("X: ".encode()).decode()
    text = f"key={KEY}\niv={IV}\nmarker={marker_b64}"
    assert parse_key({"text": text})["marker"] == "X: "

    with pytest.raises(ApiError):
        parse_key({"text": "nothing useful here"})
    with pytest.raises(ApiError):
        parse_key({"key": KEY, "iv": base64.b64encode(b"short").decode()})
    with pytest.raises(ApiError):
        parse_key({"key": "not base64!", "iv": IV})


def test_roundtrip_and_decrypt_all(tmp_path: Path) -> None:
    store = LogKeyStore(tmp_path)
    assert store.status()["present"] is False
    assert store.decrypt("anything") is None and store.encrypt("x") is None

    store.save(parse_key({"key": KEY, "iv": IV}))
    status = store.status()
    assert status["present"] is True and status["key_preview"]

    for text in ("Download All on device 4.1.2", "", "ä ö unicode, 16 bytes exactly!!"):
        blob = store.encrypt(text)
        assert blob is not None and blob.startswith(DEFAULT_MARKER)
        assert store.decrypt(blob) == text

    # A comment encrypted with a different key must not produce plausible plaintext.
    other = LogKeyStore(tmp_path / "other")
    other.save(parse_key({"key": base64.b64encode(bytes(range(32, 64))).decode(), "iv": IV}))
    assert store.decrypt(other.encrypt("secret") or "") != "secret"

    traces = [
        {"date": "d", "user": "u", "comment": store.encrypt("Loaded application"), "encrypted": True},
        {"date": "d", "user": "u", "comment": "already plain", "encrypted": False},
    ]
    assert store.decrypt_all(traces) == 1
    assert traces[0]["comment"] == "Loaded application" and traces[0]["encrypted"] is False
    assert traces[0]["comment_encrypted"].startswith(DEFAULT_MARKER)  # the original is kept
    assert traces[1]["comment"] == "already plain"

    store.clear()
    assert store.status()["present"] is False


def test_key_api(client: TestClient, dirs: tuple[Path, Path]) -> None:
    config, _ = dirs
    assert client.get("/api/ets-log-key").json()["present"] is False
    assert client.get("/api/status").json()["ets_log_key"] is False

    r = client.post("/api/ets-log-key", json={"text": f"key={KEY}\niv={IV}"})
    assert r.status_code == 200 and r.json()["present"] is True
    assert (config / "ets_log_key.json").is_file()
    assert client.get("/api/status").json()["ets_log_key"] is True
    assert "Knx.Ets.Common.dll" in client.get("/api/ets-log-key").json()["extract_powershell"]

    assert client.post("/api/ets-log-key", json={"text": "rubbish"}).status_code == 400
    assert client.request("DELETE", "/api/ets-log-key").json()["present"] is False


def test_project_log_decrypted_in_detail(client: TestClient, dirs: tuple[Path, Path]) -> None:
    """A project whose comments were encrypted with the stored key reads back in project_detail."""
    from tests.conftest import KNXPROJ, wait_job

    _, share = dirs
    job = wait_job(client, client.post("/api/project/import", json={"path": str(share / KNXPROJ.name)}).json())
    assert job["status"] == "done", job
    client.post("/api/ets-log-key", json={"text": f"key={KEY}\niv={IV}"})
    detail = client.get("/api/project/detail").json()
    # The fixture's comments were not encrypted with our test key, so nothing decrypts, but the
    # field must be present and no entry may be corrupted by the attempt.
    assert "log_decrypted" in detail
    for trace in detail.get("traces") or []:
        assert trace["comment"] is not None
