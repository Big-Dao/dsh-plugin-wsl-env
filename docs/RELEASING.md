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
npm test
npm run test:coverage
```

The release workflow runs both of these before it publishes.

The coverage thresholds are 85 lines / 84 branches / 70 functions. The
branch threshold is one point under the others deliberately: the
integration layer (`lib/index.js`) is now measured, and its uncovered
tail is the distro-resolution branches (`defaultDistro`'s no-distro
throw, `linuxHomePath`'s refusals, the watcher's real spawn internals)
that need a live `wsl.exe` — covered by the real-machine probes, not by
CI. Do not raise the branch number without either covering that tail on
the Windows CI legs or moving the coverage job to `windows-latest`.

Run the probes as well when behaviour changed, and keep their output for the pull
request or the release notes:

```bash
npm run probe
npm run probe:sandbox
npm run probe:sandbox-shell
npm run probe:terminal
npm run probe:picker
npm run probe:missing-wsl
npm run probe:mode
npm run probe:substrate
npm run probe:watch
npm run probe:agent
npm run probe:exec
```

`npm run probe:sandbox` needs no harness; `npm run probe:mode` needs Windows Node
but no harness. `probe:substrate`, `probe:watch`, `probe:agent` and `probe:exec`
run from inside the distro. The rest need Windows, WSL2, a mounted profile and a
linked checkout.

`npm publish` runs the `prepublishOnly` script, which is `npm test`. The local
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

Pushing the tag starts `.github/workflows/release.yml`. It does four things, in
this order:

1. Checks that the tag matches `version` in `package.json`, using
   `scripts/check-release-tag.mjs`.
2. Runs the gates, `npm test` and `npm run test:coverage`.
3. Publishes with `npm publish --provenance --access public`. That attaches a
   signed attestation tying the tarball to this workflow run and this commit.
4. Creates the GitHub Release, with notes taken from the changelog section by
   `scripts/changelog-section.mjs`.

The workflow requires a trusted publisher configured on npmjs.com for this
repository, this workflow file, and the `npm-publish` environment. That is what
lets npm exchange the run's OIDC token (`id-token: write`) for a short-lived
publish credential, so no npm token is stored in the repository.

If trusted publishing is not configured, add an `NPM_TOKEN` repository secret and
pass it to the publish step as `NODE_AUTH_TOKEN`. Configure required reviewers on
the `npm-publish` environment to put a second person in front of every publish.

### Manual fallback

Use this when the workflow cannot run. Publish from a machine that holds a granular
access token with write access to the package. The token needs `bypass 2FA`
enabled if the account requires 2FA.

```bash
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
gh release create vx.y.z --repo Big-Dao/dsh-plugin-wsl-env \
  --title "vx.y.z - <short title>" --notes-file <notes.md> --verify-tag
```

The notes summarise the changelog section. Mention anything a user must do, such as
a new required configuration key.

## 8. Refresh the runtime mirror

The Windows copy of the checkout is what the app loads. Sync it to the tagged
state:

```bash
npm run sync:windows
```

Then confirm that the two trees match:

```bash
diff -rq --exclude=.git --exclude=node_modules \
  . /mnt/c/Users/<you>/Documents/deepseek-harness/default-workspace/dsh-plugin-wsl
```

That destination is outside a session workspace, so a confined agent session is
refused there and has to approve a wider permission for the one command.

## Operational facts worth remembering

| Fact | What it means in practice |
|---|---|
| `npm publish` prints success at upload time | The version may still return 404 for a minute or two. Poll the registry, and do not conclude that the publish failed. |
| A retry can fail with `409 Cannot publish over previously staged version` | The first publish did land. Verify it instead of publishing again. |
| The npm readme is chosen from the candidate files at the package root, and the rule is not fully explained. With `README.md` and `README.zh.md` side by side, version 0.1.1 published as `readmeFilename: README.zh.md`, so its npm page rendered Chinese. The npm CLI's own selection code (`@npmcli/package-json/lib/normalize.js`, `glob('{README,README.*}')` with the pattern `/\.m?a?r?k?d?o?w?n$/i/`) does not match a `.md` name at all, and the tarball listed `README.md` first. | Do not rely on the rule. Keep exactly one readme candidate at the package root, which `npm run lint:style` checks. The Chinese README lives in `docs/` for this reason. |
| A local `~/.npmrc` may point at a mirror | Pass `--registry=https://registry.npmjs.org/` on every publish and every verification. |
| The npm token is a credential | Pass it per command, never commit it, and revoke it after the release. |
