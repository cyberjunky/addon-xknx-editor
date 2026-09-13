"""Bus current per segment.

A KNX power supply feeds one segment, so the total draw is a per-segment figure. The catalog holds
each device's draw on its Hardware row (mA); devices whose product data was never imported cannot be
counted, and that has to be visible rather than silently lowering the total.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from starlette.testclient import TestClient

from tests.conftest import KNXPROJ, wait_job
from xknxeditor_web import health


class FakeDevice:
    def __init__(self, program: str | None, name: str = "") -> None:
        self.hardware2program_ref_id = program
        self.name = name


def _editor(client: TestClient) -> Any:
    return client.app.state.editor  # type: ignore[attr-defined]


FACTS = {
    "P-1": {"bus_current": 10.0, "is_power_supply": False, "is_coupler": False, "name": "Switch actuator"},
    "P-2": {"bus_current": 12.5, "is_power_supply": False, "is_coupler": False, "name": "Push button"},
    "P-PSU": {"bus_current": 0.0, "is_power_supply": True, "is_coupler": False, "name": "Power supply 640 mA"},
    "P-NOCUR": {"bus_current": None, "is_power_supply": False, "is_coupler": False, "name": "Undocumented"},
}


@pytest.fixture
def loaded(client: TestClient, dirs: tuple[Path, Path], monkeypatch: pytest.MonkeyPatch) -> Any:
    _, share = dirs
    job = wait_job(client, client.post("/api/project/import", json={"path": str(share / KNXPROJ.name)}).json())
    assert job["status"] == "done", job
    editor = _editor(client)
    monkeypatch.setattr(editor, "_hardware_facts", lambda: FACTS)
    return editor


def test_sums_only_what_the_catalog_knows(loaded: Any) -> None:
    load = loaded._segment_load(
        [FakeDevice("P-1"), FakeDevice("P-2"), FakeDevice("P-NOCUR"), FakeDevice(None), FakeDevice("P-MISSING")]
    )
    assert load["current_ma"] == 22.5
    assert load["device_count"] == 5
    assert load["unknown"] == 3  # no ref, unknown ref, and a hardware without a bus current
    assert load["power_supplies"] == []


def test_a_power_supply_is_listed_not_added(loaded: Any) -> None:
    """Its catalog bus current is what it draws; the .knxprod has no rated output to compare with."""
    load = loaded._segment_load([FakeDevice("P-1"), FakeDevice("P-PSU", "Main supply")])
    assert load["current_ma"] == 10.0
    assert load["power_supplies"] == ["Main supply"]
    assert load["unknown"] == 0


def test_empty_segment(loaded: Any) -> None:
    assert loaded._segment_load([]) == {
        "device_count": 0,
        "current_ma": 0.0,
        "unknown": 0,
        "power_supplies": [],
    }


def test_topology_carries_the_load_per_segment(loaded: Any, client: TestClient) -> None:
    topology = client.get("/api/project/topology").json()
    segments = [s for a in topology["areas"] for line in a["lines"] for s in line["segments"]]
    assert segments, topology
    for segment in segments:
        assert {"device_count", "current_ma", "unknown", "power_supplies"} <= set(segment)
        assert segment["device_count"] == len(segment["devices"])


# The editor's project session belongs to the worker thread, so the checks run there too -
# reading it from the test thread trips SQLite's own bookkeeping (seen on CI, 0.3.2).
def test_health_reports_the_segment_draw(loaded: Any, client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        loaded,
        "_segment_load",
        lambda devices: {
            "device_count": 70,
            "current_ma": 900.0,
            "unknown": 2,
            "power_supplies": [],
        },
    )
    findings = {f.check: f for f in loaded.worker.run_blocking(health.run_checks, loaded)}
    assert findings["segment_too_many_devices"].severity == "error"
    assert "at most 64" in findings["segment_too_many_devices"].message
    assert findings["segment_bus_current"].severity == "warning"
    assert "900 mA" in findings["segment_bus_current"].message
    assert "2 devices not counted" in findings["segment_bus_current"].message
    assert findings["segment_without_power_supply"].severity == "info"


def test_a_normal_segment_only_reports_the_figure(
    loaded: Any, client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        loaded,
        "_segment_load",
        lambda devices: {
            "device_count": 12,
            "current_ma": 150.0,
            "unknown": 0,
            "power_supplies": ["Main supply"],
        },
    )
    findings = {f.check: f for f in loaded.worker.run_blocking(health.run_checks, loaded)}
    assert findings["segment_bus_current"].severity == "info"
    assert "150 mA of the 640 mA" in findings["segment_bus_current"].message
    assert "segment_too_many_devices" not in findings
    assert "segment_without_power_supply" not in findings
