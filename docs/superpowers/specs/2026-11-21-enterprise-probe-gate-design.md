# Enterprise Probe Gate Design

Date: 2026-11-21

## Status

Implemented (2026-11-21). The gates live in `.github/workflows/release.yml`
(`pack-candidate` on Linux, `candidate-package-smoke` and
`post-release-package-smoke` on Windows, publish bound to the smoke candidate)
and in `scripts/official-harness-smoke.{mjs,ps1}`; the through-plugin subset of
the minimum smoke is `test/probe/official-smoke-probe.mjs`, mounted on a
headless boot of the official CLI (before the Desktop starts: a CLI call while
an instance is live delegates and exits without running) with the plugin's WSL
shell executor inserted — provider-level coverage; the session-runtime preset
path remains the source gate's authority. The official installer resolves from
the official CDN's exact-version path — the upstream GitHub releases publish
no installer assets. Static contract tests are `test/release-scripts.test.mjs`,
`test/official-harness-smoke.test.mjs`, and the tarball-mode check in
`test/packaging.test.mjs`. `workflow_dispatch` dry runs the candidate path
without publishing. Validated by dispatch dry runs: CDN resolution, sha256
recording, the `dsh --version` pin, and composition are green on a real runner
(run 44914824185 and earlier); the through-plugin probe was still being
debugged at the time of writing.

## Problem

The existing cloud gate proves that the plugin works against a known Harness
source revision. It does not prove that the same plugin works through a
distributed package and official Harness installer. Those paths differ in
tarball installation, Electron packaging, plugin discovery, trust boundaries,
and process startup.

The design therefore adds package-level acceptance without replacing the
existing source-level gate.

## Goals

- Keep the current Windows + WSL source build as a PR and main-branch gate.
- Test the plugin package against an official Harness installation before a
  stable release is published.
- Test the resolved published package after release.
- Keep Windows, WSL, candidate-package, and post-release evidence separate and
  attributable.
- Fail the release or publish a visible warning when package smoke evidence is
  missing or failing.

## Non-goals

- Replace the pinned source build with official installers.
- Verify every model/provider integration.
- Promise live-account or authenticated model tests.
- Publish through a channel that has not passed the package smoke gate.

## Three acceptance layers

### 1. Source compatibility gate

The existing `cloud-wsl-gate.yml` remains the source-level Windows + WSL gate.

It continues to:

- check out and pin the Harness source revision;
- build an unsigned Windows Desktop directory;
- compose the plugin from the PR checkout;
- prepare Ubuntu and bubblewrap;
- stop all ordinary Harness processes;
- run `test/probe/run-all-when-closed.sh --include-fs`;
- fail on `SKIP`, `FAIL`, `NOT RUN`, or an incomplete PASS count;
- upload complete logs and results.

This layer validates current source compatibility. It is not interpreted as
official-package installation evidence.

### 2. Candidate package gate

Before the stable npm package is published, the release workflow creates or
obtains a candidate package tarball and installs it into an official Harness
installation on `windows-latest`.

The candidate package gate must:

- use the exact tagged commit;
- identify the candidate package by npm tag/tarball identity and content
  integrity;
- install an official Harness installer, rather than an unsigned source build;
- install the plugin candidate through supported plugin CLI or profile APIs;
- start the official Desktop app;
- verify plugin composition contains `dsh-plugin-wsl-env`;
- verify one constrained command and one filesystem operation in WSL;
- verify Desktop web readiness;
- stop the app and run the closed-app smoke subset defined below;
- upload candidate installer/probe logs without credentials or personal data.

Stable releases must not pass this gate if the official package does not
become resolvable or launch.

Candidate package publication is not allowed to move `latest`; release-candidate
artifacts may use `next` only.

### 3. Post-release verification

After registry verification succeeds, a Windows smoke job resolves the exact
published package version and repeats the minimum official-package smoke.

Post-release verification must:

- install the exact `package@version`, never only a floating `latest` tag;
- confirm registry integrity matches the locally built tarball or the release
  integrity recorded by the workflow;
- confirm official Harness startup and plugin composition;
- execute the minimum WSL command and filesystem smoke;
- upload evidence under the released version.

Failure is a release incident requiring:

- an immediate visible GitHub Release warning or follow-up issue;
- investigation of registry, installer, plugin composition, or runtime drift;
- no silent automatic rollback claim.

## Minimum official-package smoke subset

The first implementation may use a focused subset rather than the full
source-suite runner:

1. official Desktop starts and exposes a web endpoint;
2. supported plugin installation and profile composition succeed;
3. a Linux command runs in the pinned distro;
4. a workspace file operation succeeds;
5. a confined command remains subject to sandbox policy;
6. Desktop exits cleanly and probe evidence is complete.

The source gate remains the authority for the full 19-entry or later suite.

## Workflow boundaries

The implementation should use separate GitHub Actions jobs:

```text
source compatibility gate
  |
  +-- PR/main cloud-wsl-gate

release workflow
  |
  +-- build and verify candidate tarball
  +-- official-package candidate smoke
  +-- publish stable or next package
  +-- verify registry bytes and identity
  +-- official-package post-release smoke
  +-- create GitHub Release
```

Candidate smoke should run in parallel with or before independent publishing
steps, but publishing must depend on candidate smoke success. Post-release smoke
must depend on successful registry propagation and use the exact version.

## Evidence and security

Evidence artifacts must exclude:

- credentials, auth tokens, cookies, browser profiles, and model accounts;
- local machine secrets and absolute personal paths;
- installer or registry credentials;
- private environment values.

Artifacts must include:

- runner and workflow identifiers;
- candidate or published package version;
- package integrity and tarball identity;
- Harness and plugin versions;
- distro and probe facts;
- pass/fail result file;
- Desktop and probe logs.

## Testing

Static tests must prove workflow contracts rather than runtime outcomes:

- source gate still builds and runs the pinned source;
- candidate and post-release jobs use official package installation;
- publishing depends on candidate package smoke;
- package smoke uses exact versions and not floating tags;
- package, Harness, distro, and result identity are recorded;
- `SKIP`, `FAIL`, and `NOT RUN` invalidate official-package smoke.

Runtime CI remains responsible for real Windows/WSL evidence. Static assertions
remain drift checks, not proof of execution.

## Rollout

1. Add a reusable official-package smoke action or script.
2. Add a static contract test for the candidate and post-release jobs.
3. Run the official-package smoke as a non-blocking diagnostic first.
4. Verify one stable release and one `next` release candidate.
5. Make candidate smoke a publish prerequisite.
6. Make post-release smoke an incident-producing verification step.

## Acceptance criteria

The design is implemented when:

- PR/main behavior still uses the source compatibility gate;
- a release cannot publish stable artifacts before candidate smoke passes;
- candidate and published package versions are exact and integrity-bound;
- official-package smoke uses supported installation APIs;
- evidence is uploaded for both pre-release and post-release gates;
- package failures are visible and do not claim successful parity.
