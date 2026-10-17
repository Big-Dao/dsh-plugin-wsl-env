/**
 * Rebuild the `preset-wsl` row from the harness's shipped standard agent preset.
 *
 *   node scripts/build-preset-wsl.mjs <standard.patch.yml> [out.yml]
 *
 * The shipped file is `packages/bundle/web-app/presets/standard.patch.yml` of
 * the harness tree the peer pins track (`git show dsh-vX.Y.Z-rc.N:<path>` from
 * a harness checkout). The output is the ` - id: preset-wsl` block that
 * `cordis.patch.yml` carries at the end of its second `insert:` list; splice it
 * in from that row to the end of the file.
 *
 * The copy differs from the shipped preset in exactly three ways, and the
 * script applies the first two so a regeneration cannot drift on them:
 *
 *   1. the shipped rows mount inside the `wsl-env` isolate realm, which wraps
 *      them in this plugin's own shell and fs providers;
 *   2. `tool-bash` is enabled and `tool-pwsh` disabled outright, where the
 *      shipped copy derives the choice from `process.platform`;
 *   3. the identity: row `preset-wsl`, preset `wsl`, `order: 2`.
 *
 * With no output path the block goes to stdout, which is what a diff against
 * the committed copy wants:
 *
 *   node scripts/build-preset-wsl.mjs standard.patch.yml | diff - <(...)
 */
import { readFileSync, writeFileSync } from "node:fs";

const [source, target] = process.argv.slice(2);
if (source === undefined) {
  console.error("usage: node scripts/build-preset-wsl.mjs <standard.patch.yml> [out.yml]");
  process.exit(2);
}

const shipped = readFileSync(source, "utf8");
const rowsAt = shipped.indexOf("          - id: persona\n");
if (!shipped.includes("        plugins:\n") || rowsAt < 0) {
  console.error(`FAIL  ${source} carries no standard-preset plugin rows`);
  process.exit(1);
}

/** The group that carries the distro's shell and fs for the whole preset. */
const realm = `          - id: wsl-env
            name: cordis:group
            group: true
            isolate:
              shell: true
              fs: true
            config:
              # ── the WSL environment for this preset only ────────────────────
              # No \`cwd\`: an empty default workdir means the distro user's home,
              # asked of the distro itself. Pin a directory here to override it —
              # a value that is right on one machine is wrong on every other.
              #
              # Each command is confined inside the distro by bubblewrap, in the
              # policy's mode, and the file tools are fenced by the same policy.
              # Install bubblewrap there (\`sudo apt install bubblewrap\`); without
              # it the providers fail closed rather than run unconfined. Add
              # \`sandbox: false\` to either provider for the old, unconfined
              # posture.
              - id: wsl-shell
                name: 'dsh-plugin-wsl-env'
                config:
                  distro: ''
                  loginShell: true
                  timeoutMs: 120000
                  maxTimeoutMs: 600000
              - id: wsl-fs
                name: 'dsh-plugin-wsl-env/fs'
                config:
                  distro: ''
                  restrictToDistro: true
                  # agent (the default): reads/writes/identities run inside the
                  # distro over the resident agent (lib/fs-substrate.js) —
                  # native symlinks and mode bits, the write guard survives to
                  # publication, and confined mutations are kernel-enforced.
                  # share: the opt-out — the Windows-side host fs stack over
                  # the 9p share.
                  substrate: agent`;

const rows = shipped
  .slice(rowsAt)
  .split("\n")
  .map((line) => (line === "" ? line : `    ${line}`))
  .join("\n")
  .replace("                disabled: !!js process.platform === 'win32'", "                disabled: false")
  .replace("                disabled: !!js process.platform !== 'win32'", "                disabled: true");

const block = `    - id: preset-wsl
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: wsl
        order: 2
        plugins:
${realm}
${rows}`;

if (target === undefined) process.stdout.write(block);
else writeFileSync(target, block);
