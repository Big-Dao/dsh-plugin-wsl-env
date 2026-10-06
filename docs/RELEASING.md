# Releasing

This is the checklist this project follows. The last section records facts that
cost time to learn.

## 1. Decide the version

| Change | Version bump |
|---|---|
| Documentation, comments, the changelog itself | patch: 0.1.2 becomes 0.1.3 |
| A fix that does not change behaviour | patch |
| A behaviour change, a new configuration key, a new provider | minor |
| Anything that breaks an existing configuration | major |

The package is below 1.0.0, so the peer pins and the on-disk layer format may still
move in a minor release.

## 2. Cut the changelog and bump the version

1. Move the entries under `## [Unreleased]` in [`CHANGELOG.md`](../CHANGELOG.md)
   into a new dated section, `## [x.y.z] - YYYY-MM-DD`.
2. Leave the `## [Unreleased]` heading in place, empty.
3. Add a one-line introduction to the new section when the release has one theme.
4. Bump `version` in [`package.json`](../package.json) to the same number.

## 3. Run the gates

```bash
pnpm test
pnpm run test:coverage
```

The release workflow runs both of these before it publishes.

`pnpm test` includes the build-freshness gate: modules whose source lives in
`src/*.ts` must be rebuilt (`pnpm run build`) and the result committed under
`lib/`, so the tarball always ships exactly what the sources say without any
build step at pack time.

The coverage thresholds are 85 lines / 84 branches / 70 functions. The
branch threshold is one point under the others deliberately: the
integration layer is now measured, and part of what it leaves uncovered
needs a live `wsl.exe` — the distro-bound paths in `lib/index.js` (the
resolved home, the distro home, arming the watcher), the `wsl.exe` calls
in `lib/wsl.js` (`defaultDistro`'s no-distro throw, `linuxHomePath`,
`runInDistro`, and the other distro calls), and the real spawn internals
in `lib/watcher.js`. The real-machine probes cover that tail, not CI.
The rest of the uncovered branches — the host-path arm of
`wslWritableRoots`, the sandbox-error and rethrow arms, the
unrestricted-path result, all in `lib/index.js` — is ordinary
CI-coverable code. Do not raise the branch number without either covering
the `wsl.exe` tail on the Windows CI legs or moving the coverage job to
`windows-latest`.

Run the probes as well when behaviour changed, and keep their output for the pull
request or the release notes:

```bash
pnpm run probe
pnpm run probe:sandbox
pnpm run probe:sandbox-shell
pnpm run probe:sandbox-off
pnpm run probe:terminal
pnpm run probe:picker
pnpm run probe:missing-wsl
pnpm run probe:mode
pnpm run probe:substrate
pnpm run probe:watch
pnpm run probe:agent
pnpm run probe:exec
```

`pnpm run probe:sandbox` runs from inside the distro and needs neither the harness
nor a profile. `pnpm run probe:mode` uses the harness executable as its Windows
Node, so it needs no harness boot and no profile. `probe:substrate`,
`probe:watch`, `probe:agent` and `probe:exec` also run from inside the distro.
The rest — `probe`, `probe:sandbox-shell`, `probe:terminal`, `probe:picker`,
`probe:missing-wsl` and `probe:sandbox-off` — need Windows, WSL2, a mounted
profile and a linked checkout.

`npm publish` runs the `prepublishOnly` script, which is `pnpm test`. The local
gates therefore run again during the release step.

## 4. Commit and tag

```bash
git add package.json CHANGELOG.md
git commit -m "Release x.y.z: <what the release is>"
git tag -a vx.y.z -m "dsh-plugin-wsl-env x.y.z"
git push origin main vx.y.z
```

The version in `package.json` and `CHANGELOG.md` carries no `v`. The tag and the
GitHub Release do. The tag push starts the release workflow described in step 5.

## 5. Publish

### The tag-triggered workflow

Pushing the tag starts `.github/workflows/release.yml`. It does five things, in
this order:

1. Checks that the tag matches `version` in `package.json`, using
   `scripts/check-release-tag.mjs`.
2. Runs the gates, `pnpm test` and `pnpm run test:coverage`.
3. Asks the registry whether this version is already published, and skips the
   upload when it is. Re-pushing the same tag therefore does not publish again —
   it only gets you as far as the GitHub Release.
4. Publishes with `npm publish --provenance --access public`. That attaches a
   signed attestation tying the tarball to this workflow run and this commit.
5. Creates the GitHub Release, with notes taken from the changelog section by
   `scripts/changelog-section.mjs`.

The workflow requires a trusted publisher configured on npmjs.com for this
repository, this workflow file, and the `npm-publish` environment. That is what
lets npm exchange the run's OIDC token (`id-token: write`) for a short-lived
publish credential, so no npm token is stored in the repository.

If trusted publishing is not configured, add an `NPM_TOKEN` repository secret and
hand it to the Publish step in `.github/workflows/release.yml` — the step does not
read it on its own, so add `env: NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` to it.
Configure required reviewers on the `npm-publish` environment to put a second
person in front of every publish.

### Manual fallback

Use this when the workflow cannot run. Publish from a machine that holds a granular
access token with write access to the package. The token needs `bypass 2FA`
enabled if the account requires 2FA.

Run the same tag check the workflow runs, against the tag you are about to push,
then publish:

```bash
node scripts/check-release-tag.mjs vx.y.z

npm publish --registry=https://registry.npmjs.org/ \
  --//registry.npmjs.org/:_authToken=<token>
```

Pass the token on the command line. Never write it into a file in the repository,
and revoke it once the release is verified.

Set `--registry` explicitly. A local `~/.npmrc` may point at a mirror, and a
release published to a mirror is not a release.

A manual publish does not create the GitHub Release, so do step 7 by hand.

## 6. Verify on the registry

`npm publish` prints `+ dsh-plugin-wsl-env@x.y.z` when the upload is accepted. That
is not the same as the version being visible. The version and the `dist-tags`
appear in the registry a minute or two later, so poll instead of checking once:

```bash
# expect 200, not 404
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://registry.npmjs.org/dsh-plugin-wsl-env/x.y.z

curl -sS https://registry.npmjs.org/-/package/dsh-plugin-wsl-env/dist-tags
```

Then check the metadata:

```bash
npm view dsh-plugin-wsl-env version dist-tags dist.fileCount \
  --registry=https://registry.npmjs.org/ --prefer-online

npm view dsh-plugin-wsl-env readmeFilename \
  --registry=https://registry.npmjs.org/ --prefer-online
```

`readmeFilename` must be `README.md`. Compare the file count with what
`npm pack --dry-run` reports from the same commit: a difference means the `files`
list in `package.json` changed since the release.

Use `--prefer-online`, or a fresh cache directory, while verifying. A cached
packument shows the previous release and looks like a failed publish.

## 7. Create the GitHub Release

The tag-triggered workflow creates the Release for you, with notes from the
changelog section. Do it by hand only after a manual publish:

```bash
node scripts/changelog-section.mjs > notes.md

gh release create vx.y.z --repo Big-Dao/dsh-plugin-wsl-env \
  --title "vx.y.z - <short title>" --notes-file notes.md --verify-tag
```

The notes summarise the changelog section. Mention anything a user must do, such as
a new required configuration key.

## 8. Refresh the runtime mirror

The Windows copy of the checkout is what the app loads. Sync it to the tagged
state:

```bash
pnpm run sync:windows
```

Then confirm that the two trees match:

```bash
diff -rq --exclude=.git --exclude=node_modules --exclude=.scratch \
  . /mnt/c/Users/<you>/Documents/deepseek-harness/default-workspace/dsh-plugin-wsl
```

Read this as "no unexpected differences", not "no output". `test/probe/.scratch`
is never copied, and the sync is additive on purpose — it never deletes — so the
mirror legitimately keeps files this checkout no longer has.
`test/probe/sync-to-windows.sh` reports that same residual set as a note rather
than a failure. What matters is the other direction: a file this checkout has and
the mirror does not, or one that differs.

That destination is outside a session workspace, so a confined agent session is
refused there and has to approve a wider permission for the one command.

## 9. If a version turns out to be bad

npm does not let a published version be replaced, so the fix goes forward:

1. Deprecate the bad version, so anyone who installs it sees the warning:

   ```bash
   npm deprecate dsh-plugin-wsl-env@x.y.z "<what is wrong>; use x.y.(z+1)" \
     --registry=https://registry.npmjs.org/
   ```

2. Cut the fix as the next patch version, following this document from step 2.
   Prefer that to `npm unpublish`, which is not a rollback: it removes the
   tarball for every consumer that already resolved it.

3. Correct the GitHub Release for the bad tag, or point its notes at the patch
   release. The release notes stay the first thing a reader finds.

## Operational facts worth remembering

| Fact | What it means in practice |
|---|---|
| `npm publish` prints success at upload time | The version may still return 404 for a minute or two. Poll the registry, and do not conclude that the publish failed. |
| A repeated publish of the same version is refused | npm checks the registry first and stops with `You cannot publish over the previously published versions: x.y.z.`; a registry-side conflict surfaces as `EPUBLISHCONFLICT` ("Cannot publish over existing version."). Either one means the first publish landed. Verify it instead of publishing again — the release workflow's already-published check exists for the same reason. |
| The npm readme is chosen from the candidate files at the package root, and the rule is not fully explained. With `README.md` and `README.zh.md` side by side, version 0.1.1 published as `readmeFilename: README.zh.md`, so its npm page rendered Chinese — even though the tarball listed `README.md` first. Both names match the npm CLI's own selection code (`@npmcli/package-json/lib/normalize.js` globs `{README,README.*}` and accepts `/\.m?a?r?k?d?o?w?n?$/i`, which does match `.md`), so neither name is screened out. | Do not rely on the rule. Keep exactly one readme candidate at the package root, which `pnpm run lint:style` checks. The Chinese README lives in `docs/` for this reason. |
| A local `~/.npmrc` may point at a mirror | Pass `--registry=https://registry.npmjs.org/` on every publish and every verification. |
| The npm token is a credential | Pass it per command, never commit it, and revoke it after the release. |
