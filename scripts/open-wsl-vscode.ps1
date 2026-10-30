#!/usr/bin/env pwsh
# Open a WSL folder in VS Code through Remote-WSL — the full Linux
# integration (distro shell, extensions in the distro, local ext4 speed) —
# instead of the degraded UNC share (9p files, Windows terminal, Windows
# extensions).
#
#   scripts/open-wsl-vscode.ps1 -Path "\\wsl.localhost\ubuntu\home\me\proj"
#   scripts/open-wsl-vscode.ps1 -Path "/home/me/proj" -Distro ubuntu
#
# Requires VS Code on PATH (the `code` shim) and the Remote-WSL extension.

param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$Distro
)

$ErrorActionPreference = "Stop"

# Shape 1: a WSL UNC path carries its own distro name.
if ($Path -match '^\\\\wsl(?:\.localhost)?\\([^\\]+)\\(.*)$') {
  $Distro = $Matches[1]
  $LinuxPath = "/" + ($Matches[2] -replace "\\", "/")
}
elseif ($Path -match "^/") {
  # Shape 2: a Linux path needs the distro named explicitly.
  if (-not $Distro) { throw "open-wsl-vscode: a Linux path requires -Distro" }
  $LinuxPath = $Path -replace "\\", "/"
}
else {
  throw "open-wsl-vscode: not a WSL UNC path or a Linux path: $Path"
}

$Uri = "vscode-remote://wsl+$Distro$LinuxPath"
Write-Output "opening $Uri"
& code --folder-uri $Uri
if ($LASTEXITCODE -ne 0) { throw "code exited $LASTEXITCODE" }
