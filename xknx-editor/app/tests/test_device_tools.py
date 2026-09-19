"""Device tools: bus helpers (identify, serials, verify verdict), device texts, download state kept
in step with edits, unassign, comparison, connections, the project's group objects and CSV exports."""

from __future__ import annotations

import asyncio
import contextlib
import csv
import io
import time
from pathlib import Path
from typing import Any

import pytest
from starlette.testclient import TestClient

from xknxeditor_web import programming as prog
from xknxeditor_web.recorder import TelegramRecorder, parse_ga
from xknxeditor_web.reports import flags_text, flatten_parameters, merge_rows, parameter_display, rtf_to_text
from tests.conftest import KNXPROD, wait_job


# --- pure helpers ------------------------------------------------------------------------------


def test_parse_serial_and_hex() -> None:
    assert prog.parse_serial("00:FA 12-34.56 78") == bytes.fromhex("00FA12345678")
    with pytest.raises(prog.ProgrammingError):
        prog.parse_serial("00FA1234")
    assert prog.parse_hex("01 ff,0A") == b"\x01\xff\x0a"
    assert prog.parse_hex("0x0102") == b"\x01\x02"
    for bad in ("", "1", "zz", "0102 3"):
        with pytest.raises(prog.ProgrammingError):
            prog.parse_hex(bad)


def test_ip_parameters() -> None:
    r = prog.ip_parameters(bytes([192, 168, 1, 20]), bytes.fromhex("000AB3123456"), b"Gira S1" + bytes(7))
    assert r == {
        "ip_address": "192.168.1.20",
        "mac_address": "00:0A:B3:12:34:56",
        "friendly_name": "Gira S1",
        "web_url": "http://192.168.1.20/",
    }
    assert prog.ip_parameters(bytes(4), b"", b"")["ip_address"] is None


def test_device_pictures(tmp_path: Path) -> None:
    from xknxeditor_web.docs import DocStore, tag_key

    store = DocStore(tmp_path)
    store.add("manual.pdf", b"%PDF", tag="5WG1 257-3AB32")
    older = store.add("front.png", b"png", tag="5WG1 257-3AB32")
    newer = store.add("side.jpg", b"jpg", tag="5wg12573ab32")
    key = tag_key("5WG1257-3AB32")
    assert store.pictures()[key] == newer["id"]  # the newest image, the PDF never
    store.update(older["id"], picture=True)
    assert store.pictures()[key] == older["id"]  # the marked one wins
    store.update(newer["id"], picture=True)
    assert store.pictures()[key] == newer["id"] and not store.get(older["id"])[1]["picture"]
    with pytest.raises(Exception):
        store.update(store.list(tag="5WG1")[-1]["id"], picture=True)  # the PDF


def test_verdict_reads_a_preflight_as_a_check() -> None:
    same = {"segments": [{"changed_bytes": 0}], "properties": [], "changed_bytes": 0, "changed_properties": 0}
    assert prog.verdict(same)["matches"] is True and prog.verdict(same)["compared"] == 1
    differs = {**same, "changed_bytes": 3}
    assert prog.verdict(differs)["matches"] is False
    # Nothing compared is not a match: it says nothing about the device.
    assert prog.verdict({"segments": [], "properties": [], "changed_bytes": 0, "changed_properties": 0})["matches"] is False


def test_rtf_to_text() -> None:
    BS = chr(92)
    rtf = r"{\rtf1\ansi\deff0{\fonttbl{\f0 Segoe UI;}}{\colortbl ;\red0\green0\blue0;}\f0\fs18 Kitchen \'e9clairage\par second line" + BS + "u8364?}"
    assert rtf_to_text(rtf) == "Kitchen éclairage\nsecond line€"
    assert rtf_to_text("plain text") == "plain text"
    assert rtf_to_text("") == ""


def test_parameter_display_and_flatten() -> None:
    enum = {"type": "parameter", "ref_id": "p1", "label": "Mode", "value": "2", "widget": {"type": "enum", "choices": [{"value": 1, "label": "Off"}, {"value": 2, "label": "On"}]}}
    check = {"type": "parameter", "ref_id": "p2", "label": "Lock", "value": "0", "widget": {"type": "checkbox"}}
    number = {"type": "parameter", "ref_id": "p3", "label": "Delay", "value": "5", "suffix": "s", "widget": {"type": "number"}}
    assert parameter_display(enum) == "On" and parameter_display(check) == "off" and parameter_display(number) == "5 s"
    tree = [{"type": "tab", "text": "General", "children": [enum, {"type": "block", "text": "", "children": [check]}]}]
    rows = flatten_parameters(tree)
    assert [(r["ref_id"], r["path"], r["value"]) for r in rows] == [("p1", "General", "On"), ("p2", "General", "off")]


def test_merge_rows_lines_devices_up() -> None:
    a = [{"k": "x", "value": "1"}, {"k": "y", "value": "2"}]
    b = [{"k": "y", "value": "2"}, {"k": "z", "value": "3"}]
    merged = {r["k"]: r for r in merge_rows([a, b], "k")}
    assert merged["x"]["values"] == ["1", None] and merged["x"]["differs"]
    assert merged["y"]["values"] == ["2", "2"] and not merged["y"]["differs"]
    assert merged["z"]["values"] == [None, "3"]
    assert flags_text({"communication": True, "write": True}) == "C-W---"


class FakeProgrammer:
    def __init__(self, refuse_property: bool = False) -> None:
        self.refuse_property = refuse_property
        self.writes: list[tuple[str, int]] = []

    async def write_property(self, obj: int, pid: int, data: bytes, **_: Any) -> bytes:
        from xknxeditor.download.errors import VerificationError

        if self.refuse_property:
            raise VerificationError("property 54 write refused")
        self.writes.append(("property", data[0]))
        return data

    async def write_memory(self, address: int, data: bytes, **_: Any) -> None:
        assert address == 0x0060
        self.writes.append(("memory", data[0]))


def _patch_programmer(monkeypatch: pytest.MonkeyPatch, fake: FakeProgrammer) -> None:
    @contextlib.asynccontextmanager
    async def fake_programmer(_xknx: Any, _address: str):
        yield fake

    monkeypatch.setattr(prog, "_programmer", fake_programmer)


async def _no_sleep(_s: float) -> None:
    return None


def test_identify_blinks_and_ends_off(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeProgrammer()
    _patch_programmer(monkeypatch, fake)
    result = asyncio.run(prog.identify(None, "1.1.5", seconds=3, sleep=_no_sleep))
    assert result["method"] == "property"
    values = [v for _kind, v in fake.writes]
    assert values[0] == 1 and values[-1] == 0
    assert values == [1, 0, 1, 0, 1, 0]


def test_identify_falls_back_to_memory_for_a_bcu(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeProgrammer(refuse_property=True)
    _patch_programmer(monkeypatch, fake)
    result = asyncio.run(prog.identify(None, "1.1.5", seconds=1, sleep=_no_sleep))
    assert result["method"] == "memory"
    assert fake.writes == [("memory", 1), ("memory", 0)]


def test_recorder_device_filter(tmp_path: Path) -> None:
    rec = TelegramRecorder(tmp_path)
    now = time.time()

    def add(source: str, destination: str, kind: str = "group") -> None:
        rec.add(
            {
                "ts": now,
                "direction": "Incoming",
                "source": source,
                "destination": destination,
                "destination_kind": kind,
                "ga": parse_ga(destination) if kind == "group" else None,
                "apci": "GroupValueWrite",
                "raw": "01",
                "value": None,
                "unit": None,
            }
        )

    add("1.1.5", "1/0/1")  # sent by the device
    add("1.1.9", "1/0/2")  # to one of its addresses
    add("1.1.9", "1/0/3")  # unrelated
    add("0.0.1", "1.1.5", "individual")  # management to the device
    rec.flush()
    assert rec.archive(involving="1.1.5", involving_gas=[parse_ga("1/0/2")])["total"] == 3
    assert rec.archive(involving="1.1.5")["total"] == 2


# --- API ----------------------------------------------------------------------------------------


def _project_with_devices(client: TestClient, count: int = 2) -> list[int]:
    wait_job(client, client.put("/api/catalog/upload", content=KNXPROD.read_bytes()).json())
    client.post("/api/project/new", json={"name": "Tools"})
    product = client.get("/api/catalog/products").json()["items"][0]
    return [
        client.post("/api/devices", json={"product_ref_id": product["product_ref_id"], "name": f"Button {i + 1}"}).json()["id"]
        for i in range(count)
    ]


def _first_parameter(nodes: list[dict]) -> dict | None:
    for n in nodes:
        if n["type"] == "parameter" and n["widget"]["type"] == "enum" and len(n["widget"]["choices"]) > 1:
            return n
        found = _first_parameter(n.get("children") or [])
        if found:
            return found
    return None


BACKSLASH = chr(92)


def test_device_and_group_address_texts_are_undoable(client: TestClient) -> None:
    did = _project_with_devices(client, 1)[0]
    client.patch(f"/api/devices/{did}", json={"description": "Hall", "comment": "Behind the door", "installation_hints": "Cabinet A, row 2"})
    d = client.get(f"/api/devices/{did}").json()
    assert (d["description"], d["comment"], d["comment_text"], d["installation_hints"]) == ("Hall", "Behind the door", "Behind the door", "Cabinet A, row 2")
    # ETS writes both as RTF; the editor shows the text they carry.
    client.patch(f"/api/devices/{did}", json={"installation_hints": "{" + BACKSLASH + "rtf1 Cabinet A" + BACKSLASH + "par row 2}"})
    assert client.get(f"/api/devices/{did}").json()["installation_hints_text"] == "Cabinet A\nrow 2"
    client.post("/api/project/undo")  # the RTF edit
    assert client.get(f"/api/devices/{did}").json()["installation_hints"] == "Cabinet A, row 2"
    client.post("/api/project/undo")  # the first hints edit
    assert client.get(f"/api/devices/{did}").json()["installation_hints"] == ""
    assert client.patch(f"/api/devices/{did}", json={"description": None}).status_code == 200

    ga = client.post("/api/group-addresses", json={"name": "Light"}).json()
    client.patch(f"/api/group-addresses/{ga['id']}", json={"description": "Hall light", "comment": "{\\rtf1 On\\par off}"})
    g = client.get(f"/api/group-addresses/{ga['id']}").json()
    assert g["description"] == "Hall light" and g["comment_text"] == "On\noff"


def test_edits_clear_what_the_device_had_loaded(client: TestClient) -> None:
    did = _project_with_devices(client, 1)[0]
    editor = client.app.state.editor
    editor.worker.run_blocking(editor.mark_programmed, did, "full")

    def loaded() -> dict[str, bool]:
        d = client.get(f"/api/devices/{did}").json()
        return {k: d[f"{k}_loaded"] for k in ("individual_address", "application_program", "parameters", "communication_part")}

    assert all(loaded().values())
    param = _first_parameter(client.get(f"/api/devices/{did}/parameters").json()["tree"])
    assert param is not None
    other = next(c for c in param["widget"]["choices"] if str(c["value"]) != str(param["value"]))
    client.post(f"/api/devices/{did}/parameter", json={"ref_id": param["ref_id"], "value": str(other["value"])})
    state = loaded()
    assert state["parameters"] is False and state["application_program"] and state["individual_address"]
    # Undo takes the edit and the cleared tick back together.
    client.post("/api/project/undo")
    assert loaded()["parameters"] is True

    co = client.get(f"/api/devices/{did}/com-objects").json()["items"][0]
    ga = client.post("/api/group-addresses", json={"name": "Switch"}).json()
    client.post(f"/api/devices/{did}/com-objects/link", json={"ref_id": co["ref_id"], "group_address_id": ga["id"], "sending": True})
    assert loaded()["communication_part"] is False

    editor.worker.run_blocking(editor.mark_programmed, did, "full")
    client.patch(f"/api/devices/{did}", json={"individual_address": "1.1.9"})
    assert loaded()["individual_address"] is False
    summary = next(d for d in client.get("/api/project/devices").json()["items"] if d["id"] == did)
    assert summary["download_required"] is True


def test_unassign_keeps_the_device_on_its_line(client: TestClient) -> None:
    did = _project_with_devices(client, 1)[0]
    d = client.post(f"/api/devices/{did}/unassign").json()
    assert d["individual_address"] is None
    assert client.get("/api/project/devices").json()["count"] == 1
    client.post("/api/project/undo")
    assert client.get(f"/api/devices/{did}").json()["individual_address"] == "1.1.1"


def test_compare_and_connections(client: TestClient) -> None:
    a, b = _project_with_devices(client, 2)
    co = client.get(f"/api/devices/{a}/com-objects").json()["items"][0]
    ga = client.post("/api/group-addresses", json={"name": "Shared", "datapoint_type": "DPST-1-1"}).json()
    client.post(f"/api/devices/{a}/com-objects/link", json={"ref_id": co["ref_id"], "group_address_id": ga["id"], "sending": True})
    client.post(f"/api/devices/{b}/com-objects/link", json={"ref_id": co["ref_id"], "group_address_id": ga["id"]})
    c = client.get(f"/api/devices/{a}/connections").json()
    assert c["objects"][0]["links"][0]["sending"] is True
    peer = c["group_addresses"][0]["peers"][0]
    assert peer["device_id"] == b and peer["sending"] is False and peer["object_number"] == co["number"]

    objs = client.get("/api/project/objects").json()
    assert objs["count"] >= 2 and any(o["links"] for o in objs["items"])
    makers = client.get("/api/project/manufacturers").json()["items"]
    assert makers[0]["device_count"] == 2 and len(makers[0]["products"][0]["devices"]) == 2

    # Last: the parameter change may switch objects (and their links) off.
    param = _first_parameter(client.get(f"/api/devices/{a}/parameters").json()["tree"])
    assert param is not None
    other = next(c for c in param["widget"]["choices"] if str(c["value"]) != str(param["value"]))
    client.post(f"/api/devices/{a}/parameter", json={"ref_id": param["ref_id"], "value": str(other["value"])})
    r = client.get("/api/devices/compare", params={"ids": f"{a},{b}"}).json()
    assert r["same_application"] and [d["id"] for d in r["devices"]] == [a, b]
    changed = next(p for p in r["parameters"] if p["ref_id"] == param["ref_id"])
    assert changed["differs"] and changed["values"][0] == other["label"]
    assert r["differences"]["parameters"] >= 1
    assert client.get("/api/devices/compare", params={"ids": str(a)}).status_code == 400


def test_csv_exports(client: TestClient) -> None:
    _project_with_devices(client, 2)
    b = client.post("/api/spaces", json={"space_type": "Building", "name": "Home"}).json()["id"]
    client.post("/api/spaces", json={"space_type": "Room", "name": "Hall", "parent_id": b})
    for kind, column in (
        ("devices", "Individual address"),
        ("group-addresses", "Address"),
        ("group-objects", "Device address"),
        ("topology", "Area"),
        ("locations", "Location"),
        ("manufacturers", "Manufacturer"),
    ):
        r = client.get(f"/api/export/{kind}.csv")
        assert r.status_code == 200, (kind, r.text)
        assert "attachment" in r.headers["content-disposition"]
        rows = list(csv.reader(io.StringIO(r.text.lstrip("﻿"))))
        assert rows[0][0] == column, kind
    devices = list(csv.reader(io.StringIO(client.get("/api/export/devices.csv").text.lstrip("﻿"))))
    assert len(devices) == 3 and devices[1][0] == "1.1.1"
    assert client.get("/api/export/nothing.csv").status_code == 404


def test_bus_tools_need_a_connection(client: TestClient) -> None:
    did = _project_with_devices(client, 1)[0]
    for path, payload in (
        (f"/api/devices/{did}/ping", {}),
        (f"/api/devices/{did}/identify", {}),
        (f"/api/devices/{did}/verify", {}),
        (f"/api/devices/{did}/memory/read", {"start": 0, "count": 4}),
        (f"/api/devices/{did}/property/read", {"object_index": 0, "property_id": 11}),
        ("/api/devices/ping", {"device_ids": [did]}),
        ("/api/devices/verify", {"device_ids": [did]}),
        ("/api/bus/address-by-serial", {"serial": "00FA12345678"}),
    ):
        assert client.post(path, json=payload).status_code == 409, path
    assert client.get("/api/bus/programming-mode/serials").status_code == 409


def test_block_title_is_its_text_not_its_internal_name() -> None:
    from xknxeditor.prod.parser_v2.ui import UiParameterBlock

    from xknxeditor_web.serialize import node_dict

    assert node_dict(UiParameterBlock(id="b1", children=(), name="Grid"))["text"] == ""
    assert node_dict(UiParameterBlock(id="b2", children=(), name="Grid", text="Channel A"))["text"] == "Channel A"


def test_a_product_without_an_application_can_be_added(client: TestClient) -> None:
    """A power supply has no application program; ETS places it for the topology and bus load."""
    wait_job(client, client.put("/api/catalog/upload", content=KNXPROD.read_bytes()).json())
    client.post("/api/project/new", json={"name": "Supplies"})
    editor = client.app.state.editor
    product = client.get("/api/catalog/products").json()["items"][0]

    class Bare:
        product_ref_id = "P-BARE"
        hardware2program_ref_id = None
        application_id = None
        name = "Power supply 640 mA"
        order_number = "KNX-20E-640"
        manufacturer_id = "M-0001"
        manufacturer_name = "Test"

    real = editor.catalog.list_products
    editor.catalog.list_products = lambda: [*real(), Bare()]  # type: ignore[assignment]
    try:
        d = client.post("/api/devices", json={"product_ref_id": "P-BARE", "name": "Supply"}).json()
        # Not programmed, so no individual address is handed out (ETS leaves one out as well).
        assert d["individual_address"] is None and d["resolved"] is False
        assert "no application program" in d["error"]
        # Nothing is missing here, so the UI does not flag it like absent product data.
        assert d["no_application"] is True
        # Nothing to fetch: it is not product data that is missing, the product has no application.
        assert "P-BARE" not in str(client.get("/api/catalog/missing").json())
        assert client.get("/api/project/topology").json()["unresolved"] == []
        summary = next(x for x in client.get("/api/project/devices").json()["items"] if x["id"] == d["id"])
        assert summary["no_application"] is True and summary["resolved"] is False
        assert client.get(f"/api/devices/{d['id']}/com-objects").status_code == 422

    finally:
        editor.catalog.list_products = real  # type: ignore[assignment]
    assert product["product_ref_id"]


def test_import_notes_are_reported(client: TestClient, dirs: tuple[Path, Path]) -> None:
    """What the source .knxproj carried that the project cannot hold: kept on the project and
    echoed by an export, so a round trip can be trusted for what it says."""
    _, share = dirs
    from tests.conftest import KNXPROJ

    job = wait_job(client, client.post("/api/project/import", json={"path": str(share / KNXPROJ.name)}).json())
    assert job["status"] == "done", job
    # This fixture imports losslessly; the shape is what the UI reads.
    assert client.get("/api/project").json()["import_notes"] == []
    job = wait_job(client, client.post("/api/project/export", json={"path": str(share / "notes.knxproj")}).json())
    assert job["status"] == "done", job
    assert job["result"]["import_notes"] == []


def test_import_notes_read_from_the_project(tmp_path: Path) -> None:
    """A project that did lose something reports it per code, count and detail."""
    from types import SimpleNamespace

    from xknxeditor.proj.core.import_notes import ImportLoss, dumps

    from xknxeditor_web.config import Settings
    from xknxeditor_web.editor import Editor
    from xknxeditor_web.worker import EditorWorker

    stored = dumps([ImportLoss("multi_segment", 2, ""), ImportLoss("dropped_duplicate_lines", 1, "4.1")])
    editor = Editor(Settings(config_dir=tmp_path, share_dir=tmp_path, ingress_only=False, ingress_entry="", upstream_ref="t", language=None), EditorWorker())
    editor.pid = "P-TEST"
    editor.projects = SimpleNamespace(project=lambda _pid: SimpleNamespace(import_notes=stored))  # type: ignore[assignment]
    assert editor.import_notes() == [
        {"code": "multi_segment", "count": 2, "detail": ""},
        {"code": "dropped_duplicate_lines", "count": 1, "detail": "4.1"},
    ]
    editor.pid = None
    assert editor.import_notes() == []


def test_missing_group_objects_can_be_added(client: TestClient) -> None:
    """An object that a parameter already had switched on when the project was written has no row,
    so it cannot be linked; the reconcile on a later edit only adds what that edit activates."""
    did = _project_with_devices(client, 1)[0]
    editor = client.app.state.editor
    before = client.get(f"/api/devices/{did}/com-objects").json()
    assert before["missing"] == []  # a device added here starts complete

    # Drop a row the way an import can leave one out, then let the editor put it back.
    dropped = before["items"][0]

    def remove() -> None:
        row = next(c for c in editor._row(did).com_objects if c.id == dropped["db_id"])  # noqa: SLF001
        editor.projects.sync_device_com_objects(
            editor._pid(),  # noqa: SLF001
            did,
            [(c.ref_id, None) for c in editor._row(did).com_objects if c.id != row.id],  # noqa: SLF001
        )
        editor._drop_views(did)  # noqa: SLF001

    editor.worker.run_blocking(remove)
    after = client.get(f"/api/devices/{did}/com-objects").json()
    assert [o["number"] for o in after["missing"]] == [dropped["number"]]
    # The objects table only lists rows the project has, which is why the button is needed.
    assert all(o["number"] != dropped["number"] for o in after["items"])

    added = client.post(f"/api/devices/{did}/com-objects/add-missing", json={}).json()
    assert added["added"] == 1
    back = client.get(f"/api/devices/{did}/com-objects").json()
    assert back["missing"] == []
    restored = next(o for o in back["items"] if o["number"] == dropped["number"])
    assert restored["db_id"] is not None
    # Adding only adds: the device keeps every object it already had.
    assert len(back["items"]) == len(before["items"])
    client.post("/api/project/undo")
    assert client.get(f"/api/devices/{did}/com-objects").json()["missing"] != []
