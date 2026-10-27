# Compatibility matrix

Measured evidence for the support tiers in [`ROADMAP-1.0.md`](ROADMAP-1.0.md)
(WSL-202). Every row below was executed on real WSL2 distros on one machine
(x86_64, Windows 11, WSL 2, kernel 6.18) on **2026-10-26**, with the probe
suite in [`test/probe/`](../test/probe/) run from inside each distro against a
fresh `--depth 1` clone. The aarch64 native agent is additionally executed per
push under qemu in CI — see the `native packages` job in
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml); VM-only by
decision — see "Scope decisions" below.

## The matrix

| | Ubuntu (host, Tier 1) | Debian 13.5 | Fedora 44 | openSUSE Tumbleweed | Arch | Alpine 3.22 |
|---|---|---|---|---|---|---|
| init | systemd | systemd | systemd | systemd | systemd | busybox/OpenRC |
| libc | glibc | glibc | glibc | glibc | glibc | musl |
| bwrap | 0.12 | 0.12 | 0.12 | 0.13.1 | 0.13.1 | 0.12 |
| node | 24 | 20.19 | 22.23 | 26.12 | 26.12 | 22.23 |
| `sandbox.sh` | 14/14 | 14/14 | 14/14 | 14/14 | 14/14 | 15/15 |
| `agent.sh` | 11/11 | 11/11 | 11/11 | 11/11 | 11/11 | 11/11 |
| `exec.sh` | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 |
| `substrate.sh` | 8/8 | 8/8 | 8/8 | 8/8 | 8/8 | 8/8 |
| `watch.sh` | 7/7 | 7/7 | 7/7 | 7/7 | 7/7 | 5/5 |
| `session-sandbox.sh` | 10p 1s | 10p 1s | 3p 1r 1s | 3p 1r 1s | 3p 1r 1s | 3p 1d 1s |

`p` = passed, `s` = skipped, `r` = race, `d` = declared limitation. Verdicts
per row follow [`ROADMAP-1.0.md`](ROADMAP-1.0.md): Ubuntu, Debian, Fedora,
openSUSE and Arch are **supported**; Alpine is **supported** for everything
the non-systemd scope claims, with the narrower `sessionSandbox: auto` scope.

**Debian is verified end to end**: the four harness-level probes
(`run.sh`, `terminal.sh`, `picker.sh`, `fs-routing.sh`) also pass against a
`wslfs-debian` profile (2026-10-26), on top of the distro-internal suite —
the full stack, not just the in-distro half.

## The found first-run trap: missing workspace root

The Debian harness-level runs surfaced one real finding: **the confined
resident refuses to start when the workspace root does not exist yet**. The
bwrap profile binds the workspace root (`--bind <root> <root>`), bwrap
requires the bind source to exist, and on a freshly imported distro the
probe's workspace (`~/.dsh-fsprobe`) did not. `mkdir -p` of the root turns
all ten failing steps green. Every prior Ubuntu run had the directory left
over from earlier probes, which is why the trap never fired there. Any
workspace whose directory is created lazily by its first write hits the same
wall on a fresh distro. Fixed in aa12b49: the confined factory's prepare
hook now creates the root (`mkdir -p`) before bwrap runs, the handshake
failure carries the resident's stderr when one still occurs, and
`substrate.sh` gained a fresh-root leg that spawns the resident against an
absent workspace root on every run, verified on both Debian (glibc) and
Alpine (musl).

## The two explained differences

- **`session-sandbox.sh`, background-survival leg (Fedora, openSUSE, Arch).**
  The same systemd distros split on this check when driven through `wsl.exe`
  (Debian passes, the other three do not): the probe allows a 0.5 s window and
  the WSL session teardown races it. This is a probe-context artifact, not a
  plugin claim — the plugin's background-process guarantee rides on systemd
  transient scopes, whose legs the probe itself marks "run from a WSL
  terminal". On Alpine the same leg fails **by declaration**: without systemd
  the plugin does not promise background survival, and `sessionSandbox: auto`
  reports the narrower per-command scope instead.

- **`watch.sh` on Alpine (5/5).** Two checks exercised the inotify fast path
  on the other distros and the polling fallback there; both behaviours are
  shipped and both are asserted, so the lower count reflects fewer exercised
  paths on that kernel/libc, not a weaker promise.

## Tier 2 setup notes (the traps, so the next import does not rediscover them)

| Distro | Setup that mattered |
|---|---|
| Debian | First launch can wedge before OOBE completes (`wsl.exe` exec and `--terminate` both hang). `wsl --terminate <distro>` once it is Stopped, then start as root to bypass OOBE. systemd is PID 1 out of the box. |
| Alpine | Import the **minirootfs** tarball (`wsl --import`), not the standard/cloud images. Create a normal user and set `[user] default=…` in `/etc/wsl.conf` — the imported default is root, and a root agent writes 0600 files the probe user cannot read. Install `coreutils util-linux` (busybox `mktemp`/`ps` lack the used options) and `shadow` for `useradd`. |
| Fedora / openSUSE / Arch | systemd PID 1 out of the box. openSUSE: `zypper --non-interactive` (the plain `-y` still prompts); Arch: `pacman -Sy --needed`. |

Dependencies used everywhere: `bash bubblewrap git nodejs` (node 20–26 all
pass; the plugin's `engines` floor applies to the harness host, not to probe
nodes). The probe runner per distro, from inside the distro:

```sh
git clone --depth 1 https://github.com/Big-Dao/dsh-plugin-wsl-env.git
cd dsh-plugin-wsl-env
for p in sandbox session-sandbox agent exec substrate watch; do bash test/probe/$p.sh; done
```

The harness-level probes (`run.sh`, `terminal.sh`, `picker.sh`,
`fs-routing.sh`) additionally need the app closed and the throwaway `wslfs`
profile from `run.sh`'s header; on a second distro, copy that profile and set
its `distro:` key.

## Scope decisions

- **aarch64 is verified in VM only; physical hardware is out of scope
  (decided 2026-10-27).** The qemu-user CI leg executes the full 18-check
  suite against the shipped binary on every push, which covers the agent's
  own code paths; what only real hardware can add is exposure to aarch64
  silicon's edge cases, which no Windows-on-ARM device in this project's
  reach provides. The support table marks aarch64 "supported (executed in
  CI)" and stays that way.

- **Windows 10 is not separately verified (decided 2026-10-27).** The plugin's
  entire surface is `wsl.exe`, the distro, and a UNC share; on WSL2 those are
  the same components on Windows 10 as on Windows 11, and the version-specific
  behaviour lives upstream in WSL itself, not in anything this plugin mounts.
  Windows 11 is what the matrix above measures; a Win10 report is welcomed
  through the support channels, but no separate verification is planned.

## Not yet measured

- Non-systemd session scopes driven by a real WSL terminal session (the
  probe's skipped legs).
- ~~Container images~~ — closed 2026-10-27: `test/agent-container.mjs` runs
  the real shell agent inside `debian:stable-slim`, `alpine:3`, `fedora:latest`,
  `opensuse/tumbleweed` and `archlinux` containers in CI (the
  `agent-containers` job, one per image), 7 checks each — handshake with the
  in-place digest, PING, EXEC with exit and both streams, SETENV, and the
  presence of `sha256sum`/`base64` where the families actually differ
  (busybox on Alpine vs coreutils elsewhere). 35/35 on first execution.
