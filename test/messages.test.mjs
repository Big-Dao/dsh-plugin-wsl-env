/**
 * Assertion checks for the message catalogs and the harness-locale wiring:
 * the `locale.preference` resolver, the en/zh template parity, the rendered
 * remedies' verbatim commands, and the optional `settings` injection. No
 * harness is needed; the inject scope is a fake that answers synchronously.
 *
 *   node test/messages.test.mjs
 */
import assert from "node:assert/strict";
import {
  configureMessagesLocale,
  hostFallbackLocale,
  installMessagesLocale,
  messagesLocale,
  resolveMessagesLocale,
  resetMessagesLocaleForTests,
  t,
} from "../lib/messages.js";
import { sessionScopeProblem } from "../lib/session-scope.js";
import { missingBwrapRemedy } from "../lib/sandbox-core.js";

let passed = 0;
/** @type {Array<[string, () => void | Promise<void>]>} */
const checks = [];
/**
 * Defers one check; the loop at the bottom runs each through `runCheck`.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const check = (name, fn) => checks.push([name, fn]);
/**
 * Runs one check now, printing its verdict; a throw fails the process exit code.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const runCheck = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
  }
};

check("the preference resolver maps zh tags to zh and every other id to en", () => {
  assert.equal(resolveMessagesLocale("zh"), "zh");
  assert.equal(resolveMessagesLocale("zh-CN"), "zh");
  assert.equal(resolveMessagesLocale("ZH-hans"), "zh", "the tag is matched case-insensitively");
  assert.equal(resolveMessagesLocale("en"), "en");
  assert.equal(resolveMessagesLocale("ja"), "en", "a language the plugin does not ship renders en");
  assert.equal(resolveMessagesLocale("fr"), "en");
  assert.equal(resolveMessagesLocale(""), "en");
  assert.equal(resolveMessagesLocale(undefined), "en", "an unset preference renders en");
  assert.equal(resolveMessagesLocale(42), "en", "a non-string preference renders en");
});

check("the english catalog keeps the shipped refusals byte-for-byte", () => {
  resetMessagesLocaleForTests();
  assert.equal(messagesLocale(), "en");
  assert.equal(
    t("sessionScopeNoSystemd", { distro: "ubuntu" }),
    `sessionSandbox needs systemd as PID 1 in "ubuntu": set [boot] systemd=true in /etc/wsl.conf, run "wsl --shutdown", and reopen the session.`,
  );
  assert.equal(
    t("sessionScopeNoUserManager", { distro: "ubuntu" }),
    `sessionSandbox needs a reachable systemd user manager in "ubuntu": log in to the distro once, or enable lingering (see the next refusal).`,
  );
  assert.equal(
    t("sessionScopeNoSystemdRun", { distro: "ubuntu" }),
    `sessionSandbox needs "systemd-run" in "ubuntu"; the distro's systemd package is incomplete or missing.`,
  );
  assert.equal(
    t("sessionScopeNoLinger", { distro: "ubuntu" }),
    `sessionSandbox needs the user manager to outlive a login session: run "loginctl enable-linger $USER" in "ubuntu" and retry.`,
  );
  assert.equal(
    t("sessionScopeUnknownAnswer", { distro: "ubuntu", answer: "(nothing)", errorSuffix: ": wsl.exe failed: boom" }),
    `the sessionSandbox preflight in "ubuntu" answered (nothing): wsl.exe failed: boom; see docs/adr/0001-session-scoped-sandbox.md.`,
  );
  assert.equal(
    t("bwrapMissingGeneric", { distro: "ubuntu" }),
    `bwrap is not usable inside distro "ubuntu". Install it with ` +
    `"scripts/bootstrap.sh ubuntu --install" (from the package), or install the ` +
    `"bubblewrap" package with the distro's package manager.`,
  );
  assert.equal(
    t("bwrapMissingFamily", { distro: "arch", direct: "pacman -S --noconfirm bubblewrap" }),
    `bwrap is not usable inside distro "arch". Install it with ` +
    `"scripts/bootstrap.sh arch --install" (from the package), or directly: ` +
    `wsl.exe -d arch -u root -- pacman -S --noconfirm bubblewrap`,
  );
  assert.equal(
    t("bwrapBroken", { distro: "ubuntu", output: "bwrap: Can't find create_new_symref" }),
    `bwrap is installed inside distro "ubuntu" but failed the usability probe: bwrap: Can't find create_new_symref. ` +
    `This is usually the kernel (unprivileged user namespaces disabled) or an unusable bwrap build rather than a missing package, so reinstalling will not help. ` +
    `Check \`wsl.exe -d ubuntu --exec bwrap --version\` inside the distro, or set \`sandbox: false\` on the wsl-shell and wsl-fs rows to run unconfined.`,
  );
  assert.equal(
    t("bwrapRuntimeFailure", { distro: "ubuntu" }),
    `bwrap failed at run time inside distro "ubuntu". Check \`bwrap --version\` there, ` +
    `or reinstall it: "scripts/bootstrap.sh ubuntu --install".`,
  );
  assert.equal(t("bwrapProbeFailedSuffix", { output: "boom" }), ` The probe failed with: boom`);
  assert.equal(
    t("distroUnavailable", { code: "WSL_E_DISTRO_NOT_FOUND", distro: "gone" }),
    `wsl.exe reported WSL_E_DISTRO_NOT_FOUND for distro "gone": it is not installed, or not running. ` +
    `Start it with \`wsl.exe -d gone\`, check \`wsl.exe -l -v\`, or point \`distro\` at another one. ` +
    `This is not a sandbox denial, so running with wider permissions will not help.`,
  );
  assert.equal(
    t("workdirMissing", { missing: "/gone" }),
    `wsl.exe could not enter the working directory "/gone" inside the distro, so the command ran from "/" instead. ` +
    `Create it, or point \`cwd\` (or the request's \`workdir\`) at a directory that exists.`,
  );
  assert.equal(
    t("workdirAnotherDistro", { workdir: "//wsl$/debian/home/x", distro: "ubuntu" }),
    `"//wsl$/debian/home/x" names a workspace in another WSL distro, and this profile pins its commands to "ubuntu" — ` +
    `running them here would act on a different machine's tree. Open a session in that distro, ` +
    `or point cwd/workdir at this distro.`,
  );
});

check("the zh catalog keeps every command and config key verbatim", () => {
  configureMessagesLocale("zh");
  try {
    const linger = t("sessionScopeNoLinger", { distro: "ubuntu" });
    assert.match(linger, /loginctl enable-linger \$USER/, "the remedy command survives translation");
    assert.match(linger, /ubuntu/, "the distro name is interpolated");
    assert.doesNotMatch(linger, /outlive a login session/, "the sentence is not the english one");
    assert.match(t("sessionScopeNoSystemd", { distro: "ubuntu" }), /\[boot\] systemd=true/);
    assert.match(t("sessionScopeNoSystemd", { distro: "ubuntu" }), /wsl --shutdown/);
    assert.match(
      t("bwrapMissingFamily", { distro: "arch", direct: "pacman -S --noconfirm bubblewrap" }),
      /wsl\.exe -d arch -u root -- pacman -S --noconfirm bubblewrap/,
    );
    assert.match(t("bwrapBroken", { distro: "ubuntu", output: "bwrap: boom" }), /sandbox: false/);
    assert.match(t("bwrapRuntimeFailure", { distro: "ubuntu" }), /scripts\/bootstrap\.sh ubuntu --install/);
    assert.match(t("distroUnavailable", { code: "WSL_E_DISTRO_NOT_FOUND", distro: "gone" }), /wsl\.exe -l -v/);
    assert.match(t("workdirMissing", { missing: "/gone" }), /cwd/);
    assert.match(t("workdirAnotherDistro", { workdir: "//wsl$/debian/h", distro: "ubuntu" }), /cwd\/workdir/);
  } finally {
    resetMessagesLocaleForTests();
  }
});

check("the public builders render in the configured language", () => {
  assert.match(
    sessionScopeProblem({ output: { stdout: "no-linger" }, distro: "ubuntu" }) ?? "",
    /loginctl enable-linger/,
    "the default language is english",
  );
  configureMessagesLocale("zh");
  try {
    assert.doesNotMatch(
      sessionScopeProblem({ output: { stdout: "no-linger" }, distro: "ubuntu" }) ?? "",
      /outlive a login session/,
    );
    assert.match(missingBwrapRemedy("arch", "pacman"), /不可用/);
  } finally {
    resetMessagesLocaleForTests();
  }
});

check("the wiring reads locale.preference through an optional settings service", () => {
  resetMessagesLocaleForTests();
  /** @type {Array<[string, () => void]>} */
  const listeners = [];
  const describe = () => [{ ns: "locale", value: { preference: "zh-CN" } }];
  const scope = {
    settings: { describe },
    on: (/** @type {string} */ event, /** @type {() => void} */ listener) => {
      listeners.push([event, listener]);
      return () => true;
    },
  };
  const ctx = {
    inject: (/** @type {string[]} */ names, /** @type {(scope: unknown) => void} */ cb) => {
      assert.deepEqual(names, ["settings"]);
      cb(scope);
    },
  };
  installMessagesLocale(/** @type {never} */ (ctx));
  assert.equal(messagesLocale(), "zh", "the initial read maps the stored preference");
  assert.equal(listeners.length, 1, "one event listener refreshes the language");
  assert.equal(listeners[0]?.[0], "settings/document-updated");
  listeners[0]?.[1]();
  assert.equal(messagesLocale(), "zh", "a re-read of the same preference keeps the language");
  scope.settings.describe = () => [{ ns: "locale", value: { preference: "fr" } }];
  listeners[0]?.[1]();
  assert.equal(messagesLocale(), "en", "a switch to an unshipped language falls back to en");
  scope.settings.describe = () => [{ ns: "other", value: { preference: "zh" } }];
  listeners[0]?.[1]();
  assert.equal(messagesLocale(), "en", "a section that is not the locale entry is ignored");
  resetMessagesLocaleForTests();
});

check("a profile without the settings service falls back to the OS language", () => {
  resetMessagesLocaleForTests();
  installMessagesLocale(/** @type {never} */ ({
    inject: (/** @type {string[]} */ _names, /** @type {(scope: unknown) => void} */ cb) => cb({}),
  }));
  assert.equal(messagesLocale(), hostFallbackLocale(), "no settings row: the OS ICU locale is the language");
  installMessagesLocale(/** @type {never} */ ({}));
  assert.equal(messagesLocale(), hostFallbackLocale(), "a context without inject still gets the fallback");
  resetMessagesLocaleForTests();
});

check("the OS fallback maps tags onto the catalog languages", () => {
  assert.ok(hostFallbackLocale() === "en" || hostFallbackLocale() === "zh", "the fallback is always a shipped language");
});

check("a describe failure keeps the previous language", () => {
  resetMessagesLocaleForTests();
  configureMessagesLocale(hostFallbackLocale());
  /** @type {Array<() => void>} */
  const listeners = [];
  const scope = {
    settings: {
      describe: () => {
        throw new Error("boom");
      },
    },
    on: (/** @type {string} */ _event, /** @type {() => void} */ listener) => {
      listeners.push(listener);
      return () => true;
    },
  };
  installMessagesLocale(/** @type {never} */ ({
    inject: (/** @type {string[]} */ _names, /** @type {(scope: unknown) => void} */ cb) => cb(scope),
  }));
  listeners[0]?.();
  assert.equal(messagesLocale(), hostFallbackLocale(), "presentation must never gate the row");
  resetMessagesLocaleForTests();
});

for (const [name, fn] of checks) await runCheck(name, fn);
console.log(`\n${passed}/${checks.length} checks passed`);
