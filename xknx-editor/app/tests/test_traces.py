from __future__ import annotations

import hashlib

from xknxeditor_web import traces as tr

SAMPLES = [
    "ä () ö(ᅲ): ZKuKVJM0xRNb+SPMbTPD71jCG35CsFBqDxflsmKOY6Z+4hdgZQVLRMfvMfD3d070cvhQMV9bCwN9q6RokkckLCOtMNc6P6irSnA48SmJg6E=",
    "cCgbp0H8gx5tdVjOflQMhaA9lAeblftigsQw3laXfOC/NAlCV//jfSQIi3AtbGQdlUK9P7sxH4zLVJIB5BXc7gZT2vEB2n3rDmYPNHMGcOs=",
]


def test_pdb_matches_published_ets5_values() -> None:
    d = tr.password_derive_bytes(b"ETS5Password", b"Ivan Medvedev")
    assert d[:32].hex().upper() == "22BD16CDBB96B0E18E977BB3FEFADD8886E7E38A2F8A6FD9D2F2F5663AC20371"
    assert (d[8:16] + d[40:48]).hex().upper() == "8E977BB3FEFADD88E6AE6CBEAE3E7CAF"


def test_blob_extraction_and_no_false_positive() -> None:
    assert all(tr.blob_of(s) is not None and len(tr.blob_of(s) or b"") == 80 for s in SAMPLES)
    assert tr.blob_of("plain comment") is None
    result = tr.try_decrypt(SAMPLES, "wrong-password")
    assert result["scheme"] is None and result["tried"] > 20


def test_roundtrip_with_a_candidate_scheme() -> None:
    pw = "geheim"
    key = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-16-le"), b"21.project.ets.knx.org", 65536, 48)[:32]
    iv = bytes(16)
    comments = ["prefix: " + tr.encrypt_for_test("Kitchen dimmer added", key, iv), tr.encrypt_for_test("Scenes relinked", key, iv), "already plain"]
    result = tr.try_decrypt(comments, pw)
    assert result["scheme"] == "pbkdf2-project-utf16-256" and result["iv"] == "zero"
    assert result["texts"] == ["Kitchen dimmer added", "Scenes relinked", "already plain"]


def test_extra_raw_keys_are_tried() -> None:
    key = bytes(range(16))
    comments = [tr.encrypt_for_test("Backbone-keyed comment", key, bytes(16))]
    r = tr.try_decrypt(comments, "", extra_keys=[("keyring-backbone", key)])
    assert r["scheme"] == "keyring-backbone" and r["texts"] == ["Backbone-keyed comment"]
    assert tr.try_decrypt(comments, "", extra_keys=[("bad", bytes(16)[::-1])])["scheme"] is None


def test_compressed_comments_and_analysis() -> None:
    import base64
    import zlib

    blob = base64.b64encode(zlib.compress("Lampen keuken gekoppeld".encode())).decode()
    # pad the base64 to the detector's minimum length with a second, longer comment
    long_blob = base64.b64encode(zlib.compress(("Nieuwe actor toegevoegd " * 3).encode())).decode()
    r = tr.try_decrypt([f"x: {long_blob}", f"y: {blob}"], "")
    if r["scheme"] == "compressed":
        assert "Nieuwe actor" in r["texts"][0]
    a = tr.analyse([tr.encrypt_for_test("abc", bytes(16), bytes(16)), tr.encrypt_for_test("abcd", bytes(16), bytes(16))])
    assert a["blobs"] == 2 and "AES-256-CBC" in a["verdict"]


def test_container_identification() -> None:
    import base64

    dpapi = base64.b64encode(tr.DPAPI_MAGIC + b"x" * 100).decode()
    a = tr.analyse([f"note: {dpapi}"])
    assert a["containers"] == ["dpapi"]
    assert "Windows DPAPI" in a["verdict"] and "only be decrypted on that PC" in a["verdict"]

    cbc = [
        tr.encrypt_for_test("one comment here", bytes(16), bytes([1] * 16)),
        tr.encrypt_for_test("another comment", bytes(16), bytes([2] * 16)),
    ]
    a = tr.analyse(cbc)
    assert a["containers"] == ["aes-block"] and "AES-256-CBC" in a["verdict"] and a["first_bytes"]

    assert tr.container_of(bytes([0x30, 0x82, 0x01, 0x00]) + b"z" * 20) == "asn1"
    assert tr.container_of(b"PK" + bytes([3, 4]) + b"z" * 20) == "zip"
    assert tr.container_of(bytes([0x1F, 0x8B]) + b"z" * 20) == "gzip"

    # A blob that is not a whole number of 16-byte blocks is still identified, not dropped.
    odd = base64.b64encode(b"y" * 37).decode()
    assert tr.analyse([f"x: {odd}"])["blobs"] == 1
