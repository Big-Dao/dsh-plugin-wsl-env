# Archived material

Nothing here is loaded by anything. It is kept because the project's habit is to
record what was tried and why it was dropped, rather than delete the evidence.

The current state of everything lives in the repository's single
[`README.md`](../../README.md). Nothing in this directory is a second README, and
where anything here disagrees with that file, that file wins.

| File | What it is | Why it is archived |
|---|---|---|
| [`engineering-record.zh.md`](engineering-record.zh.md) | The full 0.1.x engineering record (Chinese): measured contracts, the design, the debugging rounds, the self-checks, and the conclusions as they stood then. | It used to be `README.zh.md` at the repository root, and it kept calling itself the current description long after its conclusions had been superseded — including by the distro-side sandbox, which replaced its "no sandbox" conclusion. Two READMEs is one too many, so the content is archived under an honest name and banner instead of deleted. Its §0.1 names what is now historical. |
| [`design-history.zh.md`](design-history.zh.md) | The five sections of the design record that described designs since replaced: the per-process `DSH_WSL` switch (its desktop integration and its manual step-by-step) and the three abandoned "tool naming" routes. It keeps its original section numbering and marks where each conclusion lives in the engineering record. | The README is now current state only. Anything a reader would act on today is there; this is the "why it was not done that way" record. |
| `cordis.patch.olddesign.yml` | The profile patch layer from the per-**process** design: one global `DSH_WSL=1` switch that replaced the host `ctx.fs`/`ctx.shell` providers outright. | Superseded by the per-**session** design. A single global switch cannot serve a Windows workspace and a distro workspace in the same process, and it forced the Permissions selector to disappear because the WSL executors were unconfined. The shipped `cordis.patch.yml` mounts the WSL environment as an isolated agent preset instead — see the record's §13. |
