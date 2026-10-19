/**
 * GUI-preview latency measurement (WSL-206).
 *
 * Measures the three operations a Sidebar preview pays through the root
 * `fs-routing` -> distro backend: `stat`, `listDir`, and a 1 MiB page read
 * (`readByteRange`). The WSL backend is the same one `workspace-files` reaches
 * through the router; the probe drives it directly so the numbers do not need
 * a harness boot.
 *
 *   node test/probe/gui-preview.mjs   # via test/probe/gui-preview.sh
 *
 * Environment: DSH_WSL_GUI_PREVIEW_FILE (UNC of a ~1 MiB file),
 * DSH_WSL_GUI_PREVIEW_DIR (UNC of a representative directory),
 * DSH_GUI_PREVIEW_N (iterations, default 20).
 *
 * Budgets (fail the probe when exceeded): stat p95 <= 100 ms, listDir p95 <=
 * 500 ms, 1 MiB page-read p95 <= 1000 ms/MiB. These are the WSL-206 gates.
 */
import { Context } from "@deepseek-ai/cordis";
import { WslFileSystem } from "../../lib/index.js";

const file = process.env.DSH_WSL_GUI_PREVIEW_FILE ?? "";
const directory = process.env.DSH_WSL_GUI_PREVIEW_DIR ?? "";
const N = Number(process.env.DSH_GUI_PREVIEW_N ?? "20");
if (!file || !directory) {
  console.error("gui-preview: set DSH_WSL_GUI_PREVIEW_FILE and DSH_WSL_GUI_PREVIEW_DIR (test/probe/gui-preview.sh does)");
  process.exit(2);
}

const ctx = new Context();
ctx.provide("sandboxPolicy", { defaultMode: "workspace-write", resolve: () => ({ mode: "workspace-write", workspaceRoot: "/" }) });
const distro = (file.match(/^\\\\wsl\.localhost\\([^\\]+)\\/i) ?? [])[1] ?? process.env.WSL_DISTRO_NAME ?? "ubuntu";
const fs = new WslFileSystem(ctx, WslFileSystem.Config({ distro, sandbox: false, restrictToDistro: true }));

/**
 * Rounds a millisecond value to one decimal.
 * @param {number} value - the value.
 * @returns {number} the rounded value.
 */
const round = (value) => Math.round(value * 10) / 10;
/**
 * The p-th percentile of a sample.
 * @param {number[]} samples - the samples.
 * @param {number} p - 0..1.
 * @returns {number} the percentile.
 */
const percentile = (samples, p) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))] ?? 0;
};
/**
 * Time one async operation.
 * @param {() => Promise<unknown>} action - the operation.
 * @returns {Promise<number>} milliseconds.
 */
const time = async (action) => {
  const started = performance.now();
  await action();
  return performance.now() - started;
};

let failed = 0;
/** @param {string} name @param {number} p95 @param {number} budget @param {string} detail */
const verdict = (name, p95, budget, detail) => {
  const ok = p95 <= budget;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  — ${detail}`);
  if (!ok) failed += 1;
};
/** @param {string} name @param {number[]} samples @param {number} budget @param {(value: number) => string} [format] */
const sample = (name, samples, budget, format = (value) => `${round(value)} ms`) => {
  verdict(name, percentile(samples, 0.95), budget, `p50 ${format(percentile(samples, 0.5))}, p95 ${format(percentile(samples, 0.95))}, max ${format(Math.max(...samples))} (n=${samples.length})`);
};

const target = await fs.resolve(file);
const dirTarget = await fs.resolve(directory);
// Warm the agent + the mount view before measuring.
await fs.stat(target);
await fs.listDir(dirTarget);
await fs.readByteRange(target, { offset: 0, length: 1024 * 1024 });

const stats = [];
const lists = [];
const reads = [];
for (let index = 0; index < N; index += 1) {
  stats.push(await time(() => fs.stat(target)));
  lists.push(await time(() => fs.listDir(dirTarget)));
  reads.push(await time(() => fs.readByteRange(target, { offset: 0, length: 1024 * 1024 })));
}

sample("stat", stats, 100);
sample("listDir", lists, 500);
sample("1 MiB page read", reads, 1000);
const perMiB = percentile(reads, 0.95);
console.log(`RESULT: p95 ${round(perMiB)} ms/MiB for the page read (budget 1000 ms/MiB)`);
if (failed > 0) {
  console.log(`${failed} budget(s) exceeded`);
  process.exit(1);
}
console.log("all GUI-preview budgets held");
// The shared agent's long-lived child would otherwise keep this probe alive.
process.exit(0);
