"""The project-log key: stored per add-on under /config, used to read and write the log.

Every ``ProjectTrace`` comment is encrypted with AES-256-CBC. Key and IV both come from one
PBKDF2 stream over two constants held by the tool itself, so they are the same
on every installation and nothing in the project is involved. The add-on deliberately does not
ship those bytes: the user extracts them from their own installation with ``Help -> Project log key``, exactly
like the .knxproj signing key, and they are kept under /config only.

With the key present the log is read (and written back) natively, no external script needed.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from xknxeditor_web.errors import ApiError

log = logging.getLogger(__name__)

FILE_NAME = "ets_log_key.json"

# Every encrypted comment carries this marker; the check for it is a plain StartsWith.
# Kept as code points so no editor or console can mangle it (that cost a whole debugging round).
DEFAULT_MARKER = "".join(chr(c) for c in (0xE4, 0x20, 0x28, 0x200A, 0x29, 0x20, 0xF6, 0x28, 0x159B, 0x29, 0x3A, 0x20))

_B64 = re.compile(r"([A-Za-z0-9+/]{16,}={0,2})")

# One-liner the dialog shows: build the encryptor, force its lazy Aes, read key and IV off it.
EXTRACT_POWERSHELL = (
    "$ets='C:\\Program Files (x86)\\ETS6';"
    "$a=[Reflection.Assembly]::LoadFrom((Join-Path $ets 'Knx.Ets.Common.dll'));"
    "$t=$a.GetType('Knx.Ets.Common.Security.ProjectTraceEncryptor');"
    "$e=[Activator]::CreateInstance($t,@([int]1));"
    "$p=$e.Encrypt('probe');"
    "$f=[Reflection.BindingFlags]'Instance,NonPublic';"
    "$aes=$t.GetFields($f)|%{$_.GetValue($e)}|?{$_ -and $_.GetType().FullName -like "
    "'System.Security.Cryptography.Aes*'}|select -First 1;"
    "'key='+[Convert]::ToBase64String($aes.Key);'iv='+[Convert]::ToBase64String($aes.IV);"
    "'marker='+[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($p.Substring(0,12)))"
)


def _b64(value: str, label: str, length: int) -> bytes:
    try:
        raw = base64.b64decode(value.strip(), validate=True)
    except Exception as exc:  # noqa: BLE001
        raise ApiError(f"{label} is not valid base64") from exc
    if len(raw) != length:
        raise ApiError(f"{label} must be {length} bytes, got {len(raw)}")
    return raw


def parse_key(data: dict[str, Any]) -> dict[str, str]:
    """Accept ``{key, iv, marker?}`` or the extractor's ``key=... iv=... marker=...`` text."""
    text = str(data.get("text") or "")
    values = dict(data)
    if text:
        found = dict(re.findall(r"(key|iv|marker)\s*=\s*([A-Za-z0-9+/=]+)", text))
        if not found.get("key") or not found.get("iv"):
            raise ApiError("Paste the key= and iv= lines the PowerShell snippet prints")
        values = found
    key = _b64(str(values.get("key") or ""), "key", 32)
    iv = _b64(str(values.get("iv") or ""), "iv", 16)
    marker = DEFAULT_MARKER
    if values.get("marker"):
        try:
            marker = base64.b64decode(str(values["marker"]), validate=True).decode("utf-8")
        except Exception:  # noqa: BLE001 - a bad marker is not worth failing on
            marker = DEFAULT_MARKER
    return {
        "key": base64.b64encode(key).decode("ascii"),
        "iv": base64.b64encode(iv).decode("ascii"),
        "marker": marker,
    }


class LogKeyStore:
    def __init__(self, config_dir: Path) -> None:
        self.path = config_dir / FILE_NAME

    def load(self) -> dict[str, Any] | None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        try:
            return {
                "key": base64.b64decode(data["key"]),
                "iv": base64.b64decode(data["iv"]),
                "marker": data.get("marker") or DEFAULT_MARKER,
            }
        except (KeyError, TypeError, ValueError):
            return None

    def save(self, values: dict[str, str]) -> dict[str, Any]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(values), encoding="utf-8")
        try:
            os.chmod(self.path, 0o600)
        except OSError:  # pragma: no cover - not POSIX
            pass
        return self.status()

    def clear(self) -> dict[str, Any]:
        self.path.unlink(missing_ok=True)
        return self.status()

    def status(self) -> dict[str, Any]:
        key = self.load()
        return {
            "present": key is not None,
            "key_preview": (base64.b64encode(key["key"]).decode()[:8] + "…") if key else "",
            "marker_codes": " ".join(f"{ord(c):04X}" for c in (key or {}).get("marker", DEFAULT_MARKER)),
            "extract_powershell": EXTRACT_POWERSHELL,
        }

    # --- the actual crypto ----------------------------------------------------------------

    def decrypt(self, comment: str) -> str | None:
        """Plaintext of one encrypted comment, or ``None`` when it cannot be read."""
        key = self.load()
        if key is None or not comment:
            return None
        match = _B64.search(comment)
        if match is None:
            return None
        try:
            raw = base64.b64decode(match.group(1))
        except Exception:  # noqa: BLE001
            return None
        if not raw or len(raw) % 16:
            return None
        try:
            decryptor = Cipher(algorithms.AES(key["key"]), modes.CBC(key["iv"])).decryptor()
            plain = decryptor.update(raw) + decryptor.finalize()
        except Exception:  # noqa: BLE001
            return None
        if not plain:
            return None
        pad = plain[-1]
        if not 1 <= pad <= 16 or not plain.endswith(bytes([pad]) * pad):
            return None
        try:
            return plain[:-pad].decode("utf-8")
        except UnicodeDecodeError:
            return None

    def encrypt(self, text: str) -> str | None:
        """A comment the tool will accept: marker + base64 of the AES-CBC ciphertext."""
        key = self.load()
        if key is None:
            return None
        data = text.encode("utf-8")
        pad = 16 - (len(data) % 16)
        data += bytes([pad]) * pad
        encryptor = Cipher(algorithms.AES(key["key"]), modes.CBC(key["iv"])).encryptor()
        blob = encryptor.update(data) + encryptor.finalize()
        return key["marker"] + base64.b64encode(blob).decode("ascii")

    def decrypt_all(self, traces: list[dict[str, Any]]) -> int:
        """Decrypt every encrypted comment in place, keeping the original. Returns how many."""
        if self.load() is None:
            return 0
        done = 0
        for trace in traces:
            if not trace.get("encrypted"):
                continue
            plain = self.decrypt(str(trace.get("comment") or ""))
            if plain is None:
                continue
            trace["comment_encrypted"] = trace["comment"]
            trace["comment"] = plain
            trace["encrypted"] = False
            trace["decrypted_here"] = True
            done += 1
        return done
