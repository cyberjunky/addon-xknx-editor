from __future__ import annotations

from xknxeditor_web.dpts import parse_dpts

MASTER = b"""<KNX xmlns="http://knx.org/xml/project/20"><MasterData><DatapointTypes>
<DatapointType Id="DPT-9" Number="9" Name="9.xxx" Text="2-byte float value" SizeInBit="16"><DatapointSubtypes>
<DatapointSubtype Id="DPST-9-1" Number="1" Name="DPT_Value_Temp" Text="temperature (degrees C)"><Format><Float Unit="\xc2\xb0C" /></Format></DatapointSubtype>
<DatapointSubtype Id="DPST-9-25" Number="25" Name="DPT_Value_Volume_Flow" Text="volume flow (l/h)"><Format><Float /></Format></DatapointSubtype>
</DatapointSubtypes></DatapointType>
<DatapointType Id="DPT-1" Number="1" Name="1.xxx" Text="1-bit" SizeInBit="1"><DatapointSubtypes>
<DatapointSubtype Id="DPST-1-1" Number="1" Name="DPT_Switch" Text="switch" />
</DatapointSubtypes></DatapointType>
</DatapointTypes></MasterData></KNX>"""


def test_units_and_numbers() -> None:
    by_id = {d.id: d for d in parse_dpts(MASTER)}
    assert by_id["DPST-9-1"].unit == "°C" and by_id["DPST-9-1"].number == "9.001"
    # Missing in the master data: xknx supplies it.
    assert by_id["DPST-9-25"].unit == "L/h"
    assert by_id["DPST-1-1"].unit is None and by_id["DPT-1"].number == "1"
