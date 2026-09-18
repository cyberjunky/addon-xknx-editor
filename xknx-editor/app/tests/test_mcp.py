"""The embedded MCP server: token gate, tool listing, a call through the editor thread."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from xknxeditor_web.config import Settings
from xknxeditor_web.main import create_app

HEADERS = {"Authorization": "Bearer s3cret", "Accept": "application/json, text/event-stream", "Content-Type": "application/json"}


@pytest.fixture
def mcp_client(dirs: tuple[Path, Path]) -> Iterator[TestClient]:
    config, share = dirs
    settings = Settings(config_dir=config, share_dir=share, ingress_only=True, ingress_entry="", upstream_ref="test", language=None, mcp_token="s3cret")
    with TestClient(create_app(settings)) as c:
        yield c


def _call(client: TestClient, method: str, params: dict | None = None, id_: int = 1) -> dict:
    return client.post("/mcp/", headers=HEADERS, json={"jsonrpc": "2.0", "id": id_, "method": method, "params": params or {}}).json()


def test_token_required_even_with_ingress_only(mcp_client: TestClient) -> None:
    # ingress_only blocks the API for non-supervisor clients, but /mcp is reachable with the token.
    assert mcp_client.get("/api/status").status_code == 403
    assert mcp_client.post("/mcp/", json={}).status_code == 401
    assert mcp_client.post("/mcp/", headers={**HEADERS, "Authorization": "Bearer wrong"}, json={}).status_code == 401


def test_tools_listed_and_callable(mcp_client: TestClient) -> None:
    init = _call(mcp_client, "initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}})
    from xknxeditor_web import __version__

    # The add-on's version, not the MCP SDK's, which the SDK would report by default.
    assert init["result"]["serverInfo"] == {"name": "xknx-editor", "version": __version__}
    listed = _call(mcp_client, "tools/list", id_=2)["result"]["tools"]
    names = {t["name"] for t in listed}
    assert {"status", "project_list_devices", "project_link_com_object", "connection_connect", "tools_extended_copy", "catalog_list_products"} <= names
    assert len(names) >= 60
    status = _call(mcp_client, "tools/call", {"name": "status", "arguments": {}}, id_=3)["result"]
    assert not status.get("isError") and '"open": false' in status["content"][0]["text"]
    created = _call(mcp_client, "tools/call", {"name": "project_new", "arguments": {"name": "Via MCP"}}, id_=4)["result"]
    assert not created.get("isError")
    ga = _call(mcp_client, "tools/call", {"name": "project_create_group_address", "arguments": {"name": "Hall", "address": "1/2/3", "datapoint_type": "DPST-1-1"}}, id_=5)["result"]
    assert not ga.get("isError") and "1/2/3" in ga["content"][0]["text"]
    err = _call(mcp_client, "tools/call", {"name": "project_get_device", "arguments": {"device_id": 999}}, id_=6)["result"]
    assert err.get("isError")
