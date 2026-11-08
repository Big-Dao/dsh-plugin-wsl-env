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
/**
 * The message templates, keyed by call site. Each entry owns its parameter
 * shape; the `zh` table is type-checked against the `en` table's key and
 * parameter union, so the two catalogs cannot drift apart silently.
 */
const en = {
    /** `sessionScopeProblem`: systemd is not PID 1 in the distro. */
    sessionScopeNoSystemd: ({ distro }) => `sessionSandbox needs systemd as PID 1 in "${distro}": set [boot] systemd=true in /etc/wsl.conf, run "wsl --shutdown", and reopen the session.`,
    /** `sessionScopeProblem`: `systemctl --user` does not answer. */
    sessionScopeNoUserManager: ({ distro }) => `sessionSandbox needs a reachable systemd user manager in "${distro}": log in to the distro once, or enable lingering (see the next refusal).`,
    /** `sessionScopeProblem`: the `systemd-run` binary is missing. */
    sessionScopeNoSystemdRun: ({ distro }) => `sessionSandbox needs "systemd-run" in "${distro}"; the distro's systemd package is incomplete or missing.`,
    /** `sessionScopeProblem`: the user manager would stop with the last session. */
    sessionScopeNoLinger: ({ distro }) => `sessionSandbox needs the user manager to outlive a login session: run "loginctl enable-linger $USER" in "${distro}" and retry.`,
    /**
     * `sessionScopeProblem`: the probe's answer is empty or unrecognized. The
     * caller renders `answer` (the quoted word, or `(nothing)`) and `errorSuffix`
     * (`""` or `": <error>"`) so both languages keep one sentence shape.
     */
    sessionScopeUnknownAnswer: ({ distro, answer, errorSuffix }) => `the sessionSandbox preflight in "${distro}" answered ${answer}${errorSuffix}; see docs/adr/0001-session-scoped-sandbox.md.`,
    /** `missingBwrapRemedy` without a detected package family. */
    bwrapMissingGeneric: ({ distro }) => `bwrap is not usable inside distro "${distro}". Install it with ` +
        `"scripts/bootstrap.sh ${distro} --install" (from the package), or install the ` +
        `"bubblewrap" package with the distro's package manager.`,
    /** `missingBwrapRemedy` with a family's direct install command. */
    bwrapMissingFamily: ({ distro, direct }) => `bwrap is not usable inside distro "${distro}". Install it with ` +
        `"scripts/bootstrap.sh ${distro} --install" (from the package), or directly: ` +
        `wsl.exe -d ${distro} -u root -- ${direct}`,
    /** `composeBwrapFailure`: bwrap ran and refused — present but unusable. */
    bwrapBroken: ({ distro, output }) => `bwrap is installed inside distro "${distro}" but failed the usability probe: ${output}. ` +
        `This is usually the kernel (unprivileged user namespaces disabled) or an unusable bwrap build rather than a missing package, so reinstalling will not help. ` +
        `Check \`wsl.exe -d ${distro} --exec bwrap --version\` inside the distro, or set \`sandbox: false\` on the wsl-shell and wsl-fs rows to run unconfined.`,
    /** `bwrapInstallHint`: bwrap probed healthy but failed a real command. */
    bwrapRuntimeFailure: ({ distro }) => `bwrap failed at run time inside distro "${distro}". Check \`bwrap --version\` there, ` +
        `or reinstall it: "scripts/bootstrap.sh ${distro} --install".`,
    /** `composeBwrapFailure`: the unclassified probe's raw output, appended to a remedy. */
    bwrapProbeFailedSuffix: ({ output }) => ` The probe failed with: ${output}`,
    /** `throwIfDistroUnavailable`: wsl.exe says the distro is gone. */
    distroUnavailable: ({ code, distro }) => `wsl.exe reported ${code} for distro "${distro}": it is not installed, or not running. ` +
        `Start it with \`wsl.exe -d ${distro}\`, check \`wsl.exe -l -v\`, or point \`distro\` at another one. ` +
        `This is not a sandbox denial, so running with wider permissions will not help.`,
    /** `throwIfWorkdirMissing`: `wsl.exe --cd` fell back to `/`. */
    workdirMissing: ({ missing }) => `wsl.exe could not enter the working directory "${missing}" inside the distro, so the command ran from "/" instead. ` +
        `Create it, or point \`cwd\` (or the request's \`workdir\`) at a directory that exists.`,
    /** `throwIfWorkdirInAnotherDistro`: the workspace names a pinned-against distro. */
    workdirAnotherDistro: ({ workdir, distro }) => `"${workdir}" names a workspace in another WSL distro, and this profile pins its commands to "${distro}" — ` +
        `running them here would act on a different machine's tree. Open a session in that distro, ` +
        `or point cwd/workdir at this distro.`,
    /** `wsl_doctor` digest: the verdict line. `verdict` is the report's own `ready`/`blocked`. */
    doctorDigestVerdict: ({ verdict }) => `wsl doctor verdict: ${verdict}`,
    /** `wsl_doctor` digest: the host-wide group heading. */
    doctorDigestHostLabel: () => "(host — Windows and global checks)",
    /** `wsl_doctor` digest: the heading for checks the run's scope never executed. */
    doctorDigestNotRunLabel: () => "(not run in this scope)",
    /** `wsl_doctor` digest: marks which distro group is the session's own. */
    doctorDigestSessionLabel: ({ name }) => `${name} (this session's distro)`,
    /** `wsl_doctor` digest: one summary line for the checks the run's scope never executed; `reason` says why (the run's scope profile). */
    doctorDigestSkipRow: ({ n, reason, ids }) => `[SKIP] not run in this scope — ${reason} (${n}): ${ids}`,
    /** `wsl_doctor` digest: the scope reason for a quick run's skip line. */
    doctorSkipReasonQuick: () => "the quick profile covers first-command prerequisites only",
    /** `wsl_doctor` digest: the scope reason for a section-filtered run's skip line. */
    doctorSkipReasonSections: ({ sections }) => `the run covered only: ${sections}`,
    /** `wsl_doctor` digest: the scope reason when the report recorded none. */
    doctorSkipReasonGeneric: () => "no scope recorded for this report",
    /** `wsl_doctor` digest: one line per check a failed prerequisite gated out; `reason` names the blocker. */
    doctorSkipGated: ({ id, reason }) => `[SKIP] ${id} — skipped: ${reason}`,
    /** `wsl_doctor` digest: per-group tallies, one entry per non-zero status. */
    doctorTallyOk: ({ n }) => `${n} ok`,
    doctorTallyWarn: ({ n }) => `${n} warn`,
    doctorTallyFail: ({ n }) => `${n} fail`,
    doctorTallyUnknown: ({ n }) => `${n} unknown`,
    doctorTallyInfo: ({ n }) => `${n} info`,
    doctorTallySkipped: ({ n }) => `${n} skipped`,
    /** `wsl_doctor` digest: the remedy prefix under a failed check. */
    doctorDigestFixPrefix: ({ remedy }) => `        fix: ${remedy}`,
    /** `wsl_doctor` digest: the ready note (how to attach the full report). */
    doctorDigestNoteReady: () => "the first command should succeed; run the CLI (pnpm run doctor --bundle <path>) for the attachable file",
    /** `wsl_doctor` digest: the blocked note (the rerun is the re-verification). */
    doctorDigestNoteBlocked: () => "apply each remedy above, then call this tool again — the re-run is the re-verification",
    /** `wsl_doctor` digest: the blocked summary tail; `noneBlocking` is the fixed clause. */
    doctorDigestBlockedTail: ({ blockers, warnings, skipped, note }) => `blocked by: ${blockers}; ${warnings} warning(s), ${skipped} skipped leg(s) — none blocking; ${note}`,
};
/** The Chinese catalog; the type keeps every key and parameter in step with `en`. */
const zh = {
    sessionScopeNoSystemd: ({ distro }) => `sessionSandbox 需要在 "${distro}" 中以 systemd 作为 PID 1：在 /etc/wsl.conf 中设置 [boot] systemd=true，运行 "wsl --shutdown"，然后重新打开会话。`,
    sessionScopeNoUserManager: ({ distro }) => `sessionSandbox 需要能访问 "${distro}" 中的 systemd 用户管理器：先在发行版中登录一次，或启用 lingering（见下一条拒绝说明）。`,
    sessionScopeNoSystemdRun: ({ distro }) => `sessionSandbox 需要 "${distro}" 中存在 "systemd-run"；该发行版的 systemd 软件包不完整或缺失。`,
    sessionScopeNoLinger: ({ distro }) => `sessionSandbox 需要用户管理器在登录会话结束后继续存活：在 "${distro}" 中运行 "loginctl enable-linger $USER"，然后重试。`,
    sessionScopeUnknownAnswer: ({ distro, answer, errorSuffix }) => `"${distro}" 中的 sessionSandbox 预检应答为 ${answer}${errorSuffix}；参见 docs/adr/0001-session-scoped-sandbox.md。`,
    bwrapMissingGeneric: ({ distro }) => `bwrap 在发行版 "${distro}" 中不可用。请用 "scripts/bootstrap.sh ${distro} --install"（随包提供）安装，` +
        `或用发行版的包管理器安装 "bubblewrap" 软件包。`,
    bwrapMissingFamily: ({ distro, direct }) => `bwrap 在发行版 "${distro}" 中不可用。请用 "scripts/bootstrap.sh ${distro} --install"（随包提供）安装，` +
        `或直接执行：wsl.exe -d ${distro} -u root -- ${direct}`,
    bwrapBroken: ({ distro, output }) => `bwrap 已安装在发行版 "${distro}" 中，但未通过可用性探测：${output}。` +
        `这通常是内核原因（未特权用户命名空间被禁用）或 bwrap 构建不可用，而不是缺少软件包，重新安装不会有帮助。` +
        `请在发行版内检查 \`wsl.exe -d ${distro} --exec bwrap --version\`，或将 wsl-shell 与 wsl-fs 行设为 \`sandbox: false\` 以无隔离运行。`,
    bwrapRuntimeFailure: ({ distro }) => `bwrap 在发行版 "${distro}" 中运行时失败。请在该发行版内检查 \`bwrap --version\`，` +
        `或重新安装："scripts/bootstrap.sh ${distro} --install"。`,
    bwrapProbeFailedSuffix: ({ output }) => `（探测失败输出：${output}）`,
    distroUnavailable: ({ code, distro }) => `wsl.exe 对发行版 "${distro}" 报告了 ${code}：该发行版未安装或未在运行。` +
        `用 \`wsl.exe -d ${distro}\` 启动它，用 \`wsl.exe -l -v\` 检查，或将 \`distro\` 指向另一个发行版。` +
        `这不是沙箱拒绝，放宽权限也不会有帮助。`,
    workdirMissing: ({ missing }) => `wsl.exe 无法进入发行版中的工作目录 "${missing}"，命令改从 "/" 运行。` +
        `请创建该目录，或将 \`cwd\`（或请求的 \`workdir\`）指向一个已存在的目录。`,
    workdirAnotherDistro: ({ workdir, distro }) => `"${workdir}" 指向另一个 WSL 发行版中的工作区，而本 profile 将命令固定在 "${distro}" —— ` +
        `在这里运行会作用于另一台机器的目录树。请在该发行版中打开会话，或将 cwd/workdir 指向本发行版。`,
    doctorDigestVerdict: ({ verdict }) => `wsl doctor 裁决：${verdict}`,
    doctorDigestHostLabel: () => "（宿主——Windows 与全局检查）",
    doctorDigestNotRunLabel: () => "（不在本次范围）",
    doctorDigestSessionLabel: ({ name }) => `${name}（当前会话的 distro）`,
    doctorDigestSkipRow: ({ n, reason, ids }) => `[SKIP] 不在本次范围——${reason}（${n}）：${ids}`,
    doctorSkipReasonQuick: () => "quick 档只探首条命令的前置项",
    doctorSkipReasonSections: ({ sections }) => `本次只运行了这些分区：${sections}`,
    doctorSkipReasonGeneric: () => "报告未记录运行范围",
    doctorSkipGated: ({ id, reason }) => `[SKIP] ${id}——被前置阻断：${reason}`,
    doctorTallyOk: ({ n }) => `通过 ${n}`,
    doctorTallyWarn: ({ n }) => `警告 ${n}`,
    doctorTallyFail: ({ n }) => `失败 ${n}`,
    doctorTallyUnknown: ({ n }) => `未知 ${n}`,
    doctorTallyInfo: ({ n }) => `信息 ${n}`,
    doctorTallySkipped: ({ n }) => `跳过 ${n}`,
    doctorDigestFixPrefix: ({ remedy }) => `        修复: ${remedy}`,
    doctorDigestNoteReady: () => "首条命令应能成功；如需可附加的报告文件，运行 CLI（pnpm run doctor --bundle <path>）",
    doctorDigestNoteBlocked: () => "应用上方每条修复，然后再次调用本工具——重跑即复核",
    doctorDigestBlockedTail: ({ blockers, warnings, skipped, note }) => `阻断项：${blockers}；${warnings} 个警告，${skipped} 个跳过腿——均不阻断；${note}`,
};
/** The active language; English until a settings service reports otherwise. */
let current = "en";
/**
 * The locale the message builders render in.
 *
 * @returns the active catalog language.
 */
export function messagesLocale() {
    return current;
}
/**
 * Force the message language. The wiring calls this from the resolved
 * `locale.preference`; tests call it directly and reset afterwards.
 *
 * @param locale - the language to render in.
 */
export function configureMessagesLocale(locale) {
    current = locale;
}
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
export function t(key, params) {
    // Key and parameter parity between the catalogs is the type system's job
    // (`zh` is `typeof en`), so the lookup needs no runtime fallback.
    const template = current === "zh" ? zh[key] : en[key];
    return template(params);
}
/**
 * Map one `locale.preference` value onto a catalog language. The app's
 * language ids are BCP 47-style tags (`zh`, `en`, `ja`, …); the plugin ships
 * zh and en, and every other id renders English.
 *
 * @param preference - the stored preference, or anything else when unset.
 * @returns the catalog language the preference selects.
 */
export function resolveMessagesLocale(preference) {
    return typeof preference === "string" && /^zh/iu.test(preference) ? "zh" : "en";
}
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
export function installMessagesLocale(ctx) {
    // Provisional fallback first: the settings read below is asynchronous (it
    // waits for the injection), and the OS language is the best guess until a
    // stored preference replaces it.
    configureMessagesLocale(hostFallbackLocale());
    if (typeof ctx.inject !== "function")
        return;
    ctx.inject(["settings"], (scope) => {
        // Narrow once to the shape this module reads; see `SettingsScope`.
        const view = scope;
        const settings = view.settings;
        if (settings?.describe === undefined)
            return;
        const read = () => {
            try {
                const row = settings.describe().find((entry) => entry.ns === "locale");
                if (row === undefined) {
                    // No stored preference (the provisional-UI case): the OS fallback
                    // stands. It was already applied above; keep it.
                    configureMessagesLocale(hostFallbackLocale());
                    return;
                }
                // The descriptor's value is the entry's projected volatile form —
                // `{ preference?: string }` for the locale entry.
                const preference = row.value?.preference;
                configureMessagesLocale(resolveMessagesLocale(preference));
            }
            catch {
                // A describe failure must never fail a row's load; keep the last language.
            }
        };
        read();
        // The event name lives in the host's own `Events` augmentation, which this
        // plugin's typings do not carry; widen the registration to a plain string.
        view.on("settings/document-updated", () => read());
    });
}
/**
 * Restore English. Tests only: production wiring is process-wide by design.
 */
export function resetMessagesLocaleForTests() {
    current = "en";
}
/**
 * The no-settings fallback: the process's ICU default locale, which in the
 * desktop app follows the OS UI language (a zh-CN Windows yields `zh-CN`).
 * Under Node's small-icu builds this is `en-US`, which maps to English — the
 * previous default. Exported for tests.
 *
 * @returns {"en" | "zh"} the language the OS-level locale selects.
 */
export function hostFallbackLocale() {
    try {
        return localeFromTag(Intl.DateTimeFormat().resolvedOptions().locale);
    }
    catch {
        return "en";
    }
}
/**
 * Map one BCP 47-style tag onto a catalog language: `zh*` renders Chinese,
 * everything else English.
 *
 * @param tag - the locale tag (may be empty).
 * @returns {"en" | "zh"} the catalog language the tag selects.
 */
function localeFromTag(tag) {
    return /^zh/iu.test(tag) ? "zh" : "en";
}
