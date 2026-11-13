# Upstream: `verifyDesktopPath` assumes `processPath` answers host spelling

Status: observed on DSH Desktop `0.2.1-rc.5` / re-checked against the
`0.2.2-rc.1` and `0.2.2-rc.2` sources; **not a defect of this plugin since
0.23.0**, which resolves it from the plugin side. Recorded here because the
upstream contract itself stays brittle for every routed filesystem.

## The contract

The Host verifies a desktop-open target by round trip
(`packages/api/session-controller`, `verifyDesktopPath`):

```
processPath(resolve(processPathFromHostPath(hostPath))) === hostPath
```

`processPathFromHostPath` is the inherited host implementation and answers a
host (UNC / drive-letter) spelling, so this equality implicitly requires
`processPath` to answer **host spelling too**. The same equality drives the
`ui-deliverables` presented-file route. Any filesystem implementation whose
execution world differs from the host world — which is the entire point of a
routed backend — can only satisfy it by mirroring host spelling in
`processPath`.

## How this plugin hit it (issue #37)

The root router originally answered `processPath` for a distro target in
Linux form (the target's execution-world path). With the equality above, the
round trip could never close for a UNC workspace, and every file gesture
routed through `session.openWorkspacePath` / `session.workspacePathApplications`
—the preview header's application menu, the file context menu's "Show in
folder", the deliverables open route—was refused with
`Path has no verified Host path`. Reported with a full root-cause analysis in
[issue #37](https://github.com/Big-Dao/dsh-plugin-wsl-env/issues/37)
(2026-11-09).

**Plugin-side resolution (0.23.0):** the router now answers the target's
canonical UNC where the Host's path-taking consumers read it, while
`displayPath` stays Linux and `contains` still compares POSIX coordinates —
see the CHANGELOG 0.23.0 entry and the `processPath` doc comment in
`lib/fs-routing.js` for the trade-offs (the GUI change feed and
`stat.absolutePath` now carry UNC spelling; relative Markdown images in a WSL
preview no longer resolve, `fileMediaUrl` rejects `\\`-prefixed paths).

## The remaining upstream ask

Make `verifyDesktopPath` verify what it actually means instead of what
`processPath` returns, e.g. accept

- `processPathFromHostPath(hostPath)` non-empty, **and**
- `fs.resolve(mapped)` succeeds, optionally with a `processPath`-spelling
  comparison as one accepted alternative rather than the only one.

That keeps "the path resolves in the filesystem that owns it" as the contract
and lets routed implementations answer their own execution world. Both
suggestions in issue #37 (upstream verification change; plugin-side host
spelling) were implemented on the plugin side at the router level in 0.23.0,
so the upstream hardening is the only open half.

## Versions

- Reporter environment: DSH `0.2.1-rc.5`, plugin `0.17.1` (source checked
  against 0.22.0).
- Plugin fix: 0.23.0 (2026-11-10), re-verified against `lib/fs-routing.js` in
  0.26.0 (the doc comment names `verifyDesktopPath` explicitly).
- Upstream sources checked: `0.2.1-rc.5` (reporter), `0.2.2-rc.1`,
  `0.2.2-rc.2` — `verifyDesktopPath` unchanged across all three.
