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
export declare const name = "wsl-doctor-skill";
/** The config schema's validated output: the row takes no options. */
export interface DoctorSkillConfig {
}
/** The skill directory's name under the discovery root. */
export declare const SKILL_DIR = "wsl-doctor";
/**
 * The skill's own text. Shipped here so the installed file and the tests read
 * one source; the body references only surfaces this plugin ships (the
 * `wsl_doctor` tool, the `DSH_WSL_DOCTOR` fact) plus the doctor's own
 * remedy-only boundary.
 *
 * @returns the full SKILL.md text, frontmatter included.
 */
export declare function skillText(): string;
/**
 * Mount the skill installer.
 *
 * @param ctx - the cordis context; only the logger is consumed.
 * @param _config - the schema-validated plugin config (unused).
 */
export declare function apply(ctx: {
    logger?: {
        debug?: (message: string) => void;
        warn?: (message: string) => void;
    };
}, _config?: DoctorSkillConfig): Promise<void>;
