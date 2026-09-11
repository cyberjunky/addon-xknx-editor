"""Product data out of a ``.knxproj``, into the catalog.

A project archive bundles the manufacturer data of every device in it (``M-xxxx/``), and that is
the same XML a ``.knxprod`` holds, with one possible gap: a project may ship ``Hardware.xml`` and
the application programs but not ``Catalog.xml``, because a project references hardware directly
and never needs the catalog tree. The importer requires all three, so this module builds one
archive per manufacturer and synthesises a missing ``Catalog.xml``: a single section listing every
product paired with each application program its hardware declares. Nothing is invented; every id
and name comes straight out of ``Hardware.xml``.

This is the route for product data that only exists in a legacy ``.vd`` database. ETS still reads
those, but ETS 6 has no product export of its own, so the way the data comes back out is: import the
``.vd`` into ETS once, put the device in a project, export the project, and import that here.

No password is ever needed. A password-protected project encrypts only its nested ``P-xxxx.zip``;
the manufacturer folders and ``knx_master.xml`` sit in the plain root zip whether or not the project
is protected, so this reads the root zip directly and never touches the project part. An earlier
version went through ``xknxproject``'s extractor, which insists on the password to open a protected
archive at all, and would have refused product data it did not need a password for.
"""

from __future__ import annotations

import io
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

_MANUFACTURER_DIR = re.compile(r"^(M-[0-9A-Fa-f]{4})/")

SECTION_SUFFIX = "_CS-PROJECT"
SECTION_NAME = "Imported from project"
SECTION_NUMBER = "PROJECT"


class NotAProject(ValueError):
    """The file is not a readable project archive."""


def product_archives(path: Path) -> list[tuple[str, bytes]]:
    """One ``.knxprod``-shaped archive per manufacturer bundled in the project.

    Each holds ``knx_master.xml``, everything under ``M-xxxx/``, the folder's ``.signature`` when
    present, and a ``Catalog.xml`` (the project's own if it has one, else synthesised).
    """
    try:
        root = zipfile.ZipFile(path)
    except zipfile.BadZipFile as exc:
        raise NotAProject(f"{path.name} is not a zip archive") from exc
    with root:
        names = root.namelist()
        if "knx_master.xml" not in names:
            raise NotAProject(f"{path.name} has no knx_master.xml, so it is not a project archive")
        master = root.read("knx_master.xml")
        manufacturers = sorted({m.group(1) for n in names if (m := _MANUFACTURER_DIR.match(n))})
        out: list[tuple[str, bytes]] = []
        for mid in manufacturers:
            hardware_name = f"{mid}/Hardware.xml"
            if hardware_name not in names:
                continue  # not product data, whatever else the folder holds
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                z.writestr("knx_master.xml", master)
                for n in names:
                    if n.startswith(mid + "/") and not n.endswith("/"):
                        z.writestr(n, root.read(n))
                signature = f"{mid}.signature"
                if signature in names:
                    z.writestr(signature, root.read(signature))
                if f"{mid}/Catalog.xml" not in names:
                    z.writestr(f"{mid}/Catalog.xml", synthesize_catalog(root.read(hardware_name), mid))
            out.append((mid, buf.getvalue()))
    return out


def synthesize_catalog(hardware_xml: bytes, mid: str) -> bytes:
    """A ``Catalog.xml`` listing every product × application program in ``hardware_xml``.

    The catalog item ids follow the shape ETS uses (``<hardware2program>_CI-<n>``); ``Number`` is
    the running index, which the binding requires to be an integer. A product whose hardware
    declares no application program (a power supply, say) is still listed, without a program ref.
    """
    root = ET.fromstring(hardware_xml)
    ns = root.tag[1:].split("}", 1)[0] if root.tag.startswith("{") else ""

    def q(tag: str) -> str:
        return f"{{{ns}}}{tag}" if ns else tag

    ET.register_namespace("", ns)
    knx = ET.Element(q("KNX"), {"CreatedBy": "xknx-editor", "ToolVersion": "0.1.0"})
    data = ET.SubElement(knx, q("ManufacturerData"))
    manufacturer = ET.SubElement(data, q("Manufacturer"), {"RefId": mid})
    catalog = ET.SubElement(manufacturer, q("Catalog"))
    section = ET.SubElement(
        catalog,
        q("CatalogSection"),
        {"Id": f"{mid}{SECTION_SUFFIX}", "Name": SECTION_NAME, "Number": SECTION_NUMBER, "DefaultLanguage": "en-US"},
    )

    n = 0
    for hardware in root.iter(q("Hardware")):
        hardware_id = hardware.get("Id")
        if not hardware_id:
            continue  # the wrapping <Hardware> container, not a device
        products_el = hardware.find(q("Products"))
        programs_el = hardware.find(q("Hardware2Programs"))
        products = list(products_el.iter(q("Product"))) if products_el is not None else []
        programs = list(programs_el.iter(q("Hardware2Program"))) if programs_el is not None else []
        for product in products:
            product_id = product.get("Id")
            if not product_id:
                continue
            name = product.get("Text") or hardware.get("Name") or hardware_id
            language = product.get("DefaultLanguage") or "en-US"
            for program in programs or [None]:
                n += 1
                program_id = program.get("Id") if program is not None else None
                attrs = {
                    "Id": f"{program_id or product_id}_CI-{n}",
                    "Name": name,
                    "Number": str(n),
                    "ProductRefId": product_id,
                    "DefaultLanguage": language,
                }
                if program_id:
                    attrs["Hardware2ProgramRefId"] = program_id
                ET.SubElement(section, q("CatalogItem"), attrs)

    return b'<?xml version="1.0" encoding="utf-8"?>\n' + ET.tostring(knx, encoding="unicode").encode("utf-8")
