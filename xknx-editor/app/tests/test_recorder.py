"""The round-the-clock telegram recorder: storage, filters, series, statistics, availability,
retention, and the archive routes on top of it."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

from starlette.testclient import TestClient

from xknxeditor_web.recorder import QUIET_GAP, TelegramRecorder, numeric, parse_ga

KNXPROJ = "xknx_test_project_no_password.knxproj"


def telegram(ts: float, ga: str = "1/0/1", value=None, source: str = "1.1.5", apci: str = "GroupValueWrite") -> dict:
    return {
        "ts": ts,
        "direction": "Incoming",
        "source": source,
        "destination": ga,
        "destination_kind": "group",
        "ga": parse_ga(ga),
        "apci": apci,
        "raw": "01",
        "value": value,
        "unit": "°C" if isinstance(value, float) else None,
    }


def test_parse_ga_and_numeric() -> None:
    assert parse_ga("1/2/3") == (1 << 11) | (2 << 8) | 3
    assert parse_ga("1/515") == (1 << 11) | 515
    assert parse_ga("2563") == 2563
    assert parse_ga("1/2/3/4") is None and parse_ga("x") is None and parse_ga("32/0/0") is None
    assert numeric(True) == 1.0 and numeric(False) == 0.0
    assert numeric(21.5) == 21.5 and numeric(3) == 3.0
    assert numeric("on") is None and numeric(None) is None


def test_archive_filters_series_and_stats(tmp_path: Path) -> None:
    rec = TelegramRecorder(tmp_path)
    now = time.time()
    base = now - 3600
    for i in range(60):
        rec.add(telegram(base + i * 60, "1/0/1", 20.0 + i / 10))
    for i in range(10):
        rec.add(telegram(base + i * 300, "1/0/2", i % 2 == 0, source="1.1.7"))
    rec.add(telegram(base + 10, "2/1/1", "text", apci="GroupValueRead"))
    assert rec.flush() == 71
    assert rec.summary()["rows"] == 71

    page = rec.archive(limit=50)
    assert page["count"] == 50 and page["total"] == 71 and page["next_cursor"]
    rest = rec.archive(cursor=page["next_cursor"], limit=50)
    assert rest["count"] == 21 and rest["next_cursor"] is None
    assert page["items"][0]["id"] > page["items"][-1]["id"]  # newest first (ids follow arrival)
    assert rec.archive(ga=parse_ga("1/0/2"))["total"] == 10
    assert rec.archive(ga_prefix="1/0/")["total"] == 70
    assert rec.archive(source="1.1.7")["total"] == 10
    assert rec.archive(q="GroupValueRead")["total"] == 1
    assert rec.archive(q="nothing", ga_in=[parse_ga("2/1/1")])["total"] == 1  # name search expands to addresses
    assert rec.archive(since=base + 1800)["total"] == 34  # 30 of 1/0/1 (i >= 30) + 4 of 1/0/2 (i >= 6)

    raw = rec.series(parse_ga("1/0/1"), base, now, points=100)
    assert raw["bucketed"] is False and raw["count"] == 60 and raw["unit"] == "°C"
    assert raw["points"][0][1] == 20.0 and raw["points"][-1][1] == 25.9
    bucketed = rec.series(parse_ga("1/0/1"), base, now, points=10)
    assert bucketed["bucketed"] is True and 10 <= len(bucketed["points"]) <= 11
    assert all(p[2] <= p[1] <= p[3] for p in bucketed["points"])  # min <= avg <= max
    bits = rec.series(parse_ga("1/0/2"), base, now, points=100)
    assert [p[1] for p in bits["points"]] == [1.0, 0.0] * 5
    assert rec.series(parse_ga("2/1/1"), base, now)["count"] == 0  # text values are not chartable

    st = rec.stats(base, now)
    assert st["total"] == 71 and st["per_second"] > 0
    assert len(st["histogram"]["counts"]) == 48 and sum(st["histogram"]["counts"]) == 71
    assert len(st["heatmap"]) == 7 and all(len(r) == 24 for r in st["heatmap"]) and sum(map(sum, st["heatmap"])) == 71
    assert st["top_addresses"][0]["destination"] == "1/0/1" and st["top_addresses"][0]["count"] == 60
    assert st["top_sources"][0]["source"] == "1.1.5"
    assert st["by_apci"]["GroupValueRead"] == 1
    assert rec.stats(base, now, ga=parse_ga("1/0/2"))["total"] == 10

    lines = "".join(rec.csv_rows({parse_ga("1/0/1"): "Temperature"}, ga=parse_ga("1/0/1"))).splitlines()
    assert lines[0].startswith("time,direction,source,destination,name") and len(lines) == 61
    assert ",1/0/1,Temperature,GroupValueWrite,20.0,°C," in lines[1]
    rec.close()


def test_retention_and_clear(tmp_path: Path) -> None:
    rec = TelegramRecorder(tmp_path)
    now = time.time()
    for i in range(30):
        rec.add(telegram(now - 40 * 86400 + i, "1/0/1", 1.0))  # older than 30 days
    for i in range(20):
        rec.add(telegram(now - i, "1/0/1", 1.0))
    rec.flush()
    rec.retain_days, rec.retain_rows = 30, 0
    assert rec.prune() == 30 and rec.summary()["rows"] == 20
    rec.retain_days, rec.retain_rows = 0, 5
    assert rec.prune() == 15 and rec.summary()["rows"] == 5
    rec.enabled = False
    rec.add(telegram(now, "1/0/1", 1.0))
    assert rec.flush() == 0
    rec.clear()
    assert rec.summary()["rows"] == 0
    rec.close()


def test_availability_explains_gaps(tmp_path: Path) -> None:
    rec = TelegramRecorder(tmp_path)
    t0 = time.time() - 10 * 3600
    with rec._lock:
        rec._db.executemany(
            "INSERT INTO events (ts, kind) VALUES (?, ?)",
            [
                (t0, "start"),
                (t0 + 60, "connected"),
                (t0 + 3600, "disconnected"),  # link lost for half an hour
                (t0 + 5400, "connected"),
                (t0 + 7200, "stop"),  # add-on down for an hour
                (t0 + 10800, "start"),
                (t0 + 10801, "connected"),
            ],
        )
    rec.add(telegram(t0 + 100, "1/0/1", 1.0))
    rec.add(telegram(t0 + 100 + QUIET_GAP + 600, "1/0/1", 1.0))  # a quiet stretch while recording
    rec.flush()
    now = time.time()
    a = rec.availability(t0, now)
    states = [s["state"] for s in a["segments"]]
    # start → 60 s until the link is up, half an hour of lost link, an hour not running, 1 s to reconnect
    assert states == ["link_down", "recording", "link_down", "recording", "not_running", "link_down", "recording"]
    assert abs(a["coverage"]["link_down"] - (60 + 1800 + 1)) < 1
    assert abs(a["coverage"]["not_running"] - 3600) < 1
    assert a["quiet"], "the pause between the two telegrams is listed"
    assert any(abs(q["to"] - q["from"] - (QUIET_GAP + 600)) < 1 for q in a["quiet"])
    # A range that starts mid-way inherits the state from the events before it.
    later = rec.availability(t0 + 4000, t0 + 5000)
    assert [s["state"] for s in later["segments"]] == ["link_down"]
    rec.close()


def test_unclean_shutdown_is_closed_at_the_heartbeat(tmp_path: Path) -> None:
    async def run() -> None:
        first = TelegramRecorder(tmp_path)
        first.start()
        await asyncio.sleep(0)
        first._task.cancel()  # simulate the process dying: no stop() call
        first.close()
        second = TelegramRecorder(tmp_path)
        second.start()
        with second._lock:
            kinds = [k for (k,) in second._db.execute("SELECT kind FROM events ORDER BY id")]
        assert kinds == ["start", "stop", "start"]
        await second.stop()
        with second._lock:
            kinds = [k for (k,) in second._db.execute("SELECT kind FROM events ORDER BY id")]
        assert kinds[-1] == "stop"
        second.close()

    asyncio.run(run())


def test_export_and_import_round_trip(tmp_path: Path) -> None:
    rec = TelegramRecorder(tmp_path / "a")
    now = time.time()
    for i in range(5):
        rec.add(telegram(now - i, "1/0/1", float(i)))
    copy = tmp_path / "copy.db"
    rec.export_to(copy)
    other = TelegramRecorder(tmp_path / "b")
    other.add(telegram(now, "9/7/9", 1.0))
    other.flush()
    assert other.import_from(copy) == 5
    assert other.summary()["rows"] == 5 and other.archive(ga=parse_ga("9/7/9"))["total"] == 0
    rec.close()
    other.close()


# --- through the API -----------------------------------------------------------------------------


def test_archive_routes(client: TestClient, dirs: tuple[Path, Path]) -> None:
    config, share = dirs
    rec = client.app.state.recorder
    s = client.get("/api/bus").json()
    assert s["recording"] is True and s["settings"]["record"] is True and s["settings"]["retain_days"] == 30
    assert (config / "telegrams.db").is_file()

    job = client.post("/api/project/import", json={"path": str(share / KNXPROJ)}).json()
    from tests.conftest import wait_job

    wait_job(client, job)
    gas = client.get("/api/group-addresses").json()["items"]
    named = next(g for g in gas if g["name"])
    now = time.time()
    rec.add(telegram(now - 5, named["text"], 1.0))
    rec.add(telegram(now - 4, "31/7/255", 2.5))
    rec.flush()

    page = client.get("/api/bus/archive").json()
    assert page["total"] == 2 and page["items"][0]["destination"] == "31/7/255"
    assert page["items"][1]["destination_name"] == named["name"]
    assert client.get("/api/bus/archive", params={"q": named["name"][:4]}).json()["total"] >= 1  # name search
    assert client.get("/api/bus/archive", params={"ga": "31/7/"}).json()["total"] == 1
    assert client.get("/api/bus/archive", params={"ga": "nope"}).status_code == 400
    assert client.get("/api/bus/archive/summary").json()["rows"] == 2

    csv = client.get("/api/bus/archive.csv", params={"ga": "31/7/255"})
    assert csv.status_code == 200 and csv.headers["content-type"].startswith("text/csv")
    assert csv.text.count("\n") == 2 and "31/7/255" in csv.text

    series = client.get("/api/bus/series", params={"ga": "31/7/255", "from": now - 60, "to": now}).json()
    assert series["count"] == 1 and series["points"][0][1] == 2.5 and series["destination"] == "31/7/255"
    assert client.get("/api/bus/series").status_code == 400

    stats = client.get("/api/bus/stats", params={"from": now - 60, "to": now}).json()
    assert stats["total"] == 2 and stats["top_addresses"][0]["name"] in ("", named["name"])
    assert stats["availability"]["segments"] and stats["availability"]["segments"][-1]["state"] == "link_down"

    r = client.post("/api/bus/settings", json={"record": False, "retain_days": 7, "retain_rows": 1000}).json()
    assert r["recording"] is False and rec.enabled is False and rec.retain_days == 7 and rec.retain_rows == 1000
    assert client.post("/api/bus/archive/clear", json={}).json()["rows"] == 0


def test_network_graph(client: TestClient, dirs: tuple[Path, Path]) -> None:
    _, share = dirs
    from tests.conftest import wait_job

    wait_job(client, client.post("/api/project/import", json={"path": str(share / KNXPROJ)}).json())
    net = client.get("/api/project/network").json()
    assert net["devices"] > 0 and net["nodes"]
    devices = [n for n in net["nodes"] if n["kind"] == "device"]
    gas = [n for n in net["nodes"] if n["kind"] == "ga"]
    assert len(devices) == net["devices"] and len(gas) == net["addresses"]
    ids = {n["id"] for n in net["nodes"]}
    assert all(l["source"] in ids and l["target"] in ids for l in net["links"])
    assert all(g["address"].count("/") == 2 for g in gas)  # three-level text like the GA list
    assert net["links"], "the fixture project links objects to addresses"


def test_dpt_filter_rule() -> None:
    from xknxeditor_web.api.bus import _dpt_matches

    assert _dpt_matches("9", "DPST-9-1") and _dpt_matches("9.", "DPST-9-1") and _dpt_matches("9", "DPT-9")
    assert _dpt_matches("9.001", "DPST-9-1") and _dpt_matches("DPST-9-1", "DPST-9-1") and _dpt_matches("9.1", "DPST-9-1")
    assert not _dpt_matches("9.002", "DPST-9-1") and not _dpt_matches("1", "DPST-9-1") and not _dpt_matches("9", None)
    assert _dpt_matches("9.0", "DPST-9-1") is False  # 9.000 is a sub-type, not a wildcard


def test_decode_raw_and_backfill(tmp_path: Path) -> None:
    """Telegrams recorded before the project knew their types are decoded afterwards."""
    from xknxeditor_web.recorder import decode_raw

    assert decode_raw("DPST-9-1", "0C 1E") == (21.08, "°C")
    assert decode_raw("DPST-1-1", "01") == (True, None)  # Switch.ON unwraps to its plain value
    assert decode_raw("DPST-9-1", "01") is None  # wrong length for the type
    assert decode_raw("DPST-9-1", "") is None and decode_raw("nonsense", "01") is None

    rec = TelegramRecorder(tmp_path)
    now = time.time()
    for i, raw in enumerate(("0C 1E", "0C 2E")):
        rec.add({**telegram(now - i, "1/0/1"), "raw": raw, "value": None, "unit": None})
    rec.add({**telegram(now, "1/0/9"), "raw": "07 D0", "value": None, "unit": None})  # no DPT known
    decoded = {**telegram(now, "1/0/1", 25.0), "raw": "0D 00"}
    rec.add(decoded)
    rec.flush()

    dpts = {parse_ga("1/0/1"): "DPST-9-1"}
    assert rec.backfill(dpts) == 2
    assert rec.backfill(dpts) == 0  # idempotent: only rows without a value are touched
    rows = {r["raw"]: r for r in rec.archive()["items"]}
    assert rows["0C 1E"]["num"] == 21.08 and rows["0C 1E"]["unit"] == "°C"
    assert rows["0D 00"]["value"] == "25.0"  # what the monitor decoded live is left alone
    assert rows["07 D0"]["num"] is None  # an address the project does not know stays raw
    assert rec.series(parse_ga("1/0/1"), now - 60, now + 60)["count"] == 3
    rec.close()


def test_incoming_from_own_address_is_evidence_of_a_duplicate(tmp_path: Path) -> None:
    """Anything that ARRIVES from the editor's own address is somebody else on that address."""
    rec = TelegramRecorder(tmp_path)
    now = time.time()
    mine = {**telegram(now - 10, "1/0/1", True, source="1.1.2"), "direction": "Outgoing"}
    rec.add(mine)
    rec.add({**telegram(now - 5, "1/0/1", True, source="1.1.2"), "direction": "Incoming"})
    rec.add({**telegram(now - 5, "1/0/1", True, source="1.1.9"), "direction": "Incoming"})
    rec.add({**telegram(now - 40 * 3600, "1/0/1", True, source="1.1.2"), "direction": "Incoming"})
    rec.flush()
    assert rec.incoming_from("1.1.2", now - 86400) == 1  # not our own outgoing, not the old one
    assert rec.incoming_from("1.1.9", now - 86400) == 1
    assert rec.incoming_from("1.1.3", now - 86400) == 0 and rec.incoming_from("", now) == 0
    rec.close()
