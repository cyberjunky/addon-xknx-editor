"""Which product-data files the catalog accepts.

The commissioning tool offers one filter for product data, so the add-on does too. Only `.knxprod`
can be read: a `.vd_` file is a legacy database whose zip entries are ZipCrypto-encrypted around a
proprietary binary format. Picking one has to produce an explanation, not a parse failure.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from starlette.testclient import TestClient

from tests.conftest import KNXPROD
from xknxeditor_web.errors import ApiError
from xknxeditor_web.product_files import ACCEPTED_SUFFIXES, check_importable


def test_knxprod_is_accepted() -> None:
    check_importable("gira_2gang_button_interface.knxprod")
    check_importable("UPPER.KNXPROD")


@pytest.mark.parametrize("name", ["ap257_32new.vd2", "old.vd1", "x.vd5", "export.vdx"])
def test_legacy_databases_explain_themselves(name: str) -> None:
    with pytest.raises(ApiError) as excinfo:
        check_importable(name)
    message = str(excinfo.value)
    assert "legacy product database" in message
    assert ".knxprod" in message  # says what to do instead
    assert Path(name).name in message


def test_a_project_is_accepted_for_its_product_data() -> None:
    check_importable("project.knxproj")


def test_anything_else_is_rejected() -> None:
    with pytest.raises(ApiError):
        check_importable("notes.txt")


def test_the_filter_matches_what_ets_offers() -> None:
    assert ACCEPTED_SUFFIXES == {".knxprod", ".knxproj", ".vd1", ".vd2", ".vd3", ".vd4", ".vd5", ".vdx", ".vd_"}


def test_import_endpoints_refuse_a_vd_file(client: TestClient, dirs: tuple[Path, Path]) -> None:
    _, share = dirs
    legacy = share / "weather.vd2"
    legacy.write_bytes(b"PK\x03\x04not really")

    r = client.post("/api/catalog/import", json={"path": str(legacy)})
    assert r.status_code == 400, r.text
    assert "legacy product database" in r.json()["error"]

    r = client.post(
        "/api/catalog/upload?name=weather.vd2",
        content=b"PK\x03\x04not really",
        headers={"content-type": "application/octet-stream"},
    )
    assert r.status_code == 400, r.text
    assert "legacy product database" in r.json()["error"]

    # The real thing still imports.
    job = client.post("/api/catalog/import", json={"path": str(share / KNXPROD.name)})
    assert job.status_code == 200, job.text
