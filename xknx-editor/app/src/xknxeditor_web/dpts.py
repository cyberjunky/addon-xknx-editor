"""Datapoint types from the KNX master data (fetched once, cached under /config).

The master file is KNX Association content and is never bundled; it is downloaded from
update.knx.org on first use, exactly as the desktop editor does, and kept at
``<config>/knx_master.xml`` for offline use.
"""

from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Dpt:
    id: str  # DPST-1-1
    main: int
    sub: int | None
    name: str  # DPT_Switch
    text: str  # switch
    main_text: str  # 1-bit
    size_bits: int | None
    unit: str | None = None  # °C, m³, l/h
    number: str = ""  # 9.001, or 9 for a main type

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _xknx_unit(main: int, sub: int | None) -> str | None:
    """The unit xknx knows for a sub-type; the master data leaves many of them out."""
    if sub is None:
        return None
    try:
        from xknx.dpt import DPTBase

        transcoder = DPTBase.parse_transcoder(f"{main}.{sub:03d}")
    except Exception:  # noqa: BLE001 - a type xknx does not implement has no unit here
        return None
    unit = getattr(transcoder, "unit", None) if transcoder is not None else None
    return unit or None


def _with_numbers(dpts: list[Dpt]) -> list[Dpt]:
    from dataclasses import replace

    return [
        replace(
            d,
            number=f"{d.main}.{d.sub:03d}" if d.sub is not None else str(d.main),
            unit=d.unit or _xknx_unit(d.main, d.sub),
        )
        for d in dpts
    ]


def _local(tag: object) -> str:
    return str(tag).rsplit("}", 1)[-1]


def parse_dpts(xml_bytes: bytes) -> list[Dpt]:
    root = ET.fromstring(xml_bytes)
    out: list[Dpt] = []
    for dt in root.iter():
        if _local(dt.tag) != "DatapointType":
            continue
        main_id = dt.get("Id") or ""
        try:
            main = int(dt.get("Number") or main_id.removeprefix("DPT-"))
        except ValueError:
            continue
        size = dt.get("SizeInBit")
        main_text = dt.get("Text") or dt.get("Name") or main_id
        out.append(Dpt(main_id, main, None, dt.get("Name") or main_id, main_text, main_text, int(size) if size and size.isdigit() else None))
        for st in dt.iter():
            if _local(st.tag) != "DatapointSubtype":
                continue
            sid = st.get("Id") or ""
            try:
                sub = int(st.get("Number") or sid.rsplit("-", 1)[-1])
            except ValueError:
                continue
            unit = next((el.get("Unit") for el in st.iter() if el.get("Unit")), None)
            out.append(Dpt(sid, main, sub, st.get("Name") or sid, st.get("Text") or st.get("Name") or sid, main_text, int(size) if size and size.isdigit() else None, unit))
    out.sort(key=lambda d: (d.main, d.sub if d.sub is not None else -1))
    return _with_numbers(out)


class DptCatalog:
    def __init__(self, config_dir: Path) -> None:
        self._path = config_dir / "knx_master.xml"
        self._dpts: list[Dpt] | None = None
        self.error: str | None = None

    def master_bytes(self) -> bytes:
        if self._path.is_file():
            return self._path.read_bytes()
        from xknxeditor.proj import fetch_master_xml

        data = fetch_master_xml()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_bytes(data)
        log.info("fetched knx_master.xml (%d bytes)", len(data))
        return data

    def dpts(self) -> list[Dpt]:
        if self._dpts is None:
            try:
                self._dpts = parse_dpts(self.master_bytes())
                self.error = None
            except Exception as exc:  # noqa: BLE001 - offline first start; fall back to a short list
                self.error = f"{type(exc).__name__}: {exc}"
                log.warning("master data unavailable (%s); using the built-in datapoint list", self.error)
                self._dpts = _with_numbers([Dpt(f"DPST-{m}-{s}", m, s, n, t, mt, b) for m, s, n, t, mt, b in _FALLBACK])
        return self._dpts


_FALLBACK: list[tuple[int, int, str, str, str, int]] = [
    (1, 1, "DPT_Switch", "switch", "1-bit", 1),
    (1, 2, "DPT_Bool", "boolean", "1-bit", 1),
    (1, 3, "DPT_Enable", "enable", "1-bit", 1),
    (1, 7, "DPT_Step", "step", "1-bit", 1),
    (1, 8, "DPT_UpDown", "up/down", "1-bit", 1),
    (1, 9, "DPT_OpenClose", "open/close", "1-bit", 1),
    (1, 10, "DPT_Start", "start/stop", "1-bit", 1),
    (1, 11, "DPT_State", "state", "1-bit", 1),
    (1, 17, "DPT_Trigger", "trigger", "1-bit", 1),
    (1, 24, "DPT_DayNight", "day/night", "1-bit", 1),
    (2, 1, "DPT_Switch_Control", "switch control", "1-bit controlled", 2),
    (3, 7, "DPT_Control_Dimming", "dimming control", "3-bit controlled", 4),
    (3, 8, "DPT_Control_Blinds", "blinds control", "3-bit controlled", 4),
    (5, 1, "DPT_Scaling", "percentage (0..100%)", "8-bit unsigned value", 8),
    (5, 3, "DPT_Angle", "angle (degrees)", "8-bit unsigned value", 8),
    (5, 4, "DPT_Percent_U8", "percentage (0..255%)", "8-bit unsigned value", 8),
    (5, 10, "DPT_Value_1_Ucount", "counter pulses (0..255)", "8-bit unsigned value", 8),
    (6, 1, "DPT_Percent_V8", "percentage (-128..127%)", "8-bit signed value", 8),
    (7, 1, "DPT_Value_2_Ucount", "pulses", "2-byte unsigned value", 16),
    (7, 7, "DPT_TimePeriodHrs", "time period (hours)", "2-byte unsigned value", 16),
    (8, 1, "DPT_Value_2_Count", "pulses difference", "2-byte signed value", 16),
    (9, 1, "DPT_Value_Temp", "temperature (°C)", "2-byte float value", 16),
    (9, 2, "DPT_Value_Tempd", "temperature difference (K)", "2-byte float value", 16),
    (9, 4, "DPT_Value_Lux", "lux (Lux)", "2-byte float value", 16),
    (9, 5, "DPT_Value_Wsp", "speed (m/s)", "2-byte float value", 16),
    (9, 6, "DPT_Value_Pres", "pressure (Pa)", "2-byte float value", 16),
    (9, 7, "DPT_Value_Humidity", "humidity (%)", "2-byte float value", 16),
    (9, 8, "DPT_Value_AirQuality", "parts/million (ppm)", "2-byte float value", 16),
    (9, 24, "DPT_Power", "power (kW)", "2-byte float value", 16),
    (10, 1, "DPT_TimeOfDay", "time of day", "time", 24),
    (11, 1, "DPT_Date", "date", "date", 24),
    (12, 1, "DPT_Value_4_Ucount", "counter pulses (unsigned)", "4-byte unsigned value", 32),
    (13, 1, "DPT_Value_4_Count", "counter pulses (signed)", "4-byte signed value", 32),
    (13, 10, "DPT_ActiveEnergy", "active energy (Wh)", "4-byte signed value", 32),
    (13, 13, "DPT_ActiveEnergy_kWh", "active energy (kWh)", "4-byte signed value", 32),
    (14, 19, "DPT_Value_Electric_Current", "electric current (A)", "4-byte float value", 32),
    (14, 56, "DPT_Value_Power", "power (W)", "4-byte float value", 32),
    (14, 76, "DPT_Value_Volume", "volume (m³)", "4-byte float value", 32),
    (16, 0, "DPT_String_ASCII", "character string (ASCII)", "character string", 112),
    (16, 1, "DPT_String_8859_1", "character string (ISO 8859-1)", "character string", 112),
    (17, 1, "DPT_SceneNumber", "scene number", "scene number", 8),
    (18, 1, "DPT_SceneControl", "scene control", "scene control", 8),
    (19, 1, "DPT_DateTime", "date time", "date time", 64),
    (20, 102, "DPT_HVACMode", "HVAC mode", "1-byte", 8),
    (232, 600, "DPT_Colour_RGB", "RGB value 3x(0..255)", "RGB value", 24),
    (251, 600, "DPT_Colour_RGBW", "RGBW value 4x(0..100%)", "RGBW value", 48),
]
