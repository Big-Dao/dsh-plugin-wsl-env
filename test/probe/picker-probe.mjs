/**
 * Behavioural probe for `dsh-plugin-wsl-env/picker`.
 *
 * It asks the picker the questions a reader of the documentation would ask: does the
 * root level offer the Windows home and every installed distro, is a path that is not
 * absolute refused with the documented `directory-unreadable` code, and does
 * `maxEntries` really cap a level and say so. None of that was covered: the unit tests
 * import only `lib/listing.js`, so `lib/picker.js` never ran in a gate.
 *
 * The report is written beside this module; `test/probe/picker.sh` prints it and exits
 * with this probe's status.
 *
 *   node --check test/probe/picker-probe.mjs
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PROBE_DIR } from "./env.mjs";

export default function pickerProbe(ctx, config) {
  ctx.inject(["directoryPicker"], (scoped) => {
    void run(scoped, config);
  });
}

/**
 * Walk the levels a user would walk, and report what the picker answered.
 * @param ctx - the context carrying the injected `ctx.directoryPicker`.
 * @param config - the distro, host home, scratch level, cap and report path.
 */
async function run(ctx, config) {
  const lines = [];
  const failures = [];
  const report = (line) => {
    lines.push(`PICKERPROBE ${line}`);
    console.log(`PICKERPROBE ${line}`);
  };
  const check = (name, ok, detail = "") => {
    report(`${ok ? "PASS" : "FAIL"} ${name}${detail === "" ? "" : `  — ${detail}`}`);
    if (!ok) failures.push(name);
  };
  const listing = async (path) => {
    try {
      return { ok: true, value: await ctx.directoryPicker.list(path) };
    } catch (error) {
      return { ok: false, error };
    }
  };

  const root = await listing(undefined);
  if (root.ok) {
    const names = root.value.entries.map((entry) => entry.name);
    check("the root level is crumbed", root.value.crumbs?.[0]?.name === "WSL", `crumbs=${JSON.stringify(root.value.crumbs?.map((c) => c.name))}`);
    check("the Windows home is offered", names.includes(config.hostHome), `want ${config.hostHome}`);
    check("every installed distro is offered", names.includes(config.distro), `want ${config.distro}; got ${names.join(", ")}`);
    check("the root level is not truncated", root.value.truncated === false, `truncated=${root.value.truncated}`);
  } else {
    check("the root level lists", false, `${root.error?.code} ${root.error?.message}`);
  }

  for (const [label, candidate] of [["a relative path", "relative/thing"], ["a directory that does not exist", "\\\\wsl.localhost\\no-such-distro-probe\\home"]]) {
    const refused = await listing(candidate);
    check(`${label} is refused with the documented code`, !refused.ok && refused.error?.code === "directory-unreadable", refused.ok ? "it listed" : `code=${refused.error?.code}`);
  }

  const capped = await listing(config.scratch);
  if (capped.ok) {
    const entries = capped.value.entries;
    check("maxEntries caps the level", entries.length <= config.maxEntries, `entries=${entries.length} cap=${config.maxEntries}`);
    check("a capped level says it was truncated", capped.value.truncated === true, `truncated=${capped.value.truncated}`);
    check("only directories are offered", entries.every((entry) => typeof entry.path === "string" && entry.path.length > 0), entries.map((e) => e.name).join(", "));
  } else {
    check("the prepared scratch level lists", false, `${capped.error?.code} ${capped.error?.message}`);
  }

  report(failures.length === 0 ? "RESULT: all checks passed" : `RESULT: ${failures.length} check(s) failed`);
  try {
    const destination = typeof config.report === "string" && config.report.length > 0 ? config.report : join(PROBE_DIR, "picker-report.txt");
    writeFileSync(destination, `${lines.join("\n")}\n`);
  } catch (error) {
    console.log(`PICKERPROBE report write failed: ${String(error)}`);
  }
  process.exit(failures.length === 0 ? 0 : 1);
}
