"""Product data pulled out of a .knxproj and into the catalog.

The fixture project bundles one ABB device (M-0002, JRA/S4.230.2.1). Its manufacturer folder has
Hardware.xml and the application program but no Catalog.xml, which is exactly the gap the
synthesiser fills. The decisive test is the last one: the project goes through the real API, the
real importer, and the product comes back out of the real catalog with the right order number.
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from starlette.testclient import TestClient

from tests.conftest import KNXPROJ, wait_job
from xknxeditor_web.knxproj_products import (
    SECTION_SUFFIX,
    product_archives,
    synthesize_catalog,
)

NS = "http://knx.org/xml/project/20"
Q = f"{{{NS}}}"

# The exact ids the fixture's Hardware.xml declares; a wrong synthesis would break here first.
PRODUCT = "M-0002_H-2CDG.20110.20121.20R0011-1_P-2CDG.20110.20121.20R0011"
PROGRAM = "M-0002_H-2CDG.20110.20121.20R0011-1_HP-A066-14-550B"
APPLICATION = "M-0002_A-A066-14-550B"
ORDER_NUMBER = "2CDG 110 121 R0011"


def test_one_archive_per_manufacturer_with_the_importers_three_files() -> None:
    archives = product_archives(KNXPROJ)
    assert [mid for mid, _ in archives] == ["M-0002"]
    names = zipfile.ZipFile(io.BytesIO(archives[0][1])).namelist()
    # what the knxprod importer requires, plus what the project carried
    assert {"knx_master.xml", "M-0002/Hardware.xml", "M-0002/Catalog.xml"} <= set(names)
    assert f"M-0002/{APPLICATION}.xml" in names
    assert "M-0002.signature" in names


def test_synthesised_catalog_pairs_each_product_with_its_program() -> None:
    hardware = zipfile.ZipFile(KNXPROJ).read("M-0002/Hardware.xml")
    catalog = ET.fromstring(synthesize_catalog(hardware, "M-0002"))
    section = catalog.find(f".//{Q}CatalogSection")
    assert section is not None and section.get("Id") == f"M-0002{SECTION_SUFFIX}"
    items = section.findall(f"{Q}CatalogItem")
    assert len(items) == 1
    item = items[0]
    assert item.get("ProductRefId") == PRODUCT
    assert item.get("Hardware2ProgramRefId") == PROGRAM
    assert item.get("Number") == "1"  # the binding wants an integer here
    assert item.get("Name") == "JRA/S4.230.2.1 Blind/RollerShutterAct,M,4f,230V"
    assert item.get("Id").startswith(PROGRAM)


def test_a_product_without_a_program_is_still_listed() -> None:
    """A power supply has hardware and a product but no application program."""
    hardware = f"""<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="{NS}"><ManufacturerData><Manufacturer RefId="M-00FF"><Hardware>
  <Hardware Id="M-00FF_H-1" Name="PSU">
    <Products><Product Id="M-00FF_H-1_P-1" Text="Power supply 640 mA" OrderNumber="PSU-640"/></Products>
  </Hardware>
</Hardware></Manufacturer></ManufacturerData></KNX>""".encode()
    catalog = ET.fromstring(synthesize_catalog(hardware, "M-00FF"))
    items = catalog.findall(f".//{Q}CatalogItem")
    assert len(items) == 1
    assert items[0].get("ProductRefId") == "M-00FF_H-1_P-1"
    assert items[0].get("Hardware2ProgramRefId") is None


def test_project_products_land_in_the_catalog_end_to_end(client: TestClient, dirs: tuple[Path, Path]) -> None:
    """The route a legacy .vd takes: through the real API and the real importer, out of the real catalog."""
    _, share = dirs
    assert client.get("/api/catalog/products?q=2CDG").json()["count"] == 0

    r = client.post("/api/catalog/import", json={"path": str(share / KNXPROJ.name)})
    assert r.status_code == 200, r.text
    job = wait_job(client, r.json())
    assert job["status"] == "done", job
    assert job["result"]["manufacturers"] == ["M-0002"]
    assert job["result"]["applications_added"] == [APPLICATION]

    products = client.get("/api/catalog/products?q=2CDG").json()["items"]
    assert [p["order_number"] for p in products] == [ORDER_NUMBER]
    assert products[0]["application_id"] == APPLICATION

    # Doing it again is harmless: content-hash dedup, nothing new added.
    again = wait_job(client, client.post("/api/catalog/import", json={"path": str(share / KNXPROJ.name)}).json())
    assert again["status"] == "done" and again["result"]["applications_added"] == []


def test_a_protected_project_needs_no_password(tmp_path: Path) -> None:
    """Only the nested P-xxxx.zip is encrypted; the manufacturer folders are in the plain root.

    Built from the open fixture by adding the nested project part that marks an archive as
    protected, so the reader is proven to take the root entries and never open the project part.
    """
    protected = tmp_path / "protected.knxproj"
    with zipfile.ZipFile(KNXPROJ) as src, zipfile.ZipFile(protected, "w") as dst:
        for n in src.namelist():
            dst.writestr(n, src.read(n))
        dst.writestr("P-01D2.zip", b"this is not even a zip; it must never be opened")
    archives = product_archives(protected)
    assert [mid for mid, _ in archives] == ["M-0002"]
    names = zipfile.ZipFile(io.BytesIO(archives[0][1])).namelist()
    assert f"M-0002/{APPLICATION}.xml" in names and "M-0002/Catalog.xml" in names


def test_not_a_project_is_refused_plainly(tmp_path: Path) -> None:
    import pytest

    from xknxeditor_web.knxproj_products import NotAProject

    junk = tmp_path / "junk.knxproj"
    junk.write_bytes(b"PK\x03\x04 not really")
    with pytest.raises(NotAProject):
        product_archives(junk)
    no_master = tmp_path / "nomaster.knxproj"
    with zipfile.ZipFile(no_master, "w") as z:
        z.writestr("M-0002/Hardware.xml", b"<x/>")
    with pytest.raises(NotAProject, match="knx_master"):
        product_archives(no_master)


def test_upload_of_a_project_takes_the_same_route(client: TestClient, dirs: tuple[Path, Path]) -> None:
    r = client.post(
        f"/api/catalog/upload?name={KNXPROJ.name}",
        content=KNXPROJ.read_bytes(),
        headers={"content-type": "application/octet-stream"},
    )
    assert r.status_code == 200, r.text
    job = wait_job(client, r.json())
    assert job["status"] == "done", job
    assert job["result"]["applications_added"] == [APPLICATION]
