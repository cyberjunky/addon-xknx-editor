from __future__ import annotations

from pathlib import Path

from starlette.testclient import TestClient

from tests.conftest import KNXPROD, KNXPROJ, wait_job


def test_health_and_status(client: TestClient) -> None:
    assert client.get("/health").json()["status"] == "ok"
    s = client.get("/api/status").json()
    assert s["project"]["open"] is False
    assert s["catalog"]["products"] == 0
    assert s["versions"]["xknxeditor-proj"] != "not installed"


def test_catalog_import_from_share(client: TestClient, dirs: tuple[Path, Path]) -> None:
    _, share = dirs
    job = client.post("/api/catalog/import", json={"path": str(share / KNXPROD.name)}).json()
    job = wait_job(client, job)
    assert job["status"] == "done", job
    assert job["result"]["applications_added"]
    summary = client.get("/api/catalog").json()
    assert summary["products"] >= 1
    products = client.get("/api/catalog/products", params={"q": "gira"}).json()
    assert products["count"] >= 1


def test_catalog_upload(client: TestClient) -> None:
    job = client.put("/api/catalog/upload", params={"name": KNXPROD.name}, content=KNXPROD.read_bytes()).json()
    assert wait_job(client, job)["status"] == "done"
    assert client.get("/api/catalog").json()["products"] >= 1


def test_path_outside_share_is_rejected(client: TestClient) -> None:
    r = client.post("/api/project/open", json={"path": "/etc/passwd"})
    assert r.status_code == 400


def test_new_project_and_edits(client: TestClient) -> None:
    info = client.post("/api/project/new", json={"name": "Test house"}).json()
    assert info["open"] and info["name"] == "New project" or info["open"]
    topo = client.get("/api/project/topology").json()
    assert topo["areas"][0]["lines"][0]["segments"]

    # Group address with DPT, rename, undo/redo.
    ga = client.post("/api/group-addresses", json={"name": "Light hall", "datapoint_type": "DPST-1-1"}).json()
    assert ga["text"] and ga["datapoint_type"] == "DPST-1-1"
    client.patch(f"/api/group-addresses/{ga['id']}", json={"name": "Light hall renamed"})
    assert client.get(f"/api/group-addresses/{ga['id']}").json()["name"] == "Light hall renamed"
    assert client.post("/api/project/undo").json()["undone"] is True
    assert client.get(f"/api/group-addresses/{ga['id']}").json()["name"] == "Light hall"
    assert client.post("/api/project/redo").json()["redone"] is True

    # Spaces.
    b = client.post("/api/spaces", json={"space_type": "Building", "name": "Home"}).json()["id"]
    room = client.post("/api/spaces", json={"space_type": "Room", "name": "Hall", "parent_id": b}).json()["id"]
    tree = client.get("/api/spaces").json()["tree"]
    assert tree[0]["name"] == "Home" and tree[0]["children"][0]["id"] == room

    # Revision advanced and history lists the edits.
    assert client.get("/api/project").json()["revision"] > 0
    assert client.get("/api/project/history").json()["items"]


def test_add_device_from_catalog_and_configure(client: TestClient) -> None:
    wait_job(client, client.put("/api/catalog/upload", content=KNXPROD.read_bytes()).json())
    client.post("/api/project/new", json={"name": "Devices"})
    product = client.get("/api/catalog/products").json()["items"][0]
    dev = client.post("/api/devices", json={"product_ref_id": product["product_ref_id"], "name": "Button"}).json()
    assert dev["resolved"], dev
    assert dev["individual_address"] == "1.1.1"
    did = dev["id"]

    params = client.get(f"/api/devices/{did}/parameters").json()["tree"]
    assert params, "the application should yield a parameter tree"
    first = _first_parameter(params)
    assert first is not None
    r = client.post(f"/api/devices/{did}/parameter", json={"ref_id": first["ref_id"], "value": first["value"]}).json()
    assert r["ref_id"] == first["ref_id"]

    cos = client.get(f"/api/devices/{did}/com-objects").json()
    assert cos["count"] >= 1
    co = cos["items"][0]
    ga = client.post("/api/group-addresses", json={"name": "Switch"}).json()
    link = client.post(f"/api/devices/{did}/com-objects/link", json={"ref_id": co["ref_id"], "group_address_id": ga["id"], "sending": True}).json()
    assert link["link_id"]
    cos = client.get(f"/api/devices/{did}/com-objects").json()
    assert cos["items"][0]["links"][0]["group_address_id"] == ga["id"]
    assert client.get(f"/api/group-addresses/{ga['id']}").json()["assignments"][0]["device_id"] == did

    flag = client.post(f"/api/devices/{did}/com-objects/flag", json={"ref_id": co["ref_id"], "flag": "read", "value": True}).json()
    assert flag["value"] is True
    client.patch(f"/api/devices/{did}", json={"name": "Button 2", "individual_address": "1.1.7"})
    d = client.get(f"/api/devices/{did}").json()
    assert d["name"] == "Button 2" and d["individual_address"] == "1.1.7"
    client.delete(f"/api/links/{link['link_id']}")
    assert client.get(f"/api/devices/{did}/com-objects").json()["items"][0]["links"] == []
    client.delete(f"/api/devices/{did}")
    assert client.get("/api/project/devices").json()["count"] == 0


def test_import_knxproj_and_open(client: TestClient, dirs: tuple[Path, Path]) -> None:
    _, share = dirs
    job = wait_job(client, client.post("/api/project/import", json={"path": str(share / KNXPROJ.name)}).json())
    assert job["status"] == "done", job
    assert job["result"]["open"] and job["result"]["device_count"] == 1
    files = client.get("/api/project/files").json()
    assert files["projects"]
    client.post("/api/project/close")
    assert client.get("/api/project").json()["open"] is False
    assert client.post("/api/project/open", json={"path": files["projects"][0]}).json()["device_count"] == 1
    devs = client.get("/api/project/devices").json()["items"]
    assert devs[0]["individual_address"]


def _first_parameter(nodes: list[dict]) -> dict | None:
    for n in nodes:
        if n["type"] == "parameter":
            return n
        if n.get("children"):
            found = _first_parameter(n["children"])
            if found:
                return found
    return None


def test_spa_served_when_built(tmp_path: Path, dirs: tuple[Path, Path], monkeypatch) -> None:
    from starlette.testclient import TestClient as _TC

    from xknxeditor_web.config import Settings
    from xknxeditor_web.main import create_app

    static = tmp_path / "static"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text("<title>XKNX Editor</title><script src='./assets/app.js'></script>")
    (static / "assets" / "app.js").write_text("console.log('hi')")
    monkeypatch.setenv("XKNX_STATIC_DIR", str(static))
    config, share = dirs
    settings = Settings(config_dir=config, share_dir=share, ingress_only=False, ingress_entry="", upstream_ref="t", language=None)
    with _TC(create_app(settings)) as c:
        assert "XKNX Editor" in c.get("/").text
        assert c.get("/assets/app.js").text.startswith("console.log")
        assert c.get("/status").status_code == 404  # the pre-SPA status page is gone
        assert c.get("/api/project").json()["open"] is False


def test_file_browser(client: TestClient, dirs: tuple[Path, Path]) -> None:
    config, share = dirs
    (share / "sub").mkdir()
    root = client.get("/api/files/browse").json()
    assert {e["name"] for e in root["entries"]} == {"share"}
    listing = client.get("/api/files/browse", params={"path": str(share), "ext": ".knxprod"}).json()
    names = [e["name"] for e in listing["entries"]]
    assert names[0] == "sub" and listing["entries"][0]["is_dir"] is True
    assert KNXPROD.name in names and KNXPROJ.name not in names
    assert listing["parent"] is None and listing["root"]["name"] == "share"
    sub = client.get("/api/files/browse", params={"path": str(share / "sub")}).json()
    assert sub["parent"] == str(share) and sub["entries"] == []
    assert client.get("/api/files/browse", params={"path": "/etc"}).status_code == 400
    assert client.get("/api/files/browse", params={"path": str(share / KNXPROD.name)}).status_code == 404


def test_health_and_project_detail(client: TestClient, dirs: tuple[Path, Path]) -> None:
    _, share = dirs
    wait_job(client, client.post("/api/project/import", json={"path": str(share / KNXPROJ.name)}).json())
    h = client.get("/api/project/health").json()
    assert "items" in h and isinstance(h["count"], int)
    d = client.get("/api/project/detail").json()
    assert d["open"] and "traces" in d and "schema_version" in d


def test_bus_settings_and_offline_state(client: TestClient, dirs: tuple[Path, Path]) -> None:
    config, _ = dirs
    s = client.get("/api/bus").json()
    assert s["state"] == "DISCONNECTED" and s["settings"]["auto_connect"] is False
    r = client.post("/api/bus/settings", json={"gateway_ip": "192.0.2.87", "connection_type": "tunneling_secure", "keyring_password": "secret"}).json()
    assert r["settings"]["gateway_ip"] == "192.0.2.87" and r["settings"]["keyring_password"] == "***"
    saved = (config / "settings.json").read_text()
    assert "192.0.2.87" in saved and "secret" in saved
    assert client.post("/api/bus/settings", json={"connection_type": "bogus"}).status_code == 400
    assert client.post("/api/bus/read", json={"address": "1/0/0"}).status_code == 409
    assert client.get("/api/bus/telegrams").json()["items"] == []


def test_group_address_in_range_and_dpts(client: TestClient) -> None:
    client.post("/api/project/new", json={"name": "Ranges"})
    main = client.post("/api/group-ranges", json={"name": "Lighting"}).json()["id"]
    mid = client.post("/api/group-ranges", json={"name": "Switching", "parent_id": main}).json()["id"]
    ga = client.post("/api/group-addresses", json={"name": "Hall", "range_id": mid, "datapoint_type": "DPST-1-1"}).json()
    assert ga["text"] == "0/0/1" or ga["address"] >= 1
    ranges = client.get("/api/group-addresses/ranges").json()["ranges"]
    assert ranges[0]["children"][0]["group_addresses"][0]["id"] == ga["id"]
    ga2 = client.post("/api/group-addresses", json={"name": "Hall 2", "range_id": mid}).json()
    assert ga2["address"] == ga["address"] + 1
    dpts = client.get("/api/dpts").json()
    assert dpts["count"] > 10 and any(d["id"] == "DPST-1-1" for d in dpts["items"])


def test_encrypted_trace_detection() -> None:
    from xknxeditor_web.editor import _looks_encrypted

    assert _looks_encrypted("ä () ö(ᅲ): ZKuKVJM0xRNb+SPMbTPD71jCG35CsFBqDxflsmKOY6Z+4hdgZQVLRMfvMfD3d070cvhQMV9bCwN9q6RokkckLCOtMNc6P6irSnA48SmJg6E=")
    assert _looks_encrypted("cCgbp0H8gx5tdVjOflQMhaA9lAeblftigsQw3laXfOC/NAlCV//jfSQIi3AtbGQdlUK9P7sxH4zLVJIB5BXc7gZT2vEB2n3rDmYPNHMGcOs=")
    assert not _looks_encrypted("Added the kitchen dimmer and relinked the scenes")
    assert not _looks_encrypted("")


def test_memory_preview_and_manual_rank(client: TestClient) -> None:
    from xknxeditor_web.manuals import domain_for, rank

    wait_job(client, client.put("/api/catalog/upload", content=KNXPROD.read_bytes()).json())
    client.post("/api/project/new", json={"name": "Mem"})
    product = client.get("/api/catalog/products").json()["items"][0]
    dev = client.post("/api/devices", json={"product_ref_id": product["product_ref_id"], "name": "Button"}).json()
    mem = client.get(f"/api/devices/{dev['id']}/memory").json()
    assert mem["segments"], mem
    seg = mem["segments"][0]
    assert seg["size"] == len(bytes.fromhex(seg["hex"])) and isinstance(seg["base"], int)
    # Bus actions refuse politely while disconnected.
    assert client.post(f"/api/devices/{dev['id']}/preflight", json={"scope": "full"}).status_code == 409
    assert client.post(f"/api/devices/{dev['id']}/read", json={}).status_code == 409
    assert client.post(f"/api/devices/{dev['id']}/program", json={"scope": "nope"}).status_code in (400, 409)
    assert domain_for("GIRA Giersiepen") == "gira.com" and domain_for("ABB AG - BUSCH-JAEGER") == "busch-jaeger.de"
    assert rank("https://www.mdt.de/download/MDT_THB_Glastaster.pdf") == 0 and rank("https://x.de/ds/datenblatt.pdf") == 2 and rank("https://x.de/page.html") is None


def test_bus_connect_failure_reports_error(client: TestClient) -> None:
    # 192.0.2.1 is TEST-NET: unroutable, so the tunnel handshake fails fast with a clear error.
    client.post("/api/bus/settings", json={"connection_type": "tunneling", "gateway_ip": "192.0.2.1"})
    r = client.post("/api/bus/connect", json={})
    assert r.status_code == 502, r.text
    assert r.json()["error"]
    s = client.get("/api/bus").json()
    assert s["state"] == "DISCONNECTED" and s["error"]


def test_secure_precheck_and_keyring_upload(client: TestClient, dirs: tuple[Path, Path]) -> None:
    config, _ = dirs
    client.post("/api/bus/settings", json={"connection_type": "tunneling_secure", "gateway_ip": "192.0.2.1", "keyring_path": ""})
    r = client.post("/api/bus/connect", json={})
    assert r.status_code == 502 and "keyring" in r.json()["error"].lower()
    assert client.put("/api/bus/keyring", params={"name": "x.knxkeys"}, content=b"not a keyring").status_code == 400
    fake = b'<?xml version="1.0"?><Keyring Project="Huisje" CreatedBy="ETS 6" Created="2026-07-05T10:00:00" Signature="AAAA" xmlns="http://knx.org/xml/keyring/1"></Keyring>'
    r = client.put("/api/bus/keyring", params={"name": "Huisje.knxkeys"}, content=fake)
    assert r.status_code == 200 and r.json()["settings"]["keyring_path"].endswith("keyrings/Huisje.knxkeys") or r.json()["settings"]["keyring_path"].endswith("keyrings\\Huisje.knxkeys")
    chk = client.post("/api/bus/keyring/check", json={"password": "wrong"}).json()
    assert chk["ok"] is False and chk["error"]


def test_space_detail_lists_devices_below(client: TestClient) -> None:
    wait_job(client, client.put("/api/catalog/upload", content=KNXPROD.read_bytes()).json())
    client.post("/api/project/new", json={"name": "Spaces"})
    product = client.get("/api/catalog/products").json()["items"][0]
    dev = client.post("/api/devices", json={"product_ref_id": product["product_ref_id"], "name": "Button"}).json()
    house = client.post("/api/spaces", json={"space_type": "Building", "name": "House"}).json()["id"]
    room = client.post("/api/spaces", json={"space_type": "Room", "name": "Hall", "parent_id": house}).json()["id"]
    client.patch(f"/api/devices/{dev['id']}", json={"space_id": room})
    d = client.get(f"/api/spaces/{house}").json()
    assert d["name"] == "House" and [p["name"] for p in d["parts"]] == ["Hall"]
    assert d["devices"][0]["id"] == dev["id"] and d["devices"][0]["room"] == "Hall"
    assert d["devices"][0]["download_required"] is True and d["devices"][0]["application_name"]
    assert client.get("/api/spaces/999999").status_code == 404


def test_dpt_table_uses_strings_xknx_accepts() -> None:
    from xknx import XKNX

    from xknxeditor_web.bus import BusService
    from xknxeditor_web.worker import EditorWorker

    svc = BusService(Path(__file__).parent / "_tmp_settings", EditorWorker())
    svc.set_dpt_map({(1 << 11) | (0 << 8) | 1: "DPST-1-1", (4 << 11) | (3 << 8) | 0: "DPST-9-1", 5: "DPT-5", 6: "weird"})
    x = XKNX()
    svc._apply_dpts(x)  # noqa: SLF001
    from xknx.telegram.address import GroupAddress

    assert x.group_address_dpt.get(GroupAddress("1/0/1")).__name__ == "DPTSwitch"
    assert x.group_address_dpt.get(GroupAddress("4/3/0")).__name__ == "DPTTemperature"
    assert x.group_address_dpt.get(GroupAddress(5)) is not None and x.group_address_dpt.get(GroupAddress(6)) is None


def test_picker_offers_share_only_but_config_paths_still_resolve(client: TestClient, dirs: tuple[Path, Path]) -> None:
    """/share is the one root to browse; /config stays a valid path for the API, since Open project
    and the internal routes refer to /config/projects/... - it just is not offered for browsing."""
    config, share = dirs
    top = client.get("/api/files/browse").json()
    assert [r["name"] for r in top["roots"]] == ["share"]
    assert [e["name"] for e in top["entries"]] == ["share"]
    inside = client.get("/api/files/browse", params={"path": str(share)}).json()
    assert [r["name"] for r in inside["roots"]] == ["share"]
    # An explicit /config path is still resolvable, it is just not browsed to from the top.
    assert client.get("/api/files/browse", params={"path": str(config)}).status_code == 200
    assert client.get("/api/files/browse", params={"path": "/etc"}).status_code == 400


def test_import_project_from_an_upload(client: TestClient, dirs: tuple[Path, Path]) -> None:
    """The browser sends the .knxproj; it lands under /config/imports and imports like a share file."""
    config, share = dirs
    content = (share / "xknx_test_project_no_password.knxproj").read_bytes()
    r = client.put("/api/project/upload?name=../My House.knxproj", content=content)
    assert r.status_code == 200, r.text
    path = Path(r.json()["path"])
    assert path == config / "imports" / "My House.knxproj" and path.is_file()
    assert client.put("/api/project/upload?name=notes.txt", content=content).status_code == 400
    assert client.put("/api/project/upload?name=x.knxproj", content=b"hello").status_code == 400
    job = wait_job(client, client.post("/api/project/import", json={"path": str(path)}).json())
    assert job["status"] == "done", job
    assert client.get("/api/project").json()["open"] is True


def test_manual_search_uses_what_the_device_has() -> None:
    """A device whose product data came from a project has no order number; the search still has
    the application and the product reference to work with."""
    from xknxeditor_web.manuals import clean, order_from_ref, search_url

    assert clean("-") == "" and clean(" MDT ") == "MDT" and clean(None) == ""
    assert order_from_ref("M-000C_H-6305.2019-1_P-6305.2099") == "6305"
    assert order_from_ref("M-0083_H-SCN-IP000.03-2_P-1") == ""  # no leading digit: nothing to take
    assert order_from_ref(None) == ""

    url = search_url("-", "6305", "-", "Presence / movement or alarm 1332/1.1")
    assert url.startswith("https://www.google.com/search?q=")
    assert "6305" in url and "Presence" in url and "KNX" in url and "-" not in url.split("q=")[1]
    assert search_url(None, None, None, None).endswith("KNX+manual")
    # A manufacturer that already says KNX is not prefixed again.
    assert search_url("KNX Association", "1", None, None).count("KNX") == 1


def test_refusal_message_names_an_address_clash() -> None:
    """A device dropping the connection usually means two things share one individual address."""
    from xknxeditor_web.programming import refusal_message

    clash = refusal_message("1.1.1", "1.1.2", "Dimmer (1.1.2)", "")
    assert "1.1.2" in clash and "Dimmer (1.1.2)" in clash and "Own individual address" in clash
    plain = refusal_message("1.1.1", "1.1.2", "", "peer disconnected")
    assert "peer disconnected" in plain and "one management connection at a time" in plain
    assert "group monitor is not the cause" in plain


def test_device_on_address(client: TestClient, dirs: tuple[Path, Path]) -> None:
    _, share = dirs
    wait_job(client, client.post("/api/project/import", json={"path": str(share / KNXPROJ.name)}).json())
    devices = client.get("/api/project/devices").json()["items"]
    one = next(d for d in devices if d["individual_address"])
    editor = client.app.state.editor
    assert editor.device_on_address(one["individual_address"]) in (one["name"], one["product_name"])
    assert editor.device_on_address("15.15.254") == "" and editor.device_on_address("") == ""


def test_timeout_message_points_at_the_device_in_programming_mode() -> None:
    from xknxeditor_web.programming import timeout_message

    waiting = timeout_message("1.1.19", "1.1.2", ["15.15.255"], "No ACK received")
    assert "15.15.255" in waiting and "Assign address" in waiting
    assert "does not change the device" in waiting and "No ACK received" in waiting
    alone = timeout_message("1.1.19", "1.1.2", [], "")
    assert "programming button" in alone and "coupler" in alone and "1.1.2" in alone


def test_project_import_takes_its_product_data_into_the_catalog(client: TestClient, dirs: tuple[Path, Path]) -> None:
    """A .knxproj bundles the manufacturer data of its devices; importing the project must use it,
    or every device reads as "application not in the catalog" until the same file is imported a
    second time through the catalog."""
    _, share = dirs
    assert client.get("/api/catalog").json()["products"] == 0
    job = wait_job(client, client.post("/api/project/import", json={"path": str(share / KNXPROJ.name)}).json())
    assert job["status"] == "done", job
    assert job["result"]["products"]["manufacturers"] == ["M-0002"]
    assert job["result"]["products"]["applications_added"]
    assert client.get("/api/catalog").json()["products"] >= 1
    devices = client.get("/api/project/devices").json()["items"]
    assert devices and all(d["resolved"] for d in devices)


def test_early_bcu_devices_are_refused_before_the_bus() -> None:
    """Mask 0021 is a BCU2: its load state machine is memory mapped, which the engine does not
    drive, so the device would reject every load step (seen on a Merten 6305, 2026-09-13)."""
    from types import SimpleNamespace

    from xknxeditor_web.programming import mask_of, unsupported_mask

    bcu2 = SimpleNamespace(program=SimpleNamespace(mask_version="MV-0021"))
    system_b = SimpleNamespace(program=SimpleNamespace(mask_version="MV-07B0"))
    assert mask_of(bcu2) == "0021" and mask_of(system_b) == "07B0"
    assert mask_of(SimpleNamespace(program=None)) == ""
    refusal = unsupported_mask(bcu2)
    assert "mask 0021" in refusal and "ETS" in refusal and "memory mapped" in refusal
    assert unsupported_mask(system_b) == ""
    assert unsupported_mask(SimpleNamespace(program=None)) == ""
