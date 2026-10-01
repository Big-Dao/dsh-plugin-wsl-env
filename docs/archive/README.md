# Archived material

Nothing here is loaded by anything. It is kept because the project's habit is to
record what was tried and why it was dropped, rather than delete the evidence.

| File | What it is | Why it is archived |
|---|---|---|
| `cordis.patch.olddesign.yml` | The profile patch layer from the per-**process** design: one global `DSH_WSL=1` switch that replaced the host `ctx.fs`/`ctx.shell` providers outright. | Superseded by the per-**session** design. A single global switch cannot serve a Windows workspace and a distro workspace in the same process, and it forced the Permissions selector to disappear because the WSL executors are unconfined. The shipped `cordis.patch.yml` now mounts the WSL environment as an isolated agent preset instead. See README.zh.md §16. |
