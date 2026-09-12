"""KNX bus connection: gateway settings, connect/disconnect, live telegram capture.

Runs on the server's asyncio loop (xknx is asyncio-native); nothing here touches the project or
catalog databases. Settings persist in ``<config>/settings.json``. The add-on connects at
start-up only when ``auto_connect`` is on (Home Assistant's KNX integration usually owns the
gateway's tunnel, so the user decides whether the editor takes one around the clock); with it on,
a gateway that is down at boot is retried until it answers, and xknx reconnects by itself after a
dropout. Every telegram also goes to the ``TelegramRecorder`` when recording is on.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
import json
import logging
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from xknx import XKNX
from xknx.io import ConnectionConfig, ConnectionType, SecureConfig
from xknx.io.gateway_scanner import GatewayScanner
from xknx.telegram import Telegram
from xknx.telegram.address import GroupAddress, IndividualAddress

from xknxeditor_web.recorder import TelegramRecorder
from xknxeditor_web.worker import EditorWorker

log = logging.getLogger(__name__)

TYPES = ("auto", "tunneling", "tunneling_tcp", "tunneling_secure", "routing", "routing_secure")


@dataclass
class BusSettings:
    connection_type: str = "auto"
    gateway_ip: str = ""
    gateway_port: int = 3671
    gateway_name: str = ""
    multicast_group: str = "224.0.23.12"
    individual_address: str = ""
    keyring_path: str = ""
    keyring_password: str = ""
    user_id: int | None = None
    local_ip: str = ""
    auto_connect: bool = False
    # Round-the-clock recording to /config/telegrams.db (needs auto_connect to be useful).
    record: bool = True
    retain_days: int = 30
    retain_rows: int = 500000

    def public(self) -> dict[str, Any]:
        d = asdict(self)
        d["keyring_password"] = "***" if self.keyring_password else ""
        return d


@dataclass
class TelegramRecord:
    id: int
    time: str
    ts: float
    direction: str
    source: str
    destination: str
    destination_kind: str
    apci: str
    raw: str
    value: Any = None
    unit: str | None = None
    destination_name: str = ""
    destination_dpt: str | None = None
    ga: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class BusState:
    state: str = "DISCONNECTED"
    error: str | None = None
    connected_since: str | None = None
    gateway: dict[str, Any] | None = None
    telegrams: int = 0


class BusService:
    def __init__(self, config_dir: Path, worker: EditorWorker, recorder: TelegramRecorder | None = None) -> None:
        self._path = config_dir / "settings.json"
        self._worker = worker
        self.recorder = recorder
        self._auto_task: asyncio.Task[None] | None = None
        self.settings = self._load()
        self.state = BusState()
        self._xknx: XKNX | None = None
        self._records: deque[TelegramRecord] = deque(maxlen=1000)
        self._seq = 0
        self._lock = asyncio.Lock()
        self.dpt_map: dict[int, str] = {}
        self.name_map: dict[int, str] = {}
        self.decoding: dict[str, Any] = {"project": False, "addresses": 0, "with_dpt": 0, "from_objects": 0}
        self.dpt_source: Callable[[], Awaitable[dict[str, Any]]] | None = None
        self._apply_recording()

    # --- settings -----------------------------------------------------------

    def _load(self) -> BusSettings:
        try:
            data = json.loads(self._path.read_text(encoding="utf-8")).get("bus", {})
            return BusSettings(**{k: v for k, v in data.items() if k in BusSettings.__dataclass_fields__})
        except (OSError, ValueError, TypeError):
            return BusSettings()

    def save(self) -> None:
        data: dict[str, Any] = {}
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            pass
        data["bus"] = asdict(self.settings)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def update(self, changes: dict[str, Any]) -> BusSettings:
        for key, value in changes.items():
            if key not in BusSettings.__dataclass_fields__:
                raise ValueError(f"Unknown setting {key!r}")
            if key == "connection_type" and value not in TYPES:
                raise ValueError(f"connection_type must be one of {TYPES}")
            if key == "keyring_password" and value == "***":
                continue
            setattr(self.settings, key, value)
        self.save()
        self._apply_recording()
        if self._xknx is None and self.state.error:
            self.state.error = None  # stale failure from the old settings
            self._emit_state()
        return self.settings

    def _apply_recording(self) -> None:
        if self.recorder is None:
            return
        self.recorder.enabled = bool(self.settings.record)
        self.recorder.retain_days = max(0, int(self.settings.retain_days))
        self.recorder.retain_rows = max(0, int(self.settings.retain_rows))

    # --- status -------------------------------------------------------------

    def status(self) -> dict[str, Any]:
        s = asdict(self.state)
        s["telegrams"] = len(self._records)
        s["settings"] = self.settings.public()
        s["decoding"] = dict(self.decoding)
        s["recording"] = self.recorder.enabled if self.recorder is not None else False
        s["retrying"] = self._auto_task is not None and not self._auto_task.done()
        return s

    # --- connect / disconnect -------------------------------------------------

    def _config(self) -> ConnectionConfig:
        s = self.settings
        secure = None
        if s.keyring_path:
            secure = SecureConfig(
                knxkeys_file_path=s.keyring_path,
                knxkeys_password=s.keyring_password or None,
                user_id=s.user_id,
            )
        ctype = {
            "auto": ConnectionType.AUTOMATIC,
            "tunneling": ConnectionType.TUNNELING,
            "tunneling_tcp": ConnectionType.TUNNELING_TCP,
            "tunneling_secure": ConnectionType.TUNNELING_TCP_SECURE,
            "routing": ConnectionType.ROUTING,
            "routing_secure": ConnectionType.ROUTING_SECURE,
        }[s.connection_type]
        kwargs: dict[str, Any] = {"connection_type": ctype}
        if ctype in (ConnectionType.ROUTING, ConnectionType.ROUTING_SECURE):
            kwargs["multicast_group"] = s.multicast_group or "224.0.23.12"
        elif s.gateway_ip:
            kwargs["gateway_ip"] = s.gateway_ip
            kwargs["gateway_port"] = s.gateway_port or 3671
        if s.local_ip:
            kwargs["local_ip"] = s.local_ip
        if s.individual_address:
            kwargs["individual_address"] = s.individual_address
        if secure is not None:
            kwargs["secure_config"] = secure
        return ConnectionConfig(**kwargs)

    def precheck(self) -> str | None:
        """A human explanation of why connecting cannot work with the current settings."""
        s = self.settings
        secure = s.connection_type in ("tunneling_secure", "routing_secure")
        if secure and not s.keyring_path:
            return "IP Secure needs a keyring: open Connection settings, upload or pick the project's .knxkeys file and enter its password."
        if s.keyring_path and not Path(s.keyring_path).is_file():
            return f"Keyring file not found: {s.keyring_path}"
        if s.connection_type in ("tunneling", "tunneling_tcp", "tunneling_secure") and not s.gateway_ip:
            return "No gateway selected: pick one from the list (top right) or enter its IP in Connection settings."
        return None

    async def keyring_summary(self, password: str | None = None) -> dict[str, Any]:
        """Verify the keyring password and describe what the file holds (no secrets returned)."""
        from xknx.exceptions import InvalidSecureConfiguration
        from xknx.secure.keyring import load_keyring

        path = self.settings.keyring_path
        if not path or not Path(path).is_file():
            return {"ok": False, "error": "No keyring file configured"}
        pw = password if password is not None else self.settings.keyring_password
        try:
            kr = await load_keyring(path, pw)
        except InvalidSecureConfiguration as exc:
            return {"ok": False, "error": f"Keyring password rejected ({exc})"}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": f"Cannot read keyring: {type(exc).__name__}: {exc}"}
        gw = self.settings.gateway_ip
        return {
            "ok": True,
            "project": kr.project_name,
            "created_by": kr.created_by,
            "created": kr.created,
            "backbone": kr.backbone is not None,
            "interfaces": [
                {
                    "type": getattr(i.type, "value", str(i.type)),
                    "individual_address": str(i.individual_address),
                    "host": str(i.host) if i.host else None,
                    "user_id": i.user_id,
                }
                for i in kr.interfaces
            ],
            "devices": [str(d.individual_address) for d in kr.devices],
            "group_addresses": len(kr.group_addresses),
            "gateway_hint": gw,
        }

    async def connect(self) -> dict[str, Any]:
        async with self._lock:
            if self._xknx is not None:
                return self.status()
            problem = self.precheck()
            if problem:
                log.warning("bus connect refused: %s", problem)
                self.state = BusState(state="DISCONNECTED", error=problem)
                self._emit_state()
                return self.status()
            s = self.settings
            log.info(
                "bus connect: %s to %s:%s (keyring=%s, user=%s, own address=%s)",
                s.connection_type, s.gateway_ip or s.multicast_group, s.gateway_port,
                "yes" if s.keyring_path else "no", s.user_id or "auto", s.individual_address or "auto",
            )
            self.state = BusState(state="CONNECTING")
            self._emit_state()
            xknx = XKNX(connection_config=self._config(), telegram_received_cb=self._on_telegram)
            try:
                if self.dpt_source is not None:
                    self.apply_table(await self.dpt_source())
                self._apply_dpts(xknx)
                await asyncio.wait_for(xknx.start(), timeout=20)
            except Exception as exc:  # noqa: BLE001 - reported to the client
                await _stop_quietly(xknx)
                self.state = BusState(state="DISCONNECTED", error=f"{type(exc).__name__}: {exc}")
                self._emit_state()
                log.warning("bus connect failed: %s", self.state.error, exc_info=True)
                return self.status()
            self._xknx = xknx
            gw = xknx.knxip_interface.gateway_info if hasattr(xknx.knxip_interface, "gateway_info") else None
            self.state = BusState(
                state="CONNECTED",
                connected_since=time.strftime("%Y-%m-%dT%H:%M:%S"),
                gateway=_gateway_dict(gw) if gw else {"ip": self.settings.gateway_ip, "name": self.settings.gateway_name},
            )
            xknx.connection_manager.register_connection_state_changed_cb(self._on_state)
            self._record_event("connected")
            self._emit_state()
            log.info("bus connected via %s", self.settings.connection_type)
            return self.status()

    def keep_connected(self) -> None:
        """Auto-connect: try until the gateway answers, backing off from 5 s to 2 min. A user
        disconnect stops the attempts; xknx handles reconnects after a dropout on its own."""
        if self._auto_task is not None and not self._auto_task.done():
            return
        self._auto_task = asyncio.get_running_loop().create_task(self._retry_connect())

    async def _retry_connect(self) -> None:
        delay = 5
        try:
            while self.settings.auto_connect and self._xknx is None:
                result = await self.connect()
                if result["state"] == "CONNECTED":
                    return
                log.info("auto-connect failed (%s); next try in %d s", result.get("error"), delay)
                await asyncio.sleep(delay)
                delay = min(delay * 2, 120)
        except asyncio.CancelledError:
            pass

    async def disconnect(self) -> dict[str, Any]:
        if self._auto_task is not None and not self._auto_task.done():
            self._auto_task.cancel()
        async with self._lock:
            xknx, self._xknx = self._xknx, None
            if xknx is not None:
                await _stop_quietly(xknx)
                self._record_event("disconnected")
                log.info("bus disconnected")
            self.state = BusState()
            self._emit_state()
            return self.status()

    async def shutdown(self) -> None:
        await self.disconnect()

    async def scan(self) -> list[dict[str, Any]]:
        scanner = GatewayScanner(XKNX(), timeout_in_seconds=3.0)
        return [_gateway_dict(g) for g in await scanner.scan()]

    # --- telegrams -------------------------------------------------------------

    def set_dpt_map(self, mapping: dict[int, str]) -> None:
        """Group address value → DPT string ("DPST-1-1") from the open project, for decoding."""
        self.dpt_map = mapping
        if self._xknx is not None:
            self._apply_dpts(self._xknx)

    async def refresh_dpts(self) -> int:
        """Pull the open project's DPT table through ``dpt_source`` (set by the app) and apply it.
        Called on connect and whenever the project changes, so the monitor decodes regardless of
        whether the project was opened before or after connecting."""
        source = getattr(self, "dpt_source", None)
        if source is None:
            return len(self.dpt_map)
        try:
            table = await source()
        except Exception as exc:  # noqa: BLE001 - decoding is best effort
            log.warning("could not read the project's DPT table: %s", exc)
            return len(self.dpt_map)
        self.apply_table(table)
        return len(self.dpt_map)

    def apply_table(self, table: dict[str, Any]) -> None:
        """Take the editor's monitor table (names, dpts, counts)."""
        self.name_map = dict(table.get("names") or {})
        self.decoding = {
            "project": bool(table.get("addresses") or table.get("names")),
            "addresses": int(table.get("addresses") or 0),
            "with_dpt": int(table.get("with_dpt") or 0),
            "from_objects": int(table.get("from_objects") or 0),
        }
        self.set_dpt_map(dict(table.get("dpts") or {}))

    def _apply_dpts(self, xknx: XKNX) -> None:
        from xknx.dpt import DPTBase

        # GroupAddressDPT.set() parses strings itself ("1.001"); it silently drops anything else.
        table: dict[Any, Any] = {}
        for address, dpt in self.dpt_map.items():
            spec = _dpt_to_xknx(dpt)
            if DPTBase.parse_transcoder(spec) is not None:
                table[GroupAddress(address)] = spec
        xknx.group_address_dpt.clear()
        if table:
            xknx.group_address_dpt.set(table)
        log.info("group monitor decodes %d of %d group addresses", len(table), len(self.dpt_map))

    def _on_telegram(self, telegram: Telegram) -> None:
        self._seq += 1
        payload = telegram.payload
        raw = ""
        value: Any = None
        unit = None
        if payload is not None and hasattr(payload, "value") and payload.value is not None:
            v = payload.value
            raw = " ".join(f"{b:02X}" for b in v.value) if hasattr(v, "value") and isinstance(v.value, tuple) else (f"{v.value:02X}" if hasattr(v, "value") else str(v))
        if telegram.decoded_data is not None:
            value = telegram.decoded_data.value
            unit = getattr(telegram.decoded_data.transcoder, "unit", None)
            if hasattr(value, "value"):
                value = getattr(value, "value")
            if not isinstance(value, (int, float, str, bool)) and value is not None:
                value = str(value)
        dest = telegram.destination_address
        ga_value = dest.raw if isinstance(dest, GroupAddress) else None
        now = time.time()
        record = TelegramRecord(
            id=self._seq,
            time=time.strftime("%H:%M:%S", time.localtime(now)),
            ts=now,
            direction=str(getattr(telegram.direction, "value", telegram.direction)),
            source=str(telegram.source_address),
            destination=str(dest),
            destination_kind="group" if isinstance(dest, GroupAddress) else "individual" if isinstance(dest, IndividualAddress) else "other",
            apci=type(payload).__name__ if payload is not None else "",
            raw=raw,
            value=value,
            unit=unit,
            destination_name=self.name_map.get(ga_value, "") if ga_value is not None else "",
            destination_dpt=self.dpt_map.get(ga_value) if ga_value is not None else None,
            ga=ga_value,
        )
        self._records.append(record)
        self.state.telegrams = len(self._records)
        data = record.to_dict()
        if self.recorder is not None:
            self.recorder.add(data)
        self._worker.emit({"type": "telegram", "telegram": data})

    def telegrams(self, since: int = 0, limit: int = 500) -> list[dict[str, Any]]:
        return [r.to_dict() for r in self._records if r.id > since][-limit:]

    def clear(self) -> None:
        self._records.clear()
        self.state.telegrams = 0

    # --- group communication ---------------------------------------------------

    async def group_read(self, address: str) -> None:
        from xknx.telegram.apci import GroupValueRead

        xknx = self._require()
        await xknx.telegrams.put(Telegram(destination_address=GroupAddress(address), payload=GroupValueRead()))

    async def group_write_raw(self, address: str, data: bytes | int, small: bool) -> None:
        from xknx.dpt import DPTArray, DPTBinary
        from xknx.telegram.apci import GroupValueWrite

        xknx = self._require()
        payload = GroupValueWrite(DPTBinary(int(data)) if small else DPTArray(bytes(data)))
        await xknx.telegrams.put(Telegram(destination_address=GroupAddress(address), payload=payload))

    def _require(self) -> XKNX:
        if self._xknx is None:
            raise RuntimeError("Not connected to the bus")
        return self._xknx

    # --- internals --------------------------------------------------------------

    async def _on_state(self, state: Any) -> None:
        name = getattr(state, "value", str(state))
        if self._xknx is not None:
            was = self.state.state
            self.state.state = name
            if name == "DISCONNECTED":
                self.state.error = self.state.error or "Connection lost"
                if was == "CONNECTED":
                    self._record_event("disconnected")
            elif name == "CONNECTED":
                self.state.error = None
                if was != "CONNECTED":
                    self._record_event("connected")
            self._emit_state()

    def _record_event(self, kind: str) -> None:
        if self.recorder is not None:
            try:
                self.recorder.event(kind)
            except Exception:  # noqa: BLE001 - the event log is advisory
                log.debug("recorder event %s failed", kind, exc_info=True)

    def _emit_state(self) -> None:
        self._worker.emit({"type": "bus", "bus": self.status()})


async def _stop_quietly(xknx: XKNX) -> None:
    """Stop an XKNX instance on a cleanup path; its own errors must not mask the real one."""
    try:
        await asyncio.wait_for(xknx.stop(), timeout=10)
    except Exception as exc:  # noqa: BLE001
        log.debug("xknx.stop() during cleanup: %s", exc)


def _gateway_dict(g: Any) -> dict[str, Any]:
    return {
        "name": getattr(g, "name", ""),
        "ip": getattr(g, "ip_addr", ""),
        "port": getattr(g, "port", 3671),
        "individual_address": str(getattr(g, "individual_address", "") or ""),
        "tunnelling": bool(getattr(g, "supports_tunnelling", False)),
        "tunnelling_tcp": bool(getattr(g, "supports_tunnelling_tcp", False)),
        "routing": bool(getattr(g, "supports_routing", False)),
        "secure_tunnelling": bool(getattr(g, "tunnelling_requires_secure", False)),
        "secure_routing": bool(getattr(g, "routing_requires_secure", False)),
        "current_ip": getattr(g, "current_ip", None) and str(g.current_ip),
    }


def _dpt_to_xknx(dpt: str) -> str:
    """``DPST-1-1`` → ``1.001``; ``DPT-1`` → ``1``; pass anything else through."""
    parts = dpt.split("-")
    if parts[0] == "DPST" and len(parts) == 3 and parts[1].isdigit() and parts[2].isdigit():
        return f"{int(parts[1])}.{int(parts[2]):03d}"
    if parts[0] == "DPT" and len(parts) == 2 and parts[1].isdigit():
        return parts[1]
    return dpt
