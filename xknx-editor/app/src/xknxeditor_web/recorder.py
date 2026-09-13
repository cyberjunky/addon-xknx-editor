"""Round-the-clock telegram recording: every telegram the bus connection sees goes to a SQLite
file under /config, so what happened on the bus at three in the morning can be looked up later.

The live group monitor keeps its short in-memory list; this is the long-term tier behind the
Archive view, the charts and the statistics. Writes are batched from the asyncio loop (a burst of
telegrams costs one transaction a second), reads run in a worker thread. Retention is by age and by
row count. Alongside the telegrams the recorder keeps a small event log (add-on start/stop, bus
connected/lost) and a heartbeat, so a gap in the history can be explained: quiet bus, lost link, or
the add-on not running.
"""

from __future__ import annotations

import asyncio
import contextlib
import csv
import io
import logging
import sqlite3
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

FILE_NAME = "telegrams.db"
FLUSH_SECONDS = 1.0
PRUNE_EVERY = 300  # seconds between retention passes
HEARTBEAT_EVERY = 60
QUIET_GAP = 1800  # a pause on the bus longer than this is listed in the availability report
MAX_LIMIT = 1000

SCHEMA = """
CREATE TABLE IF NOT EXISTS telegrams (
    id INTEGER PRIMARY KEY,
    ts REAL NOT NULL,
    direction TEXT NOT NULL,
    source TEXT NOT NULL,
    destination TEXT NOT NULL,
    kind TEXT NOT NULL,
    ga INTEGER,
    apci TEXT NOT NULL,
    raw TEXT NOT NULL,
    value TEXT,
    num REAL,
    unit TEXT
);
CREATE INDEX IF NOT EXISTS telegrams_ts ON telegrams (ts);
CREATE INDEX IF NOT EXISTS telegrams_ga_ts ON telegrams (ga, ts);
CREATE INDEX IF NOT EXISTS telegrams_source ON telegrams (source);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    ts REAL NOT NULL,
    kind TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

EVENT_KINDS = ("start", "stop", "connected", "disconnected")


def dpt_to_xknx(dpt: str) -> str:
    """``DPST-1-1`` -> ``1.001``; ``DPT-1`` -> ``1``; pass anything else through."""
    parts = dpt.split("-")
    if parts[0] == "DPST" and len(parts) == 3 and parts[1].isdigit() and parts[2].isdigit():
        return f"{int(parts[1])}.{int(parts[2]):03d}"
    if parts[0] == "DPT" and len(parts) == 2 and parts[1].isdigit():
        return parts[1]
    return dpt


def decode_raw(dpt: str, raw: str) -> tuple[Any, str | None] | None:
    """The value a stored payload carries under ``dpt``, or None when it does not fit (a wrong
    length, a payload that is not a group value). Mirrors what the live monitor shows."""
    from xknx.dpt import DPTArray, DPTBase, DPTBinary

    transcoder = DPTBase.parse_transcoder(dpt_to_xknx(dpt))
    if transcoder is None or not raw:
        return None
    try:
        if transcoder.payload_type is DPTBinary:
            payload: Any = DPTBinary(int(raw.replace(" ", ""), 16))
        else:
            payload = DPTArray(bytes.fromhex(raw.replace(" ", "")))
        value = transcoder.from_knx(payload)
    except Exception:  # noqa: BLE001 - a payload that does not match the type is simply skipped
        return None
    if hasattr(value, "value"):
        value = value.value
    if value is not None and not isinstance(value, (int, float, str, bool)):
        value = str(value)
    return value, getattr(transcoder, "unit", None)


def _text(value: Any) -> str | None:
    """The display form of a decoded value, the way the live monitor shows it (JSON-style
    booleans, numbers as they are)."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def numeric(value: Any) -> float | None:
    """The chartable form of a decoded value: booleans as 0/1, numbers as themselves."""
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float)):
        return float(value)
    return None


def parse_ga(text: str) -> int | None:
    """``1/2/3`` or ``1/2`` or a plain number → raw group address, None when malformed."""
    parts = text.strip().split("/")
    try:
        nums = [int(p) for p in parts]
    except ValueError:
        return None
    if len(nums) == 3 and 0 <= nums[0] <= 31 and 0 <= nums[1] <= 7 and 0 <= nums[2] <= 255:
        return (nums[0] << 11) | (nums[1] << 8) | nums[2]
    if len(nums) == 2 and 0 <= nums[0] <= 31 and 0 <= nums[1] <= 2047:
        return (nums[0] << 11) | nums[1]
    if len(nums) == 1 and 0 <= nums[0] <= 65535:
        return nums[0]
    return None


class TelegramRecorder:
    def __init__(self, config_dir: Path) -> None:
        self.path = config_dir / FILE_NAME
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=NORMAL")
        self._db.executescript(SCHEMA)
        self._lock = threading.Lock()
        self._buffer: list[tuple[Any, ...]] = []
        self._task: asyncio.Task[None] | None = None
        self.enabled = True
        self.retain_days = 30
        self.retain_rows = 500_000
        self.written = 0
        self._last_prune = 0.0
        self._last_beat = 0.0

    # --- lifecycle ---------------------------------------------------------------------------

    def start(self) -> None:
        """Open the run: close a previous run that never said stop, note the start, start the writer."""
        now = time.time()
        with self._lock:
            last = self._db.execute("SELECT kind, ts FROM events ORDER BY id DESC LIMIT 1").fetchone()
            if last is not None and last[0] != "stop":
                alive = self._db.execute("SELECT value FROM meta WHERE key='alive'").fetchone()
                died = max(float(alive[0]) if alive else 0.0, float(last[1]))
                self._db.execute("INSERT INTO events (ts, kind) VALUES (?, 'stop')", (min(died, now),))
            self._db.execute("INSERT INTO events (ts, kind) VALUES (?, 'start')", (now,))
            self._beat(now)
        self._last_prune = now
        self._task = asyncio.get_running_loop().create_task(self._writer())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
        self.flush()
        with self._lock:
            self._db.execute("INSERT INTO events (ts, kind) VALUES (?, 'stop')", (time.time(),))
            self._beat(time.time())

    def close(self) -> None:
        with self._lock:
            self._db.close()

    def event(self, kind: str) -> None:
        """Bus connected / lost, from the bus service."""
        if kind not in EVENT_KINDS:
            raise ValueError(kind)
        with self._lock:
            self._db.execute("INSERT INTO events (ts, kind) VALUES (?, ?)", (time.time(), kind))

    # --- writing -------------------------------------------------------------------------------

    def add(self, record: dict[str, Any]) -> None:
        """Queue one telegram (the dict the live monitor emits). Cheap: called on the loop."""
        if not self.enabled:
            return
        value = record.get("value")
        self._buffer.append(
            (
                float(record.get("ts") or time.time()),
                str(record.get("direction") or ""),
                str(record.get("source") or ""),
                str(record.get("destination") or ""),
                str(record.get("destination_kind") or ""),
                record.get("ga"),
                str(record.get("apci") or ""),
                str(record.get("raw") or ""),
                _text(value),
                numeric(value),
                record.get("unit"),
            )
        )

    def flush(self) -> int:
        rows, self._buffer = self._buffer, []
        if not rows:
            return 0
        with self._lock:
            self._db.execute("BEGIN")
            self._db.executemany(
                "INSERT INTO telegrams (ts, direction, source, destination, kind, ga, apci, raw, value, num, unit)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                rows,
            )
            self._db.execute("COMMIT")
        self.written += len(rows)
        return len(rows)

    async def _writer(self) -> None:
        while True:
            await asyncio.sleep(FLUSH_SECONDS)
            try:
                await asyncio.to_thread(self._tick)
            except Exception:  # noqa: BLE001 - recording must never take the bus down
                log.exception("telegram recorder")

    def _tick(self) -> None:
        self.flush()
        now = time.time()
        if now - self._last_beat >= HEARTBEAT_EVERY:
            with self._lock:
                self._beat(now)
        if now - self._last_prune >= PRUNE_EVERY:
            self._last_prune = now
            self.prune()

    def _beat(self, now: float) -> None:
        self._db.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('alive', ?)", (str(now),))
        self._last_beat = now

    def prune(self) -> int:
        """Apply the retention limits; returns the number of rows removed."""
        removed = 0
        with self._lock:
            if self.retain_days > 0:
                cur = self._db.execute("DELETE FROM telegrams WHERE ts < ?", (time.time() - self.retain_days * 86400,))
                removed += cur.rowcount
            if self.retain_rows > 0:
                edge = self._db.execute(
                    "SELECT id FROM telegrams ORDER BY id DESC LIMIT 1 OFFSET ?", (self.retain_rows,)
                ).fetchone()
                if edge is not None:
                    cur = self._db.execute("DELETE FROM telegrams WHERE id <= ?", (edge[0],))
                    removed += cur.rowcount
        if removed:
            log.info("telegram recorder pruned %d rows", removed)
        return removed

    def clear(self) -> None:
        self._buffer.clear()
        with self._lock:
            self._db.execute("DELETE FROM telegrams")
            self._db.execute("VACUUM")

    # --- reading -------------------------------------------------------------------------------

    def summary(self) -> dict[str, Any]:
        with self._lock:
            row = self._db.execute("SELECT count(*), min(ts), max(ts) FROM telegrams").fetchone()
        try:
            size = self.path.stat().st_size + (self.path.with_name(self.path.name + "-wal").stat().st_size if self.path.with_name(self.path.name + "-wal").exists() else 0)
        except OSError:
            size = 0
        return {
            "enabled": self.enabled,
            "rows": int(row[0] or 0) + len(self._buffer),
            "oldest": row[1],
            "newest": row[2],
            "bytes": size,
            "retain_days": self.retain_days,
            "retain_rows": self.retain_rows,
            "path": str(self.path),
        }

    @staticmethod
    def _where(
        since: float | None,
        until: float | None,
        ga: int | None = None,
        ga_prefix: str | None = None,
        ga_in: list[int] | None = None,
        source: str | None = None,
        kind: str | None = None,
        q: str | None = None,
        ga_any: list[int] | None = None,
    ) -> tuple[str, list[Any]]:
        clauses: list[str] = []
        args: list[Any] = []
        if since is not None:
            clauses.append("ts >= ?")
            args.append(since)
        if until is not None:
            clauses.append("ts <= ?")
            args.append(until)
        if ga is not None:
            clauses.append("ga = ?")
            args.append(ga)
        if ga_prefix:
            clauses.append("destination LIKE ?")
            args.append(ga_prefix.replace("%", "") + "%")
        if source:
            clauses.append("source = ?")
            args.append(source)
        if kind:
            clauses.append("kind = ?")
            args.append(kind)
        if ga_any is not None:  # a DPT filter resolved to addresses; an empty list matches nothing
            clauses.append(f"ga IN ({','.join('?' * len(ga_any)) or 'NULL'})")
            args += ga_any
        if q:
            like = f"%{q}%"
            text = "(destination LIKE ? OR source LIKE ? OR apci LIKE ? OR value LIKE ? OR raw LIKE ?)"
            args_q: list[Any] = [like] * 5
            if ga_in:
                text = f"({text} OR ga IN ({','.join('?' * len(ga_in))}))"
                args_q += ga_in
            clauses.append(text)
            args += args_q
        return (" WHERE " + " AND ".join(clauses)) if clauses else "", args

    def archive(
        self,
        since: float | None = None,
        until: float | None = None,
        *,
        ga: int | None = None,
        ga_prefix: str | None = None,
        ga_in: list[int] | None = None,
        source: str | None = None,
        kind: str | None = None,
        q: str | None = None,
        ga_any: list[int] | None = None,
        cursor: int | None = None,
        limit: int = 200,
    ) -> dict[str, Any]:
        """Newest first, keyset-paginated on id: pass the returned ``next_cursor`` to continue."""
        limit = max(1, min(int(limit), MAX_LIMIT))
        self.flush()
        where, args = self._where(since, until, ga, ga_prefix, ga_in, source, kind, q, ga_any)
        page_where = where + (" AND " if where else " WHERE ") + "id < ?" if cursor else where
        page_args = [*args, cursor] if cursor else args
        with self._lock:
            total = self._db.execute(f"SELECT count(*) FROM telegrams{where}", args).fetchone()[0]
            rows = self._db.execute(
                "SELECT id, ts, direction, source, destination, kind, ga, apci, raw, value, num, unit"
                f" FROM telegrams{page_where} ORDER BY id DESC LIMIT ?",
                [*page_args, limit],
            ).fetchall()
        items = [_row(r) for r in rows]
        return {
            "items": items,
            "count": len(items),
            "total": int(total),
            "next_cursor": items[-1]["id"] if len(items) == limit else None,
        }

    def csv_rows(self, names: dict[int, str] | None = None, **filters: Any) -> Iterator[str]:
        """The filtered archive as CSV lines, oldest first, streamed."""
        self.flush()
        where, args = self._where(
            filters.get("since"), filters.get("until"), filters.get("ga"), filters.get("ga_prefix"),
            filters.get("ga_in"), filters.get("source"), filters.get("kind"), filters.get("q"), filters.get("ga_any"),
        )
        names = names or {}
        buf = io.StringIO()
        writer = csv.writer(buf, lineterminator="\n")
        writer.writerow(["time", "direction", "source", "destination", "name", "apci", "value", "unit", "raw"])
        yield buf.getvalue()
        last_id = 0
        while True:
            with self._lock:
                rows = self._db.execute(
                    "SELECT id, ts, direction, source, destination, kind, ga, apci, raw, value, num, unit"
                    f" FROM telegrams{where}{' AND ' if where else ' WHERE '}id > ? ORDER BY id LIMIT 2000",
                    [*args, last_id],
                ).fetchall()
            if not rows:
                return
            buf = io.StringIO()
            writer = csv.writer(buf, lineterminator="\n")
            for r in rows:
                writer.writerow([
                    time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(r[1])),
                    r[2], r[3], r[4], names.get(r[6], "") if r[6] is not None else "", r[7],
                    "" if r[9] is None else r[9], r[11] or "", r[8],
                ])
            last_id = rows[-1][0]
            yield buf.getvalue()

    def series(self, ga: int, since: float, until: float, points: int = 600) -> dict[str, Any]:
        """Numeric values of one group address over a range. Raw when they fit in ``points``,
        otherwise averaged per time bucket with the bucket's min and max alongside."""
        self.flush()
        points = max(10, min(int(points), 5000))
        with self._lock:
            n, unit = self._db.execute(
                "SELECT count(*), max(unit) FROM telegrams WHERE ga = ? AND num IS NOT NULL AND ts BETWEEN ? AND ?",
                (ga, since, until),
            ).fetchone()
            if n <= points:
                rows = self._db.execute(
                    "SELECT ts, num FROM telegrams WHERE ga = ? AND num IS NOT NULL AND ts BETWEEN ? AND ? ORDER BY ts",
                    (ga, since, until),
                ).fetchall()
                return {"ga": ga, "unit": unit, "count": n, "bucketed": False, "bucket": 0,
                        "points": [[r[0], r[1], r[1], r[1]] for r in rows]}
            bucket = max(1.0, (until - since) / points)
            rows = self._db.execute(
                "SELECT CAST((ts - ?) / ? AS INTEGER) AS b, avg(num), min(num), max(num)"
                " FROM telegrams WHERE ga = ? AND num IS NOT NULL AND ts BETWEEN ? AND ? GROUP BY b ORDER BY b",
                (since, bucket, ga, since, until),
            ).fetchall()
        return {"ga": ga, "unit": unit, "count": n, "bucketed": True, "bucket": bucket,
                "points": [[since + r[0] * bucket + bucket / 2, r[1], r[2], r[3]] for r in rows]}

    def stats(self, since: float, until: float, ga: int | None = None, top: int = 10) -> dict[str, Any]:
        """Totals, telegrams over time, weekday × hour heatmap and the busiest addresses in a range."""
        self.flush()
        where, args = self._where(since, until, ga)
        buckets = 48
        width = max(1.0, (until - since) / buckets)
        with self._lock:
            total = self._db.execute(f"SELECT count(*) FROM telegrams{where}", args).fetchone()[0]
            hist = self._db.execute(
                f"SELECT CAST((ts - ?) / ? AS INTEGER) AS b, count(*) FROM telegrams{where} GROUP BY b ORDER BY b",
                [since, width, *args],
            ).fetchall()
            heat = self._db.execute(
                "SELECT CAST(strftime('%w', ts, 'unixepoch', 'localtime') AS INTEGER),"
                " CAST(strftime('%H', ts, 'unixepoch', 'localtime') AS INTEGER), count(*)"
                f" FROM telegrams{where} GROUP BY 1, 2",
                args,
            ).fetchall()
            top_ga = self._db.execute(
                f"SELECT ga, destination, count(*) AS n FROM telegrams{where}{' AND ' if where else ' WHERE '}ga IS NOT NULL"
                " GROUP BY ga ORDER BY n DESC LIMIT ?",
                [*args, top],
            ).fetchall()
            top_src = self._db.execute(
                f"SELECT source, count(*) AS n FROM telegrams{where} GROUP BY source ORDER BY n DESC LIMIT ?",
                [*args, top],
            ).fetchall()
            kinds = self._db.execute(f"SELECT apci, count(*) FROM telegrams{where} GROUP BY apci", args).fetchall()
        heatmap = [[0] * 24 for _ in range(7)]
        for d, h, n in heat:
            if 0 <= d < 7 and 0 <= h < 24:
                heatmap[d][h] = n
        counts = {int(b): n for b, n in hist}
        span = max(1.0, until - since)
        return {
            "since": since,
            "until": until,
            "total": int(total),
            "per_second": total / span,
            "histogram": {"width": width, "counts": [counts.get(i, 0) for i in range(buckets)]},
            "heatmap": heatmap,
            "top_addresses": [{"ga": r[0], "destination": r[1], "count": r[2]} for r in top_ga],
            "top_sources": [{"source": r[0], "count": r[1]} for r in top_src],
            "by_apci": {r[0]: r[1] for r in kinds},
        }

    def availability(self, since: float, until: float) -> dict[str, Any]:
        """What the recorder was doing across a range: recording, link down, or not running; plus
        the longest pauses on the bus while it was recording."""
        self.flush()
        with self._lock:
            events = self._db.execute("SELECT ts, kind FROM events WHERE ts <= ? ORDER BY ts, id", (until,)).fetchall()
            gaps = self._db.execute(
                "SELECT prev, ts FROM (SELECT ts, LAG(ts) OVER (ORDER BY ts) AS prev FROM telegrams WHERE ts BETWEEN ? AND ?)"
                " WHERE ts - prev > ? ORDER BY ts - prev DESC LIMIT 20",
                (since, until, QUIET_GAP),
            ).fetchall()
            last_tg = self._db.execute("SELECT max(ts) FROM telegrams WHERE ts <= ?", (until,)).fetchone()[0]
        running = connected = False
        segments: list[dict[str, Any]] = []
        cursor = since

        def state() -> str:
            if not running:
                return "not_running"
            return "recording" if connected else "link_down"

        def close(at: float) -> None:
            nonlocal cursor
            at = min(max(at, since), until)
            if at > cursor:
                kind = state()
                if segments and segments[-1]["state"] == kind:
                    segments[-1]["to"] = at
                else:
                    segments.append({"state": kind, "from": cursor, "to": at})
            cursor = max(cursor, at)

        for ts, kind in events:
            if ts > since:
                close(ts)
            if kind == "start":
                running, connected = True, False
            elif kind == "stop":
                running, connected = False, False
            elif kind == "connected":
                connected = True
            elif kind == "disconnected":
                connected = False
        close(until)
        coverage: dict[str, float] = {"recording": 0.0, "link_down": 0.0, "not_running": 0.0}
        for s in segments:
            coverage[s["state"]] += s["to"] - s["from"]
        quiet = [{"from": p, "to": t} for p, t in gaps]
        if last_tg is not None and segments and segments[-1]["state"] == "recording" and until - last_tg > QUIET_GAP:
            quiet.insert(0, {"from": max(last_tg, since), "to": until})
        return {"since": since, "until": until, "segments": segments, "coverage": coverage, "quiet": quiet}

    def backfill(self, dpt_map: dict[int, str], limit: int = 200_000) -> int:
        """Fill in value/num/unit for rows recorded before their datapoint type was known (no
        project open, or the address typed later). Only rows that have no value are touched, so it
        is idempotent and never overwrites what the monitor decoded live."""
        if not dpt_map:
            return 0
        self.flush()
        done = 0
        with self._lock:
            pending = self._db.execute(
                "SELECT DISTINCT ga FROM telegrams WHERE value IS NULL AND ga IS NOT NULL AND raw != ''"
            ).fetchall()
        for (ga,) in pending:
            dpt = dpt_map.get(ga)
            if not dpt:
                continue
            with self._lock:
                rows = self._db.execute(
                    "SELECT id, raw FROM telegrams WHERE ga = ? AND value IS NULL AND raw != '' LIMIT ?",
                    (ga, limit - done),
                ).fetchall()
            updates = []
            for row_id, raw in rows:
                decoded = decode_raw(dpt, raw)
                if decoded is None:
                    continue
                value, unit = decoded
                updates.append((_text(value), numeric(value), unit, row_id))
            if updates:
                with self._lock:
                    self._db.execute("BEGIN")
                    self._db.executemany(
                        "UPDATE telegrams SET value = ?, num = ?, unit = ? WHERE id = ?", updates
                    )
                    self._db.execute("COMMIT")
                done += len(updates)
            if done >= limit:
                break
        if done:
            log.info("decoded %d recorded telegrams with the project's datapoint types", done)
        return done

    # --- backup ---------------------------------------------------------------------------------

    def export_to(self, dest: Path) -> None:
        """A consistent copy of the database (SQLite online backup)."""
        self.flush()
        with self._lock, contextlib.closing(sqlite3.connect(dest)) as out:
            self._db.backup(out)

    def import_from(self, src: Path) -> int:
        """Replace the recorded telegrams with those of a backup copy; events and meta stay."""
        self._buffer.clear()
        with self._lock, contextlib.closing(sqlite3.connect(f"file:{src}?mode=ro", uri=True)) as other:
            try:
                rows = other.execute(
                    "SELECT ts, direction, source, destination, kind, ga, apci, raw, value, num, unit FROM telegrams ORDER BY id"
                ).fetchall()
            except sqlite3.DatabaseError as exc:
                raise ValueError(f"not a telegram archive: {exc}") from exc
            self._db.execute("BEGIN")
            self._db.execute("DELETE FROM telegrams")
            self._db.executemany(
                "INSERT INTO telegrams (ts, direction, source, destination, kind, ga, apci, raw, value, num, unit)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                rows,
            )
            self._db.execute("COMMIT")
        return len(rows)


def _row(r: tuple[Any, ...]) -> dict[str, Any]:
    return {
        "id": r[0],
        "ts": r[1],
        "time": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(r[1])),
        "direction": r[2],
        "source": r[3],
        "destination": r[4],
        "destination_kind": r[5],
        "ga": r[6],
        "apci": r[7],
        "raw": r[8],
        "value": r[9],
        "num": r[10],
        "unit": r[11],
    }
