<#
.SYNOPSIS
  Copy the add-on to a Home Assistant "addons" share for a local Supervisor build.

.DESCRIPTION
  Packs the vendored editor sources into one tarball (see pack-vendor.ps1), mirrors xknx-editor/
  to \\<host>\addons\addon-xknx-editor\xknx-editor (repository folder with the add-on folder
  inside, the layout the add-on store uses) without the vendored directory itself, and stamps
  config.yaml
  with "version: dev-<short git sha>" so the Supervisor sees every redeploy as an update. The
  committed file keeps the released version; it is what the add-on store compares against.

  Afterwards: Settings -> Add-ons -> Add-on store -> (menu) Check for updates, then
  Update or Rebuild "XKNX Editor (dev)" under Local add-ons.

.EXAMPLE
  .\tools\deploy-local.ps1
  .\tools\deploy-local.ps1 -HostName homeassistant.local
#>
param(
  [string]$HostName = "homeassistant.local",
  [string]$Share = "addons"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$src = Join-Path $repo "xknx-editor"
$dst = "\\$HostName\$Share\addon-xknx-editor\xknx-editor"

if (-not (Test-Path "\\$HostName\$Share")) {
  throw "\\$HostName\$Share is not reachable. Is the host up and the Samba add-on running?"
}
if ((Test-Path $dst) -and -not (Test-Path (Join-Path $dst "Dockerfile"))) {
  throw "$dst exists but does not look like this add-on; refusing to mirror over it."
}

& (Join-Path $PSScriptRoot "pack-vendor.ps1")

$sha = (git -C $repo rev-parse --short HEAD).Trim()
$dirty = if ((git -C $repo status --porcelain -- xknx-editor).Length -gt 0) { "-dirty" } else { "" }
$version = "dev-$sha$dirty"

$excludeDirs = @((Join-Path $src "vendor\xknx-editor"), (Join-Path $src "frontend\node_modules"), (Join-Path $src "frontend\dist"), "__pycache__", ".pytest_cache", "*.egg-info")
robocopy $src $dst /MIR /XD $excludeDirs /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -gt 3) { throw "robocopy failed with exit code $LASTEXITCODE" }

$cfg = Join-Path $dst "config.yaml"
(Get-Content $cfg) -replace '^version: .*$', "version: $version" | Set-Content -Encoding utf8 $cfg

Write-Host "Deployed $version to $dst"

# robocopy leaves 1-3 in $LASTEXITCODE for "copied some files"; do not surface that as a failure.
exit 0
