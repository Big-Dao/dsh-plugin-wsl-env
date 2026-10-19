#!/usr/bin/env node
/**
 * Peer-upgrade canary (WSL-209).
 *
 * The plugin pins its peers exactly, so a new upstream release line can break it
 * before a user reports it. This script compares the pins in `package.json` with
 * one dist-tag (default `next`, the rc line the plugin tracks), prints the exact
 * version delta, and — with `--apply` — installs that line into a scratch copy
 * and runs `pnpm test` plus the composition boot test. The workflow that calls it
 * is `.github/workflows/peer-canary.yml` (weekly + manual).
 *
 *   node scripts/peer-canary.mjs --check [--tag next] [--json]
 *   node scripts/peer-canary.mjs --apply [--tag next]
 *
 * `--check` exits 0 when every pin already satisfies the tag, 2 when the line
 * moved, 1 when the registry could not be queried. `--apply` exits 0 when the
 * line is unchanged or the scratch tree passes, 1 when the upgrade fails.
 *
 * The summary table is written to `canary-summary.md` for the workflow's
 * `$GITHUB_STEP_SUMMARY`; SUPPORT.md's version table is updated from it.
 *
 * @module dsh-plugin-wsl/scripts/peer-canary
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions } from "./doctor.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Windows resolves the CLIs to `.cmd`, which execFile cannot spawn without a shell. */
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const SUMMARY = join(ROOT, "canary-summary.md");

/** A manifest's dependency blocks. */
/**
 * @typedef {object} Manifest
 * @property {string} [name]
 * @property {Record<string, string>} [peerDependencies]
 * @property {Record<string, string>} [devDependencies]
 */
/** One peer whose tagged version no longer satisfies the pin.
 * @typedef {object} PeerDelta
 * @property {string} name - the peer package.
 * @property {string} pinned - the range in package.json.
 * @property {string} latest - the tag's resolved version.
 */

/**
 * Compare each pinned peer against the tag's versions.
 * @param {Record<string, string>} pinned - `peerDependencies`.
 * @param {Record<string, string>} tagged - resolved `name -> version` for the tag.
 * @returns {PeerDelta[]} the peers whose pin the tag does not satisfy, sorted by name.
 */
export function peerDelta(pinned, tagged) {
  /** @type {PeerDelta[]} */
  const delta = [];
  for (const [name, range] of Object.entries(pinned)) {
    const latest = tagged[name];
    if (latest === undefined) continue;
    const base = range.startsWith("~") ? range.slice(1) : range;
    // Only a NEWER tag is a canary event; a pin ahead of the tag (different
    // release cadence, e.g. cordis) is not a regression to test.
    if (compareVersions(latest, base) > 0) delta.push({ name, pinned: range, latest });
  }
  return delta.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Move one manifest's peer/dev pins onto the tagged versions, keeping a tilde
 * range a tilde range (a patch canary should not silently widen to a caret).
 * @param {Manifest} manifest - the parsed manifest.
 * @param {Record<string, string>} tagged - resolved `name -> version` for the tag.
 * @returns {Manifest} a copy with the pins rewritten.
 */
export function rewriteManifest(manifest, tagged) {
  /** @param {Record<string, string> | undefined} block - one dependency block. */
  const rewrite = (block) => {
    if (block === undefined) return block;
    const next = { ...block };
    for (const [name, version] of Object.entries(tagged)) {
      const pinned = next[name];
      if (pinned === undefined) continue;
      next[name] = pinned.startsWith("~") ? `~${version}` : version;
    }
    return next;
  };
  return {
    ...manifest,
    peerDependencies: rewrite(manifest.peerDependencies),
    devDependencies: rewrite(manifest.devDependencies),
  };
}

/**
 * Resolve one tag for one package.
 * @param {string} name - the package.
 * @param {string} tag - the dist-tag.
 * @returns {string | undefined} the version, or undefined when the package has no such tag.
 */
function taggedVersion(name, tag) {
  const tags = JSON.parse(execFileSync(NPM, ["view", name, "dist-tags", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      npm_config_update_notifier: "false",
      npm_config_cache: process.env.npm_config_cache ?? join(tmpdir(), "dsh-peer-canary-npm-cache"),
      npm_config_logs_dir: process.env.npm_config_logs_dir ?? join(tmpdir(), "dsh-peer-canary-npm-logs"),
    },
    timeout: 60_000,
    shell: process.platform === "win32",
  }));
  const version = /** @type {Record<string, string>} */ (tags)[tag];
  return typeof version === "string" ? version : undefined;
}

/**
 * Write the summary table.
 * @param {string} tag - the dist-tag queried.
 * @param {PeerDelta[]} delta - the peers that moved.
 * @param {string[]} lines - extra result lines.
 */
function writeSummary(tag, delta, lines) {
  const table = [
    `### Peer canary (tag \`${tag}\`)`,
    "",
    "| Package | Pinned | Tagged | Delta |",
    "|---|---|---|---|",
    ...delta.map((entry) => `| \`${entry.name}\` | \`${entry.pinned}\` | \`${entry.latest}\` | moved |`),
    ...(delta.length === 0 ? ["| — | — | — | no change |"] : []),
    "",
    ...lines,
    "",
  ];
  writeFileSync(SUMMARY, table.join("\n"));
  console.log(table.join("\n"));
}

/**
 * Run the canary.
 * @param {{ tag: string, apply: boolean, json: boolean }} options - the run options.
 * @returns {number} the exit status.
 */
function main(options) {
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const pinned = /** @type {Record<string, string>} */ (manifest.peerDependencies ?? {});
  /** @type {Record<string, string>} */
  const tagged = {};
  for (const name of Object.keys(pinned)) {
    try {
      const version = taggedVersion(name, options.tag);
      if (version !== undefined) tagged[name] = version;
    } catch (error) {
      console.error(`peer-canary: could not query ${name}: ${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
  }
  const delta = peerDelta(pinned, tagged);
  if (options.json) {
    console.log(JSON.stringify({ tag: options.tag, delta, tagged }, null, 2));
  }

  if (!options.apply) {
    writeSummary(options.tag, delta, delta.length === 0 ? ["Every pin satisfies the tag."] : ["Run `node scripts/peer-canary.mjs --apply` to test the new line."]);
    return delta.length === 0 ? 0 : 2;
  }

  if (delta.length === 0) {
    writeSummary(options.tag, delta, ["Every pin satisfies the tag; nothing to upgrade."]);
    return 0;
  }

  const scratch = mkdtempSync(join(tmpdir(), "dsh-peer-canary-"));
  /** @type {string[]} */
  const results = [];
  try {
    cpSync(ROOT, scratch, {
      recursive: true,
      filter: (source) => !/[\\/](node_modules|\.git|canary-summary\.md)$/.test(source) && !source.includes(".scratch"),
    });
    const nextManifest = rewriteManifest(manifest, tagged);
    writeFileSync(join(scratch, "package.json"), `${JSON.stringify(nextManifest, null, 2)}\n`);
    execFileSync("git", ["init", "-q"], { cwd: scratch });
    execFileSync("git", ["add", "-A"], { cwd: scratch });
    /**
     * Run one scratch-tree step, recording its verdict.
     * @param {string} command - the executable.
     * @param {string[]} args - its arguments.
     * @returns {boolean} whether it succeeded.
     */
    const run = (command, args) => {
      try {
        execFileSync(command, args, { cwd: scratch, stdio: "inherit", timeout: 600_000, shell: process.platform === "win32" });
        results.push(`PASS  \`${command} ${args.join(" ")}\``);
        return true;
      } catch {
        results.push(`FAIL  \`${command} ${args.join(" ")}\``);
        return false;
      }
    };
    const installed = run(PNPM, ["install", "--no-frozen-lockfile"]);
    const tested = installed && run(PNPM, ["test"]);
    const composed = installed && run("node", ["test/composition.test.mjs"]);
    const ok = installed && tested && composed;
    writeSummary(options.tag, delta, results);
    return ok ? 0 : 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let tag = "next";
  let apply = false;
  let json = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] ?? "";
    if (arg === "--tag") tag = args[++i] ?? "next";
    else if (arg === "--apply") apply = true;
    else if (arg === "--json") json = true;
    else if (arg === "--check") apply = false;
    else {
      console.error(`peer-canary: unknown option ${arg}`);
      process.exit(2);
    }
  }
  process.exitCode = main({ tag, apply, json });
}
