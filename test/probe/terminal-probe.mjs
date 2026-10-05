/**
 * Behavioural probe for `dsh-plugin-wsl-env/subprocess`.
 *
 * The provider replaces a *composition-level* service, so the only honest test
 * is a real boot: this plugin is mounted beside it in the throwaway `wslfs`
 * profile and asks for the exact terminal request `dsh-api-terminal-controller`
 * makes — argv `["wsl.exe"]` and the Session workspace as cwd — then types a few
 * commands and reports what the PTY answered. A pass proves the whole rewrite:
 * the distro, the initial directory, and the `DSH_*` fact the controller passes
 * through `WSLENV`.
 *
 * Driven by `test/probe/terminal.sh`; see its header for the one-time setup.
 *
 *   node --check test/probe/terminal-probe.mjs
 */
/**
 * The overlay's config for this probe.
 * @typedef {object} TerminalProbeConfig
 * @property {string} cwd - the workspace cwd the terminal controller would pass.
 * @property {string} expectPwd - the distro directory `cwd` must resolve to.
 */

/**
 * Mount the probe and run it once the subprocess service is up.
 * @param {import("@deepseek-ai/cordis").Context} ctx - the plugin context.
 * @param {TerminalProbeConfig} config - the overlay's `cwd` (what the controller would pass) and the
 *   `expectPwd` that directory must resolve to inside the distro.
 */
export default function terminalProbe(ctx, config) {
  ctx.inject(["subprocess"], (/** @type {import("@deepseek-ai/cordis").Context} */ scoped) => {
    void run(scoped, config);
  });
}

/**
 * Open one terminal the way the GUI does, type the assertions, and report.
 * @param {import("@deepseek-ai/cordis").Context} ctx - the context carrying the injected `ctx.subprocess`.
 * @param {TerminalProbeConfig} config - the overlay's `cwd` (what the controller would pass) and the
 *   `expectPwd` that directory must resolve to inside the distro.
 */
async function run(ctx, config) {
  const session = "wsl-terminal-probe";
  /** @param {string} line - the line to report. */
  const report = (line) => console.log(`TERMPROBE ${line}`);
  let handle;
  try {
    handle = await ctx.subprocess.spawnTerminal({
      argv: ["wsl.exe"],
      cwd: config.cwd,
      cols: 100,
      rows: 30,
      terminalType: "xterm-256color",
      graceMs: 2000,
      env: { DSH_SESSION_ID: session },
      shellActivity: true,
    });
  } catch (error) {
    report(`SPAWN FAILED ${String((/** @type {Error} */ (error))?.stack ?? error)}`);
    process.exit(1);
  }
  report("SPAWNED");

  let text = "";
  const reader = (async () => {
    for await (const chunk of handle.output) text += chunk.toString("utf8");
  })().catch(() => {});

  // The login shell sources its profile before the first prompt, so the commands
  // go in well after the spawn rather than racing the prompt.
  await delay(5000);
  handle.write(
    `pwd; echo PROBE-$((6*7)); echo DISTRO=\${WSL_DISTRO_NAME:-unset}; echo SESSION=\${DSH_SESSION_ID:-unset}; echo SHELL=$SHELL\n`,
  );
  await delay(6000);

  report("OUTPUT-BEGIN");
  for (const line of text.split(/\r?\n/)) {
    const visible = line.replace(/\u001b\[[0-9;?]*[a-zA-Z]/gu, "").trim();
    if (visible.length > 0) console.log(`TERMPROBE | ${visible}`);
  }
  report("OUTPUT-END");

  const checks = {
    "arithmetic ran": /PROBE-42/.test(text),
    "cwd translated": text.includes(`\n${config.expectPwd}\n`) || text.includes(`${config.expectPwd}\r\n`),
    "DSHENV forwarded": text.includes(`SESSION=${session}`),
  };
  for (const [name, ok] of Object.entries(checks)) report(`${ok ? "PASS" : "FAIL"} ${name}`);
  const distro = /[\r\n]DISTRO=(\S+)/u.exec(text)?.[1];
  const shell = /[\r\n]SHELL=(\S+)/u.exec(text)?.[1];
  report(`DISTRO=${String(distro)} SHELL=${String(shell)}`);
  try {
    await handle.terminate();
  } catch {}
  reader.catch(() => {});
  process.exit(Object.values(checks).every(Boolean) ? 0 : 2);
}

/**
 * Wait for the terminal to make progress.
 * @param {number} ms - milliseconds to wait.
 * @returns {Promise<void>} a promise that settles when the wait is over.
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
