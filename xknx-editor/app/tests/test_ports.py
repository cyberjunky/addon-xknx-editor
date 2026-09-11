"""Recover-from-bus apply, signing key, keyring viewer, DALI/assign guards, licences."""

from __future__ import annotations

from pathlib import Path

import pytest
from starlette.testclient import TestClient

from tests.conftest import KNXPROD, VENDOR, wait_job
from xknxeditor_web import signing

KEYRING = VENDOR / "packages/datasecure/tests/resources/keyring.knxkeys"


def _catalog_and_project(client: TestClient, share: Path) -> dict:
    job = wait_job(client, client.post("/api/catalog/import", json={"path": str(share / KNXPROD.name)}).json())
    assert job["status"] == "done", job
    client.post("/api/project/new", json={"name": "Ports"})
    return client.get("/api/catalog/products", params={"q": "gira"}).json()["items"][0]


# --- recover ----------------------------------------------------------------------------------


def test_recover_apply_synthetic(client: TestClient, dirs: tuple[Path, Path]) -> None:
    """A RecoveredDevice built by hand (no bus) is written into the project with its links."""
    from xknxeditor.recover import AppId
    from xknxeditor.recover.dossier import DeviceDossier
    from xknxeditor.recover.parameters import RecoveredParameters
    from xknxeditor.recover.recover import RecoveredDevice, com_object_ref_by_number
    from xknxeditor.recover.tables_decode import DecodedGroupObject, DecodedLink

    from xknxeditor_web.recover import Entry

    _, share = dirs
    product = _catalog_and_project(client, share)
    svc = client.app.state.recover  # type: ignore[attr-defined]
    ed = client.app.state.editor  # type: ignore[attr-defined]
    app = ed.worker.run_blocking(ed.catalog.get_application, product["application_id"], None)
    from xknxeditor_web.device_view import DeviceView

    class _Empty:
        parameters: list = []
        module_instances: list = []
        com_objects: list = []

    # A number whose object is active on a fresh device (the app also lists inactive ones).
    defaults = {ref for ref, _ch in DeviceView(0, app, _Empty()).default_com_object_refs()}
    first = next(n for n, ref in sorted(com_object_ref_by_number(app).items()) if ref in defaults)
    recovered = RecoveredDevice(
        address="1.1.7",
        application_id=app.id,
        device_address=7,
        group_addresses=[2305],
        links=[DecodedLink(group_address=2305, group_object_number=first, sending=True)],
        group_objects={first: DecodedGroupObject(number=first, priority="low", communication=True, read=False, write=True, transmit=True, update=False, read_on_init=False, size_code=0, object_size="1 Bit")},
        parameters=RecoveredParameters(values={}, unknown=[]),
        dossier=DeviceDossier(serial_number="0011223344"),
    )
    entry = Entry(address="1.1.7", mask_version=0x07B0, app_id=AppId(manufacturer_id="M-0008", application_number=1, application_version=1))
    entry.product_ref_id = product["product_ref_id"]
    entry.hardware2program_ref_id = product["hardware2program_ref_id"]
    entry.product_name = product["name"]
    entry.application = app
    entry.recovered = recovered
    entry.state = "recovered"
    svc.entries = [entry]

    result = ed.worker.run_blocking(svc.apply, None)
    assert result["added"] == 1, result
    devices = client.get("/api/project/devices").json()["items"]
    dev = next(d for d in devices if d["individual_address"] == "1.1.7")
    cos = client.get(f"/api/devices/{dev['id']}/com-objects").json()["items"]
    linked = [c for c in cos if c["links"]]
    assert linked and linked[0]["links"][0]["text"] == "1/1/1" and linked[0]["links"][0]["is_sending"]
    assert linked[0]["flags"]["write"] is True
    # Second apply is a no-op (already in the project).
    assert ed.worker.run_blocking(svc.apply, None)["added"] == 0
    status = client.get("/api/recover").json()
    assert status["entries"][0]["state"] == "applied" and status["totals"]["links"] == 1
    # Bus operations refuse without a connection.
    assert client.post("/api/recover/scan", json={"start": "1.1.1", "end": "1.1.5"}).status_code == 409
    assert client.post("/api/recover/scan", json={"start": "1.1.9", "end": "1.1.5"}).status_code in (400, 409)


# --- signing key ------------------------------------------------------------------------------


def _test_key() -> tuple[int, int, int]:
    # Small but valid RSA parameters are not enough (1000-bit minimum); generate a real 1024-bit key.
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=1024)
    numbers = key.private_numbers()
    return numbers.public_numbers.n, numbers.d, numbers.public_numbers.e


def test_signing_parse_and_api(client: TestClient, dirs: tuple[Path, Path]) -> None:
    import base64

    n, d, e = _test_key()
    assert signing.parse_key({"modulus": f"{n:x}", "private_exponent": f"{d:x}"}) == (n, d, e)
    b64 = lambda v: base64.b64encode(v.to_bytes((v.bit_length() + 7) // 8, "big")).decode()  # noqa: E731
    text = f"MOD={b64(n)}\nEXP={b64(e)}\nD={b64(d)}\n"
    assert signing.parse_key({"text": text}) == (n, d, e)
    with pytest.raises(ValueError):
        signing.parse_key({"modulus": f"{n:x}", "private_exponent": f"{d + 2:x}"})
    with pytest.raises(ValueError):
        signing.parse_key({"text": "garbage"})

    assert client.get("/api/signing-key").json()["placeholder"] is True
    r = client.post("/api/signing-key", json={"text": text})
    assert r.status_code == 200 and r.json()["placeholder"] is False and r.json()["stored"] is True
    config, _ = dirs
    assert (config / "signing_key.json").is_file()
    assert client.post("/api/signing-key", json={"text": "MOD=abc"}).status_code == 400
    assert client.delete("/api/signing-key").json()["placeholder"] is True


# --- secure keyring viewer --------------------------------------------------------------------


def test_secure_keyring_contents_and_export(client: TestClient, dirs: tuple[Path, Path]) -> None:
    config, share = dirs
    assert client.get("/api/secure/keyring").status_code == 409  # nothing configured
    client.post("/api/bus/settings", json={"keyring_path": str(KEYRING), "keyring_password": "pwd"})
    k = client.get("/api/secure/keyring").json()
    assert k["backbone_key"] and k["backbone_key"].endswith("…") and k["interfaces"]
    full = client.get("/api/secure/keyring", params={"reveal": "1"}).json()
    assert full["backbone_key"] == "96f034fccf510760cbd63da0f70d4a9d"
    r = client.post("/api/secure/export", json={"path": str(share / "converted.knxkeys"), "new_password": "newpwd"})
    assert r.status_code == 200 and (share / "converted.knxkeys").stat().st_size > 0
    from xknxeditor.datasecure import load_and_decrypt

    assert load_and_decrypt(share / "converted.knxkeys", "newpwd").backbone_key == bytes.fromhex("96f034fccf510760cbd63da0f70d4a9d")
    client.post("/api/bus/settings", json={"keyring_password": "wrong"})
    assert client.get("/api/secure/keyring").status_code == 400


# --- dali + assign guards, licences ---------------------------------------------------------------


def test_dali_and_assign_guards(client: TestClient, dirs: tuple[Path, Path]) -> None:
    from xknxeditor_web.dali import is_mdt_dali_app

    assert is_mdt_dali_app("M-0083_A-0154-40-0F69-O00EF") and not is_mdt_dali_app("M-0008_A-0001-10-0000")
    _, share = dirs
    product = _catalog_and_project(client, share)
    dev = client.post("/api/devices", json={"product_ref_id": product["product_ref_id"], "name": "Button"}).json()
    assert dev.get("dali") is False
    assert client.post(f"/api/devices/{dev['id']}/assign-address", json={}).status_code == 409  # not connected
    assert client.post(f"/api/devices/{dev['id']}/dali/scan", json={}).status_code == 409
    assert client.get("/api/bus/programming-mode").status_code == 409


def test_licences(client: TestClient) -> None:
    lic = client.get("/api/licences").json()
    names = {i["name"] for i in lic["items"]}
    assert "xknx" in names and lic["count"] > 20
    ours = [i for i in lic["items"] if i["ours"]]
    assert ours and all(i["licence"].startswith("GPL-2.0") for i in ours)
