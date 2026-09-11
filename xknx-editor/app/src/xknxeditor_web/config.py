"""Runtime settings, read once from the environment the s6 run script prepares."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

SUPERVISOR_IP = "172.30.32.2"


@dataclass(frozen=True)
class Settings:
    config_dir: Path
    share_dir: Path
    ingress_only: bool
    ingress_entry: str
    upstream_ref: str
    language: str | None
    mcp_token: str = ""
    port: int = 0

    @property
    def catalog_path(self) -> Path:
        return self.config_dir / "catalog.xknxcatalog"

    @property
    def projects_dir(self) -> Path:
        return self.config_dir / "projects"

    @classmethod
    def from_env(cls) -> Settings:
        lang = os.environ.get("XKNX_LANGUAGE", "").strip() or None
        return cls(
            config_dir=Path(os.environ.get("XKNX_CONFIG_DIR", "/config")),
            share_dir=Path(os.environ.get("XKNX_SHARE_DIR", "/share")),
            ingress_only=os.environ.get("XKNX_INGRESS_ONLY", "true").strip().lower() == "true",
            ingress_entry=os.environ.get("XKNX_INGRESS_ENTRY", ""),
            upstream_ref=os.environ.get("XKNX_EDITOR_REF", "unknown"),
            language=lang,
            mcp_token=os.environ.get("XKNX_MCP_TOKEN", "").strip(),
            port=int(os.environ.get("XKNX_PORT", "0") or 0),
        )
