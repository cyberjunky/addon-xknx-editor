from __future__ import annotations

from pathlib import Path

from xknxeditor_web import dpts as d

MASTER = b"""<KNX xmlns="http://knx.org/xml/project/23"><MasterData><DatapointTypes>
  <DatapointType Id="DPT-1" Number="1" Name="1.xxx" Text="1-bit" SizeInBit="1">
    <DatapointSubtypes>
      <DatapointSubtype Id="DPST-1-1" Number="1" Name="DPT_Switch" Text="switch"/>
      <DatapointSubtype Id="DPST-1-8" Number="8" Name="DPT_UpDown" Text="up/down"/>
    </DatapointSubtypes>
  </DatapointType>
  <DatapointType Id="DPT-9" Number="9" Name="9.xxx" Text="2-byte float value" SizeInBit="16">
    <DatapointSubtypes><DatapointSubtype Id="DPST-9-1" Number="1" Name="DPT_Value_Temp" Text="temperature (&#176;C)"/></DatapointSubtypes>
  </DatapointType>
</DatapointTypes></MasterData></KNX>"""


def test_parse_dpts() -> None:
    items = d.parse_dpts(MASTER)
    ids = [i.id for i in items]
    assert ids == ["DPT-1", "DPST-1-1", "DPST-1-8", "DPT-9", "DPST-9-1"]
    assert items[1].text == "switch" and items[1].main_text == "1-bit" and items[1].size_bits == 1
    assert items[4].text.startswith("temperature")


def test_catalog_uses_cache_and_fallback(tmp_path: Path, monkeypatch) -> None:
    (tmp_path / "knx_master.xml").write_bytes(MASTER)
    cat = d.DptCatalog(tmp_path)
    assert [x.id for x in cat.dpts()][:2] == ["DPT-1", "DPST-1-1"] and cat.error is None

    def offline() -> bytes:
        raise OSError("no network")

    empty = d.DptCatalog(tmp_path / "nothing")
    monkeypatch.setattr(empty, "master_bytes", offline)
    fallback = empty.dpts()
    assert empty.error and any(x.id == "DPST-1-1" for x in fallback) and any(x.id == "DPST-9-1" for x in fallback)
