/**
 * The doctor's user-facing trigger: install a `wsl-doctor` skill into the
 * harness's skill discovery path, so invoking it is a user action, not the
 * model's initiative.
 *
 * The doctor already has two in-session surfaces — the `wsl_doctor` tool (the
 * model runs it) and the `DSH_WSL_DOCTOR` fact (a ready-to-run command) — but
 * both wait for someone to ask. A GUI user diagnosing a broken environment
 * wants the opposite shape: a fixed entry they can trigger themselves. The
 * harness discovers skills from filesystem directories (`<dshHome>/skills`
 * among them) and honors `disable-model-invocation: true`, so a skill IS the
 * traditional button this plugin can ship without an upstream seam: the user
 * invokes it by name, and its body walks the model through the doctor and the
 * remedies.
 *
 * Installation is idempotent and content-addressed: the skill file is written
 * only when missing or different, so a restart never churns the file and a
 * user edit survives until the shipped copy actually changes. The write is
 * advisory like every other arm of this plugin: an unwritable home degrades to
 * a debug line and never fails the load.
 *
 * This is a TypeScript source built to `lib/doctor-skill.js`; edit THIS file
 * and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/doctor-skill
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
export const name = "wsl-doctor-skill";
/** The skill directory's name under the discovery root. */
export const SKILL_DIR = "wsl-doctor";
/**
 * The skill's own text. Shipped here so the installed file and the tests read
 * one source; the body references only surfaces this plugin ships (the
 * `wsl_doctor` tool, the `DSH_WSL_DOCTOR` fact) plus the doctor's own
 * remedy-only boundary.
 *
 * @returns the full SKILL.md text, frontmatter included.
 */
export function skillText() {
    return `---
name: wsl-doctor
description: 运行 WSL 环境诊断（doctor）：verdict、blockers 与每个失败项的修复提示，环境异常时的一键入口。
disable-model-invocation: true
---

用户要求诊断 WSL 环境。按当前会话能走的路径执行，取一次完整 verdict 并如实呈现：

1. **优先用 \`wsl_doctor\` 工具**（WSL 模式的会话里有）。它进程内收集报告并合并活跃 resident 的状态。
2. **没有该工具时**，用 shell 运行事实命令：\`sh -c "$DSH_WSL_DOCTOR --json"\`（该事实由本插件注入每个 distro 会话）。
3. **两条都不可用**（宿主会话、插件未挂载）：告知用户 CLI 入口 \`pnpm run doctor --bundle <path>\`（插件检出内）或请用户在 WSL 模式新开会话后再试。

呈现要求：

- 先给结论：\`verdict\`（ready / blocked）。
- \`blocked\` 时逐条列出 blockers 与对应失败项的 \`remedy\`——remedy 是可直接复制执行的命令或配置改动，原样给出，不改写。
- 多个发行版时按 \`distroVerdicts\` 分组。
- 修复建议只到 remedy 为止：不代改用户或发行版内的文件、不代装软件包；用户确认后可以代为执行 remedy 命令本身。
- 修复执行后复跑一次 doctor，给出 before → after 的判定变化。
`;
}
/**
 * Mount the skill installer.
 *
 * @param ctx - the cordis context; only the logger is consumed.
 * @param _config - the schema-validated plugin config (unused).
 */
export async function apply(ctx, _config = {}) {
    const debug = (message) => ctx.logger?.debug?.(message);
    const home = process.env.DSH_HOME ?? join(homedir(), ".dsh");
    const dir = join(home, "skills", SKILL_DIR);
    const file = join(dir, "SKILL.md");
    const text = skillText();
    try {
        await mkdir(dir, { recursive: true });
        const existing = await readFile(file, "utf8").catch(() => undefined);
        if (existing === text) {
            debug(`wsl-doctor-skill: the skill is already installed at ${file}`);
            return;
        }
        await writeFile(file, text, "utf8");
        debug(`wsl-doctor-skill: installed the wsl-doctor skill at ${file}`);
    }
    catch (error) {
        debug(`wsl-doctor-skill: could not install the skill at ${file} (${error?.message ?? error})`);
    }
}
