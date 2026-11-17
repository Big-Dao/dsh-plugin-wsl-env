# 2026-11-17 单探针补跑（非发版门禁）

本记录**不是**发版门禁的全套结果：Harness 应用没有关闭，探针是在应用运行期间
从应用沙箱之外的 `wsl.exe -d ubuntu --exec` 会话里逐个启动的。`run.sh` 在
一次被中断的套件启动里通过；其余逐项结果如下。完整套件（应用关闭后运行）待
执行。

## 环境

- checkout `9d17bf8`（工作树仅有一处待提交的 MIGRATION 结果更新）。
- Windows 11 + WSL 2，Ubuntu（systemd），x86_64；Node 24.19.0。
- 应用**保持运行**（这是本记录与 `*-probe-suite.md` 各记录的关键差别）。

## 逐项结果

| 探针 | 结果 |
|---|---|
| `run.sh` | PASS（被中断的套件启动里完成） |
| `terminal.sh` | pass |
| `mode.sh` | pass |
| `missing-wsl.sh` | all checks passed |
| `sandbox.sh` | 19 expectations held；interop escape 为 INFO（既有约定） |
| `sandbox-shell.sh` | all checks passed |
| `interop-shell.sh` | resident / one-shot × visible / masked 全 pass |
| `sandbox-off.sh` | all checks passed |
| `picker.sh` | all checks passed |
| `two-distro.sh` | all checks passed |
| `fs-routing.sh` | all checks passed |
| `agent.sh` | 11 checks pass |
| `substrate.sh` | 9 checks pass |
| `watch.sh` | 7 checks pass |
| `exec.sh` | 5 checks pass |
| `native-session.sh` | 8 passed（需把 fnm 的 node 加入 PATH） |
| `session-sandbox.sh` | **11 passed / 0 failed / 0 skipped**（全新 WSL 会话内运行，systemd 为 PID 1） |
| `agent-restart.sh` | **未完成**：它会杀掉 distro 内的常驻 agent，包括当前 Harness 会话正在执行命令的那个；执行到一半命令被中断 |
| `auto-preset.sh` | **未完成**：启动第二个 Harness 时与运行中的应用争用同名 transient scope（`dsh-wsl-ubuntu-<hash>.scope`），应用侧的 agent 随后无法启动 |

## 事故与恢复

- `agent-restart.sh` 的 kill 行为作用于整个 distro，而不是某个 host 进程；在应用
  运行时执行会杀死本会话的 agent（`agent exited while request … was in flight`）。
- `auto-preset.sh` 启动的完整 profile 使用 native session scope；与运行中的应用
  的 scope 同名时 `systemd-run --scope` 拒绝启动，遗留的 unit 使应用侧 agent
  持续握手失败。重启 Harness 后恢复。
- 结论：这两个探针以及完整套件必须在 **Harness 关闭**后运行；
  `run-all-when-closed.sh` 的等待正是为此。逐项结果可作为行为证据，但不能替代
  关闭应用后的门禁结果。

## 关闭应用后的全套结果（同日稍晚）

Harness 关闭后运行 `run-all-when-closed.sh --include-fs`：

**18 项 — pass 17 · fail 1 · skipped 0 · not run 0**。唯一失败是
`auto-preset.sh`：报告 `preset="standard"` 而非 `wsl`。原因是探针的
`wslfs` profile **不组合插件 bundle**（`dsh.profile.bundles` 只有 base 与
web），因此 auto-preset 行和 `wsl` preset 根本不存在；探针的注释错误地假设
“profile 已组合本 checkout 的 bundle”。

修复：`auto-preset.sh` 在 profile 层之后追加包自身的
`cordis.patch.yml` 作为第二个 `--patch`，并在探针 overlay 中禁用 profile
自己的根 `wsl-fs`（否则与 bundle 层的 `fs-routing` 争用根 `fs`）。该组合已用
`--dump-config` 验证：无 patch 警告，`auto-preset`、`preset-wsl`、
`fs-routing` 均在位，`wsl-fs` 为 disabled。探针单独重跑待执行（需要再次关闭
Harness，因为 `wslfs` 的 agent 与运行中应用的 native scope 同名）。

## 待办

```bash
# 退出 DSH 全部进程后，在 WSL 终端（单探针验证，约 1 分钟）：
cd /home/andy/Projects/dsh/plugins/dsh-plugin-wsl-env
pnpm run probe:auto-preset
# 通过后可重跑整套；期望 18 项全通过：
bash test/probe/run-all-when-closed.sh --include-fs
```

通过后更新 MIGRATION 的探针行（目前记录 17/18 与探针组合修复）。

## 原始日志

- `test/probe/.scratch/full-probe.ERBHXj.log`（被中断的套件启动：run.sh PASS，
  terminal.sh 开始后中止）
- `test/probe/.scratch/suite-2026-11-17.log`（套件的等待/启动输出）
