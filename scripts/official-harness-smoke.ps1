# Official Harness Desktop package smoke. Invoked by official-harness-smoke.mjs, which
# resolves the installer and exports DSH_SMOKE_* inputs. Each check appends
# "STATUS<TAB>name<TAB>detail" to DSH_SMOKE_CHECKS_FILE; any failure exits nonzero.
# Evidence (desktop log, through-plugin probe report) lands in test/probe/.scratch/
# and survives the run for the workflow's always() artifact.
$ErrorActionPreference = "Stop"
$checks = $env:DSH_SMOKE_CHECKS_FILE
$distro = $env:DSH_WSL_ENV_DISTRO
$profileName = $env:DSH_WSL_ENV_PROFILE
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$scratch = Join-Path $root "test\probe\.scratch"
$work = Join-Path ([IO.Path]::GetTempPath()) ("dsh-official-smoke-" + [guid]::NewGuid().ToString("N"))
$probeReport = Join-Path $scratch "official-smoke-probe.report"
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
  foreach ($k in "DSH_SMOKE_INSTALLER_URL", "DSH_SMOKE_INSTALLER_NAME", "DSH_OFFICIAL_HARNESS_VERSION", "DSH_SMOKE_PACKAGE_IDENTITY", "DSH_PLUGIN_PACKAGE_TARBALL", "DSH_WSL_ENV_DISTRO", "DSH_WSL_ENV_PROFILE", "DSH_SMOKE_CHECKS_FILE") {
    if (-not [Environment]::GetEnvironmentVariable($k)) { throw "$k is not set" }
  }
  New-Item -ItemType Directory -Path $work | Out-Null
  New-Item -ItemType Directory -Path $scratch -Force | Out-Null
  $installer = Join-Path $work $env:DSH_SMOKE_INSTALLER_NAME

  Step "installer-download" {
    Invoke-WebRequest -Uri $env:DSH_SMOKE_INSTALLER_URL -OutFile $installer -UseBasicParsing
    $installer
  }

  # The official CDN publishes no checksum object, so unless a checksum URL was
  # resolved upstream this step RECORDS the downloaded file's sha256 as evidence
  # instead of verifying a published one.
  Step "installer-checksum" {
    $expected = $env:DSH_SMOKE_INSTALLER_SHA256
    if (-not $expected -and $env:DSH_SMOKE_CHECKSUM_URL) {
      $sums = (Invoke-WebRequest -Uri $env:DSH_SMOKE_CHECKSUM_URL -UseBasicParsing).Content
      $line = ($sums -split "`n") | Where-Object { $_ -match [regex]::Escape($env:DSH_SMOKE_INSTALLER_NAME) } | Select-Object -First 1
      if ($line -match "(?i)\b([0-9a-f]{64})\b") { $expected = $Matches[1] }
    }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer).Hash
    if ($expected) {
      if ($actual -ine $expected) { throw "sha256 mismatch: expected $expected, got $actual" }
      "sha256 verified $actual"
    } else {
      "sha256 recorded $actual (no official checksum published)"
    }
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

  # The installed CLI must report the exact requested version: the CDN path is
  # exact, but a misconfigured mirror or cache could still serve other bytes.
  Step "harness-version" {
    $out = Invoke-Native $dsh.FullName @("--version")
    $line = ($out -split "`r?`n") | Where-Object { $_ -match "^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$" } | Select-Object -First 1
    if (-not $line) { throw "no version line in dsh --version output: $out" }
    $found = $line.Trim()
    if ($found -ne $env:DSH_OFFICIAL_HARNESS_VERSION) { throw "harness version is $found, expected $($env:DSH_OFFICIAL_HARNESS_VERSION)" }
    "dsh --version $found"
  }

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

  Step "dump-config" {
    $cfg = Invoke-Native $dsh.FullName @("--profile", $profileName, "--dump-config")
    if ($cfg -notmatch "dsh-plugin-wsl-env") { throw "dsh-plugin-wsl-env missing from --dump-config" }
    if ($cfg -match "skipped") { throw "composed profile reports skipped entries" }
    "dsh-plugin-wsl-env composed in profile $profileName"
  }

  # Composition alone proves nothing about the plugin's runtime seams. The
  # through-plugin probe (test/probe/official-smoke-probe.mjs) is mounted by
  # appending an overlay row to the profile's patch layer, so the Desktop app
  # boots it with the tarball-installed plugin: one shell command through the
  # plugin's WSL executor, one workspace file operation through the routed
  # filesystem, and one confined command the sandbox must refuse.
  Step "wire-probe" {
    $probeModule = Join-Path $root "test\probe\official-smoke-probe.mjs"
    if (-not (Test-Path -LiteralPath $probeModule)) { throw "probe module not found: $probeModule" }
    $patch = Join-Path $dshHome "profiles\$profileName\cordis.patch.yml"
    if (-not (Test-Path -LiteralPath $patch)) { throw "profile patch layer not found: $patch" }
    Remove-Item -LiteralPath $probeReport -Force -ErrorAction SilentlyContinue
    $overlay = @"

- insert:
    - id: official-smoke-probe
      name: '$probeModule'
      config:
        distro: '$distro'
        root: /tmp/dsh-official-smoke-probe
        outside: /tmp/dsh-official-smoke-probe-outside.txt
        report: '$probeReport'
"@
    Add-Content -LiteralPath $patch -Value $overlay
    "probe overlay appended to $patch"
  }

  # Keep the probe's scratch paths from a previous run out of this one.
  Step "probe-scratch-clean" {
    Invoke-Native "wsl.exe" @("-d", $distro, "-u", "root", "--", "rm", "-rf", "/tmp/dsh-official-smoke-probe", "/tmp/dsh-official-smoke-probe-outside.txt") | Out-Null
    "distro $distro scratch paths removed"
  }

  # The desktop log goes to the scratch evidence dir (not $work), so the
  # workflow's if: always() artifact carries it even after cleanup.
  $log = Join-Path $scratch "official-harness-smoke.desktop.log"
  Remove-Item -LiteralPath $log, "$log.err" -Force -ErrorAction SilentlyContinue
  $app = Start-Process -FilePath $desktop.FullName -ArgumentList @("--no-sandbox", "--disable-gpu", "--no-open", "--profile", $profileName) `
    -PassThru -RedirectStandardOutput $log -RedirectStandardError "$log.err"

  Step "desktop-web-ready" {
    $deadline = (Get-Date).AddSeconds(180)
    while ((Get-Date) -lt $deadline) {
      if ($app.HasExited) { throw "Desktop exited early with $($app.ExitCode)" }
      $text = (Get-Content -LiteralPath $log, "$log.err" -Raw -ErrorAction SilentlyContinue) -join "`n"
      if ($text -match "(https?://(?:127\.0\.0\.1|localhost):\d+\S*)") {
        $url = $Matches[1]
        try {
          $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10
          if ($r.StatusCode -eq 200) { return $url }
        } catch {
          # The endpoint can refuse connections while the server warms up;
          # keep polling until the deadline.
        }
      }
      Start-Sleep -Seconds 2
    }
    throw "web endpoint not ready within 180s"
  }

  Step "plugin-probe" {
    $deadline = (Get-Date).AddSeconds(240)
    $report = ""
    while ($true) {
      if ($app.HasExited) { throw "Desktop exited before the probe reported (exit=$($app.ExitCode))" }
      if (Test-Path -LiteralPath $probeReport) {
        $report = Get-Content -LiteralPath $probeReport -Raw
        if ($report -match "RESULT:") { break }
      }
      if ((Get-Date) -gt $deadline) { throw "probe report did not settle within 240s: $probeReport" }
      Start-Sleep -Seconds 2
    }
    if ($report -match "(?m)^FAIL ") { throw "the through-plugin probe reported failures:`n$report" }
    if ($report -notmatch "RESULT: all steps passed") { throw "the through-plugin probe did not complete:`n$report" }
    (($report -split "`r?`n") | Where-Object { $_ -match "^PASS " }) -join "; "
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
  if ($app) {
    if ($app.HasExited) {
      # An app that died on its own is not a stopped app; the smoke needed it
      # running, so any early exit is a failure regardless of the code.
      Record "FAIL" "app-stop" "Desktop exited early with $($app.ExitCode)"
    } else {
      # The profile was booted with --no-open (headless server), so the smoke
      # force-stops it and requires the process to actually be gone. Clean-exit
      # evidence for the full suite remains the source gate's authority.
      Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
      $stopped = $app.WaitForExit(15000)
      Record ($(if ($stopped) { "PASS" } else { "FAIL" })) "app-stop" $(if ($stopped) { "force-stopped and confirmed exited" } else { "still running 15s after Stop-Process" })
    }
  } else {
    Record "FAIL" "app-stop" "Desktop was never started"
  }
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
if ($failed) { exit 1 }
exit 0
