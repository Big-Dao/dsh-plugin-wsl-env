# Archived material

Nothing here is loaded by anything. It is kept because the project's habit is to
record what was tried and why it was dropped, rather than delete the evidence.

| File | What it is | Why it is archived |
|---|---|---|
| [`design-history.zh.md`](design-history.zh.md) | The five sections of the design record that described designs since replaced: the per-process `DSH_WSL` switch (its desktop integration and its manual step-by-step) and the three abandoned "tool naming" routes. It keeps its original section numbering and marks where each conclusion lives in the current document. | The README is now current state only. Anything a reader would act on today is there; this is the "why it was not done that way" record. |
| `cordis.patch.olddesign.yml` | The profile patch layer from the per-**process** design: one global `DSH_WSL=1` switch that replaced the host `ctx.fs`/`ctx.shell` providers outright. | Superseded by the per-**session** design. A single global switch cannot serve a Windows workspace and a distro workspace in the same process, and it forced the Permissions selector to disappear because the WSL executors are unconfined. The shipped `cordis.patch.yml` now mounts the WSL environment as an isolated agent preset instead — see README.zh.md §13. |
