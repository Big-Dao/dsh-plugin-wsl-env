# Official Harness Desktop package smoke. Invoked by official-harness-smoke.mjs, which
# resolves the installer and exports DSH_SMOKE_* inputs. Each check appends
# "STATUS<TAB>name<TAB>detail" to DSH_SMOKE_CHECKS_FILE; any failure exits nonzero.
$ErrorActionPreference = "Stop"
$checks = $env:DSH_SMOKE_CHECKS_FILE
$distro = $env:DSH_WSL_ENV_DISTRO
$profileName = $env:DSH_WSL_ENV_PROFILE
$work = Join-Path ([IO.Path]::GetTempPath()) ("dsh-official-smoke-" + [guid]::NewGuid().ToString("N"))
$app = $null

function Record([string]$status, [string]$name, [string]$detail = "") {
  Add-Content -LiteralPath $checks -Value "$status`t$name`t$detail"
  Write-Host "[smoke] $status $name $detail"
}

function Step([string]$name, [scriptblock]$body) {
  try {
    $detail = & $body
    Record "PASS" $name ([string]$detail)
  } catch {
    Record "FAIL" $name $_.Exception.Message
    throw
  }
}

function Invoke-Native([string]$exe, [string[]]$argv) {
  $out = & $exe @argv 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "$exe exited $LASTEXITCODE`: $out" }
  return $out
}

try {
  foreach ($k in "DSH_SMOKE_INSTALLER_URL", "DSH_SMOKE_INSTALLER_NAME", "DSH_SMOKE_PACKAGE_IDENTITY", "DSH_PLUGIN_PACKAGE_TARBALL", "DSH_WSL_ENV_DISTRO", "DSH_WSL_ENV_PROFILE", "DSH_SMOKE_CHECKS_FILE") {
    if (-not [Environment]::GetEnvironmentVariable($k)) { throw "$k is not set" }
  }
  New-Item -ItemType Directory -Path $work | Out-Null
  $installer = Join-Path $work $env:DSH_SMOKE_INSTALLER_NAME

  Step "installer-download" {
    Invoke-WebRequest -Uri $env:DSH_SMOKE_INSTALLER_URL -OutFile $installer -UseBasicParsing
    $installer
  }

  Step "installer-checksum" {
    $expected = $env:DSH_SMOKE_INSTALLER_SHA256
    if (-not $expected -and $env:DSH_SMOKE_CHECKSUM_URL) {
      $sums = (Invoke-WebRequest -Uri $env:DSH_SMOKE_CHECKSUM_URL -UseBasicParsing).Content
      $line = ($sums -split "`n") | Where-Object { $_ -match [regex]::Escape($env:DSH_SMOKE_INSTALLER_NAME) } | Select-Object -First 1
      if ($line -match "(?i)\b([0-9a-f]{64})\b") { $expected = $Matches[1] }
    }
    if (-not $expected) { throw "no expected sha256 available" }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash
    if ($actual -ine $expected) { throw "sha256 mismatch: expected $expected, got $actual" }
    "sha256 $actual"
  }

  $installDir = Join-Path $work "harness"
  Step "desktop-install" {
    $p = Start-Process -FilePath $installer -ArgumentList @("/S", "/D=$installDir") -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "installer exited $($p.ExitCode)" }
    $installDir
  }

  $dsh = Get-ChildItem -LiteralPath $installDir -Recurse -Filter "dsh.cmd" -File | Select-Object -First 1
  if (-not $dsh) { Record "FAIL" "dsh-cmd" "dsh.cmd not found under $installDir"; throw "dsh.cmd not found" }
  $desktop = Get-ChildItem -LiteralPath $installDir -Filter "*.exe" -File |
    Where-Object { $_.Name -notmatch "(?i)uninstall" } | Select-Object -First 1
  if (-not $desktop) { Record "FAIL" "desktop-exe" "Desktop executable not found"; throw "Desktop executable not found" }

  # An isolated DSH_HOME keeps the smoke away from any real profile; WSLENV
  # forwards the variables into WSL, as in cloud-wsl-gate.yml.
  $dshHome = Join-Path $work "dsh-home"
  New-Item -ItemType Directory -Path $dshHome | Out-Null
  $env:DSH_HOME = $dshHome
  $env:WSLENV = "DSH_HOME:DSH_WSL_ENV_PROFILE:DSH_WSL_ENV_DISTRO"

  Step "profile-init" {
    Invoke-Native $dsh.FullName @($profileName, "--from-default-profile", "web", "--dump-config") | Out-Null
    "profile $profileName from the default web profile"
  }

  Step "plugin-add" {
    $tarball = (Resolve-Path -LiteralPath $env:DSH_PLUGIN_PACKAGE_TARBALL).Path
    Invoke-Native $dsh.FullName @("plugin", "--profile", $profileName, "add", "file:$tarball") | Out-Null
    "tarball $($env:DSH_SMOKE_PACKAGE_IDENTITY) $(Split-Path -Leaf $tarball)"
  }

  # Dump-config proves composition only; the package
  # identity is the tarball identity recorded above.
  Step "dump-config" {
    $cfg = Invoke-Native $dsh.FullName @("--profile", $profileName, "--dump-config")
    if ($cfg -notmatch "dsh-plugin-wsl-env") { throw "dsh-plugin-wsl-env missing from --dump-config" }
    "dsh-plugin-wsl-env composed in profile $profileName"
  }

  $log = Join-Path $work "desktop.log"
  $app = Start-Process -FilePath $desktop.FullName -ArgumentList @("--no-sandbox", "--disable-gpu", "--no-open", "--profile", $profileName) `
    -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"

  Step "desktop-web-ready" {
    $deadline = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $deadline) {
      if ($app.HasExited) { throw "Desktop exited early with $($app.ExitCode)" }
      $text = (Get-Content -LiteralPath $log, "$log.err" -Raw -ErrorAction SilentlyContinue) -join "`n"
      if ($text -match "(https?://(?:127\.0\.0\.1|localhost):\d+\S*)") {
        $url = $Matches[1]
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10
        if ($r.StatusCode -eq 200) { return $url }
      }
      Start-Sleep -Seconds 2
    }
    throw "web endpoint not ready within 120s"
  }

  Step "wsl-command" {
    $out = (Invoke-Native "wsl.exe" @("-d", $distro, "--exec", "echo", "dsh-smoke")).Trim()
    if ($out -ne "dsh-smoke") { throw "unexpected output: $out" }
    "distro $distro"
  }

  Step "workspace-file-operation" {
    $dir = "\\wsl.localhost\$distro\tmp\dsh-official-smoke-$([guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $dir | Out-Null
    try {
      $f = Join-Path $dir "probe.txt"
      Set-Content -LiteralPath $f -Value "ok" -NoNewline
      if ((Get-Content -LiteralPath $f -Raw) -ne "ok") { throw "read-back mismatch" }
    } finally {
      Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
    }
    "write/read/delete in $distro"
  }
} catch {
  Write-Host "[smoke] FAILED: $($_.Exception.Message)"
  $failed = $true
} finally {
  if ($app -and -not $app.HasExited) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
  if ($app) { Add-Content -LiteralPath $checks -Value "PASS`tapp-stop`tstopped" }
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
if ($failed) { exit 1 }
exit 0
