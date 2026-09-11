"""Document library: upload, list, tag filter, inline serving, delete."""

from __future__ import annotations

from pathlib import Path

import pytest
from starlette.testclient import TestClient

from xknxeditor_web.docs import DocStore
from xknxeditor_web.errors import ApiError


def test_store_roundtrip(tmp_path: Path) -> None:
    store = DocStore(tmp_path)
    assert store.list() == []
    doc = store.add("AP257 manual.pdf", b"%PDF-1.4 fake", tag="5WG1 257-3AB32")
    assert doc["ext"] == ".pdf" and doc["inline"] is True and doc["content_type"] == "application/pdf"
    assert store.list(tag="257-3AB32") and not store.list(tag="nope")
    path, meta = store.get(doc["id"])
    assert path.read_bytes() == b"%PDF-1.4 fake" and meta["name"] == "AP257 manual.pdf"
    store.update(doc["id"], tag="weather")
    assert store.list(tag="weather")
    store.delete(doc["id"])
    assert store.list() == [] and not path.exists()
    with pytest.raises(ApiError):
        store.add("bad.exe", b"x")
    with pytest.raises(ApiError):
        store.add("empty.pdf", b"")


def test_docs_api(client: TestClient) -> None:
    r = client.put("/api/docs", params={"name": "ap257_tpi.pdf", "tag": "5WG1 257-3AB32"}, content=b"%PDF-1.4 datasheet")
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["name"] == "ap257_tpi.pdf" and doc["tag"] == "5WG1 257-3AB32"
    listing = client.get("/api/docs").json()
    assert listing["count"] == 1
    assert client.get("/api/docs", params={"tag": "257-3AB32"}).json()["count"] == 1
    assert client.get("/api/docs", params={"tag": "gira"}).json()["count"] == 0
    raw = client.get(f"/api/docs/{doc['id']}/raw")
    assert raw.status_code == 200 and raw.headers["content-type"] == "application/pdf"
    assert raw.headers["content-disposition"].startswith("inline")
    assert raw.content == b"%PDF-1.4 datasheet"
    # a .vd2 is stored and served as a download, not inline
    vd = client.put("/api/docs", params={"name": "ap257_32.vd2"}, content=b"PK\x03\x04vd2").json()
    assert client.get(f"/api/docs/{vd['id']}/raw").headers["content-disposition"].startswith("attachment")
    client.patch(f"/api/docs/{doc['id']}", json={"tag": "renamed"})
    assert client.get("/api/docs", params={"tag": "renamed"}).json()["count"] == 1
    assert client.request("DELETE", f"/api/docs/{doc['id']}").status_code == 200
    assert client.get("/api/docs").json()["count"] == 1
    assert client.get("/api/docs/missing/raw").status_code == 404
    assert client.put("/api/docs", params={"name": "x.exe"}, content=b"z").status_code == 400
