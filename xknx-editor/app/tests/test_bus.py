"""Group monitor decoding: the DPT table reaches xknx, real telegrams decode, and the table follows
the project without an explicit connect."""

from __future__ import annotations

import time
from pathlib import Path

from starlette.testclient import TestClient
from xknx import XKNX
from xknx.dpt import DPTArray, DPTBinary
from xknx.telegram import Telegram
from xknx.telegram.address import GroupAddress
from xknx.telegram.apci import GroupValueWrite

from tests.conftest import KNXPROJ, wait_job
from xknxeditor_web.bus import BusService
from xknxeditor_web.worker import EditorWorker


def _ga(text: str) -> int:
    return GroupAddress(text).raw


def test_telegrams_decode_with_project_dpts(tmp_path: Path) -> None:
    worker = EditorWorker()
    bus = BusService(tmp_path, worker)
    bus.set_dpt_map({_ga("4/4/3"): "DPST-13-10", _ga("4/4/4"): "DPST-14-56", _ga("1/1/1"): "DPST-1-1", _ga("1/1/2"): "DPST-9-1"})
    xknx = XKNX()
    bus._apply_dpts(xknx)  # noqa: SLF001

    def push(address: str, payload: DPTArray | DPTBinary) -> dict:
        telegram = Telegram(destination_address=GroupAddress(address), payload=GroupValueWrite(payload))
        xknx.group_address_dpt.set_decoded_data(telegram)
        bus._on_telegram(telegram)  # noqa: SLF001
        return bus.telegrams()[-1]

    r = push("4/4/3", DPTArray((0x00, 0x02, 0x58, 0x64)))
    assert r["value"] == 153700 and r["unit"] == "Wh" and r["raw"] == "00 02 58 64"
    r = push("4/4/4", DPTArray((0x42, 0xA6, 0x00, 0x00)))
    assert abs(r["value"] - 83.0) < 0.01 and r["unit"] == "W"
    r = push("1/1/1", DPTBinary(1))
    assert r["value"] is True
    r = push("1/1/2", DPTArray((0x0C, 0x1A)))  # 21.0 °C in DPT 9.001
    assert abs(r["value"] - 21.0) < 0.05 and r["unit"] == "°C"
    r = push("7/7/7", DPTArray((0x01,)))  # unknown address: raw only, no crash
    assert r["value"] is None and r["raw"] == "01"


def test_dpt_table_follows_the_project(client: TestClient, dirs: tuple[Path, Path]) -> None:
    _, share = dirs
    bus = client.app.state.bus  # type: ignore[attr-defined]
    assert bus.dpt_map == {}
    job = wait_job(client, client.post("/api/project/import", json={"path": str(share / KNXPROJ.name)}).json())
    assert job["status"] == "done", job
    gas = client.get("/api/group-addresses").json()["items"]
    expected = {g["address"]: g["datapoint_type"] for g in gas if g["datapoint_type"]}
    for _ in range(50):  # the follower coalesces revisions for 0.3 s
        if bus.dpt_map == expected and expected:
            break
        time.sleep(0.1)
    assert expected and bus.dpt_map == expected
    # Editing a DPT propagates too; closing the project clears the table.
    ga = gas[0]
    client.patch(f"/api/group-addresses/{ga['id']}", json={"datapoint_type": "DPST-9-1"})
    for _ in range(50):
        if bus.dpt_map.get(ga["address"]) == "DPST-9-1":
            break
        time.sleep(0.1)
    assert bus.dpt_map.get(ga["address"]) == "DPST-9-1"
    client.post("/api/project/close")
    for _ in range(50):
        if bus.dpt_map == {}:
            break
        time.sleep(0.1)
    assert bus.dpt_map == {}


def test_untyped_address_borrows_object_dpt_and_names_reach_records(client: TestClient, dirs: tuple[Path, Path]) -> None:
    from tests.conftest import KNXPROD

    _, share = dirs
    job = wait_job(client, client.post("/api/catalog/import", json={"path": str(share / KNXPROD.name)}).json())
    assert job["status"] == "done"
    client.post("/api/project/new", json={"name": "Monitor"})
    product = client.get("/api/catalog/products", params={"q": "gira"}).json()["items"][0]
    dev = client.post("/api/devices", json={"product_ref_id": product["product_ref_id"], "name": "Button"}).json()
    ga = client.post("/api/group-addresses", json={"name": "Hall light"}).json()  # no DPT on purpose
    co = next(c for c in client.get(f"/api/devices/{dev['id']}/com-objects").json()["items"] if c["db_id"] is not None and c["dpt_codes"])
    client.post(f"/api/devices/{dev['id']}/com-objects/link", json={"ref_id": co["ref_id"], "group_address_id": ga["id"], "sending": True})
    bus = client.app.state.bus  # type: ignore[attr-defined]
    for _ in range(60):
        if bus.dpt_map.get(ga["address"]) == co["dpt_codes"][0]:
            break
        time.sleep(0.1)
    assert bus.dpt_map.get(ga["address"]) == co["dpt_codes"][0]
    assert bus.name_map.get(ga["address"]) == "Hall light"
    assert bus.decoding["from_objects"] == 1 and bus.decoding["project"] is True
    # A live record carries the name and the DPT without the HTTP list endpoint.
    xknx = XKNX()
    bus._apply_dpts(xknx)  # noqa: SLF001
    telegram = Telegram(destination_address=GroupAddress(ga["address"]), payload=GroupValueWrite(DPTBinary(1)))
    xknx.group_address_dpt.set_decoded_data(telegram)
    bus._on_telegram(telegram)  # noqa: SLF001
    rec = bus.telegrams()[-1]
    assert rec["destination_name"] == "Hall light" and rec["destination_dpt"] == co["dpt_codes"][0] and rec["value"] is True
