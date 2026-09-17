"""Dataclasses from the upstream packages → JSON-ready dicts for the API."""

from __future__ import annotations

from dataclasses import asdict, is_dataclass
from enum import Enum
from typing import Any

from xknxeditor.prod.parser_v2.ui import (
    CheckBoxWidget,
    DateWidget,
    EnumWidget,
    FloatSliderWidget,
    FloatWidget,
    IpAddressWidget,
    NumberSliderWidget,
    NumberWidget,
    PictureWidget,
    ProgressBarWidget,
    TextWidget,
    TimeWidget,
    UiButton,
    UiComObject,
    UiNode,
    UiParameter,
    UiParameterBlock,
    UiSeparator,
    UiTab,
)


def plain(value: Any) -> Any:
    """Enums to their value, dataclasses to dicts, bytes to hex; everything else as-is."""
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, bytes):
        return value.hex()
    if is_dataclass(value) and not isinstance(value, type):
        return {k: plain(v) for k, v in asdict(value).items()}
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    if isinstance(value, dict):
        return {k: plain(v) for k, v in value.items()}
    return value


def widget_dict(widget: Any) -> dict[str, Any]:
    if widget is None:
        return {"type": "none"}
    if isinstance(widget, EnumWidget):
        return {
            "type": "enum",
            "choices": [
                {"value": c.value, "label": c.label, "id": c.id, "icon": c.icon}
                for c in widget.choices
            ],
        }
    if isinstance(widget, (NumberWidget, NumberSliderWidget)):
        return {
            "type": "slider" if isinstance(widget, NumberSliderWidget) else "number",
            "min": widget.min,
            "max": widget.max,
            "increment": widget.increment,
            "display_offset": widget.display_offset,
            "display_factor": widget.display_factor,
        }
    if isinstance(widget, (FloatWidget, FloatSliderWidget)):
        return {
            "type": "float_slider" if isinstance(widget, FloatSliderWidget) else "float",
            "min": widget.min,
            "max": widget.max,
            "increment": widget.increment,
            "display_format": widget.display_format,
            "display_offset": widget.display_offset,
            "display_factor": widget.display_factor,
        }
    if isinstance(widget, CheckBoxWidget):
        return {"type": "checkbox"}
    if isinstance(widget, ProgressBarWidget):
        return {"type": "progress", "min": widget.min, "max": widget.max}
    if isinstance(widget, TextWidget):
        return {"type": "text", "max_length": widget.max_length, "pattern": widget.pattern}
    if isinstance(widget, TimeWidget):
        return {
            "type": "time",
            "unit": plain(widget.unit),
            "min": widget.min,
            "max": widget.max,
            "hint": plain(widget.hint),
        }
    if isinstance(widget, DateWidget):
        return {"type": "date", "encoding": plain(widget.encoding), "year": widget.display_the_year}
    if isinstance(widget, IpAddressWidget):
        return {
            "type": "ip",
            "address_type": plain(widget.address_type),
            "version": plain(widget.version),
        }
    if isinstance(widget, PictureWidget):
        return {"type": "picture", "ref_id": widget.ref_id}
    return {"type": type(widget).__name__.removesuffix("Widget").lower()}


def node_dict(node: UiNode) -> dict[str, Any]:
    if isinstance(node, UiTab):
        return {
            "type": "tab",
            "id": node.id,
            "text": node.text or node.name or "",
            "number": node.number,
            "icon": node.icon,
            "children": [node_dict(c) for c in node.children],
        }
    if isinstance(node, UiParameterBlock):
        return {
            "type": "block",
            "id": node.id,
            # Only the block's Text is shown; its Name ("Grid", "Block_1") is internal to the product.
            "text": node.text or "",
            "inline": node.inline,
            "layout": plain(node.layout),
            "row_labels": list(node.row_labels),
            "column_headers": list(node.column_headers),
            "children": [node_dict(c) for c in node.children],
        }
    if isinstance(node, UiParameter):
        return {
            "type": "parameter",
            "ref_id": node.ref_id,
            "label": node.label,
            "value": node.value,
            "default": node.default_value,
            "widget": widget_dict(node.widget),
            "indent": node.indent_level,
            "suffix": node.suffix,
            "access": plain(node.access),
            "icon": node.icon,
            "cell": node.cell,
        }
    if isinstance(node, UiComObject):
        return {"type": "com_object", "ref_id": node.ref_id, "number": node.number, "name": node.name}
    if isinstance(node, UiSeparator):
        return {"type": "separator", "id": node.id, "text": node.text, "cell": node.cell}
    if isinstance(node, UiButton):
        return {"type": "button", "id": node.id, "text": node.text}
    return {"type": type(node).__name__}


def tree_dict(nodes: list[UiNode]) -> list[dict[str, Any]]:
    return [node_dict(n) for n in nodes]
