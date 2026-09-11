"""The .knxproj signing key: stored per add-on under /config, applied to the signer at start.

The vendored signer ships only a placeholder key (exports import but are not accepted as genuine
signatures). The genuine converter key lives in the user's own installation
on the user's own machine; the desktop XKNX Editor reads it with a .NET runtime, which the
add-on image does not carry. Here the user pastes it (hex, or the extractor's ``MOD=/EXP=/D=``
base64 lines). The key is never written into a project or exported file.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

from xknxeditor.proj.core.knxproj_signing import (
    current_signing_key,
    reset_signing_key,
    set_signing_key,
    signing_key_is_placeholder,
)

log = logging.getLogger(__name__)

FILE_NAME = "signing_key.json"
_HEX = re.compile(r"^[0-9a-fA-F]+$")

# PowerShell one-liner for the user's own Windows machine.
EXTRACT_POWERSHELL = (
    "$a=[Reflection.Assembly]::LoadFrom('C:\\Program Files (x86)\\ETS6\\Knx.Ets.XmlSigning.dll');"
    "$t=$a.GetType('Knx.Ets.XmlSigning.XmlSigning');"
    "$f=[Reflection.BindingFlags]'NonPublic,Public,Static';"
    "$m=$t.GetMethod('GetConverterRsaKey',$f);"
    "if(-not $m){$m=$t.GetMethods($f)|?{$_.GetParameters().Count -eq 0 -and "
    "[Security.Cryptography.AsymmetricAlgorithm].IsAssignableFrom($_.ReturnType)}|select -First 1};"
    "$p=$m.Invoke($null,$null).ExportParameters($true);"
    "'MOD='+[Convert]::ToBase64String($p.Modulus);'EXP='+[Convert]::ToBase64String($p.Exponent);"
    "'D='+[Convert]::ToBase64String($p.D)"
)


def _parse_number(text: str, label: str) -> int:
    value = text.strip()
    if not value:
        raise ValueError(f"{label} is empty")
    # Hex first (any length: a big integer's hex form may have an odd number of digits). A base64
    # string of this size that happens to consist only of hex characters is practically impossible.
    if _HEX.match(value) and len(value) >= 8:
        return int(value, 16)
    try:
        return int.from_bytes(base64.b64decode(value, validate=True), "big")
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"{label} is neither hex nor base64") from exc


def parse_key(data: dict[str, Any]) -> tuple[int, int, int]:
    """Accept ``{modulus, private_exponent, public_exponent?}`` (hex or base64) or a pasted
    ``MOD=... EXP=... D=...`` block in ``text``."""
    text = str(data.get("text") or "")
    if text:
        found: dict[str, str] = {}
        for m in re.finditer(r"(MOD|EXP|D)=([A-Za-z0-9+/=]+)", text):
            found[m.group(1)] = m.group(2)
        if "MOD" not in found or "D" not in found:
            raise ValueError("Paste the three lines MOD=, EXP= and D= from the extractor")
        modulus = _parse_number(found["MOD"], "MOD")
        private = _parse_number(found["D"], "D")
        public = _parse_number(found.get("EXP", "AQAB"), "EXP")
    else:
        modulus = _parse_number(str(data.get("modulus") or ""), "modulus")
        private = _parse_number(str(data.get("private_exponent") or ""), "private exponent")
        pub_raw = str(data.get("public_exponent") or "").strip()
        public = _parse_number(pub_raw, "public exponent") if pub_raw else 65537
    if modulus.bit_length() < 1000 or modulus.bit_length() > 8200:
        raise ValueError(f"modulus has {modulus.bit_length()} bits; an RSA key of 1024-4096 bits was expected")
    if private <= 1 or private >= modulus:
        raise ValueError("private exponent is out of range for this modulus")
    # Sanity: sign and verify a probe so a mistyped key is refused up front.
    probe = 0x1234567
    if pow(pow(probe, private, modulus), public, modulus) != probe:
        raise ValueError("the key pair does not verify (modulus, private and public exponent do not match)")
    return modulus, private, public


class SigningKeyStore:
    def __init__(self, config_dir: Path) -> None:
        self.path = config_dir / FILE_NAME

    def load(self) -> tuple[int, int, int] | None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return int(data["modulus"], 16), int(data["private_exponent"], 16), int(data["public_exponent"], 16)
        except (OSError, KeyError, TypeError, ValueError):
            return None

    def apply_saved(self) -> bool:
        """Apply this config's key to the signer, or the placeholder when there is none.

        The signer's key is module-global state, so a store that finds no file must reset it:
        otherwise a fresh store in the same process inherits whatever the previous one set and
        reports a genuine key it never loaded. A restore that writes a key file relies on this too.
        """
        key = self.load()
        if key is None:
            reset_signing_key()
            return False
        set_signing_key(*key)
        return True
    def save(self, modulus: int, private: int, public: int) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps({"modulus": f"{modulus:x}", "private_exponent": f"{private:x}", "public_exponent": f"{public:x}"}),
            encoding="utf-8",
        )
        with contextlib_chmod(self.path):
            pass
        set_signing_key(modulus, private, public)

    def clear(self) -> None:
        self.path.unlink(missing_ok=True)
        reset_signing_key()

    def status(self) -> dict[str, Any]:
        modulus, _private, public = current_signing_key()
        return {
            "placeholder": signing_key_is_placeholder(),
            "bits": modulus.bit_length(),
            "modulus_preview": f"{modulus:x}"[:16] + "…",
            "public_exponent": public,
            "stored": self.path.is_file(),
            "extract_powershell": EXTRACT_POWERSHELL,
        }


class contextlib_chmod:
    """Owner-only permissions for the key file on POSIX; a no-op elsewhere."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def __enter__(self) -> None:
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass

    def __exit__(self, *exc: object) -> None:
        return None
