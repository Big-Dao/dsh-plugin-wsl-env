# Archived material, English index

Nothing in this directory is loaded by anything. It is kept because the project's
habit is to record what was tried and why it was dropped, rather than delete the
evidence.

[`README.md`](../../README.md) at the repository root is the only statement of
current state. Nothing in this directory is a second README. Where anything here
disagrees with that file, that file wins.

The material is the 0.1.x record: it was archived on 2026-10-02, and its version
numbers and its conclusions stop there. Later releases are recorded in
[`CHANGELOG.md`](../../CHANGELOG.md).

The two `.zh.md` records are written in Chinese; the archived patch layer's
comments are in English. This file is an English index, so a reader who does not
read Chinese can still tell what is here. [`README.md`](README.md) in this
directory lists the same three files.

| File | What it is | Why it is archived |
|---|---|---|
| [`engineering-record.zh.md`](engineering-record.zh.md) | The full 0.1.x engineering record, in Chinese: measured contracts, the design, the debugging rounds, the self-checks, and the conclusions as they stood then. Its relative links (`lib/…`, `test/…`) were written when it still sat at the repository root and were not rewritten on archiving, so find the files they name by the repository's current layout, not by those links. | It used to be `README.zh.md` at the repository root, and it kept calling itself the current description long after its conclusions had been superseded. The distro-side sandbox replaced its "no sandbox" conclusion. Two READMEs is one too many, so the content is archived under an honest name and a banner instead of being deleted. Its section 0.1 names what is now historical. |
| [`design-history.zh.md`](design-history.zh.md) | The five sections of the design record that described designs since replaced: the per-process `DSH_WSL` switch, with its desktop integration and its manual step-by-step, and the three abandoned "tool naming" routes. It keeps its original section numbering and marks where each conclusion now lives in the engineering record. | The README is now current state only, and anything a reader would act on today is there. This file is the record of why it was not done that way. |
| [`cordis.patch.olddesign.yml`](cordis.patch.olddesign.yml) | The profile patch layer from the per-process design: it disables the host `ctx.fs` and `ctx.shell` providers and mounts WSL-backed replacements. The `DSH_WSL=1` switch that gated that layer is described in section 10 of [`design-history.zh.md`](design-history.zh.md); the archived file itself carries no gate. | Superseded by the per-session design. A single global switch cannot serve a Windows workspace and a distro workspace in the same process, and it made the Permissions selector disappear, because the WSL executors were unconfined. The shipped `cordis.patch.yml` mounts the WSL environment as an isolated agent preset instead. See section 13 of the engineering record. |

The index [`README.md`](README.md) and this file are not archived material.
They describe the directory.
