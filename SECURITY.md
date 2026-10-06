# Security policy

## Supported versions

Only the latest published version receives security fixes.

| Version | Supported |
|---|---|
| the version npm's `latest` tag points at | yes |
| every earlier version | no |

## Reporting a vulnerability

Report a suspected vulnerability privately. Use GitHub's private vulnerability
reporting on this repository:

https://github.com/Big-Dao/dsh-plugin-wsl-env/security/advisories/new

If that form is not available to you, open an ordinary issue that asks for a
private channel. Do not put exploit details in that issue. A maintainer will reply
with a private place to send them.

Do not post exploit details in a public issue, a discussion, or a pull request
before a fix is released.

## What to include in a report

- The plugin version you tested. `npm ls dsh-plugin-wsl-env` prints it, or name the
  tag you built from.
- Your Windows build and the distro you used. `wsl.exe -l -v` lists the distros.
- The DSH version and the profile name.
- What you expected to happen, and what happened instead.
- The smallest reproduction you can produce, with the exact command.
- Whether the sandbox was enabled at the time. `sandbox: true` is the default.

## Response times

These are targets, not a contract.

| Stage | Target |
|---|---|
| Acknowledge the report | within 3 business days |
| Initial assessment and severity | within 10 business days |
| A fix, or a documented mitigation | within 30 business days |

If a report is out of scope, we will say so and explain why.

## Disclosure

A confirmed vulnerability is fixed and disclosed through the ordinary release
process, not through a separate security track.

- The fix ships in the next release of the package, which is the only version the
  Supported versions table above covers.
- That release records the fix in [`CHANGELOG.md`](CHANGELOG.md), and the GitHub
  Release notes are taken from that section.
- The advisory is published on this repository's Security tab, where the private
  report was filed, once the release that carries the fix is out.

A report that is out of scope, or that we cannot confirm as a vulnerability, is
closed without a published advisory.

## Scope

In scope:

- the plugin's own code under `lib/`;
- the published package `dsh-plugin-wsl-env`.

Out of scope:

- the upstream DSH packages under `@deepseek-ai/`. Report those to their own
  projects.
- WSL itself, the Windows kernel, and `bubblewrap`.
- The configuration of a user's own distro. That includes its `sudoers` rules, its
  mounted filesystems, and the interpreters installed in it.
- Anything that requires an attacker to already control the user's Windows account
  or their distro account.

## Sandbox enforcement is `partial` by design

The plugin reports the sandbox enforcement level as `partial`, not `full`. A
process inside the distro can still start a Windows program through WSL interop,
for example `/mnt/c/.../*.exe`. That program runs outside the Linux sandbox.

This is a documented design boundary, not a vulnerability by itself. The command
`npm run probe:sandbox` demonstrates it on your machine when run from inside the
distro, where `bubblewrap` and `node` must be installed; the README states it in
its Sandbox section.

A report is still welcome if you find an escape that does not depend on interop,
or if the plugin ever reports `full` while interop is reachable.

## Credentials

No credential, token, or private key belongs in this repository. That includes npm
tokens, GitHub tokens, and distro passwords. If you find one committed here, report
it through the private channel above. Do not open a public issue for it.
