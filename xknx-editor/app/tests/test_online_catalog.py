"""Online catalog parsing and ref matching, without network."""

from __future__ import annotations

import pytest

import json
from pathlib import Path

from xknxeditor_web import online_catalog as oc

MANUFACTURERS_XML = b"""<?xml version="1.0"?>
<ArrayOfUnsignedShort xmlns="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
  <unsignedShort>8</unsignedShort><unsignedShort>131</unsignedShort>
</ArrayOfUnsignedShort>"""

MASTER_XML = b"""<KNX xmlns="http://knx.org/xml/project/23"><MasterData><Manufacturers>
  <Manufacturer Id="M-0008" KnxManufacturerId="8" Name="GIRA Giersiepen"/>
  <Manufacturer Id="M-0083" KnxManufacturerId="131" Name="MDT technologies"/>
</Manufacturers></MasterData></KNX>"""

INDEX = {
    "ManufacturerId": 8,
    "Entries": [
        {
            "Id": "M-0008_H-ISSDAIKX03.2E1-1-O007C_HP-0004-11-2E3F_CI-1",
            "CatalogItemName": "Gira S1",
            "OrderNumber": "2089 00",
            "ApplicationIdentifier": [0, 8, 0, 4, 17],
            "ApplicationProgramName": "KIM Remote Access",
        },
        {"Id": "M-0008_H-X_HP-0001-01-AAAA_CI-1", "ProductName": "Locked", "NoDownloadWithoutPlugin": True},
    ],
}


def test_parse_manufacturers_and_names() -> None:
    assert oc.parse_manufacturer_ids(MANUFACTURERS_XML) == [8, 131]
    assert oc.parse_manufacturer_names(MASTER_XML) == {8: "GIRA Giersiepen", 131: "MDT technologies"}


def test_parse_index() -> None:
    items = oc.parse_index(json.dumps(INDEX).encode())
    assert [i.name for i in items] == ["Gira S1", "Locked"]
    s1 = items[0]
    assert s1.manufacturer_id == 8 and s1.order_number == "2089 00" and s1.application_version == 17
    assert s1.downloadable is True and items[1].downloadable is False


def test_manufacturer_id_of_ref() -> None:
    assert oc.manufacturer_id_of("M-0008_H-ISSDAIKX03.2E1-1-O007C_HP-0004-11-2E3F") == 8
    assert oc.manufacturer_id_of("M-0083_H-1_HP-1") == 131
    assert oc.manufacturer_id_of("garbage") is None


def test_match_refs_uses_cached_index(tmp_path: Path, monkeypatch) -> None:
    cat = oc.OnlineCatalog(tmp_path)
    (tmp_path / "online_index_8.json").write_text(json.dumps([i.to_dict() for i in oc.parse_index(json.dumps(INDEX).encode())]))
    def offline(url: str) -> bytes:
        raise oc.OnlineCatalogError(f"offline: {url}")

    monkeypatch.setattr(oc, "_get", offline)
    ids, unmatched = cat.match_refs(["M-0008_H-ISSDAIKX03.2E1-1-O007C_HP-0004-11-2E3F", "M-0008_H-NOPE_HP-9", "M-0083_H-1_HP-1"])
    assert ids == ["M-0008_H-ISSDAIKX03.2E1-1-O007C_HP-0004-11-2E3F_CI-1"]
    assert "M-0008_H-NOPE_HP-9" in unmatched and "M-0083_H-1_HP-1" in unmatched


def test_search_all_and_index_status(tmp_path: Path, monkeypatch) -> None:
    cat = oc.OnlineCatalog(tmp_path)
    (tmp_path / "online_index_8.json").write_text(json.dumps([i.to_dict() for i in oc.parse_index(json.dumps(INDEX).encode())]))
    (tmp_path / "online_manufacturers.json").write_text(json.dumps([{"id": 8, "name": "GIRA Giersiepen"}]))
    monkeypatch.setattr(oc, "_get", lambda url: (_ for _ in ()).throw(oc.OnlineCatalogError("offline")))
    hits = cat.search_all("gira s1")
    assert [h.name for h in hits] == ["Gira S1"]
    assert cat.search_all("2089") and not cat.search_all("nonexistent thing")
    status = cat.index_status()
    assert status["cached_manufacturers"] == 1 and status["products"] == 2


def test_download_refusal_is_explained(monkeypatch) -> None:
    import io
    import urllib.error

    from xknxeditor_web import online_catalog as oc

    def refuse(req, timeout=0):  # noqa: ARG001
        raise urllib.error.HTTPError(
            req.full_url, 400, "Bad Request", {}, io.BytesIO(b'{"CatalogItemIds":["M-0001_X"],"Id":"NotInAnyMarket"}')
        )

    monkeypatch.setattr(oc.urllib.request, "urlopen", refuse)
    with pytest.raises(oc.OnlineCatalogError) as info:
        oc._post("https://onlinecatalog.knx.org/Download/DownloadProduct", b"{}")  # noqa: SLF001
    assert "not offer this product" in str(info.value) and "Upload .knxprod" in str(info.value)
    assert oc.describe_server_error(400, "Bad Request", b"not json") == "400 Bad Request"
    assert "Weird" in oc.describe_server_error(400, "Bad Request", b'{"Id":"Weird"}')
