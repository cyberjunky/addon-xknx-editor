"""KNX Data Secure keyring viewer and converter (the desktop app's "XKNX Secure" tab).

Reads the ``.knxkeys`` the gateway settings point at with the add-on's own verified crypto
(``xknxeditor.datasecure``), shows what it holds, and can re-export it under another password.
Key material is shown masked unless the caller asks to reveal it; nothing is persisted here.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from xknxeditor.datasecure import (
    KeyringSignatureError,
    load_and_decrypt,
    load_keyring,
    reencrypt_keyring,
    serialize_keyring,
)

from xknxeditor_web.errors import ApiError


def _mask(value: bytes | str | None, reveal: bool) -> str | None:
    if value is None:
        return None
    text = value.hex() if isinstance(value, bytes) else value
    if reveal:
        return text
    return text[:4] + "…" if len(text) > 4 else "…"


def _ga_text(value: int) -> str:
    return f"{value >> 11}/{(value >> 8) & 7}/{value & 0xFF}"


def keyring_contents(path: str, password: str, reveal: bool = False) -> dict[str, Any]:
    """Decrypt and describe a keyring file."""
    file = Path(path)
    if not path or not file.is_file():
        raise ApiError("No keyring configured. Upload one in the gateway settings (top right).", 409)
    data = file.read_bytes()
    try:
        dec = load_and_decrypt(data, password)
    except KeyringSignatureError as exc:
        raise ApiError(f"Keyring password is wrong or the file was altered: {exc}", 400) from exc
    except Exception as exc:  # noqa: BLE001 - malformed file
        raise ApiError(f"Cannot read the keyring: {type(exc).__name__}: {exc}", 400) from exc
    model = load_keyring(data)
    return {
        "path": str(file),
        "project": getattr(model, "project", "") or "",
        "created_by": getattr(model, "created_by", "") or "",
        "created": getattr(model, "created", "") or "",
        "backbone_key": _mask(dec.backbone_key, reveal),
        "interfaces": [
            {
                "type": getattr(i.type, "value", str(i.type)),
                "individual_address": i.individual_address,
                "host": i.host,
                "user_id": i.user_id,
                "password": _mask(i.password, reveal),
                "authentication": _mask(i.authentication, reveal),
            }
            for i in dec.interfaces
        ],
        "devices": [
            {
                "individual_address": d.individual_address,
                "tool_key": _mask(d.tool_key, reveal),
                "management_password": _mask(d.management_password, reveal),
                "authentication": _mask(d.authentication, reveal),
                "fdsk": _mask(d.fdsk, reveal),
                "sequence_number": d.sequence_number,
            }
            for d in dec.devices
        ],
        "group_keys": [
            {"address": value, "text": _ga_text(value), "key": _mask(key, reveal)} for value, key in sorted(dec.group_keys.items())
        ],
        "revealed": reveal,
    }


def export_keyring(path: str, password: str, dest: Path, new_password: str) -> dict[str, Any]:
    """Write the keyring to ``dest`` re-encrypted and signed under ``new_password``."""
    file = Path(path)
    if not path or not file.is_file():
        raise ApiError("No keyring configured", 409)
    if not new_password:
        raise ApiError("A new keyring password is required")
    data = file.read_bytes()
    try:
        load_and_decrypt(data, password)  # verifies the current password first
    except KeyringSignatureError as exc:
        raise ApiError(f"Keyring password is wrong: {exc}", 400) from exc
    model = load_keyring(data)
    converted = reencrypt_keyring(model, password, new_password)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(serialize_keyring(converted))
    return {"path": str(dest), "bytes": dest.stat().st_size}
