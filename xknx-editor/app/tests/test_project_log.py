"""Importing the plaintext project log that ETS decrypted, and merging it into the project detail."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from tests.conftest import KNXPROJ, wait_job
from xknxeditor_web.errors import ApiError
from xknxeditor_web.project_log import ProjectLogStore, merge


def test_store_and_merge(tmp_path: Path) -> None:
    store = ProjectLogStore(tmp_path)
    assert store.summary("P-1") is None and store.texts("P-1") == {}
    payload = {
        "source": "huisje.knxproj",
        "exported": "2026-09-07T10:00:00",
        "items": [
            {"date": "2026-03-01T12:30:05", "user": "Ron", "comment": "Keuken actor toegevoegd"},
            {"date": "2026-04-02T08:00:00", "user": "Ron", "comment": ""},  # dropped: no text
            "junk",  # dropped: not an object
        ],
    }
    result = store.store("P-1", payload)
    assert result["stored"] == 1 and result["count"] == 1 and result["source"] == "huisje.knxproj"

    traces = [
        {"date": "2026-03-01T12:30:59", "user": "ron", "comment": "AAAA", "encrypted": True},
        {"date": "2026-09-09T09:00:00", "user": "Someone", "comment": "BBBB", "encrypted": True},
    ]
    # matched on the minute and case-insensitively on the user
    assert merge(traces, store.texts("P-1")) == 1
    assert traces[0]["comment"] == "Keuken actor toegevoegd" and traces[0]["encrypted"] is False
    assert traces[0]["from_import"] is True and traces[1]["comment"] == "BBBB"

    store.clear("P-1")
    assert store.summary("P-1") is None
    with pytest.raises(ApiError):
        store.store("P-1", {"items": []})
    with pytest.raises(ApiError):
        store.store("P-1", {"items": [{"date": "x", "user": "y"}]})


def test_import_api(client: TestClient, dirs: tuple[Path, Path]) -> None:
    config, share = dirs
    job = wait_job(client, client.post("/api/project/import", json={"path": str(share / KNXPROJ.name)}).json())
    assert job["status"] == "done", job
    detail = client.get("/api/project/detail").json()
    assert detail["log_import"] is None
    traces = detail.get("traces") or []

    # Build an import that matches the first trace, whatever the fixture contains.
    if traces:
        first = traces[0]
        items = [{"date": first["date"], "user": first["user"], "comment": "Decrypted by ETS"}]
    else:
        items = [{"date": "2026-01-01T00:00:00", "user": "nobody", "comment": "Decrypted by ETS"}]
    log = share / "project-log.json"
    log.write_text(json.dumps({"source": "test.knxproj", "items": items}), encoding="utf-8")

    r = client.post("/api/project/log/import", json={"path": str(log)})
    assert r.status_code == 200, r.text
    assert r.json()["stored"] == 1

    detail = client.get("/api/project/detail").json()
    assert detail["log_import"]["count"] == 1 and detail["log_import"]["source"] == "test.knxproj"
    if traces:
        assert detail["log_matched"] == 1
        assert detail["traces"][0]["comment"] == "Decrypted by ETS"
        assert detail["traces"][0]["encrypted"] is False

    # the sidecar lives under /config and never touches the project file
    assert list((config / "project_logs").glob("*.json"))
    assert client.request("DELETE", "/api/project/log").status_code == 200
    assert client.get("/api/project/detail").json()["log_import"] is None

    # a file without items is refused with a helpful message
    bad = share / "bad.json"
    bad.write_text(json.dumps({"nope": 1}), encoding="utf-8")
    r = client.post("/api/project/log/import", json={"path": str(bad)})
    assert r.status_code == 400 and "items" in r.json()["error"]

    # PowerShell writes UTF-8 with a BOM; the import must accept that too.
    bom = share / "with-bom.json"
    bom.write_text(json.dumps({"source": "ps.knxproj", "items": items}), encoding="utf-8-sig")
    assert client.post("/api/project/log/import", json={"path": str(bom)}).json()["stored"] == 1


def test_export_encrypted_entries(client: TestClient, dirs: tuple[Path, Path]) -> None:
    _, share = dirs
    job = wait_job(client, client.post("/api/project/import", json={"path": str(share / KNXPROJ.name)}).json())
    assert job["status"] == "done", job
    r = client.get("/api/project/log/export")
    assert r.status_code == 200
    assert r.headers["content-disposition"].startswith("attachment")
    data = r.json()
    assert "items" in data and data["count"] == len(data["items"])
    detail = client.get("/api/project/detail").json()
    assert data["count"] == len(detail.get("traces") or [])
    for item in data["items"]:
        assert set(item) == {"date", "user", "comment"}
