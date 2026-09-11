"""Third-party licence inventory of the running environment (Help → Third-party licences).

Read from package metadata so it reflects what is actually installed in the image. It lists what
is there; judging compatibility is not the panel's job, and the answer for this image is settled.
"""

from __future__ import annotations

import importlib.metadata as md
from typing import Any


def _licence_of(dist: md.Distribution) -> str:
    meta = dist.metadata
    expr = meta.get("License-Expression")
    if expr:
        return str(expr)
    lic = meta.get("License")
    if lic and len(lic) < 80 and "\n" not in lic:
        return str(lic)
    for c in meta.get_all("Classifier") or []:
        if c.startswith("License ::"):
            return c.split("::")[-1].strip()
    return lic.splitlines()[0][:60] if lic else "unknown"


def installed_licences() -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for dist in md.distributions():
        name = dist.metadata.get("Name") or ""
        if not name:
            continue
        lic = _licence_of(dist)
        items.append({"name": name, "version": dist.version, "licence": lic, "ours": name.startswith("xknxeditor")})
    items.sort(key=lambda x: (not x["ours"], x["name"].lower()))
    return {
        "items": items,
        "count": len(items),
        "frontend": [
            {"name": "lit", "licence": "BSD-3-Clause"},
            {"name": "@shoelace-style/shoelace", "licence": "MIT"},
            {"name": "lucide", "licence": "ISC"},
            {"name": "@floating-ui/dom (via Shoelace)", "licence": "MIT"},
        ],
    }
