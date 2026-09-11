"""Which product-data files the catalog can take, and why the legacy ones cannot be imported.

The commissioning tool offers one file filter for product data (``*.knxprod;*.vd1..*.vd5;*.vdx``) and so do we, because
a user with an old download should get an explanation rather than a file dialog that hides the file.
Only ``.knxprod`` can actually be read.

A ``.vd_`` file is a legacy product database: a ZIP whose entries are encrypted with the legacy
ZipCrypto cipher, wrapping a proprietary binary database (``ets2.vd_`` plus ``prodsym.neu``). Neither
the password nor a parser for that database is public, and no open-source project has one. The commissioning
tool still reads them, so the way through is to import the file there once and export the product as a
``.knxprod``.
"""

from __future__ import annotations

from pathlib import Path

from xknxeditor_web.errors import ApiError

KNXPROD_SUFFIX = ".knxprod"
KNXPROJ_SUFFIX = ".knxproj"  # a project bundles its devices' product data
LEGACY_SUFFIXES = frozenset({".vd1", ".vd2", ".vd3", ".vd4", ".vd5", ".vdx", ".vd_"})
ACCEPTED_SUFFIXES = frozenset({KNXPROD_SUFFIX, KNXPROJ_SUFFIX}) | LEGACY_SUFFIXES

LEGACY_MESSAGE = (
    "{name} is a legacy product database (.vd), not a .knxprod. Its contents are encrypted with "
    "a key only the commissioning tool has, so the add-on cannot read it. Import the file there "
    "once (Catalog, Import), add the device to a project, export that project as a .knxproj, and "
    "import the .knxproj here: the product data comes along inside it."
)


def check_importable(name: str) -> None:
    """Raise :class:`ApiError` unless ``name`` is a file the catalog can actually read."""
    suffix = Path(name).suffix.lower()
    if suffix in (KNXPROD_SUFFIX, KNXPROJ_SUFFIX):
        return
    if suffix in LEGACY_SUFFIXES:
        raise ApiError(LEGACY_MESSAGE.format(name=Path(name).name))
    raise ApiError(f"{Path(name).name} is not product data; expected a .knxprod file")
