"""MDT DALI gateway commissioning over the bus (upstream package ``xknxeditor-dali``).

Glue between the bus connection and the commissioner, ported from the desktop app's
``programming_dali.py``: open a (Tool-Key secured when the keyring has one) point-to-point
connection to the gateway, run one operation, close. Manufacturer specific (MDT DALI Control
gateways); verify against real hardware.
"""

from __future__ import annotations

import contextlib
from collections.abc import Awaitable, Callable
from dataclasses import asdict
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from xknx import XKNX
    from xknxeditor.dali import DaliBusState, MdtDaliCommissioner
    from xknxeditor.download import DeviceSecurity

# MDT DALI Control gateway application-id prefixes (manufacturer M-0083; 1x64 / 2x64 + presence
# variants). Matched as a prefix of the full ``Application.id`` (e.g. "M-0083_A-0154-40-0F69-O00EF").
_MDT_DALI_PREFIXES = tuple(f"M-0083_A-{n}" for n in ("0153", "0154", "0155", "0158"))

OPERATIONS = ("scan", "broadcast", "switch", "blink", "group-switch", "group-blink", "new-install", "post-install", "abort")


def is_mdt_dali_app(app_id: str | None) -> bool:
    """Whether ``app_id`` is an MDT DALI Control gateway application (gates the DALI tab)."""
    return bool(app_id) and app_id.upper().startswith(_MDT_DALI_PREFIXES)


async def run_dali_operation[T](
    xknx: XKNX,
    address: str,
    security: DeviceSecurity | None,
    channel: int,
    op: Callable[[MdtDaliCommissioner], Awaitable[T]],
) -> T:
    """Open a connection to ``address``, run ``op`` against an ``MdtDaliCommissioner``, then close."""
    from xknx.telegram import IndividualAddress
    from xknxeditor.dali import MdtDaliCommissioner, MdtDaliConnection
    from xknxeditor.download import DeviceProgrammer
    from xknxeditor.download.download import (
        _apdu_overhead,  # pyright: ignore[reportPrivateUsage]
        _connection_manager,  # pyright: ignore[reportPrivateUsage]
    )

    target = IndividualAddress(address)
    manager = _connection_manager(xknx, target, security)
    connection = await manager.open()
    try:
        programmer = DeviceProgrammer(connection, apdu_overhead=_apdu_overhead(security))
        # Negotiate the device's real APDU length; multi-byte DALI property writes do not fit the
        # mandatory 15-octet default.
        programmer.max_apdu_length = await programmer.read_max_apdu_length()
        commissioner = MdtDaliCommissioner(MdtDaliConnection(programmer, channel))
        return await op(commissioner)
    finally:
        with contextlib.suppress(Exception):
            await manager.close()


def state_dict(state: DaliBusState) -> dict[str, Any]:
    from xknxeditor.dali.model import GROUP_SINGLE, GROUP_UNASSIGNED

    def group_label(g: int) -> str:
        return "single" if g == GROUP_SINGLE else "unassigned" if g == GROUP_UNASSIGNED else str(g)

    ecgs = []
    for e in state.ecgs:
        d = asdict(e)
        d["group_label"] = group_label(e.group_index)
        d["long_address_hex"] = f"{e.long_address:06X}"
        ecgs.append(d)
    return {
        "channel": state.channel,
        "firmware": ".".join(str(x) for x in state.firmware) if state.firmware else None,
        "ecgs": ecgs,
        "present": sum(1 for e in state.ecgs if e.present),
        "groups": [asdict(g) for g in state.groups],
    }


def operation(name: str, params: dict[str, Any], progress: Callable[[str], None]) -> Callable[[MdtDaliCommissioner], Awaitable[Any]]:
    """Build the coroutine for a named operation; results are JSON-ready."""
    slot = int(params.get("slot", 0))
    group = int(params.get("group", 0))
    on = bool(params.get("on", True))

    def on_progress(readback: object) -> None:
        found = getattr(readback, "param1", None)
        if found is not None:
            progress(f"found {found}")

    async def scan(c: MdtDaliCommissioner) -> Any:
        return state_dict(await c.scan())

    async def broadcast(c: MdtDaliCommissioner) -> Any:
        await c.broadcast(on)
        return {"broadcast": on}

    async def switch(c: MdtDaliCommissioner) -> Any:
        await c.switch_ecg(slot, on)
        return {"slot": slot, "on": on}

    async def blink(c: MdtDaliCommissioner) -> Any:
        await c.blink_ecg(slot, on)
        return {"slot": slot, "blink": on}

    async def group_switch(c: MdtDaliCommissioner) -> Any:
        await c.switch_group(group, on)
        return {"group": group, "on": on}

    async def group_blink(c: MdtDaliCommissioner) -> Any:
        await c.blink_group(group, on)
        return {"group": group, "blink": on}

    async def new_install(c: MdtDaliCommissioner) -> Any:
        return state_dict(await c.new_installation(on_progress=on_progress))

    async def post_install(c: MdtDaliCommissioner) -> Any:
        return state_dict(await c.post_installation(on_progress=on_progress))

    async def abort(c: MdtDaliCommissioner) -> Any:
        await c.abort()
        return {"aborted": True}

    table: dict[str, Callable[[MdtDaliCommissioner], Awaitable[Any]]] = {
        "scan": scan,
        "broadcast": broadcast,
        "switch": switch,
        "blink": blink,
        "group-switch": group_switch,
        "group-blink": group_blink,
        "new-install": new_install,
        "post-install": post_install,
        "abort": abort,
    }
    if name not in table:
        raise ValueError(f"unknown DALI operation {name!r}; one of {', '.join(OPERATIONS)}")
    return table[name]
