"""Test fixtures: a temp config/share layout with upstream's own .knxprod and .knxproj fixtures."""

from __future__ import annotations

import shutil
from collections.abc import Iterator
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from xknxeditor_web.config import Settings
from xknxeditor_web.main import create_app

VENDOR = Path(__file__).resolve().parents[2] / "vendor" / "xknx-editor"
KNXPROD = VENDOR / "packages/prod/tests/fixtures/gira_2gang_button_interface.knxprod"
KNXPROJ = VENDOR / "packages/proj/tests/fixtures/xknx_test_project_no_password.knxproj"


@pytest.fixture
def dirs(tmp_path: Path) -> tuple[Path, Path]:
    config = tmp_path / "config"
    share = tmp_path / "share"
    config.mkdir()
    share.mkdir()
    shutil.copy(KNXPROD, share / KNXPROD.name)
    shutil.copy(KNXPROJ, share / KNXPROJ.name)
    return config, share


@pytest.fixture
def client(dirs: tuple[Path, Path]) -> Iterator[TestClient]:
    config, share = dirs
    settings = Settings(
        config_dir=config,
        share_dir=share,
        ingress_only=False,
        ingress_entry="",
        upstream_ref="test",
        language=None,
    )
    with TestClient(create_app(settings)) as c:
        yield c


def wait_job(client: TestClient, job: dict) -> dict:
    import time

    for _ in range(600):
        if job["status"] in ("done", "failed"):
            return job
        time.sleep(0.05)
        job = client.get(f"/api/jobs/{job['id']}").json()
    raise AssertionError(f"job did not finish: {job}")
