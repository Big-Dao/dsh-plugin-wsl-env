# Final fix report

1. Both Windows jobs (candidate, post-release) provision Ubuntu-24.04 (install, wsl.conf systemd, shutdown, set-default, apt prerequisites, linger) before smoke. Default distro/profile vars now `Ubuntu-24.04` / `wsl`.
2. official-harness-smoke.ps1: isolated DSH_HOME + WSLENV, `dsh wsl --from-default-profile web --dump-config`, `dsh plugin --profile wsl add file:<tarball>`, dump-config must contain plugin name (FAIL otherwise), Desktop with --profile/--no-open.
3. No installed-version claim: PASS detail is tarball identity; docs state dump-config proves composition only.
4. Candidate packs once on Windows; tgz + pack.json uploaded as `candidate-package`; publish downloads, verifies sha512, runs `npm publish <tgz> --provenance --access public`. Registry integrity/fileCount verified also when version already published (publish skipped).
5. Static tests extended; RELEASING (en/zh) updated; added RELEASING.zh.md to package.json files (pre-existing docs-ships failure from 0e06abe).

`pnpm test` passes. Concerns: workflows/PowerShell not executed locally; `file:` tarball form for `dsh plugin add` and a locally-run `npm publish <tgz>` with provenance are unverified on real runners.
