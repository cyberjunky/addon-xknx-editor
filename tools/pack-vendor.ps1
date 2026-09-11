<#
.SYNOPSIS
  Pack the vendored editor sources into the single tarball the Dockerfile expects.

.DESCRIPTION
  Writes xknx-editor/vendor/xknx-editor.tar.gz from xknx-editor/vendor/xknx-editor (git keeps the
  directory; the tarball is ignored). Run before a local docker build; deploy-local.ps1 calls it.
#>
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$vendor = Join-Path $repo "xknx-editor\vendor"
$out = Join-Path $vendor "xknx-editor.tar.gz"
if (Test-Path $out) { Remove-Item $out }
# bsdtar ships with Windows 10+; exclude the dev venv and caches.
& "$env:SystemRoot\System32\tar.exe" -czf $out -C $vendor --exclude ".venv" --exclude "__pycache__" --exclude ".pytest_cache" xknx-editor
if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }
Write-Host ("Packed {0} ({1:N1} MB)" -f $out, ((Get-Item $out).Length / 1MB))
