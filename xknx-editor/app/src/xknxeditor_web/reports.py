"""Read-only views over the open project: device comparison, a device's connections, the project's
group objects, and the CSV exports of the tables.

Every function runs on the editor thread (callers go through ``editor.worker.run``).
"""

from __future__ import annotations

import csv
import io
from collections.abc import Iterable
from typing import TYPE_CHECKING, Any

from xknxeditor_web.errors import ApiError, NotFound
from xknxeditor_web.serialize import tree_dict

if TYPE_CHECKING:
    from xknxeditor_web.editor import Editor

FLAG_LETTERS = (("communication", "C"), ("read", "R"), ("write", "W"), ("transmit", "T"), ("update", "U"), ("read_on_init", "I"))


# --- pure helpers -----------------------------------------------------------------------------


def parameter_display(node: dict[str, Any]) -> str:
    """The value as the parameter page shows it: an enum's label, a checkbox as on/off."""
    value = node.get("value")
    widget = node.get("widget") or {}
    if widget.get("type") == "enum":
        for choice in widget.get("choices", []):
            if str(choice.get("value")) == str(value):
                return str(choice.get("label") or value)
    if widget.get("type") == "checkbox":
        return "on" if str(value) not in ("0", "", "false", "False", "None") else "off"
    suffix = node.get("suffix")
    text = "" if value is None else str(value)
    return f"{text} {suffix}" if suffix and text else text


def flatten_parameters(nodes: list[dict[str, Any]], path: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    """Every visible parameter with the page and block it sits in."""
    out: list[dict[str, Any]] = []
    for node in nodes:
        kind = node.get("type")
        if kind in ("tab", "block"):
            text = (node.get("text") or "").strip()
            out.extend(flatten_parameters(node.get("children", []), (*path, text) if text else path))
        elif kind == "parameter":
            out.append(
                {
                    "ref_id": node["ref_id"],
                    "path": " › ".join(path),
                    "label": node.get("label") or node["ref_id"],
                    "value": parameter_display(node),
                }
            )
    return out


def flags_text(flags: dict[str, bool]) -> str:
    return "".join(letter if flags.get(key) else "-" for key, letter in FLAG_LETTERS)


def merge_rows(columns: list[list[dict[str, Any]]], key: str) -> list[dict[str, Any]]:
    """Line up per-device rows on ``key`` (first-seen order); ``values`` holds one entry per device
    (``None`` where a device lacks the row) and ``differs`` whether they disagree."""
    order: list[str] = []
    seen: dict[str, dict[str, Any]] = {}
    for column in columns:
        for row in column:
            k = row[key]
            if k not in seen:
                seen[k] = {**row, "values": [None] * len(columns)}
                order.append(k)
    for i, column in enumerate(columns):
        for row in column:
            seen[row[key]]["values"][i] = row["value"]
    out = []
    for k in order:
        row = seen[k]
        row.pop("value", None)
        row["differs"] = len({v for v in row["values"]}) > 1
        out.append(row)
    return out


def rows_csv(header: list[str], rows: Iterable[list[Any]]) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(header)
    for row in rows:
        writer.writerow(["" if v is None else v for v in row])
    return buf.getvalue()


def rtf_to_text(text: str) -> str:
    """ETS writes comments as RTF; show them as the text they carry. Plain text passes unchanged."""
    if not text or not text.lstrip().startswith("{\\rtf"):
        return text or ""
    out: list[str] = []
    depth = 0
    skip_depth: int | None = None
    i = 0
    n = len(text)
    while i < n:
        c = text[i]
        if c == "{":
            depth += 1
            i += 1
            # Destinations such as {\fonttbl ...}, {\colortbl ...} or {\*\... } carry no text.
            ahead = text[i : i + 12]
            if skip_depth is None and (ahead.startswith("\\*") or any(ahead.startswith(f"\\{w}") for w in ("fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer"))):
                skip_depth = depth
            continue
        if c == "}":
            if skip_depth == depth:
                skip_depth = None
            depth -= 1
            i += 1
            continue
        if c == "\\":
            i += 1
            if i >= n:
                break
            nxt = text[i]
            if nxt in "\\{}":
                if skip_depth is None:
                    out.append(nxt)
                i += 1
                continue
            if nxt == "'":
                hexpair = text[i + 1 : i + 3]
                if skip_depth is None:
                    try:
                        out.append(bytes([int(hexpair, 16)]).decode("cp1252"))
                    except ValueError:
                        pass
                i += 3
                continue
            j = i
            while j < n and text[j].isalpha():
                j += 1
            word = text[i:j]
            k = j
            if k < n and (text[k] == "-" or text[k].isdigit()):
                k += 1
                while k < n and text[k].isdigit():
                    k += 1
            param = text[j:k]
            if k < n and text[k] == " ":
                k += 1
            i = k
            if skip_depth is not None:
                continue
            if word in ("par", "line"):
                out.append("\n")
            elif word == "tab":
                out.append("\t")
            elif word == "u" and param:
                try:
                    out.append(chr(int(param) % 0x10000))
                except ValueError:
                    pass
                if i < n and text[i] == "?":
                    i += 1
            continue
        if c in "\r\n":
            i += 1
            continue
        if skip_depth is None:
            out.append(c)
        i += 1
    return "".join(out).strip()


# --- project reads ------------------------------------------------------------------------------


def _object_owner(ed: Editor) -> dict[int, tuple[int, str]]:
    """com_object row id -> (device id, qualified ref), the form the device views speak."""
    return ed.com_object_owners()


def _object_names(ed: Editor, device_id: int, cache: dict[int, dict[str, tuple[int, str]]]) -> dict[str, tuple[int, str]]:
    if device_id not in cache:
        try:
            cache[device_id] = {co.ref_id: (co.number, co.name) for co in ed.view(device_id).com_objects()}
        except ApiError:
            cache[device_id] = {}
    return cache[device_id]


def compare_devices(ed: Editor, device_ids: list[int]) -> dict[str, Any]:
    """Parameters and group objects of two or more devices side by side."""
    if len(device_ids) < 2:
        raise ApiError("Pick at least two devices to compare")
    if len(device_ids) > 8:
        raise ApiError("Compare at most eight devices at a time")
    summaries = {d["id"]: d for d in ed.devices()}
    pid = ed._pid()  # noqa: SLF001
    gas = {g.id: g for g in ed.projects.group_addresses(pid)}
    devices: list[dict[str, Any]] = []
    param_columns: list[list[dict[str, Any]]] = []
    object_columns: list[list[dict[str, Any]]] = []
    app_ids: list[str] = []
    for device_id in device_ids:
        summary = summaries.get(device_id)
        if summary is None:
            raise NotFound(f"No device with id {device_id}")
        view = ed.view(device_id)
        app_ids.append(view.app.id)
        devices.append(
            {
                "id": device_id,
                "name": summary["name"],
                "individual_address": summary["individual_address"],
                "application": view.app.name,
                "application_id": view.app.id,
            }
        )
        param_columns.append(flatten_parameters(tree_dict(view.ui_tree())))
        objects = []
        for co in view.com_objects():
            links = ed.projects.com_object_links(pid, co.db_id) if co.db_id is not None else []
            texts = [f"{gas[ln.group_address_id].text}{'*' if ln.is_sending else ''}" for ln in links if ln.group_address_id in gas]
            objects.append(
                {
                    "number": co.number,
                    "name": co.name,
                    "value": f"{flags_text(co.flags)} {', '.join(texts) or '–'}",
                }
            )
        object_columns.append(objects)
    same = len(set(app_ids)) == 1
    if not same:
        # Different applications share no ref ids; line parameters up by where they are shown.
        for column in param_columns:
            for row in column:
                row["ref_id"] = f"{row['path']}|{row['label']}"
        for column in object_columns:
            for row in column:
                row["number"] = f"{row['number']}|{row['name']}"
    else:
        for column in object_columns:
            for row in column:
                row["number"] = str(row["number"])
    parameters = merge_rows(param_columns, "ref_id")
    objects = merge_rows(object_columns, "number")
    for row in objects:
        row["number"] = row["number"].split("|")[0]
    return {
        "devices": devices,
        "same_application": same,
        "parameters": parameters,
        "objects": objects,
        "differences": {
            "parameters": sum(1 for r in parameters if r["differs"]),
            "objects": sum(1 for r in objects if r["differs"]),
        },
    }


def device_connections(ed: Editor, device_id: int) -> dict[str, Any]:
    """Who a device talks to: its group objects, their addresses, and every other object on them."""
    pid = ed._pid()  # noqa: SLF001
    device = ed.device(device_id)
    view = ed.view(device_id)
    gas = {g.id: g for g in ed.projects.group_addresses(pid)}
    owner = _object_owner(ed)
    summaries = {d["id"]: d for d in ed.devices()}
    names: dict[int, dict[str, tuple[int, str]]] = {}
    addresses: dict[int, dict[str, Any]] = {}
    objects: list[dict[str, Any]] = []
    for co in view.com_objects():
        if co.db_id is None:
            continue
        links = ed.projects.com_object_links(pid, co.db_id)
        if not links:
            continue
        objects.append(
            {
                "number": co.number,
                "name": co.name,
                "dpt": co.dpt_codes[0] if co.dpt_codes else None,
                "flags": flags_text(co.flags),
                "links": [{"group_address_id": ln.group_address_id, "sending": ln.is_sending} for ln in links],
            }
        )
        for ln in links:
            ga = gas.get(ln.group_address_id)
            if ga is None or ga.id in addresses:
                continue
            peers = []
            for other in ed.projects.group_address_links(pid, ga.id):
                other_device, ref = owner.get(other.com_object_id, (None, ""))
                if other_device is None or other_device == device_id:
                    continue
                number, name = _object_names(ed, other_device, names).get(ref, (0, ""))
                summary = summaries.get(other_device, {})
                peers.append(
                    {
                        "device_id": other_device,
                        "name": summary.get("name", ""),
                        "individual_address": summary.get("individual_address"),
                        "object_number": number,
                        "object_name": name,
                        "sending": other.is_sending,
                    }
                )
            addresses[ga.id] = {
                "id": ga.id,
                "address": ga.address,
                "text": ga.text,
                "name": ga.name,
                "dpt": ga.datapoint_type,
                "peers": peers,
            }
    return {
        "device": {"id": device_id, "name": device["name"], "individual_address": device["individual_address"]},
        "objects": objects,
        "group_addresses": sorted(addresses.values(), key=lambda a: a["address"]),
    }


def device_traffic(ed: Editor, device_id: int) -> dict[str, Any]:
    """The device's individual address and the raw values of its linked group addresses."""
    pid = ed._pid()  # noqa: SLF001
    row = ed._row(device_id)  # noqa: SLF001
    gas = {g.id: g.address for g in ed.projects.group_addresses(pid)}
    values = sorted(
        {
            gas[ln.group_address_id]
            for co in row.com_objects
            for ln in ed.projects.com_object_links(pid, co.id)
            if ln.group_address_id in gas
        }
    )
    return {"address": ed.projects.individual_address(pid, device_id), "gas": values}


def project_objects(ed: Editor) -> dict[str, Any]:
    """Every group object of every device whose product data is in the catalog."""
    pid = ed._pid()  # noqa: SLF001
    gas = {g.id: g for g in ed.projects.group_addresses(pid)}
    items: list[dict[str, Any]] = []
    missing = 0
    for d in ed.devices():
        try:
            cos = ed.view(d["id"]).com_objects()
        except ApiError:
            missing += 1
            continue
        for co in cos:
            links = ed.projects.com_object_links(pid, co.db_id) if co.db_id is not None else []
            items.append(
                {
                    **co.to_dict(),
                    "device_id": d["id"],
                    "device_name": d["name"],
                    "individual_address": d["individual_address"],
                    "line": d["line"],
                    "room": d["room"],
                    "links": [
                        {
                            "id": ln.id,
                            "group_address_id": ln.group_address_id,
                            "text": gas[ln.group_address_id].text if ln.group_address_id in gas else "?",
                            "name": gas[ln.group_address_id].name if ln.group_address_id in gas else "",
                            "is_sending": ln.is_sending,
                        }
                        for ln in links
                    ],
                }
            )
    return {"items": items, "count": len(items), "devices_without_product_data": missing}


# --- CSV exports -------------------------------------------------------------------------------


def _ia_key(ia: str | None) -> list[int]:
    return [int(p) for p in ia.split(".")] if ia else [999]


def export_devices(ed: Editor) -> str:
    rows = []
    pid = ed._pid()  # noqa: SLF001
    for d in sorted(ed.devices(), key=lambda x: _ia_key(x["individual_address"])):
        info = ed.projects.device(pid, d["id"])
        rows.append(
            [
                d["individual_address"], d["name"], d["room"], d["manufacturer_name"], d["product_name"],
                d["order_number"], d["application_name"], d["serial_number"], d["description"],
                rtf_to_text(getattr(info, "comment", "")), rtf_to_text(getattr(info, "installation_hints", "")),
                "yes" if d["individual_address_loaded"] else "no", "yes" if d["application_loaded"] else "no",
                "yes" if d["parameters_loaded"] else "no", "yes" if d["communication_part_loaded"] else "no",
                d["last_download"] or "",
            ]
        )
    header = [
        "Individual address", "Name", "Room", "Manufacturer", "Product", "Order number", "Application",
        "Serial number", "Description", "Comment", "Installation hints", "Address loaded",
        "Application loaded", "Parameters loaded", "Group communication loaded", "Last download",
    ]
    return rows_csv(header, rows)


def export_group_addresses(ed: Editor) -> str:
    pid = ed._pid()  # noqa: SLF001
    ranges: list[tuple[int, int, str, int]] = []

    def walk(nodes: list[Any], level: int) -> None:
        for n in nodes:
            ranges.append((n.range_start, n.range_end, n.name, level))
            walk(n.children, level + 1)

    for inst in ed.projects.installations(pid):
        walk(ed.projects.group_ranges(pid, inst.index), 0)
    owner = _object_owner(ed)
    summaries = {d["id"]: d for d in ed.devices()}
    rows = []
    for g in sorted(ed.projects.group_addresses(pid), key=lambda x: x.address):
        main = next((r[2] for r in ranges if r[3] == 0 and r[0] <= g.address <= r[1]), "")
        middle = next((r[2] for r in ranges if r[3] == 1 and r[0] <= g.address <= r[1]), "")
        devices = []
        for ln in ed.projects.group_address_links(pid, g.id):
            device_id = owner.get(ln.com_object_id, (None, ""))[0]
            if device_id is not None and device_id in summaries:
                s = summaries[device_id]
                devices.append(f"{s['individual_address'] or '-'} {s['name']}{' (sends)' if ln.is_sending else ''}")
        rows.append([g.text, g.name, main, middle, g.datapoint_type or "", g.description, rtf_to_text(g.comment), len(devices), "; ".join(devices)])
    return rows_csv(["Address", "Name", "Main group", "Middle group", "DPT", "Description", "Comment", "Links", "Linked devices"], rows)


def export_group_objects(ed: Editor) -> str:
    rows = []
    for co in sorted(project_objects(ed)["items"], key=lambda x: (_ia_key(x["individual_address"]), x["number"])):
        rows.append(
            [
                co["individual_address"], co["device_name"], co["number"], co["name"], co["function_text"],
                ", ".join(co["dpt_codes"]), co["object_size"], flags_text(co["flags"]),
                ", ".join(f"{ln['text']}{' (sends)' if ln['is_sending'] else ''}" for ln in co["links"]),
            ]
        )
    return rows_csv(["Device address", "Device", "Number", "Name", "Function", "DPT", "Size", "Flags (CRWTUI)", "Group addresses"], rows)


def export_topology(ed: Editor) -> str:
    rows = []
    pid = ed._pid()  # noqa: SLF001
    for inst in ed.projects.installations(pid):
        topo = ed.topology(inst.index)
        for a in topo["areas"]:
            for ln in a["lines"]:
                for s in ln["segments"]:
                    if not s["devices"]:
                        rows.append([a["address"], a["name"], f"{a['address']}.{ln['address']}", ln["name"], s["number"], s["medium_type"], "", "", "", s["current_ma"]])
                    for d in sorted(s["devices"], key=lambda x: _ia_key(x["individual_address"])):
                        rows.append(
                            [
                                a["address"], a["name"], f"{a['address']}.{ln['address']}", ln["name"], s["number"],
                                s["medium_type"], d["individual_address"], d["name"], d["product_name"], s["current_ma"],
                            ]
                        )
    return rows_csv(["Area", "Area name", "Line", "Line name", "Segment", "Medium", "Individual address", "Device", "Product", "Segment current (mA)"], rows)


def export_locations(ed: Editor) -> str:
    rows = []
    pid = ed._pid()  # noqa: SLF001

    def walk(nodes: list[Any], path: tuple[str, ...]) -> None:
        for n in nodes:
            here = (*path, n.name or n.space_type)
            if not n.devices:
                rows.append([" / ".join(here), n.space_type, n.number, "", ""])
            for d in n.devices:
                rows.append([" / ".join(here), n.space_type, n.number, d.individual_address or "", d.name])
            walk(n.children, here)

    for inst in ed.projects.installations(pid):
        walk(ed.projects.space_tree(pid, inst.index), ())
        for d in ed.projects.unassigned_devices(pid, inst.index):
            rows.append(["(no room)", "", "", d.individual_address or "", d.name])
    return rows_csv(["Location", "Type", "Number", "Individual address", "Device"], rows)


def manufacturers(ed: Editor) -> dict[str, Any]:
    """Devices grouped by manufacturer, then by product (order number)."""
    groups: dict[str, dict[tuple[str, str], list[dict[str, Any]]]] = {}
    for d in ed.devices():
        maker = d["manufacturer_name"] or "(unknown manufacturer)"
        key = (d["order_number"] or "", d["product_name"] or d["hardware_name"] or "")
        groups.setdefault(maker, {}).setdefault(key, []).append(d)
    items = []
    for maker in sorted(groups, key=str.lower):
        products = []
        for (order, product), devices in sorted(groups[maker].items(), key=lambda kv: (kv[0][1].lower(), kv[0][0])):
            devices.sort(key=lambda x: _ia_key(x["individual_address"]))
            products.append(
                {
                    "order_number": order,
                    "product_name": product,
                    "application_name": next((x["application_name"] for x in devices if x["application_name"]), ""),
                    "resolved": all(x["resolved"] for x in devices),
                    "devices": [
                        {"id": x["id"], "name": x["name"], "individual_address": x["individual_address"], "line": x["line"], "room": x["room"], "download_required": x["download_required"]}
                        for x in devices
                    ],
                }
            )
        items.append({"manufacturer": maker, "device_count": sum(len(p["devices"]) for p in products), "products": products})
    return {"items": items, "count": len(items)}


def export_manufacturers(ed: Editor) -> str:
    rows = []
    for m in manufacturers(ed)["items"]:
        for p in m["products"]:
            rows.append([m["manufacturer"], p["product_name"], p["order_number"], p["application_name"], len(p["devices"]), ", ".join(d["individual_address"] or "-" for d in p["devices"])])
    return rows_csv(["Manufacturer", "Product", "Order number", "Application", "Count", "Individual addresses"], rows)


EXPORTS = {
    "devices": export_devices,
    "group-addresses": export_group_addresses,
    "group-objects": export_group_objects,
    "topology": export_topology,
    "locations": export_locations,
    "manufacturers": export_manufacturers,
}


def export_csv(ed: Editor, kind: str) -> str:
    fn = EXPORTS.get(kind)
    if fn is None:
        raise NotFound(f"No export {kind!r}; one of {', '.join(EXPORTS)}")
    return fn(ed)
