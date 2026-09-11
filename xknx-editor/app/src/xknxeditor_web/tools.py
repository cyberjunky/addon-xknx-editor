"""Project tools: extended copy, replace device, shift addresses, labels, topology check, and the
mass linker. The pure helpers mirror the desktop app's Tools / Mass Linker panels (same repo, GPL)
so both editors behave the same; the operations compose the project service like the desktop does.

Every operation runs on the editor thread (callers go through ``editor.worker.run``).
"""

from __future__ import annotations

import csv
import io
import re
from typing import TYPE_CHECKING, Any

from xknxeditor.proj.core.addressing import GroupAddressStyle, format_ga, parse_ga

from xknxeditor_web.errors import ApiError, NotFound

if TYPE_CHECKING:
    from xknxeditor_web.device_view import ComObjectView
    from xknxeditor_web.editor import Editor

LABEL_HEADER = ["Individual address", "Name", "Order number", "Manufacturer", "Description", "Room"]
_DPT_MAJOR = re.compile(r"^DPS?T-(\d+)")


# --- pure helpers -----------------------------------------------------------------------------


def apply_name_swap(name: str, find: str, replace: str) -> str:
    """``name`` with ``find`` replaced by ``replace``; unchanged when ``find`` is empty."""
    return name.replace(find, replace) if find else name


def shifted_ia(ia: str | None, offset: int) -> str | None:
    """Shift the device octet of ``area.line.device`` by ``offset``; ``None`` if malformed or the
    result leaves 1-255 (0 is the line coupler)."""
    if not ia:
        return None
    parts = ia.split(".")
    if len(parts) != 3:
        return None
    try:
        area, line, device = (int(p) for p in parts)
    except ValueError:
        return None
    if not (0 <= area <= 15 and 0 <= line <= 15 and 0 <= device <= 255):
        return None
    new_device = device + offset
    if not 1 <= new_device <= 255:
        return None
    return f"{area}.{line}.{new_device}"


def dpt_major(codes: list[str] | tuple[str, ...] | None) -> int | None:
    """The main DPT number of the first code (``DPST-1-1`` -> 1), or ``None``."""
    for code in codes or ():
        m = _DPT_MAJOR.match(code or "")
        if m:
            return int(m.group(1))
    return None


def match_by_number(
    old: list[dict[str, Any]], new: list[dict[str, Any]]
) -> list[tuple[dict[str, Any], dict[str, Any] | None]]:
    """Pair each old com-object with the new one of the same ``number`` and object size."""
    by_number = {co["number"]: co for co in new}
    out: list[tuple[dict[str, Any], dict[str, Any] | None]] = []
    for co in old:
        cand = by_number.get(co["number"])
        if cand is not None and (
            not co["object_size"] or not cand["object_size"] or co["object_size"] == cand["object_size"]
        ):
            out.append((co, cand))
        else:
            out.append((co, None))
    return out


def topology_findings(devices: list[tuple[int, str, str | None]]) -> list[tuple[int, str, str]]:
    """Scan ``(device_id, name, individual_address)`` for address problems -> ``(id, severity, message)``."""
    findings: list[tuple[int, str, str]] = []
    seen: dict[str, int] = {}
    for device_id, name, ia in devices:
        label = name or f"#{device_id}"
        if not ia:
            findings.append((device_id, "warning", f"{label}: no individual address"))
            continue
        parts = ia.split(".")
        valid = len(parts) == 3 and all(p.isdigit() for p in parts)
        if valid:
            area, line, dev = (int(p) for p in parts)
            valid = 0 <= area <= 15 and 0 <= line <= 15 and 0 <= dev <= 255
        if not valid:
            findings.append((device_id, "error", f"{label}: malformed address {ia!r}"))
            continue
        if ia in seen:
            findings.append((device_id, "error", f"{label}: duplicate address {ia}"))
        seen[ia] = device_id
    return findings


def labels_csv(rows: list[list[str]]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(LABEL_HEADER)
    writer.writerows(rows)
    return buf.getvalue()


def autopair(
    obj_name: str, obj_major: int | None, gas: list[tuple[int, str, int | None]]
) -> tuple[int | None, str]:
    """Best existing group address for one object by name, constrained by DPT major.

    ``gas`` is ``(ga_id, ga_name, ga_major)``. Status: ``ready`` (name match, compatible DPT),
    ``ambiguous`` (matched, DPT unknown on a side or several candidates), ``incompatible`` (only
    wrong-major matches), ``unmatched``. Exact name beats substring; first match wins."""
    key = obj_name.strip().lower()
    if not key:
        return None, "unmatched"
    named = [(gid, gname.strip().lower(), gmaj) for gid, gname, gmaj in gas if gname.strip()]
    exact = [(gid, gmaj) for gid, low, gmaj in named if low == key]
    contains = (
        [(gid, gmaj) for gid, low, gmaj in named if key in low or low in key] if len(key) >= 3 else []
    )
    candidates = exact or contains
    if not candidates:
        return None, "unmatched"
    if obj_major is None:
        return candidates[0][0], "ambiguous"
    compatible = [gid for gid, gmaj in candidates if gmaj == obj_major]
    if len(compatible) == 1:
        return compatible[0], "ready"
    if len(compatible) > 1:
        return compatible[0], "ambiguous"
    unknown = [gid for gid, gmaj in candidates if gmaj is None]
    if unknown:
        return unknown[0], "ambiguous"
    return None, "incompatible"


def sequential_targets(existing: list[tuple[int, int]], start_value: int, count: int) -> list[int | None]:
    """The first ``count`` existing group addresses with value >= ``start_value`` (``(value, id)``)."""
    ordered = sorted(v for v in existing if v[0] >= start_value)
    ids = [ga_id for _value, ga_id in ordered]
    return [ids[i] if i < len(ids) else None for i in range(count)]


GA_MAX_VALUE = 65535


def first_free_values(used: set[int], start: int, count: int, *, limit: int = GA_MAX_VALUE) -> list[int]:
    """The next ``count`` free group-address values >= ``max(start, 1)``."""
    taken = set(used)
    out: list[int] = []
    value = max(start, 1)
    while len(out) < count and value <= limit:
        if value not in taken:
            out.append(value)
            taken.add(value)
        value += 1
    return out


# --- operations on the open project -------------------------------------------------------------


def _style(ed: Editor) -> GroupAddressStyle:
    return GroupAddressStyle(ed.projects.project(ed._pid()).group_address_style)


def _visible(ed: Editor, device_id: int) -> list[ComObjectView]:
    return [co for co in ed.view(device_id).com_objects() if co.db_id is not None]


def _co_dict(co: ComObjectView) -> dict[str, Any]:
    return {
        "ref_id": co.ref_id,
        "db_id": co.db_id,
        "number": co.number,
        "name": co.name,
        "function_text": co.function_text,
        "dpt_codes": list(co.dpt_codes),
        "object_size": co.object_size,
    }


def clone_device(ed: Editor, device_id: int, count: int = 1) -> list[int]:
    """Create ``count`` copies of a device with its parameter values, com-objects and module
    instances, on the same line with the next free addresses. Returns the new device ids."""
    pid = ed._pid()
    row = ed._row(device_id)
    if ed._resolve_app(row.hardware2program_ref_id) is None:
        raise ApiError(f"Cannot copy device {device_id}: its application is not in the catalog", 422)
    params = [(p.ref_id, p.value) for p in row.parameters]
    com_objects = [(c.ref_id, None) for c in row.com_objects]
    modules = [(m.instance_id, m.ref_id) for m in row.module_instances]
    created: list[int] = []
    for i in range(max(1, min(count, 500))):
        suffix = " (copy)" if count == 1 else f" (copy {i + 1})"
        try:
            address: int | None = ed.projects.next_free_individual_address_for_segment(pid, row.segment_id)
        except ValueError:
            address = None
        new_id = ed.projects.add_device(
            pid,
            row.segment_id,
            row.product_ref_id,
            address=address,
            name=f"{row.name}{suffix}",
            hardware2program_ref_id=row.hardware2program_ref_id,
            parameters=params or None,
            com_objects=com_objects or None,
            module_instances=modules or None,
        )
        created.append(new_id)
    ed._bump(structural=True)
    return created


def auto_create_gas(
    ed: Editor, device_id: int, ref_ids: set[str] | None = None, installation: int = 0
) -> int:
    """Create one group address per (selected) com-object of a device and link it, sending when
    the object had no link yet. Returns the number of addresses created."""
    pid = ed._pid()
    row = ed._row(device_id)
    created = 0
    for co in _visible(ed, device_id):
        if ref_ids is not None and co.ref_id not in ref_ids:
            continue
        assert co.db_id is not None
        address = ed.projects.next_free_group_address(pid, installation)
        ga_id = ed.projects.create_group_address(
            pid, installation, address, co.name or f"{row.name} {co.number}"
        )
        if co.dpt_codes:
            ed.projects.set_group_address_datapoint_type(pid, ga_id, co.dpt_codes[0])
        existing = ed.projects.com_object_links(pid, co.db_id)
        ed.projects.link_com_object(pid, co.db_id, ga_id, sending=not existing)
        created += 1
    if created:
        ed._bump(structural=True, device=device_id)
    return created


def extended_copy(
    ed: Editor, device_id: int, count: int, find: str, replace: str, create_gas: bool
) -> dict[str, Any]:
    """Clone a device ``count`` times; optionally rewrite the copies' names (find/replace) and
    create a group address for every com-object of each copy."""
    pid = ed._pid()
    ids = clone_device(ed, device_id, count)
    gas = 0
    errors: list[str] = []
    for nid in ids:
        row = ed._row(nid)
        if find:
            new_name = apply_name_swap(row.name, find, replace)
            if new_name != row.name:
                ed.projects.set_device_name(pid, nid, new_name)
        if create_gas:
            try:
                gas += auto_create_gas(ed, nid)
            except ApiError as exc:
                errors.append(f"copy {nid}: {exc}")
    ed._bump(structural=True)
    return {"created": ids, "group_addresses": gas, "errors": errors}


def replace_preview(ed: Editor, target_id: int, template_id: int) -> dict[str, Any]:
    """Which of the target's linked com-objects map onto the template's (by number + size)."""
    pid = ed._pid()
    old = [_co_dict(co) for co in _visible(ed, target_id)]
    new = [_co_dict(co) for co in _visible(ed, template_id)]
    pairs = []
    for o, n in match_by_number(old, new):
        assert o["db_id"] is not None
        links = ed.projects.com_object_links(pid, o["db_id"])
        pairs.append({"old": o, "new": n, "links": len(links)})
    mapped = sum(1 for p in pairs if p["new"] is not None and p["links"])
    lost = sum(1 for p in pairs if p["new"] is None and p["links"])
    return {"pairs": pairs, "mapped": mapped, "lost": lost}


def replace_device(ed: Editor, target_id: int, template_id: int) -> dict[str, Any]:
    """Replace ``target`` by a copy of ``template`` (another project device), keeping the target's
    name, address, room and group-address links (matched by object number and size)."""
    pid = ed._pid()
    if target_id == template_id:
        raise ApiError("Pick two different devices")
    target = ed._row(target_id)
    target_ia = ed.projects.individual_address(pid, target_id)
    target_name, target_space = target.name, target.space_id
    old_links: dict[int, tuple[str, list[tuple[int, bool]]]] = {}
    for co in _visible(ed, target_id):
        assert co.db_id is not None
        links = ed.projects.com_object_links(pid, co.db_id)
        if links:
            old_links[co.number] = (co.object_size, [(ln.group_address_id, ln.is_sending) for ln in links])
    new_id = clone_device(ed, template_id, 1)[0]
    ed.projects.set_device_name(pid, new_id, target_name)
    ed.remove_device(target_id)
    errors: list[str] = []
    if target_ia:
        try:
            ed.projects.set_individual_address(pid, new_id, target_ia)
        except ValueError as exc:
            errors.append(f"address {target_ia} not applied: {exc}")
    if target_space is not None:
        ed.projects.set_device_space(pid, new_id, target_space)
    ed._drop_views(new_id)
    new_by_number = {co.number: co for co in _visible(ed, new_id)}
    mapped = 0
    for number, (size, gas) in old_links.items():
        nco = new_by_number.get(number)
        if nco is None or (size and nco.object_size and size != nco.object_size):
            errors.append(f"object #{number}: no matching object on the replacement")
            continue
        assert nco.db_id is not None
        for ga_id, sending in gas:
            ed.projects.link_com_object(pid, nco.db_id, ga_id, sending=sending)
        mapped += 1
    ed._drop_views(new_id)
    ed._bump(structural=True, device=new_id)
    return {"device_id": new_id, "mapped": mapped, "errors": errors}


def shift_addresses(
    ed: Editor, device_ids: list[int], offset: int, dry_run: bool = False
) -> dict[str, Any]:
    """Shift the device octet of the selected addresses by ``offset``. All-or-nothing: the whole
    resulting state is checked for range and collisions first; with conflicts nothing is written."""
    pid = ed._pid()
    devices = ed.devices()
    by_id = {d["id"]: d for d in devices}
    errors: list[str] = []
    targets: dict[int, str] = {}
    for did in device_ids:
        d = by_id.get(did)
        if d is None:
            errors.append(f"device {did}: not found")
            continue
        new = shifted_ia(d["individual_address"], offset)
        if new is None:
            errors.append(f"{d['name'] or did}: {d['individual_address'] or '-'} {offset:+d} is out of range")
        else:
            targets[did] = new
    final: dict[str, list[str]] = {}
    for d in devices:
        ia = targets.get(d["id"], d["individual_address"])
        if ia:
            final.setdefault(ia, []).append(d["name"] or str(d["id"]))
    for ia, names in final.items():
        if len(names) > 1 and any(t == ia for t in targets.values()):
            errors.append(f"{ia} would be used by {', '.join(names)}")
    preview = [
        {"device_id": did, "from": by_id[did]["individual_address"], "to": ia} for did, ia in targets.items()
    ]
    if dry_run or errors:
        return {"applied": 0, "preview": preview, "errors": errors}
    # Movers in an order that never steps on a not-yet-moved sibling.
    order = sorted(targets, key=lambda did: by_id[did]["address"] or 0, reverse=offset > 0)
    for did in order:
        ed.projects.set_individual_address(pid, did, targets[did])
    ed._drop_views()
    ed._bump(structural=True)
    return {"applied": len(order), "preview": preview, "errors": []}


def labels(ed: Editor, device_ids: list[int] | None = None) -> dict[str, Any]:
    """Label rows (and CSV) for the selected devices, or all when none given."""
    rows: list[list[str]] = []
    wanted = set(device_ids) if device_ids else None
    ordered = sorted(
        ed.devices(), key=lambda x: (x["individual_address"] is None, x["individual_address"] or "")
    )
    for d in ordered:
        if wanted is not None and d["id"] not in wanted:
            continue
        rows.append(
            [
                d["individual_address"] or "",
                d["name"],
                d["order_number"],
                d["manufacturer_name"],
                d["description"],
                d["room"] or "",
            ]
        )
    return {"header": LABEL_HEADER, "rows": rows, "csv": labels_csv(rows)}


def topology_check(ed: Editor) -> dict[str, Any]:
    devices = ed.devices()
    items = [
        {"device_id": did, "severity": sev, "message": msg}
        for did, sev, msg in topology_findings(
            [(d["id"], d["name"], d["individual_address"]) for d in devices]
        )
    ]
    for d in devices:
        if not d["resolved"]:
            items.append(
                {
                    "device_id": d["id"],
                    "severity": "warning",
                    "message": f"{d['name'] or d['id']}: product data missing ({d['order_number'] or d['product_name']})",
                }
            )
    return {"items": items, "count": len(items), "devices": len(devices)}


def objects_for(ed: Editor, device_ids: list[int]) -> dict[str, Any]:
    """The linkable com-objects of the given devices with their current links (mass linker source)."""
    pid = ed._pid()
    gas = {g.id: g for g in ed.projects.group_addresses(pid)}
    summaries = {d["id"]: d for d in ed.devices()}
    items: list[dict[str, Any]] = []
    for did in device_ids:
        summary = summaries.get(did)
        if summary is None:
            raise NotFound(f"No device with id {did}")
        try:
            cos = _visible(ed, did)
        except ApiError:
            continue
        for co in cos:
            assert co.db_id is not None
            links = ed.projects.com_object_links(pid, co.db_id)
            d = _co_dict(co)
            d.update(
                device_id=did,
                device_name=summary["name"],
                individual_address=summary["individual_address"],
                dpt_major=dpt_major(co.dpt_codes),
                links=[
                    {
                        "id": ln.id,
                        "group_address_id": ln.group_address_id,
                        "text": gas[ln.group_address_id].text if ln.group_address_id in gas else "?",
                        "is_sending": ln.is_sending,
                    }
                    for ln in links
                ],
            )
            items.append(d)
    return {"items": items, "count": len(items)}


def mass_link(ed: Editor, pairs: list[dict[str, Any]]) -> dict[str, Any]:
    """Link ``[{device_id, ref_id, group_address_id}]``; sending when the object had no link."""
    pid = ed._pid()
    linked = 0
    errors: list[str] = []
    for p in pairs:
        try:
            device_id, ref_id, ga_id = int(p["device_id"]), str(p["ref_id"]), int(p["group_address_id"])
            co = next((c for c in _visible(ed, device_id) if c.ref_id == ref_id), None)
            if co is None or co.db_id is None:
                raise NotFound(f"device {device_id} has no linkable object {ref_id}")
            existing = ed.projects.com_object_links(pid, co.db_id)
            if any(ln.group_address_id == ga_id for ln in existing):
                continue
            ed.projects.link_com_object(pid, co.db_id, ga_id, sending=not existing)
            linked += 1
        except (KeyError, ValueError, ApiError) as exc:
            errors.append(f"{p}: {exc}")
    if linked:
        ed._bump(structural=False)
    return {"linked": linked, "errors": errors}


def mass_link_objects(ed: Editor, pairs: list[dict[str, Any]], installation: int = 0) -> dict[str, Any]:
    """Object-to-object links: for each ``{source: {device_id, ref_id}, target: {device_id, ref_id},
    address?, name?}`` create a group address (given text or the first free one), give it the
    source's DPT, and link source (sending) and target to it."""
    pid = ed._pid()
    style = _style(ed)
    used = {g.address for g in ed.projects.group_addresses(pid)}
    created: list[dict[str, Any]] = []
    errors: list[str] = []
    for p in pairs:
        try:
            src_dev, dst_dev = int(p["source"]["device_id"]), int(p["target"]["device_id"])
            src = next((c for c in _visible(ed, src_dev) if c.ref_id == p["source"]["ref_id"]), None)
            dst = next((c for c in _visible(ed, dst_dev) if c.ref_id == p["target"]["ref_id"]), None)
            if src is None or dst is None or src.db_id is None or dst.db_id is None:
                raise NotFound("source or target object is not linkable")
            text = str(p.get("address") or "").strip()
            value = parse_ga(text, style) if text else first_free_values(used, 1, 1)[0]
            if value in used:
                raise ApiError(f"{format_ga(value, style)} is already used")
            used.add(value)
            name = str(p.get("name") or "").strip() or src.name or str(src.number)
            ga_id = ed.projects.create_group_address(pid, installation, value, name)
            if src.dpt_codes:
                ed.projects.set_group_address_datapoint_type(pid, ga_id, src.dpt_codes[0])
            has_links = bool(ed.projects.com_object_links(pid, src.db_id))
            ed.projects.link_com_object(pid, src.db_id, ga_id, sending=not has_links)
            ed.projects.link_com_object(pid, dst.db_id, ga_id, sending=False)
            created.append({"group_address_id": ga_id, "text": format_ga(value, style), "name": name})
        except (KeyError, ValueError, IndexError, ApiError) as exc:
            errors.append(f"{p.get('name') or p}: {exc}")
    if created:
        ed._bump(structural=True)
    return {"created": created, "errors": errors}
