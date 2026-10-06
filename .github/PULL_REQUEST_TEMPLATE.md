## What this changes

<!-- One or two sentences. What can a reader of the code or the docs now do that
they could not do before? -->

## Why

<!-- The reason, not the diff. Link the issue or discussion if there is one. -->

## Checks

- [ ] `pnpm test` passes: style and packaging, syntax, build consistency, types, unit
- [ ] `pnpm run test:coverage` passes, or the drop is explained in a comment
- [ ] Behaviour changed, so `CHANGELOG.md` has an entry under `## [Unreleased]`
- [ ] The two READMEs still match section for section (`README.md`, `docs/README.zh.md`)
- [ ] Probes run where they apply, or this PR says why not. The full set of twelve is
      `test/probe/run-all-when-closed.sh --include-fs`, which waits for the harness to
      close first; individually: `pnpm run probe`, `pnpm run probe:sandbox`,
      `pnpm run probe:sandbox-shell`, `pnpm run probe:terminal`,
      `pnpm run probe:missing-wsl`, `pnpm run probe:picker`, `pnpm run probe:mode`,
      `pnpm run probe:sandbox-off`, and inside the distro `pnpm run probe:substrate`,
      `pnpm run probe:watch`, `pnpm run probe:agent`, `pnpm run probe:exec`

## Notes for the reviewer

<!-- What you are unsure about, and what you deliberately did not do. -->
