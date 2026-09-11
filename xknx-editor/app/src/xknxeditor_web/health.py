"""Project health checks: actionable findings with a device or group address to jump to.

Mirrors the desktop editor's Health panel: missing or duplicate individual addresses,
applications missing from the catalog, com-objects without a group address, group addresses
without a datapoint type, and group addresses with no or several senders.

Plus the checks a KNX segment has to satisfy physically: a segment is what one power supply feeds,
so its device count and its total bus current are per-segment facts, not per-line ones.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING, Any

# A KNX TP segment carries at most 64 devices, and the common power supply ratings are 320, 640 and
# 1280 mA. The .knxprod carries a device's *draw* but not a supply's rated output, so a total can
# only be compared against an assumption: warn past the most common 640 mA rating and say so.
MAX_DEVICES_PER_SEGMENT = 64
ASSUMED_SUPPLY_MA = 640.0

# A parameter is only worth comparing across devices when there are enough of them to say what
# "the others" even do; with two devices a difference is just a difference.
MIN_SIBLINGS_FOR_OUTLIER = 3


def _keyring_path(editor: "Editor") -> str:
    """The keyring the bus is configured with, read from the settings the BusService persists.

    Health only has the editor, and the bus lives beside it on the app state, so the shared
    ``<config>/settings.json`` is the honest way to ask. A missing or broken file means "none".
    """
    try:
        data = json.loads((editor.settings.config_dir / "settings.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ""
    return str(data.get("keyring_path") or "")


def main_type(dpt: str) -> int | None:
    """The main datapoint type number of ``DPST-9-1``, ``DPT-9`` or ``9.001``, else ``None``.

    Only the main type is compared. A sub-type difference (DPST-1-1 against DPST-1-2) is a
    labelling detail the tooling tolerates and real projects are full of; a main-type difference
    (a percentage object on a switching address) is a wiring mistake worth reporting.
    """
    text = dpt.strip()
    if not text:
        return None
    if text[0].isdigit():
        head = text.split(".", 1)[0]
        return int(head) if head.isdigit() else None
    parts = text.split("-")
    if len(parts) >= 2 and parts[0] in {"DPT", "DPST"} and parts[1].isdigit():
        return int(parts[1])
    return None

from xknxeditor_web.errors import ApiError

if TYPE_CHECKING:
    from xknxeditor_web.editor import Editor


@dataclass(frozen=True)
class Finding:
    check: str
    severity: str  # error | warning | info
    message: str
    device_id: int | None = None
    group_address_id: int | None = None
    subject: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def run_checks(editor: Editor) -> list[Finding]:
    pid = editor.pid
    if pid is None:
        return []
    svc = editor.projects
    findings: list[Finding] = []
    rows = svc.devices(pid)

    # Individual addresses: missing and duplicates.
    ia_of: dict[int, str | None] = {}
    for row in rows:
        ia_of[row.id] = svc.individual_address(pid, row.id)
    for row in rows:
        if ia_of[row.id] is None:
            findings.append(Finding("missing_address", "error", "Device has no individual address", row.id, subject=row.name))
    counts = Counter(ia for ia in ia_of.values() if ia)
    for row in rows:
        ia = ia_of[row.id]
        if ia and counts[ia] > 1:
            findings.append(Finding("duplicate_address", "error", f"Individual address {ia} is used by {counts[ia]} devices", row.id, subject=row.name))

    # Applications missing from the catalog.
    for row in rows:
        if row.hardware2program_ref_id and editor._resolve_app(row.hardware2program_ref_id) is None:  # noqa: SLF001
            findings.append(Finding("missing_application", "warning", f"Product data not in the catalog ({row.product_name or row.hardware2program_ref_id})", row.id, subject=row.name))

    # Com-objects without any link, and group addresses without DPT / senders.
    gas = {g.id: g for g in svc.group_addresses(pid)}
    senders: dict[int, int] = defaultdict(int)
    linked_gas: set[int] = set()
    for row in rows:
        unlinked = 0
        for co in row.com_objects:
            links = svc.com_object_links(pid, co.id)
            if not links:
                unlinked += 1
            for ln in links:
                linked_gas.add(ln.group_address_id)
                if ln.is_sending:
                    senders[ln.group_address_id] += 1
        if unlinked and row.com_objects and unlinked == len(row.com_objects):
            findings.append(Finding("unlinked_device", "warning", "None of the device's group objects is linked", row.id, subject=row.name))
    for ga in gas.values():
        if not ga.datapoint_type:
            findings.append(Finding("ga_without_dpt", "warning", "Group address has no datapoint type", group_address_id=ga.id, subject=f"{ga.text} {ga.name}"))
        if ga.id in linked_gas:
            n = senders.get(ga.id, 0)
            if n == 0:
                findings.append(Finding("ga_no_sender", "info", "Group address has links but no sending object", group_address_id=ga.id, subject=f"{ga.text} {ga.name}"))
            elif n > 1:
                findings.append(Finding("ga_many_senders", "info", f"Group address has {n} sending objects (fine for central functions)", group_address_id=ga.id, subject=f"{ga.text} {ga.name}"))
        else:
            findings.append(Finding("ga_unused", "info", "Group address is not linked to any object", group_address_id=ga.id, subject=f"{ga.text} {ga.name}"))
    # --- rules that need the application program (DPTs, effective flags) --------------------
    # A device with no product data has no application to read, so it is skipped here; the
    # missing_application check above has already reported it.
    views: dict[int, Any] = {}
    for row in rows:
        try:
            views[row.id] = editor.view(row.id)
        except ApiError:
            continue

    objects_on_ga: dict[int, list[tuple[Any, Any]]] = defaultdict(list)
    for row in rows:
        view = views.get(row.id)
        if view is None:
            continue
        by_ref = {co.ref_id: co for co in view.com_objects()}
        never_sends = 0
        for co in row.com_objects:
            found = by_ref.get(co.ref_id)
            if found is None:
                continue
            links = svc.com_object_links(pid, co.id)
            for link in links:
                objects_on_ga[link.group_address_id].append((row, found))
            # A transmit-capable object linked only as receiving never puts its telegram on the
            # bus: a push-button or sensor output wired up but with no sending address, so
            # pressing it does nothing. Each such object needs exactly one sending link.
            if links and found.flags.get("transmit_flag") and not any(link.is_sending for link in links):
                never_sends += 1
        if never_sends:
            findings.append(
                Finding(
                    "object_never_sends",
                    "warning",
                    f"{never_sends} object(s) are linked but never send: no sending group address",
                    row.id,
                    subject=row.name,
                )
            )

    for ga in gas.values():
        entries = objects_on_ga.get(ga.id) or []
        if not entries:
            continue
        wanted = main_type(ga.datapoint_type or "")
        if wanted is not None:
            for row, co in entries:
                types = {main_type(code) for code in co.dpt_codes} - {None}
                if types and wanted not in types:
                    findings.append(
                        Finding(
                            "ga_dpt_conflict",
                            "warning",
                            f"'{row.name}' object {co.number} ({co.name}) is {'/'.join(sorted(co.dpt_codes))}, "
                            f"but the address is {ga.datapoint_type}",
                            row.id,
                            ga.id,
                            f"{ga.text} {ga.name}",
                        )
                    )
        # An address every object only sends on is one nothing acts upon.
        if any(co.flags.get("transmit_flag") for _row, co in entries) and not any(
            co.flags.get("write_flag") for _row, co in entries
        ):
            findings.append(
                Finding(
                    "ga_no_receiver",
                    "info",
                    "Every object on this address only sends; nothing is set to act on it",
                    group_address_id=ga.id,
                    subject=f"{ga.text} {ga.name}",
                )
            )

    # KNX Secure: a device whose application supports it, with no keyring loaded to hold its keys.
    if not _keyring_path(editor):
        secure_devices = [
            row
            for row in rows
            if editor._hardware_facts().get(row.hardware2program_ref_id or "", {}).get("secure")  # noqa: SLF001
        ]
        if secure_devices:
            names = ", ".join(sorted(d.name for d in secure_devices)[:3])
            findings.append(
                Finding(
                    "secure_without_keyring",
                    "warning",
                    f"{len(secure_devices)} device(s) run a KNX Secure application but no keyring is loaded "
                    f"({names}{', …' if len(secure_devices) > 3 else ''}); "
                    "load the project's .knxkeys in Connection settings",
                    subject="KNX Secure",
                )
            )

    # A parameter one device sets differently from every sibling running the same application.
    by_app: dict[str, list[Any]] = defaultdict(list)
    for row in rows:
        if row.hardware2program_ref_id:
            by_app[row.hardware2program_ref_id].append(row)
    for siblings in by_app.values():
        if len(siblings) < MIN_SIBLINGS_FOR_OUTLIER:
            continue
        values: dict[str, dict[int, str]] = defaultdict(dict)
        for row in siblings:
            for param in row.parameters:
                values[param.ref_id][row.id] = param.value
        names = {row.id: row.name for row in siblings}
        for ref_id, per_device in values.items():
            if len(per_device) != len(siblings):
                continue  # not every sibling has the parameter; nothing to compare
            counts = Counter(per_device.values())
            if len(counts) != 2:
                continue
            (common, common_n), (odd, odd_n) = counts.most_common()
            if odd_n != 1 or common_n < MIN_SIBLINGS_FOR_OUTLIER - 1:
                continue
            device_id = next(d for d, v in per_device.items() if v == odd)
            findings.append(
                Finding(
                    "parameter_outlier",
                    "info",
                    f"{ref_id} is '{odd}' here but '{common}' on the other {common_n} identical devices",
                    device_id,
                    subject=names[device_id],
                )
            )

    # Per segment: the unit one power supply feeds.
    for area in svc.topology(pid, 0).areas:
        for line in area.lines:
            for seg in line.segments:
                devices = list(seg.devices)
                if not devices:
                    continue
                where = f"{area.address}.{line.address}"
                if len(line.segments) > 1:
                    where += f" segment {seg.number}"
                load = editor._segment_load(devices)  # noqa: SLF001
                if load["device_count"] > MAX_DEVICES_PER_SEGMENT:
                    findings.append(
                        Finding(
                            "segment_too_many_devices",
                            "error",
                            f"{load['device_count']} devices on one segment; a KNX TP segment carries at most {MAX_DEVICES_PER_SEGMENT}",
                            subject=where,
                        )
                    )
                if not load["power_supplies"]:
                    findings.append(
                        Finding(
                            "segment_without_power_supply",
                            "info",
                            "No power supply is placed on this segment (add it to the project to document the installation)",
                            subject=where,
                        )
                    )
                current = load["current_ma"]
                if current > ASSUMED_SUPPLY_MA:
                    findings.append(
                        Finding(
                            "segment_bus_current",
                            "warning",
                            f"Devices draw {current:.0f} mA, more than a {ASSUMED_SUPPLY_MA:.0f} mA supply delivers"
                            + (f" ({load['unknown']} devices not counted, no product data)" if load["unknown"] else ""),
                            subject=where,
                        )
                    )
                elif current:
                    findings.append(
                        Finding(
                            "segment_bus_current",
                            "info",
                            f"Devices draw {current:.0f} mA of the {ASSUMED_SUPPLY_MA:.0f} mA a common supply delivers"
                            + (f" ({load['unknown']} devices not counted, no product data)" if load["unknown"] else ""),
                            subject=where,
                        )
                    )

    order = {"error": 0, "warning": 1, "info": 2}
    findings.sort(key=lambda f: (order[f.severity], f.check, f.subject))
    return findings
