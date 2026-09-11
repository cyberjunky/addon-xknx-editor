"""Manufacturer data for a ``.knxproj`` export.

An importing tool needs the ``M-XXXX/`` product trees (and their signatures) of every manufacturer a project
uses inside the archive. This re-extracts them from the ``.knxprod`` files the catalog imported
from and merges those archives' ``knx_master.xml`` into one. Ported from the desktop app's
``knxproj_manufacturer`` module (same repository, GPL-2.0-only) against the package-level
catalog service.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ManufacturerBundle:
    extra_files: dict[str, bytes] = field(default_factory=dict)
    master_xml: bytes | None = None
    resolved_manufacturers: set[str] = field(default_factory=set)
    skipped_refs: set[str] = field(default_factory=set)


def collect_manufacturer_bundle(program_refs: Iterable[str], catalog: Any) -> ManufacturerBundle:
    """Gather the archive members for the given hardware-program refs from their source
    ``.knxprod`` files (``catalog.get_program_source(ref)`` -> ``(knxprod_path, manufacturer_id)``)."""
    bundle = ManufacturerBundle()
    needed: dict[str, set[str]] = {}
    for ref in program_refs:
        source = catalog.get_program_source(ref)
        if source is None:
            bundle.skipped_refs.add(ref)
            continue
        knxprod_path, manufacturer_id = source
        needed.setdefault(knxprod_path, set()).add(manufacturer_id)

    masters: list[bytes] = []
    for knxprod_path, manufacturer_ids in needed.items():
        try:
            with zipfile.ZipFile(knxprod_path) as zf:
                names = zf.namelist()
                if "knx_master.xml" in names:
                    masters.append(zf.read("knx_master.xml"))
                for mid in manufacturer_ids:
                    prefix = f"{mid}/"
                    signature = f"{mid}.signature"
                    for name in names:
                        if name.endswith("/"):
                            continue
                        member = name == signature or name.startswith(prefix)
                        if member and name not in bundle.extra_files:
                            bundle.extra_files[name] = zf.read(name)
                    bundle.resolved_manufacturers.add(mid)
        except (OSError, zipfile.BadZipFile):
            bundle.skipped_refs.update(manufacturer_ids)

    bundle.master_xml = merge_masters(masters)
    return bundle


def _localname(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _find_manufacturers(root: ET.Element) -> ET.Element | None:
    for el in root.iter():
        if _localname(el.tag) == "Manufacturers":
            return el
    return None


def merge_masters(masters: list[bytes]) -> bytes | None:
    """Union the ``<Manufacturer>`` entries of several ``knx_master.xml`` blobs.

    The blob with the most manufacturers is the base. It is returned verbatim when nothing has to
    be added, so its MasterData signature stays valid; a real merge blanks the signature."""
    if not masters:
        return None
    parsed = [ET.fromstring(blob) for blob in masters]

    def count(root: ET.Element) -> int:
        container = _find_manufacturers(root)
        return len(list(container)) if container is not None else 0

    base_index = max(range(len(parsed)), key=lambda i: count(parsed[i]))
    base = parsed[base_index]
    base_container = _find_manufacturers(base)
    if base_container is None:
        return masters[base_index]
    known = {m.get("Id") for m in base_container}
    appended = False
    for i, root in enumerate(parsed):
        if i == base_index:
            continue
        container = _find_manufacturers(root)
        if container is None:
            continue
        for manufacturer in container:
            mid = manufacturer.get("Id")
            if mid not in known:
                base_container.append(manufacturer)
                known.add(mid)
                appended = True
    if not appended:
        return masters[base_index]
    master_data = next((el for el in base.iter() if _localname(el.tag) == "MasterData"), None)
    if master_data is not None and master_data.get("Signature"):
        master_data.set("Signature", "")
    if base.tag.startswith("{"):
        ET.register_namespace("", base.tag[1:].split("}", 1)[0])
    return b'<?xml version="1.0" encoding="utf-8"?>\n' + ET.tostring(base, encoding="unicode").encode("utf-8")
