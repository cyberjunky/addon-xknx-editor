"""The audit rules in the Health tab.

These are the checks an ETS project reviewer runs by hand: does every object on an address agree
about what the address carries, does anything actually act on it, are Secure devices backed by a
keyring, and is one device configured unlike its identical siblings.

The rules are exercised against a small stand-in project rather than the .knxproj fixture: each
one needs a specific shape (a mistyped object, three identical devices), and building that by hand
says what the rule is about. `test_the_real_fixture_is_clean` keeps them honest against real data.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from starlette.testclient import TestClient

from tests.conftest import KNXPROJ, wait_job
from xknxeditor_web import health
from xknxeditor_web.health import main_type


class Param:
    def __init__(self, ref_id: str, value: str) -> None:
        self.ref_id = ref_id
        self.value = value


class StoredObject:
    """A com-object as the project database holds it."""

    def __init__(self, oid: int, ref_id: str) -> None:
        self.id = oid
        self.ref_id = ref_id


class ViewObject:
    """The same object as the device view reports it: effective flags and declared DPTs."""

    def __init__(
        self,
        ref_id: str,
        number: int,
        dpt_codes: tuple[str, ...] = (),
        *,
        transmit: bool = False,
        write: bool = False,
        name: str = "obj",
    ) -> None:
        self.ref_id = ref_id
        self.number = number
        self.name = name
        self.dpt_codes = dpt_codes
        self.flags = {"transmit_flag": transmit, "write_flag": write}


class Device:
    def __init__(
        self,
        did: int,
        name: str,
        *,
        program: str = "M-1_HP-1",
        objects: list[ViewObject] | None = None,
        parameters: list[Param] | None = None,
        address: str | None = "1.1.1",
    ) -> None:
        self.id = did
        self.name = name
        self.product_name = "Product"
        self.hardware2program_ref_id = program
        self.view_objects = objects or []
        self.com_objects = [StoredObject(did * 100 + i, o.ref_id) for i, o in enumerate(self.view_objects)]
        self.parameters = parameters or []
        self.address = address


class GroupAddress:
    def __init__(self, gid: int, text: str, dpt: str | None) -> None:
        self.id = gid
        self.text = text
        self.name = "Address"
        self.datapoint_type = dpt


class Link:
    def __init__(self, group_address_id: int, is_sending: bool) -> None:
        self.group_address_id = group_address_id
        self.is_sending = is_sending


class FakeProjects:
    def __init__(self, devices: list[Device], gas: list[GroupAddress], links: dict[int, list[Link]]) -> None:
        self._devices = devices
        self._gas = gas
        self._links = links

    def devices(self, _pid: str) -> list[Device]:
        return self._devices

    def group_addresses(self, _pid: str) -> list[GroupAddress]:
        return self._gas

    def com_object_links(self, _pid: str, com_object_id: int) -> list[Link]:
        return self._links.get(com_object_id, [])

    def individual_address(self, _pid: str, device_id: int) -> str | None:
        return next((d.address for d in self._devices if d.id == device_id), None)

    def topology(self, _pid: str, _installation: int) -> Any:
        return type("Inst", (), {"areas": []})()


class FakeEditor:
    def __init__(self, tmp_path: Path, devices: list[Device], gas: list[GroupAddress], links: dict[int, list[Link]]) -> None:
        self.pid = "p1"
        self.projects = FakeProjects(devices, gas, links)
        self.settings = type("S", (), {"config_dir": tmp_path})()
        self.secure_programs: set[str] = set()

    def _resolve_app(self, _ref: str | None) -> object:
        return object()  # every device's product data is present

    def view(self, device_id: int) -> Any:
        device = next(d for d in self.projects.devices(self.pid) if d.id == device_id)
        return type("V", (), {"com_objects": lambda _self: device.view_objects})()

    def _hardware_facts(self) -> dict[str, dict[str, Any]]:
        return {p: {"secure": True} for p in self.secure_programs}

    def _segment_load(self, _devices: list[Device]) -> dict[str, Any]:
        return {"device_count": 0, "current_ma": 0.0, "unknown": 0, "power_supplies": []}


def checks(editor: Any) -> dict[str, Any]:
    return {f.check: f for f in health.run_checks(editor)}


@pytest.mark.parametrize(
    ("text", "expected"),
    [("DPST-9-1", 9), ("DPT-1", 1), ("9.001", 9), ("1", 1), ("", None), ("nonsense", None), ("DPST-x-1", None)],
)
def test_main_type(text: str, expected: int | None) -> None:
    assert main_type(text) == expected


def test_a_sub_type_difference_is_not_a_conflict() -> None:
    """DPST-1-1 against DPST-1-2 is a labelling detail; DPST-5-1 on a switch is a real mistake."""
    assert main_type("DPST-1-1") == main_type("DPST-1-2")
    assert main_type("DPST-5-1") != main_type("DPST-1-1")


def test_dpt_conflict_reports_only_a_different_main_type(tmp_path: Path) -> None:
    ga = GroupAddress(1, "1/1/1", "DPST-1-1")
    wrong = ViewObject("O-1", 3, ("DPST-5-1",), transmit=True, write=True, name="Brightness")
    device = Device(1, "Dimmer", objects=[wrong])
    editor = FakeEditor(tmp_path, [device], [ga], {device.com_objects[0].id: [Link(1, True)]})

    found = checks(editor)
    assert "ga_dpt_conflict" in found
    finding = found["ga_dpt_conflict"]
    assert "DPST-5-1" in finding.message and "DPST-1-1" in finding.message
    assert finding.group_address_id == 1 and finding.device_id == 1

    subtype = ViewObject("O-1", 3, ("DPST-1-2",), transmit=True, write=True, name="Switch")
    device.view_objects = [subtype]
    assert "ga_dpt_conflict" not in checks(editor)

    # An object that declares no DPT cannot conflict with anything.
    device.view_objects = [ViewObject("O-1", 3, (), transmit=True, write=True)]
    assert "ga_dpt_conflict" not in checks(editor)


def test_an_address_nothing_acts_on(tmp_path: Path) -> None:
    ga = GroupAddress(1, "1/1/1", "DPST-1-1")
    sender = ViewObject("O-1", 3, ("DPST-1-1",), transmit=True, write=False)
    device = Device(1, "Push button", objects=[sender])
    editor = FakeEditor(tmp_path, [device], [ga], {device.com_objects[0].id: [Link(1, True)]})

    found = checks(editor)
    assert found["ga_no_receiver"].severity == "info"
    assert found["ga_no_receiver"].group_address_id == 1

    # Give the address a listener and the finding goes.
    listener = ViewObject("O-2", 4, ("DPST-1-1",), transmit=False, write=True)
    device.view_objects.append(listener)
    device.com_objects.append(StoredObject(999, "O-2"))
    editor.projects._links[999] = [Link(1, False)]
    assert "ga_no_receiver" not in checks(editor)


def test_secure_devices_without_a_keyring(tmp_path: Path) -> None:
    device = Device(1, "Secure actuator")
    editor = FakeEditor(tmp_path, [device], [], {})
    editor.secure_programs = {"M-1_HP-1"}

    found = checks(editor)
    assert found["secure_without_keyring"].severity == "warning"
    assert ".knxkeys" in found["secure_without_keyring"].message
    assert "Secure actuator" in found["secure_without_keyring"].message

    (tmp_path / "settings.json").write_text(json.dumps({"keyring_path": "/config/house.knxkeys"}), encoding="utf-8")
    assert "secure_without_keyring" not in checks(editor)


def test_a_broken_settings_file_is_not_a_keyring(tmp_path: Path) -> None:
    (tmp_path / "settings.json").write_text("{not json", encoding="utf-8")
    editor = FakeEditor(tmp_path, [Device(1, "Secure actuator")], [], {})
    editor.secure_programs = {"M-1_HP-1"}
    assert "secure_without_keyring" in checks(editor)


def _siblings(*values: str) -> list[Device]:
    return [
        Device(i + 1, f"Device {i + 1}", parameters=[Param("P-1", v), Param("P-2", "same")], address=f"1.1.{i + 1}")
        for i, v in enumerate(values)
    ]


def test_parameter_outlier_needs_enough_siblings(tmp_path: Path) -> None:
    # Two devices that differ: neither is the odd one out.
    editor = FakeEditor(tmp_path, _siblings("on", "off"), [], {})
    assert "parameter_outlier" not in checks(editor)

    # Three, one of which differs.
    editor = FakeEditor(tmp_path, _siblings("on", "on", "off"), [], {})
    found = checks(editor)
    finding = found["parameter_outlier"]
    assert finding.device_id == 3 and finding.subject == "Device 3"
    assert "'off'" in finding.message and "'on'" in finding.message
    assert finding.severity == "info"

    # An even split says nothing about which side is wrong.
    editor = FakeEditor(tmp_path, _siblings("on", "on", "off", "off"), [], {})
    assert "parameter_outlier" not in checks(editor)

    # A parameter every sibling agrees on is never reported.
    assert "P-2" not in checks(FakeEditor(tmp_path, _siblings("on", "on", "off"), [], {}))["parameter_outlier"].message


def test_devices_of_different_products_are_not_compared(tmp_path: Path) -> None:
    devices = _siblings("on", "on", "off")
    devices[2].hardware2program_ref_id = "M-2_HP-9"  # a different product entirely
    editor = FakeEditor(tmp_path, devices, [], {})
    assert "parameter_outlier" not in checks(editor)


def test_the_real_fixture_is_clean(client: TestClient, dirs: tuple[Path, Path]) -> None:
    """The audit rules must not fire on a real, valid project."""
    _, share = dirs
    job = wait_job(client, client.post("/api/project/import", json={"path": str(share / KNXPROJ.name)}).json())
    assert job["status"] == "done", job
    editor = client.app.state.editor  # type: ignore[attr-defined]
    found = checks(editor)
    for rule in ("ga_dpt_conflict", "secure_without_keyring", "parameter_outlier"):
        assert rule not in found, found[rule]


def test_a_transmit_object_linked_only_as_receiving_never_sends(tmp_path: Path) -> None:
    """A push-button output wired to an address but with no sending link does nothing when pressed."""
    ga = GroupAddress(1, "1/1/1", "DPST-1-1")
    button = ViewObject("O-1", 1, ("DPST-1-1",), transmit=True, write=False, name="Switch")
    device = Device(1, "Push button", objects=[button])
    editor = FakeEditor(tmp_path, [device], [ga], {device.com_objects[0].id: [Link(1, False)]})

    found = checks(editor)
    assert found["object_never_sends"].severity == "warning"
    assert found["object_never_sends"].device_id == 1
    assert "1 object(s)" in found["object_never_sends"].message

    # Give it a sending link and the finding goes.
    editor.projects._links[device.com_objects[0].id] = [Link(1, True)]
    assert "object_never_sends" not in checks(editor)

    # An object that cannot transmit is never expected to send.
    listener = ViewObject("O-1", 1, ("DPST-1-1",), transmit=False, write=True, name="Actuator")
    device.view_objects = [listener]
    editor.projects._links[device.com_objects[0].id] = [Link(1, False)]
    assert "object_never_sends" not in checks(editor)
