## What this changes

<!-- One or two sentences. What can a reader of the code or the docs now do that
they could not do before? -->

## Why

<!-- The reason, not the diff. Link the issue or discussion if there is one. -->

## Checks

- [ ] `npm test` passes: style and packaging, syntax, unit
- [ ] `npm run test:coverage` passes, or the drop is explained in a comment
- [ ] Behaviour changed, so `CHANGELOG.md` has an entry under `## [Unreleased]`
- [ ] The two READMEs still match section for section (`README.md`, `docs/README.zh.md`)
- [ ] Probes run where they apply, or this PR says why not: `npm run probe`,
      `npm run probe:sandbox`, `npm run probe:sandbox-shell`, `npm run probe:terminal`,
      and inside the distro `npm run probe:substrate`, `npm run probe:watch`,
      `npm run probe:agent`, `npm run probe:exec`

## Notes for the reviewer

<!-- What you are unsure about, and what you deliberately did not do. -->
