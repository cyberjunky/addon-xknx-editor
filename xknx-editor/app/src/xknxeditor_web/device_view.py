"""Runtime view of one project device: its application plus the live parameter evaluator.

The project database stores only references and overrides (parameter values, com-object flag
overrides, module instances). This class resolves them against the catalog application into what
the UI shows: the parameter tree with visibility applied, and the device's com-objects. It is the
web counterpart of the desktop editor's device view, written against the ``xknxeditor.prod`` API.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from xknxeditor.namespaces.intermediate.com_object_instance_ref_t import (
    ComObjectInstanceRef,
)
from xknxeditor.namespaces.intermediate.enable_t import Enable
from xknxeditor.namespaces.intermediate.module_instance_t import ModuleInstance
from xknxeditor.namespaces.intermediate.parameter_instance_ref_t import (
    ParameterInstanceRef,
)
from xknxeditor.prod.parser_v2.dynamic import DynamicUI
from xknxeditor.prod.parser_v2.ui import (
    UiComObject,
    UiNode,
    UiParameter,
    UiParameterBlock,
    UiTab,
)

if TYPE_CHECKING:
    from xknxeditor.prod import Application
from xknxeditor.proj.core.identity import qualified_com_object_ref

FLAG_COLUMNS = (
    "communication_flag",
    "read_flag",
    "write_flag",
    "transmit_flag",
    "update_flag",
    "read_on_init_flag",
)


@dataclass
class ComObjectView:
    """A device com-object as the UI needs it: identity, flags, DPTs, and its project row id."""

    ref_id: str
    db_id: int | None
    number: int
    name: str
    function_text: str
    dpt_codes: tuple[str, ...]
    object_size: str
    priority: str
    flags: dict[str, bool]
    locked: dict[str, bool]

    def to_dict(self) -> dict[str, Any]:
        return {
            "ref_id": self.ref_id,
            "db_id": self.db_id,
            "number": self.number,
            "name": self.name,
            "function_text": self.function_text,
            "dpt_codes": list(self.dpt_codes),
            "object_size": self.object_size,
            "priority": self.priority,
            "flags": self.flags,
            "locked": self.locked,
        }


def _enable(value: bool | None) -> Enable | None:
    return None if value is None else (Enable.ENABLED if value else Enable.DISABLED)


def qualified_ref(row: Any, app_program_id: str) -> str:
    """The qualified per-instance ref of a com-object row: what the dynamic UI keys objects by.

    ``ComObject.ref_id`` is module-instance stripped, so matching on it alone makes every channel of
    a repeated module the same object (upstream issue #17)."""
    return qualified_com_object_ref(
        row.ref_id, getattr(row, "instance_ref_id", "") or "", app_program_id
    )


def instance_ref_from_row(row: Any, app_program_id: str = "") -> ComObjectInstanceRef:
    """A com-object instance ref carrying the row's flag overrides (bare ref when none)."""
    return ComObjectInstanceRef(
        ref_id=qualified_ref(row, app_program_id),
        communication_flag=_enable(row.communication_flag),
        read_flag=_enable(row.read_flag),
        write_flag=_enable(row.write_flag),
        transmit_flag=_enable(row.transmit_flag),
        update_flag=_enable(row.update_flag),
        read_on_init_flag=_enable(row.read_on_init_flag),
    )


def collect_com_objects(nodes: Any) -> list[UiComObject]:
    out: list[UiComObject] = []
    for node in nodes:
        if isinstance(node, UiComObject):
            out.append(node)
        elif isinstance(node, (UiTab, UiParameterBlock)):
            out.extend(collect_com_objects(node.children))
    return out


def collect_parameters(nodes: Any) -> list[UiParameter]:
    out: list[UiParameter] = []
    for node in nodes:
        if isinstance(node, UiParameter):
            out.append(node)
        elif isinstance(node, (UiTab, UiParameterBlock)):
            out.extend(collect_parameters(node.children))
    return out


class DeviceView:
    def __init__(self, device_id: int, app: Application, row: Any) -> None:
        self.device_id = device_id
        self.app = app
        self.app_program_id = app.program.id if app.program is not None else ""
        self._row_ids: dict[str, int] = {
            qualified_ref(co, self.app_program_id): co.id for co in row.com_objects
        }
        self._dyn: DynamicUI | None = None
        if app.program.dynamic is not None:
            pirs = [ParameterInstanceRef(ref_id=p.ref_id, value=p.value) for p in row.parameters]
            mis = [ModuleInstance(id=m.instance_id, ref_id=m.ref_id) for m in row.module_instances]
            coirs = [instance_ref_from_row(co, self.app_program_id) for co in row.com_objects]
            self._dyn = DynamicUI(
                app.program,
                parameter_instance_refs=pirs or None,
                module_instances=mis or None,
                com_object_instance_refs=coirs or None,
            )

    # --- parameters --------------------------------------------------------

    def ui_tree(self) -> list[UiNode]:
        """The pruned UI tree (tabs, blocks, parameters, com-objects) for the current values."""
        return [] if self._dyn is None else self._dyn.ui()

    def get_parameter(self, ref_id: str) -> str | None:
        return None if self._dyn is None else self._dyn.get_parameter_ref(ref_id)

    def set_parameter(self, ref_id: str, value: str) -> None:
        if self._dyn is not None:
            self._dyn.set_parameter_ref(ref_id, value)

    def parameter_count(self) -> int:
        return len(collect_parameters(self.ui_tree()))

    # --- com-objects -------------------------------------------------------

    def active_com_object_ref_ids(self) -> set[str]:
        """Parameter-driven active set (empty means "cannot derive", never "none")."""
        return set() if self._dyn is None else self._dyn.active_parameter_driven_com_object_ref_ids()

    def instantiated_ref_ids(self) -> set[str]:
        return set() if self._dyn is None else self._dyn.instantiated_com_object_ref_ids()

    def set_instance_ref(self, ref_id: str, coir: ComObjectInstanceRef) -> None:
        if self._dyn is not None:
            self._dyn.set_com_obj_instance_ref(ref_id, coir)

    def set_row_id(self, ref_id: str, db_id: int | None) -> None:
        if db_id is None:
            self._row_ids.pop(ref_id, None)
        else:
            self._row_ids[ref_id] = db_id

    def com_objects(self) -> list[ComObjectView]:
        """Visible com-objects for the current parameter values.

        An imported device carries the exact set it instantiated; restrict to that so channel-mode
        products do not show per-channel objects the raw defaults would activate. A device built
        from scratch has no instances and keeps the full parameter-driven set."""
        ui_cos = collect_com_objects(self.ui_tree())
        instantiated = self.instantiated_ref_ids()
        if instantiated:
            ui_cos = [co for co in ui_cos if co.ref_id in instantiated]
        return [
            ComObjectView(
                ref_id=co.ref_id,
                db_id=self._row_ids.get(co.ref_id),
                number=co.number,
                name=co.name,
                function_text=co.function_text or "",
                dpt_codes=tuple(dict.fromkeys(co.dpt_codes)),
                object_size=co.object_size or "",
                priority=co.priority or "",
                flags={
                    "communication": co.communication,
                    "read": co.read,
                    "write": co.write,
                    "transmit": co.transmit,
                    "update": co.update,
                    "read_on_init": co.read_on_init,
                },
                locked={
                    "read": co.read_locked,
                    "write": co.write_locked,
                    "transmit": co.transmit_locked,
                    "update": co.update_locked,
                    "read_on_init": co.read_on_init_locked,
                },
            )
            for co in ui_cos
        ]

    def default_com_object_refs(self) -> list[tuple[str, str | None]]:
        """``(ref_id, channel_id)`` of the objects a fresh device of this application starts with."""
        return [(co.ref_id, None) for co in collect_com_objects(self.ui_tree())]

    def module_instances(self) -> list[tuple[str, str]]:
        return [] if self._dyn is None else self._dyn.get_module_instances()
