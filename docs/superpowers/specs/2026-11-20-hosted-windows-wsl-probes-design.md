# GitHub-hosted Windows + WSL Probe Gate

Date: 2026-11-20

## Goal

Run the repository's real-machine closed-app probe suite on
`GitHub-hosted windows-latest` runners after the existing Desktop and WSL
gate has prepared a usable Ubuntu distro and the WSL plugin profile.

The hosted gate must report a real pass only when every member of the selected
suite runs and passes. Failures, missing prerequisites, skips and probes never
attempted must remain visible and must not become success-shaped fallback.

## Scope

Add one hosted probe phase to `.github/workflows/cloud-wsl-gate.yml`.

The phase uses the existing suite runner:

```text
test/probe/run-all-when-closed.sh --include-fs
```

This is the authoritative suite because it includes the 18-script
`SUITE` plus `run.sh` with `--include-fs`. It does not invent a second suite or
replace existing probe scripts.

The existing cloud gate is responsible for:

- building the unsigned Windows Desktop package;
- installing Ubuntu 24.04 and bubblewrap;
- creating the `wsl` profile and linking the plugin;
- booting and checking the Desktop Web endpoint;
- installing all probe prerequisites inside WSL.

The probe phase is responsible for:

- preparing the throwaway `wslfs` profile;
- preparing a runtime mirror of the current checkout;
- installing a second distro for the two-distro probe;
- ensuring no Harness GUI process is left running;
- running the suite inside Ubuntu under the same unconfined shell used by
  `run-all-when-closed.sh`;
- uploading the complete suite log and results files as evidence.

## Approach

Use the existing hosted gate as the integration point rather than a second
standalone workflow. Reuse the packaged Desktop CLI and the existing
`run-all-when-closed.sh` contract.

Why this approach:

- the hosted Desktop build and WSL setup are already proven;
- the suite runner already distinguishes PASS, FAIL, SKIP and NOT RUN;
- `run.sh` and the Harness-backed probes require the app to be closed;
- a separate workflow would duplicate platform setup and make evidence harder
  to correlate.

## Environment preparation

Before starting Desktop probes, the gate prepares one throwaway `wslfs`
profile:

1. Set `DSH_HOME` to the hosted home directory.
2. Create the profile from the shipped `web` template.
3. Add the plugin checkout as a linked plugin.
4. Copy `test/probe/wslfs-profile.patch.yml` into the profile.
5. Export the probe path facts required by `test/probe/env.sh`.
6. Install Node, bubblewrap and systemd/user-manager prerequisites in Ubuntu.
7. Install Debian or another second distro for the two-distro probe.

The probe phase must not use the production `wsl` profile. A leftover profile
or GUI process must not be mistaken for a successful throwaway probe boot.

## Execution

Stop the Desktop process after Web readiness is verified. Then invoke the suite
inside Ubuntu:

```bash
WSL_UTF8=1 wsl.exe -d Ubuntu-24.04 --exec bash -lc \
  "cd '<wsl-checkout>' && bash test/probe/run-all-when-closed.sh --include-fs"
```

The suite runner owns app-process polling and the probe ordering. The workflow
must not start the suite while the readiness process is still alive.

The suite's stdout and stderr must remain in runner evidence. On failure, the
job must upload `test/probe/.scratch/full-probe.*.log` and
`test/probe/.scratch/full-probe.*.results`.

## Failure contract

The suite is successful only if `summarize-probes.mjs` reports:

```text
FULL PASS: every probe in the suite ran and passed
```

Therefore:

- FAIL exits 1;
- SKIP or NOT RUN exits 2;
- malformed or missing evidence is not converted to PASS;
- a probe's prerequisite missing from the hosted environment is a SKIP unless
  the environment was supposed to provide that prerequisite.

If the repository policy later defines an approved hosted-run skip list, it
must be explicit and machine-readable. It must not be a silent workflow
default.

## Artifacts

The gate uploads:

- composed `cloud-desktop-profile.txt`;
- Desktop stdout/stderr;
- the suite log;
- the suite results file;
- existing probe report files for scripts that produce them.

Artifacts remain always-uploaded so failure diagnosis does not depend on
runner console output.

## Verification

Before a workflow change is merged:

1. `pnpm test` passes.
2. A hosted workflow run includes the probe phase.
3. Desktop, WSL composition and Web readiness pass.
4. The suite log reports a full pass with no skipped or not-run entries.
5. At least one deliberate probe failure is tested in a throwaway branch to
   confirm FAIL evidence is uploaded and the job fails.

## Non-goals

- Replacing the existing unit and browser suites.
- Running a real-model or authenticated-account round that requires secrets.
- Hiding hosted prerequisites behind `SKIP`.
- Adding a self-hosted runner requirement to `windows-latest`.
