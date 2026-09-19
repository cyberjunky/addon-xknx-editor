"""A com-object row is matched by its qualified per-instance ref.

``ComObject.ref_id`` has the module instance stripped, so every channel of a repeated module (an MDT
push button, upstream issue #17) collapses onto one string. Matching on it hid rows and let a
reconcile delete and recreate them, losing their links and flag overrides.
"""

from __future__ import annotations

from types import SimpleNamespace

from xknxeditor_web.device_view import qualified_ref


def row(ref_id: str, instance_ref_id: str = ""):
    return SimpleNamespace(ref_id=ref_id, instance_ref_id=instance_ref_id)


APP = "M-0083_A-0001-11-ABCD"


def test_channels_of_one_module_stay_apart() -> None:
    first = row(f"{APP}_O-1_R-1", "M-0083_MD-1_M-1_MI-1_O-1_R-1")
    second = row(f"{APP}_O-1_R-1", "M-0083_MD-1_M-1_MI-2_O-1_R-1")
    assert qualified_ref(first, APP) != qualified_ref(second, APP)
    assert qualified_ref(first, APP) == f"{APP}_M-0083_MD-1_M-1_MI-1_O-1_R-1"


def test_an_instance_ref_that_already_carries_the_app_is_left_alone() -> None:
    both = row(f"{APP}_O-2_R-2", f"{APP}_M-0083_MD-1_M-1_MI-3_O-2_R-2")
    assert qualified_ref(both, APP) == f"{APP}_M-0083_MD-1_M-1_MI-3_O-2_R-2"


def test_without_an_instance_ref_the_stored_ref_is_used() -> None:
    # Objects created in the editor (not imported) carry no instance ref; theirs is already
    # qualified. An unknown application id must not invent a prefix either.
    assert qualified_ref(row(f"{APP}_O-3_R-3"), APP) == f"{APP}_O-3_R-3"
    assert qualified_ref(row("O-4_R-4", "M-1_MI-1_O-4_R-4"), "") == "O-4_R-4"
