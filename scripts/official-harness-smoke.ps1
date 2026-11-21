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
  # through-plugin probe (test/probe/official-smoke-probe.mjs) is mounted via
  # --patch on a headless CLI boot of the official install, which must happen
  # BEFORE the Desktop app starts: a CLI invocation while any instance is live
  # hands its arguments to that instance and exits 0 without running anything.
  # The overlay follows test/probe/sandbox-shell-probe.yml: the shipped
  # sandboxing shell executors are disabled so ctx.shell IS the plugin's WSL
  # executor (root composition routes shell elsewhere; the plugin's own rows
  # live in the preset isolate realm, which an external patch cannot reach),
  # and ctx.fs stays the routed filesystem the plugin composes at the root.
  # The file is a complete YAML document on its own — not an append to the
  # profile patch, whose default template is the flow sequence `[]`.
  Step "wire-probe" {
    $probeModule = Join-Path $root "test\probe\official-smoke-probe.mjs"
    if (-not (Test-Path -LiteralPath $probeModule)) { throw "probe module not found: $probeModule" }
    Remove-Item -LiteralPath $probeReport -Force -ErrorAction SilentlyContinue
    # The workspace root and the refusal target live under the distro HOME:
    # workspace-write mounts an ephemeral tmpfs over /tmp (the mode's promised
    # temp area), so a /tmp "outside" write lands in that private tmpfs and is
    # accepted — $HOME stays read-only, which is what the refusal check needs.
    $distroHome = (Invoke-Native "wsl.exe" @("-d", $distro, "--exec", "sh", "-c", 'printf %s "$HOME"')).Trim()
    if (-not $distroHome.StartsWith("/")) { throw "the distro reported no POSIX home: $distroHome" }
    $overlayPath = Join-Path $scratch "official-smoke-probe.overlay.yml"
    Set-Content -LiteralPath $overlayPath -Encoding utf8 -Value @"
- id: bash-sandbox
  disabled: true

- id: pwsh-sandbox
  disabled: true

- insert:
    - id: wsl-shell
      name: 'dsh-plugin-wsl-env/shell'
      config:
        distro: '$distro'
        loginShell: true

    - id: official-smoke-probe
      name: '$probeModule'
      config:
        distro: '$distro'
        root: $distroHome/.dsh-official-smoke-probe
        outside: $distroHome/dsh-official-smoke-probe-outside.txt
        report: '$probeReport'
"@
    $overlayPath
  }

  # Keep the probe's scratch paths from a previous run out of this one. Runs
  # as the distro's default user, so $HOME is that user's home.
  Step "probe-scratch-clean" {
    Invoke-Native "wsl.exe" @("-d", $distro, "--exec", "sh", "-c", 'rm -rf "$HOME"/.dsh-official-smoke-probe "$HOME"/dsh-official-smoke-probe-outside.txt') | Out-Null
    "distro $distro scratch paths removed"
  }

  $probeCliLog = Join-Path $work "probe-cli.log"
  $script:probeProcess = $null
  Step "plugin-probe" {
    $overlayPath = Join-Path $scratch "official-smoke-probe.overlay.yml"
    # $script: scope: a Step body runs in a child scope, and finally must see
    # the process to stop it when this step throws.
    # No --expose-internals here: run.sh passes it to the ELECTRON wrapper
    # before the CLI path; handed to dsh.cmd directly it swallows --profile
    # (run 44914824185 failed with "--profile <name> is required").
    $script:probeProcess = Start-Process -FilePath $dsh.FullName `
      -ArgumentList @("--profile", $profileName, "--patch", $overlayPath, "--no-open", "--port", "0") `
      -PassThru -RedirectStandardOutput $probeCliLog -RedirectStandardError "$probeCliLog.err"
    $deadline = (Get-Date).AddSeconds(240)
    $report = ""
    while ($true) {
      if ($script:probeProcess.HasExited) { throw "probe CLI exited before the probe reported (exit=$($script:probeProcess.ExitCode))" }
      if (Test-Path -LiteralPath $probeReport) {
        $report = Get-Content -LiteralPath $probeReport -Raw
        if ($report -match "RESULT:") { break }
      }
      if ((Get-Date) -gt $deadline) { throw "probe report did not settle within 240s: $probeReport" }
      Start-Sleep -Seconds 2
    }
    Stop-Process -Id $script:probeProcess.Id -Force -ErrorAction SilentlyContinue
    # dsh.cmd is a wrapper: the CLI's node child survives a plain Stop-Process
    # as an orphan still holding the redirected log open, so kill the tree.
    & taskkill.exe /PID $script:probeProcess.Id /T /F 2>&1 | Out-Null
    if (-not $script:probeProcess.WaitForExit(15000)) { throw "probe CLI did not exit after taskkill" }
    if ($report -match "(?m)^FAIL ") { throw "the through-plugin probe reported failures:`n$report" }
    if ($report -notmatch "RESULT: all steps passed") { throw "the through-plugin probe did not complete:`n$report" }
    (($report -split "`r?`n") | Where-Object { $_ -match "^PASS " }) -join "; "
  }

  # The desktop log is redirected inside $work: its writer's redirection
  # handle can outlive the process (a detached child survives the tree kill),
  # so the finally step reads it and writes the redacted evidence fresh into
  # the scratch dir instead of rewriting a file that may still be held.
  $log = Join-Path $work "desktop.log"
  # Keep the pinned install pinned: without these, the app checks the
  # production feed (the pinned rc.2 already found rc.5) and could pull a new
  # build over the evidence mid-run.
  $env:DSH_DESKTOP_AUTO_UPDATE_ENV = "test"
  $env:DSH_DESKTOP_MANDATORY_UPDATE_TEST_ORIGIN = "https://updates.example.invalid/"
  $env:DSH_DESKTOP_MANDATORY_UPDATE_PROD_ORIGIN = ""
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
          if ($r.StatusCode -eq 200) {
            # The endpoint URL carries a session token; the evidence contract
            # excludes auth tokens, so the recorded detail is redacted.
            return $url -replace "token=[^&\s]+", "token=REDACTED"
          }
        } catch {
          # The endpoint can refuse connections while the server warms up;
          # keep polling until the deadline.
        }
      }
      Start-Sleep -Seconds 2
    }
    throw "web endpoint not ready within 180s"
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
  # Any FAIL row recorded here must also set $failed: the checks file alone
  # does not drive this script's exit code when it runs standalone.
  if ($app) {
    if ($app.HasExited) {
      # An app that died on its own is not a stopped app; the smoke needed it
      # running, so any early exit is a failure regardless of the code.
      Record "FAIL" "app-stop" "Desktop exited early with $($app.ExitCode)"
      $failed = $true
    } else {
      # The profile was booted with --no-open (headless server), so the smoke
      # force-stops it and requires the process to actually be gone. The tree
      # kill matters: Electron's children keep the redirected log open after
      # the main process dies. Clean-exit evidence for the full suite remains
      # the source gate's authority.
      Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
      & taskkill.exe /PID $app.Id /T /F 2>&1 | Out-Null
      $stopped = $app.WaitForExit(15000)
      if (-not $stopped) {
        Record "FAIL" "app-stop" "still running 15s after Stop-Process"
        $failed = $true
      } else {
        Record "PASS" "app-stop" "force-stopped and confirmed exited"
      }
    }
  } else {
    Record "FAIL" "app-stop" "Desktop was never started"
    $failed = $true
  }
  if ($script:probeProcess -and -not $script:probeProcess.HasExited) {
    Stop-Process -Id $script:probeProcess.Id -Force -ErrorAction SilentlyContinue
    $script:probeProcess.WaitForExit(10000) | Out-Null
  }
  # The logs keep the web endpoint's session token; the evidence contract
  # excludes auth tokens. The writers' redirection handles can outlive them
  # (a detached child survives the tree kill), so never rewrite the originals:
  # read them and write the redacted copies into the scratch evidence dir.
  # Empty logs are common (a failed boot prints to one stream only).
  $evidencePairs = @(
    @($log, "official-harness-smoke.desktop.log"),
    @("$log.err", "official-harness-smoke.desktop.log.err"),
    @($probeCliLog, "official-harness-smoke.probe-cli.log"),
    @("$probeCliLog.err", "official-harness-smoke.probe-cli.log.err")
  )
  foreach ($pair in $evidencePairs) {
    $src = $pair[0]
    if (-not $src -or -not (Test-Path -LiteralPath $src)) { continue }
    $text = $null
    for ($attempt = 1; $attempt -le 3; $attempt++) {
      try {
        $text = Get-Content -LiteralPath $src -Raw
        break
      } catch {
        if ($attempt -eq 3) { throw "could not read $src : $($_.Exception.Message)" }
        Start-Sleep -Seconds 2
      }
    }
    if ($text) {
      Set-Content -LiteralPath (Join-Path $scratch $pair[1]) -NoNewline -Value ($text -replace "token=[^&\s`"']+", "token=REDACTED")
    }
  }
  # The profile home dies with $work; its startup logs are the composition
  # evidence (patch application, plugin load errors), so keep them.
  if ($dshHome) {
    Copy-Item -LiteralPath (Join-Path $dshHome "logs") -Destination (Join-Path $scratch "profile-logs") -Recurse -Force -ErrorAction SilentlyContinue
  }
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
if ($failed) { exit 1 }
exit 0
