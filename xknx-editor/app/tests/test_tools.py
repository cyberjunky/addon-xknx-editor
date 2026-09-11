"""Tools (extended copy, replace, shift, labels, topology check, mass linker) and the MCP bridge."""

from __future__ import annotations

from pathlib import Path

from starlette.testclient import TestClient

from tests.conftest import KNXPROD, wait_job
from xknxeditor_web import tools


def test_pure_helpers() -> None:
    assert tools.shifted_ia("1.1.5", 10) == "1.1.15"
    assert tools.shifted_ia("1.1.250", 10) is None
    assert tools.shifted_ia("1.1.1", -1) is None  # 0 is the coupler
    assert tools.shifted_ia("bogus", 1) is None
    assert tools.apply_name_swap("Light kitchen", "kitchen", "hall") == "Light hall"
    assert tools.dpt_major(["DPST-1-1"]) == 1 and tools.dpt_major(["DPT-9"]) == 9 and tools.dpt_major([]) is None
    findings = tools.topology_findings([(1, "a", "1.1.1"), (2, "b", "1.1.1"), (3, "c", None), (4, "d", "9.9")])
    assert [(f[0], f[1]) for f in findings] == [(2, "error"), (3, "warning"), (4, "error")]
    gas = [(1, "Light hall", 1), (2, "Light hall dim", 3), (3, "Temperature", 9)]
    assert tools.autopair("Light hall", 1, gas) == (1, "ready")
    assert tools.autopair("Temperature", 1, gas) == (None, "incompatible")
    assert tools.autopair("nothing", 1, gas) == (None, "unmatched")
    assert tools.sequential_targets([(5, 50), (3, 30), (9, 90)], 4, 3) == [50, 90, None]
    assert tools.first_free_values({1, 2, 4}, 1, 3) == [3, 5, 6]
    assert "Individual address" in tools.labels_csv([["1.1.1", "a", "o", "m", "d", "r"]])


def _project_with_device(client: TestClient, share: Path) -> dict:
    job = wait_job(client, client.post("/api/catalog/import", json={"path": str(share / KNXPROD.name)}).json())
    assert job["status"] == "done", job
    client.post("/api/project/new", json={"name": "Tools"})
    product = client.get("/api/catalog/products", params={"q": "gira"}).json()["items"][0]
    return client.post("/api/devices", json={"product_ref_id": product["product_ref_id"], "name": "Button kitchen"}).json()


def test_extended_copy_replace_shift_labels_check(client: TestClient, dirs: tuple[Path, Path]) -> None:
    _, share = dirs
    dev = _project_with_device(client, share)

    r = client.post("/api/tools/extended-copy", json={"device_id": dev["id"], "count": 2, "find": "kitchen", "replace": "hall", "create_group_addresses": True}).json()
    assert len(r["created"]) == 2 and r["group_addresses"] > 0 and not r["errors"]
    devices = client.get("/api/project/devices").json()["items"]
    names = sorted(d["name"] for d in devices)
    assert names == ["Button hall (copy 1)", "Button hall (copy 2)", "Button kitchen"]
    assert len({d["individual_address"] for d in devices}) == 3
    copy = next(d for d in devices if d["name"].endswith("(copy 1)"))
    cos = client.get(f"/api/devices/{copy['id']}/com-objects").json()["items"]
    assert any(c["links"] for c in cos)

    # Replace the original by a copy of "copy 1": name/address stay, links come along by number.
    preview = client.get("/api/tools/replace-preview", params={"target": copy["id"], "template": dev["id"]}).json()
    assert preview["mapped"] >= 1 and preview["lost"] == 0
    r = client.post("/api/tools/replace-device", json={"target_id": copy["id"], "template_id": dev["id"]}).json()
    assert r["mapped"] >= 1 and not r["errors"]
    new = client.get(f"/api/devices/{r['device_id']}").json()
    assert new["name"] == "Button hall (copy 1)" and new["individual_address"] == copy["individual_address"]
    assert client.get(f"/api/devices/{copy['id']}").status_code == 404

    # Shift: dry run reports, real run applies; collision is refused with 409.
    ids = [d["id"] for d in client.get("/api/project/devices").json()["items"]]
    dry = client.post("/api/tools/shift-addresses", json={"device_ids": ids, "offset": 10, "dry_run": True}).json()
    assert dry["applied"] == 0 and len(dry["preview"]) == 3 and not dry["errors"]
    assert client.post("/api/tools/shift-addresses", json={"device_ids": ids, "offset": 10}).json()["applied"] == 3
    after = {d["id"]: d["individual_address"] for d in client.get("/api/project/devices").json()["items"]}
    assert all(a.endswith((".11", ".12", ".13")) for a in after.values())
    clash = client.post("/api/tools/shift-addresses", json={"device_ids": ids[:1], "offset": 1})
    assert clash.status_code == 409

    labels = client.get("/api/tools/labels").json()
    assert labels["header"][0] == "Individual address" and len(labels["rows"]) == 3
    csv = client.get("/api/tools/labels", params={"format": "csv"})
    assert csv.headers["content-type"].startswith("text/csv") and "Button" in csv.text

    check = client.get("/api/tools/topology-check").json()
    assert check["devices"] == 3 and check["count"] == 0


def test_mass_link(client: TestClient, dirs: tuple[Path, Path]) -> None:
    _, share = dirs
    dev = _project_with_device(client, share)
    ga = client.post("/api/group-addresses", json={"name": "Switch", "datapoint_type": "DPST-1-1"}).json()
    objs = client.get("/api/tools/objects", params={"devices": str(dev["id"])}).json()["items"]
    assert objs and objs[0]["device_id"] == dev["id"] and "dpt_major" in objs[0]
    first = objs[0]
    r = client.post("/api/tools/mass-link", json={"pairs": [{"device_id": dev["id"], "ref_id": first["ref_id"], "group_address_id": ga["id"]}]}).json()
    assert r["linked"] == 1 and not r["errors"]
    # Linking the same pair again is a no-op, not an error.
    r = client.post("/api/tools/mass-link", json={"pairs": [{"device_id": dev["id"], "ref_id": first["ref_id"], "group_address_id": ga["id"]}]}).json()
    assert r["linked"] == 0
    if len(objs) > 1:
        second = objs[1]
        r = client.post("/api/tools/mass-link-objects", json={"pairs": [{"source": {"device_id": dev["id"], "ref_id": first["ref_id"]}, "target": {"device_id": dev["id"], "ref_id": second["ref_id"]}, "name": "Pair"}]}).json()
        assert len(r["created"]) == 1 and r["created"][0]["name"] == "Pair" and not r["errors"]


def test_save_copy_and_reopen(client: TestClient, dirs: tuple[Path, Path]) -> None:
    config, share = dirs
    client.post("/api/project/new", json={"name": "Keep me"})
    assert (config / "last_project.txt").read_text().endswith("Keep me.xknx")
    r = client.post("/api/project/save-copy", json={"path": str(share / "backup.xknx")})
    assert r.status_code == 200 and (share / "backup.xknx").stat().st_size > 0
    assert client.post("/api/project/save-copy", json={"path": str(share / "backup.xknx")}).status_code == 409
    assert client.post("/api/project/save-copy", json={"path": str(share / "backup.xknx"), "overwrite": True}).status_code == 200
    opened = client.post("/api/project/open", json={"path": str(share / "backup.xknx")}).json()
    assert opened["open"]
    client.post("/api/project/close")
    assert not (config / "last_project.txt").exists()


def test_export_knxproj(client: TestClient, dirs: tuple[Path, Path]) -> None:
    import zipfile

    _, share = dirs
    _project_with_device(client, share)
    job = wait_job(client, client.post("/api/project/export", json={"path": str(share / "out.knxproj")}).json())
    assert job["status"] == "done", job
    r = job["result"]
    assert r["schema"] in ("20", "23") and r["manufacturers"] and not r["skipped_refs"]  # aligned to the bundled master data
    with zipfile.ZipFile(share / "out.knxproj") as zf:
        names = zf.namelist()
    assert "knx_master.xml" in names and any(n.startswith("M-0008") for n in names)
    assert client.post("/api/project/export", json={"path": str(share / "out.knxproj")}).status_code == 200  # queued; job fails on exists
    assert wait_job(client, client.post("/api/project/export", json={"path": str(share / "out.knxproj")}).json())["status"] == "failed"


def test_recent_projects(client: TestClient, dirs: tuple[Path, Path]) -> None:
    config, share = dirs
    assert client.get("/api/project/recent").json()["count"] == 0
    client.post("/api/project/new", json={"name": "First"})
    client.post("/api/project/new", json={"name": "Second"})
    recent = client.get("/api/project/recent").json()["items"]
    assert [r["name"] for r in recent] == ["Second", "First"] and recent[0]["open"] is True and recent[1]["open"] is False
    assert client.get("/api/project").json()["recent"][0]["name"] == "Second"
    # opening an older one moves it to the top; closing keeps the list
    client.post("/api/project/open", json={"path": recent[1]["path"]})
    assert [r["name"] for r in client.get("/api/project/recent").json()["items"]] == ["First", "Second"]
    client.post("/api/project/close")
    info = client.get("/api/project").json()
    assert info["open"] is False and len(info["recent"]) == 2
    # a deleted file disappears from the list; forget drops one or all
    Path(recent[0]["path"]).unlink()
    assert [r["name"] for r in client.get("/api/project/recent").json()["items"]] == ["First"]
    assert client.post("/api/project/recent/forget", json={}).json()["count"] == 0
