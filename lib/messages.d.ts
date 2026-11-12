/**
 * The language the plugin's runtime refusal and remedy messages render in,
 * following the harness app's locale setting.
 *
 * The preference lives in the host composition as the `locale` entry's
 * `preference` field (`@deepseek-ai/dsh-client-locale`'s host half declares it
 * volatile), persisted through the host `settings` service. This module reads
 * it through an OPTIONAL `settings` injection — the service belongs to the
 * base bundle, and a profile without it (or a `settings` that never resolves)
 * keeps the English defaults, which is also every test's default. A language
 * switch re-reads on the service's `settings/document-updated` event, so
 * following the remedy or switching language needs no app restart.
 *
 * Only plugin-authored text is cataloged here. The `fs-decisions` refusals and
 * the fsio replica stay byte-identical English — the tool layer matches on
 * those strings (see `src/fs-decisions.ts` and `docs/UPSTREAM-FSIO-EXPORT.md`).
 *
 * This is a TypeScript source built to `lib/messages.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/messages
 */
import type { Context } from "@deepseek-ai/cordis";
/** The languages the catalogs ship. More locales are additive: add a table and widen the resolver. */
type MessagesLocale = "en" | "zh";
/**
 * The message templates, keyed by call site. Each entry owns its parameter
 * shape; the `zh` table is type-checked against the `en` table's key and
 * parameter union, so the two catalogs cannot drift apart silently.
 */
declare const en: {
    /** `sessionScopeProblem`: systemd is not PID 1 in the distro. */
    sessionScopeNoSystemd: ({ distro }: {
        distro: string;
    }) => string;
    /** `sessionScopeProblem`: `systemctl --user` does not answer. */
    sessionScopeNoUserManager: ({ distro }: {
        distro: string;
    }) => string;
    /** `sessionScopeProblem`: the `systemd-run` binary is missing. */
    sessionScopeNoSystemdRun: ({ distro }: {
        distro: string;
    }) => string;
    /** `sessionScopeProblem`: the user manager would stop with the last session. */
    sessionScopeNoLinger: ({ distro }: {
        distro: string;
    }) => string;
    /**
     * `sessionScopeProblem`: the probe's answer is empty or unrecognized. The
     * caller renders `answer` (the quoted word, or `(nothing)`) and `errorSuffix`
     * (`""` or `": <error>"`) so both languages keep one sentence shape.
     */
    sessionScopeUnknownAnswer: ({ distro, answer, errorSuffix }: {
        distro: string;
        answer: string;
        errorSuffix: string;
    }) => string;
    /** `missingBwrapRemedy` without a detected package family. */
    bwrapMissingGeneric: ({ distro }: {
        distro: string;
    }) => string;
    /** `missingBwrapRemedy` with a family's direct install command. */
    bwrapMissingFamily: ({ distro, direct }: {
        distro: string;
        direct: string;
    }) => string;
    /** `composeBwrapFailure`: bwrap ran and refused — present but unusable. */
    bwrapBroken: ({ distro, output }: {
        distro: string;
        output: string;
    }) => string;
    /** `bwrapInstallHint`: bwrap probed healthy but failed a real command. */
    bwrapRuntimeFailure: ({ distro }: {
        distro: string;
    }) => string;
    /** `composeBwrapFailure`: the unclassified probe's raw output, appended to a remedy. */
    bwrapProbeFailedSuffix: ({ output }: {
        output: string;
    }) => string;
    /** `throwIfDistroUnavailable`: wsl.exe says the distro is gone. */
    distroUnavailable: ({ code, distro }: {
        code: string;
        distro: string;
    }) => string;
    /** `throwIfWorkdirMissing`: `wsl.exe --cd` fell back to `/`. */
    workdirMissing: ({ missing }: {
        missing: string;
    }) => string;
    /** `throwIfWorkdirInAnotherDistro`: the workspace names a pinned-against distro. */
    workdirAnotherDistro: ({ workdir, distro }: {
        workdir: string;
        distro: string;
    }) => string;
    /**
     * `auto-preset`: a distro workspace is recorded as Windows access (9p), so
     * the session runs the host preset. The model-facing half of the reminder;
     * the human sees the web client's banner.
     */
    hostModeWindowsAccess: ({ cwd, distro }: {
        cwd: string;
        distro: string;
    }) => string;
    /** `auto-preset`: the session began its first turn before the WSL preset could be selected. */
    hostModeLocked: ({ cwd, distro }: {
        cwd: string;
        distro: string;
    }) => string;
    /** `auto-preset`: the profile composes no WSL preset, so the session keeps the host environment. */
    hostModePresetUnavailable: ({ cwd, distro }: {
        cwd: string;
        distro: string;
    }) => string;
    /** `wsl_doctor` digest: the verdict line. `verdict` is the report's own `ready`/`blocked`. */
    doctorDigestVerdict: ({ verdict }: {
        verdict: string;
    }) => string;
    /** `wsl_doctor` digest: the host-wide group heading. */
    doctorDigestHostLabel: () => string;
    /** `wsl_doctor` digest: the heading for checks the run's scope never executed. */
    doctorDigestNotRunLabel: () => string;
    /** `wsl_doctor` digest: marks which distro group is the session's own. */
    doctorDigestSessionLabel: ({ name }: {
        name: string;
    }) => string;
    /** `wsl_doctor` digest: one summary line for the checks the run's scope never executed; `reason` says why (the run's scope profile). */
    doctorDigestSkipRow: ({ n, reason, ids }: {
        n: number;
        reason: string;
        ids: string;
    }) => string;
    /** `wsl_doctor` digest: the scope reason for a quick run's skip line. */
    doctorSkipReasonQuick: () => string;
    /** `wsl_doctor` digest: the scope reason for a section-filtered run's skip line. */
    doctorSkipReasonSections: ({ sections }: {
        sections: string;
    }) => string;
    /** `wsl_doctor` digest: the scope reason when the report recorded none. */
    doctorSkipReasonGeneric: () => string;
    /** `wsl_doctor` digest: one line per check a failed prerequisite gated out; `reason` names the blocker. */
    doctorSkipGated: ({ id, reason }: {
        id: string;
        reason: string;
    }) => string;
    /** `wsl_doctor` digest: per-group tallies, one entry per non-zero status. */
    doctorTallyOk: ({ n }: {
        n: number;
    }) => string;
    doctorTallyWarn: ({ n }: {
        n: number;
    }) => string;
    doctorTallyFail: ({ n }: {
        n: number;
    }) => string;
    doctorTallyUnknown: ({ n }: {
        n: number;
    }) => string;
    doctorTallyInfo: ({ n }: {
        n: number;
    }) => string;
    doctorTallySkipped: ({ n }: {
        n: number;
    }) => string;
    /** `wsl_doctor` digest: the remedy prefix under a failed check. */
    doctorDigestFixPrefix: ({ remedy }: {
        remedy: string;
    }) => string;
    /** `wsl_doctor` digest: the ready note; the report is not a promise about a call. */
    doctorDigestNoteReady: () => string;
    /** `wsl_doctor` digest: the blocked note (the rerun is the re-verification). */
    doctorDigestNoteBlocked: () => string;
    /** `wsl_doctor` digest: the blocked summary tail; `noneBlocking` is the fixed clause. */
    doctorDigestBlockedTail: ({ blockers, warnings, skipped, note }: {
        blockers: string;
        warnings: number;
        skipped: number;
        note: string;
    }) => string;
};
type Catalog = typeof en;
type MessageKey = keyof Catalog;
/**
 * The locale the message builders render in.
 *
 * @returns the active catalog language.
 */
export declare function messagesLocale(): MessagesLocale;
/**
 * Force the message language. The wiring calls this from the resolved
 * `locale.preference`; tests call it directly and reset afterwards.
 *
 * @param locale - the language to render in.
 */
export declare function configureMessagesLocale(locale: MessagesLocale): void;
/**
 * Render one message in the active language, falling back to the English
 * template when the active catalog somehow lacks the key (the catalogs are
 * type-checked against each other, so this guards runtime drift only).
 *
 * The `params` type correlates the parameters with the key: the conditional
 * resolves per call site, so `t("sessionScopeNoLinger", { distro })`
 * typechecks while `t("sessionScopeNoLinger", { missing })` does not. It
 * lives in the JSDoc because a comment between the parameters would have the
 * type-stripping build emit a line with trailing whitespace, which the style
 * gate refuses.
 *
 * @typeParam K - the message key.
 * @param key - the message to render.
 * @param params - the key's parameters, as the template declares them.
 * @returns the rendered message.
 */
export declare function t<K extends MessageKey>(key: K, params: Catalog[K] extends (first: infer P) => string ? P : never): string;
/**
 * Map one `locale.preference` value onto a catalog language. The app's
 * language ids are BCP 47-style tags (`zh`, `en`, `ja`, …); the plugin ships
 * zh and en, and every other id renders English.
 *
 * @param preference - the stored preference, or anything else when unset.
 * @returns the catalog language the preference selects.
 */
export declare function resolveMessagesLocale(preference: unknown): MessagesLocale;
/**
 * Follow the harness locale for the caller's composition. Every row wires its
 * own injection (the shell executor, the fs provider and the preflight all
 * call this), so a hot-reloaded row re-wires too; the redundant reads converge
 * on the same app-wide preference and the events are rare.
 *
 * The `settings` service is optional — a profile without it (some CLI
 * compositions) keeps English. When it is present, the preference is read once
 * the service resolves and again on every `settings/document-updated` event,
 * which also covers the `locale` entry activating after this row did. A read
 * that throws keeps the previous language: this is presentation, not gating.
 *
 * A browser whose user never picked a language in Settings has NO persisted
 * `locale.preference` — its Chinese UI came from the navigator's provisional
 * match, which the Host settings never record. For that case the fallback
 * reads the process's ICU default locale (Electron: the OS UI language), so
 * a zh-CN Windows with a provisional-Chinese UI still renders Chinese. An
 * explicit Settings choice always wins over the fallback.
 *
 * @param ctx - the row's composition context.
 */
export declare function installMessagesLocale(ctx: Context): void;
/**
 * Restore English. Tests only: production wiring is process-wide by design.
 */
export declare function resetMessagesLocaleForTests(): void;
/**
 * The no-settings fallback: the process's ICU default locale, which in the
 * desktop app follows the OS UI language (a zh-CN Windows yields `zh-CN`).
 * Under Node's small-icu builds this is `en-US`, which maps to English — the
 * previous default. Exported for tests.
 *
 * @returns {"en" | "zh"} the language the OS-level locale selects.
 */
export declare function hostFallbackLocale(): MessagesLocale;
export {};
