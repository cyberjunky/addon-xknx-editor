"""A line repeater gives a line a second segment. ETS writes one <Segment> per part of the line and
puts each device in the one it sits on; xknxproject flattens that, so the importer reads it from the
raw project XML (vendored patch)."""

from __future__ import annotations

import io

from xknxeditor.proj.core.knxproj_import import _read_segments  # noqa: PLC2701 - the patch's own rule

XML = b"""<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/23"><Project Id="P-01"><Installations><Installation>
<Topology>
  <Area Id="P-01-0_A-2" Address="4" Name="IP Gedeelte">
    <Line Id="P-01-0_L-3" Address="1" Name="TP lijn">
      <Segment Id="P-01-0_S-3" Number="0" MediumTypeRefId="MT-0">
        <DeviceInstance Id="P-01-0_DI-1" Address="1" Name="Gira S1" />
        <DeviceInstance Id="P-01-0_DI-3" Address="3" Name="Lijnkoppelaar" />
      </Segment>
      <Segment Id="P-01-0_S-9" Number="1" MediumTypeRefId="MT-0" Name="TP buiten segment">
        <DeviceInstance Id="P-01-0_DI-4" Address="4" Name="Weerstation" />
      </Segment>
    </Line>
    <Line Id="P-01-0_L-2" Address="0">
      <Segment Id="P-01-0_S-2" Number="0" MediumTypeRefId="MT-5" />
    </Line>
  </Area>
</Topology>
</Installation></Installations></Project></KNX>"""

OLD_SCHEMA = b"""<?xml version="1.0" encoding="utf-8"?>
<KNX xmlns="http://knx.org/xml/project/20"><Project Id="P-01"><Installations><Installation><Topology>
  <Area Address="1"><Line Address="1" MediumTypeRefId="MT-0">
    <DeviceInstance Id="P-01-0_DI-1" Address="1" />
  </Line></Area>
</Topology></Installation></Installations></Project></KNX>"""


class Contents:
    """The slice of xknxproject's KNXProjContents the reader uses."""

    def __init__(self, raw: bytes | None) -> None:
        self.raw = raw

    def open_project_0(self) -> io.BytesIO:
        if self.raw is None:
            raise FileNotFoundError("0.xml")
        return io.BytesIO(self.raw)


def test_segments_are_read_per_line() -> None:
    found = _read_segments(Contents(XML))
    assert set(found) == {(4, 1), (4, 0)}
    line = found[(4, 1)]
    assert [s.number for s in line] == [0, 1]
    assert [s.name for s in line] == ["", "TP buiten segment"]
    assert line[0].device_ids == ("P-01-0_DI-1", "P-01-0_DI-3")
    assert line[1].device_ids == ("P-01-0_DI-4",)
    assert line[1].medium_type == "MT-0"
    # A line whose segment holds no device is still a segment.
    assert found[(4, 0)][0].device_ids == ()


def test_a_project_without_segments_reads_none() -> None:
    # ETS 5 and older write the devices straight under the line; the importer then makes one
    # segment per line as before.
    assert _read_segments(Contents(OLD_SCHEMA)) == {}
    assert _read_segments(Contents(None)) == {}
    assert _read_segments(Contents(b"not xml")) == {}
