"""Experimental: decrypt project-log comments with the project password.

``ProjectTrace/@Comment`` is stored encrypted. Every derivation
known to be used elsewhere is tried here (the archive password, the keyring password
hash, the project-store key, plain SHA-256), each with several IV choices, and a result is
accepted only when every blob yields valid PKCS#7 padding and printable text. The password is
used in memory for this one call and never stored.
"""

from __future__ import annotations

import base64
import hashlib
import re
from collections.abc import Callable, Iterable
from typing import Any

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

_B64 = re.compile(r"([A-Za-z0-9+/]{20,}={0,2})")


def password_derive_bytes(password: bytes, salt: bytes, iterations: int = 100, cb: int = 48) -> bytes:
    """.NET PasswordDeriveBytes (PBKDF1 with its legacy extension for more than one hash block)."""
    base = password + salt
    for _ in range(iterations - 1):
        base = hashlib.sha1(base).digest()
    out = hashlib.sha1(base).digest()
    counter = 1
    while len(out) < cb:
        out += hashlib.sha1(str(counter).encode("ascii") + base).digest()
        counter += 1
    return out[:cb]


def _pbkdf2(password: bytes, salt: bytes, iterations: int, length: int) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password, salt, iterations, length)


def candidate_keys(password: str, context: Iterable[str] = ()) -> list[tuple[str, bytes, list[tuple[str, bytes | None]]]]:
    """``(name, key, [(iv_name, iv or None for 'blob-prefixed')])`` for every scheme worth trying."""
    utf8 = password.encode("utf-8")
    utf16 = password.encode("utf-16-le")
    ctx_ivs: list[tuple[str, bytes | None]] = [("zero", bytes(16)), ("prefixed", None)]
    for c in context:
        if c:
            ctx_ivs.append((f"sha256({c[:12]})", hashlib.sha256(c.encode("utf-8")).digest()[:16]))
    out: list[tuple[str, bytes, list[tuple[str, bytes | None]]]] = []
    # Archive password derivation (xknxproject): the raw bytes, and the base64 text fed to the zip.
    for enc_name, pw in (("utf16", utf16), ("utf8", utf8)):
        d48 = _pbkdf2(pw, b"21.project.ets.knx.org", 65536, 48)
        out.append((f"pbkdf2-project-{enc_name}-256", d48[:32], [*ctx_ivs, ("derived", d48[32:48])]))
        out.append((f"pbkdf2-project-{enc_name}-128", d48[:16], [*ctx_ivs, ("derived", d48[16:32])]))
        k = _pbkdf2(pw, b"1.keyring.ets.knx.org", 65536, 48)
        out.append((f"pbkdf2-keyring-{enc_name}-128", k[:16], [*ctx_ivs, ("derived", k[16:32])]))
        out.append((f"pbkdf2-keyring-{enc_name}-256", k[:32], [*ctx_ivs, ("derived", k[32:48])]))
        sha = hashlib.sha256(pw).digest()
        out.append((f"sha256-{enc_name}-256", sha, ctx_ivs))
        out.append((f"sha256-{enc_name}-128", sha[:16], ctx_ivs))
    zip_pw = base64.b64encode(_pbkdf2(utf16, b"21.project.ets.knx.org", 65536, 32))
    z = _pbkdf2(zip_pw, b"21.project.ets.knx.org", 65536, 48)
    out.append(("pbkdf2-zip-b64-256", z[:32], [*ctx_ivs, ("derived", z[32:48])]))
    # Project-store scheme, with the .NET IV quirk.
    d = password_derive_bytes(utf8, b"Ivan Medvedev")
    out.append(("pdb-ets5-quirk", d[:32], [("quirk", d[8:16] + d[40:48]), ("std", d[32:48]), *ctx_ivs]))
    d16 = password_derive_bytes(utf16, b"Ivan Medvedev")
    out.append(("pdb-ets5-utf16", d16[:32], [("quirk", d16[8:16] + d16[40:48]), ("std", d16[32:48]), *ctx_ivs]))
    return out


def _decrypt(key: bytes, iv: bytes, data: bytes) -> bytes:
    c = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
    return c.update(data) + c.finalize()


def _unpad_text(pt: bytes) -> str | None:
    if not pt:
        return None
    pad = pt[-1]
    if not 1 <= pad <= 16 or not pt.endswith(bytes([pad]) * pad):
        return None
    body = pt[:-pad]
    for enc in ("utf-8", "utf-16-le"):
        try:
            s = body.decode(enc)
        except UnicodeDecodeError:
            continue
        if s and all(ch.isprintable() or ch in "\r\n\t" for ch in s):
            return s
    return None


# Windows DPAPI blobs start with a version word and the provider GUID; a comment protected with
# ProtectedData.Protect can only be read back by the same Windows user on the same machine.
DPAPI_MAGIC = bytes.fromhex("01000000") + bytes.fromhex("d08c9ddf0115d1118c7a00c04fc297eb")


def raw_blob_of(comment: str) -> bytes | None:
    """The decoded base64 run in a comment, whatever its length (used for identification)."""
    m = _B64.search(comment)
    if not m:
        return None
    try:
        raw = base64.b64decode(m.group(1))
    except ValueError:
        return None
    return raw or None


def blob_of(comment: str) -> bytes | None:
    """The decoded run when it has a block-cipher shape (a whole number of 16-byte blocks)."""
    raw = raw_blob_of(comment)
    return raw if raw is not None and len(raw) % 16 == 0 else None


def container_of(raw: bytes) -> str:
    """Name the container format of one blob, so a failed decrypt says what it is up against."""
    if raw.startswith(DPAPI_MAGIC):
        return "dpapi"
    if raw[:1] == b"\x30" and len(raw) > 4:  # ASN.1 SEQUENCE: PKCS#7 / CMS envelope
        return "asn1"
    if raw[:2] in (b"\x1f\x8b",):
        return "gzip"
    if raw[:1] == b"\x78":
        return "zlib"
    if raw[:2] == b"PK":
        return "zip"
    return "aes-block" if len(raw) % 16 == 0 else "unknown"


def keyring_keys(path: str, password: str) -> list[tuple[str, bytes]]:
    """Raw AES keys a .knxkeys file holds (backbone, tool keys, group keys) as extra candidates."""
    from xknx.secure.keyring import sync_load_keyring

    kr = sync_load_keyring(path, password)
    out: list[tuple[str, bytes]] = []
    if kr.backbone is not None and kr.backbone.decrypted_key:
        out.append(("keyring-backbone", kr.backbone.decrypted_key))
    for d in kr.devices:
        if d.decrypted_tool_key:
            out.append((f"keyring-toolkey-{d.individual_address}", d.decrypted_tool_key))
    for g in kr.group_addresses:
        if g.decrypted_key:
            out.append((f"keyring-groupkey-{g.address}", g.decrypted_key))
    return out


def _inflate(raw: bytes) -> str | None:
    """Comments that are merely compressed (deflate/zlib/gzip) rather than encrypted."""
    import gzip
    import zlib

    for attempt in (lambda b: zlib.decompress(b), lambda b: zlib.decompress(b, -15), lambda b: gzip.decompress(b)):
        try:
            out = attempt(raw)
        except Exception:  # noqa: BLE001
            continue
        for enc in ("utf-8", "utf-16-le"):
            try:
                s = out.decode(enc)
            except UnicodeDecodeError:
                continue
            if s and all(ch.isprintable() or ch in "\r\n\t" for ch in s):
                return s
    return None


_CONTAINER_VERDICT = {
    "dpapi": (
        "Windows DPAPI (ProtectedData): the key belongs to the Windows user account that wrote the "
        "log, not to the project. It can only be decrypted on that PC, under that account"
    ),
    "asn1": "an ASN.1/PKCS#7 envelope: the key is carried or referenced in the structure itself",
    "gzip": "gzip-compressed, not encrypted",
    "zlib": "zlib-compressed, not encrypted",
    "zip": "a zip archive, not a cipher blob",
}


def analyse(comments: list[str]) -> dict[str, Any]:
    """What the encrypted comments look like, to narrow down the scheme without a key."""
    raws = [b for b in (raw_blob_of(c) for c in comments) if b is not None]
    if not raws:
        return {"blobs": 0}
    containers = sorted({container_of(b) for b in raws})
    sizes = sorted({len(b) for b in raws})
    heads = [b[:16] for b in raws]
    shared_head = len(raws) > 1 and len(set(heads)) == 1
    dup_full = len(raws) - len({bytes(b) for b in raws})
    prefixes = sorted({c[: m.start()] for c in comments if (m := _B64.search(c)) is not None and m.start() > 0})
    known = next((c for c in containers if c in _CONTAINER_VERDICT), None)
    if known and len(containers) == 1:
        verdict = _CONTAINER_VERDICT[known]
    elif all(s % 16 == 0 for s in sizes):
        # Confirmed against real project data: the whole blob is
        # ciphertext (no IV prefix), AES-256-CBC, and both key and IV come from one
        # Rfc2898DeriveBytes stream over two constants held by the tool.
        verdict = (
            "AES-256-CBC: the whole blob is ciphertext, and both the key "
            "and the IV from a PBKDF2 stream over two constants held by the tool itself. "
            "That key is the same for every installation and is not in your project, so no "
            "derivation from project data can find it. Use the import route instead"
        )
    else:
        verdict = "not a 16-byte block layout and no known container"
    return {
        "blobs": len(raws),
        "sizes": sizes,
        "containers": containers,
        "shared_first_block": shared_head,
        "identical_blobs": dup_full,
        "prefixes": prefixes[:5],
        "first_bytes": raws[0][:12].hex(" "),
        "verdict": verdict,
    }


def try_decrypt(
    comments: list[str], password: str, context: Iterable[str] = (), extra_keys: Iterable[tuple[str, bytes]] = ()
) -> dict[str, Any]:
    """Return ``{"scheme": name, "iv": iv_name, "texts": [...]}`` or ``{"scheme": None, "tried": n}``."""
    blobs = [blob_of(c) for c in comments]
    targets = [(i, b) for i, b in enumerate(blobs) if b is not None]
    if not targets:
        return {"scheme": None, "tried": 0, "reason": "no encrypted comments"}
    analysis = analyse(comments)
    # Cheapest explanation first: compressed, not encrypted.
    inflated = {i: s for i, raw in targets if (s := _inflate(raw)) is not None}
    if len(inflated) == len(targets):
        return {"scheme": "compressed", "iv": "-", "texts": [inflated.get(i, c) for i, c in enumerate(comments)], "tried": 1, "analysis": analysis}
    tried = 0
    ctx_ivs: list[tuple[str, bytes | None]] = [("zero", bytes(16)), ("prefixed", None)]
    for c in context:
        if c:
            ctx_ivs.append((f"sha256({c[:12]})", hashlib.sha256(c.encode("utf-8")).digest()[:16]))
    candidates = (candidate_keys(password, context) if password else []) + [
        (name, key, ctx_ivs) for name, key in extra_keys if len(key) in (16, 24, 32)
    ]
    # Every context string (project GUID, id, creator, name, the comment prefix) as a password too.
    seen = {password}
    for c in (*context, *analysis.get("prefixes", [])):
        if c and c not in seen:
            seen.add(c)
            candidates.extend((f"ctx({c[:12]})-{name}", key, ivs) for name, key, ivs in candidate_keys(c, context))
    for name, key, ivs in candidates:
        for iv_name, iv in ivs:
            tried += 1
            texts: dict[int, str] = {}
            for i, raw in targets:
                if iv is None:
                    if len(raw) < 32:
                        break
                    pt = _decrypt(key, raw[:16], raw[16:])
                else:
                    pt = _decrypt(key, iv, raw)
                s = _unpad_text(pt)
                if s is None:
                    break
                texts[i] = s
            if len(texts) == len(targets):
                return {"scheme": name, "iv": iv_name, "texts": [texts.get(i, c) for i, c in enumerate(comments)], "tried": tried, "analysis": analysis}
    return {"scheme": None, "tried": tried, "analysis": analysis}


def encrypt_for_test(text: str, key: bytes, iv: bytes) -> str:
    """Helper for tests: AES-CBC + PKCS#7, base64."""
    data = text.encode("utf-8")
    pad = 16 - len(data) % 16
    data += bytes([pad]) * pad
    c = Cipher(algorithms.AES(key), modes.CBC(iv)).encryptor()
    return base64.b64encode(c.update(data) + c.finalize()).decode("ascii")


DecryptFn = Callable[[list[str], str], dict[str, Any]]
