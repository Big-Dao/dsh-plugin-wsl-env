/**
 * The `wsl_doctor` tool: the model runs the environment doctor itself, and
 * the verdict lands in the transcript — the GUI entry that belongs entirely
 * to the plugin.
 *
 * The doctor is this package's own diagnostic (WSL-316); exposing it as a
 * tool keeps the loop cohesive: no upstream surface is required, no file is
 * written into the user's workspace, and the model gets a structured digest
 * (verdict, blockers, per-failure copy-paste remedies) it can narrate or
 * act on. The heavy lifting is {@link doctorReport} — the sanctioned
 * in-process collector that spawns the shipped CLI once with the app's own
 * runtime and folds the live resident's state in; the tool adds only the
 * distro resolution and the digest.
 *
 * The distro comes from the caller when given, else from the agent's own
 * session cwd through the harness's `workingDirectory` service — the same
 * resolution the preflight performs, and the reason this row mounts inside
 * the `preset-wsl` block: a host-preset agent has no distro to examine.
 *
 * This is a TypeScript source built to `lib/wsl-doctor-tool.js`; edit THIS
 * file and run `pnpm run build` — the artifact under `lib/` is generated,
 * and `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/wsl-doctor-tool
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { distroOfUnc } from "./distro-route.js";
import { doctorReport } from "./index.js";

export const name = "wsl-doctor-tool";

/**
 * The context properties `apply` reads eagerly: the tool registry and the
 * harness's `workingDirectory` service (the session's distro resolution).
 * Cordis 4 refuses an undeclared read, so both must be named here. The doctor
 * collector is deliberately NOT injected: no host row provides a `doctor`
 * service, and a required inject would fail the whole preset mount; it is
 * resolved per call through the optional `ctx.get` (which needs no inject)
 * with the package's own `doctorReport` as the fallback — `doctorCollector`
 * below.
 */
export const inject = ["tools", "workingDirectory"];

/** The tool registry slice this service consumes. */
export interface ToolRegistrySlice {
  register: (tool: unknown) => unknown;
}

/** The harness's `workingDirectory` service slice (cwd resolution). */
export interface WorkingDirectoryToolSlice {
  ensure: (agent: unknown, signal?: unknown) => Promise<string>;
}

/** The doctor report this tool digests — the doctor CLI's versioned shape. */
export interface DoctorReportLike {
  verdict?: string;
  blockers?: string[];
  distroVerdicts?: Array<{ name: string, verdict: string, blockers: string[] }>;
  checks?: Array<{ id: string, status: string, title?: string, detail?: string, remedy?: string, distro?: string }>;
  summary?: Record<string, number>;
  /** The run's scope when the report is quick or section-filtered. */
  scope?: { sections: string[], quick: boolean };
}

/** The doctor report collector: distro plus run scope in, report out. */
export type DoctorCollector = (distro: string, options?: { quick?: boolean, sections?: readonly string[] }) => Promise<DoctorReportLike>;

/** The context slice this service consumes. */
export type WslDoctorToolContext = {
  tools: ToolRegistrySlice;
  workingDirectory: WorkingDirectoryToolSlice;
  /** Optional cordis-style lookup: how production resolves `doctor` without an inject. */
  get?: (name: string) => unknown;
  /** The in-process collector: a provided `doctor` service, or the test seam's fake. */
  doctor?: DoctorCollector;
};

/** The tool's config: the row takes no options. */
export interface WslDoctorToolConfig {
  /** Reserved; the wrapper has no options today. */
  enabled?: boolean;
}

/** One failing check as the digest carries it: what failed and what to do. */
export interface FailingCheck {
  id: string;
  detail: string;
  remedy: string;
}

/** The tool's result: the doctor's verdict, condensed for the model. */
export interface DoctorDigest {
  verdict: string;
  blockers: string[];
  failing: FailingCheck[];
  warningCount: number;
  skippedCount: number;
  /** Per-section tallies for the checks the report carried, in SECTIONS order. */
  sections: Array<{ section: string, ok: number, warn: number, fail: number, unknown: number }>;
  /** The scope the report answers for (quick profile or a section subset). */
  scope?: { sections: string[], quick: boolean };
  distroVerdicts: Array<{ name: string, verdict: string, blockers: string[] }>;
  note: string;
}

/**
 * The section a check id belongs to. Mirrors `sectionOf` in
 * `scripts/doctor.mjs` (the CLI's `--sections` filter reads that one); the
 * parity is pinned by a test in `test/wsl-doctor-tool.test.mjs`, so a check
 * cannot move sections on one side without the other noticing.
 * @param id - the check id.
 * @returns the section name.
 */
export function sectionOf(id: string): "host" | "sandbox" | "session" | "conf" | "net" | "agent" {
  if (id.startsWith("sandbox.") || id === "functional.sandbox") return "sandbox";
  if (id.startsWith("session.") || id === "runtime.scopes" || id === "distro.wsl-conf-boot") return "session";
  if (id.startsWith("config.") || id === "distro.wsl-conf-interop" || id === "distro.wsl-conf-automount") return "conf";
  if (id === "distro.dns") return "net";
  if (id.startsWith("agent.") || id === "functional.exec" || id === "functional.fs") return "agent";
  return "host";
}

/** The sections in report order, matching the doctor CLI's SECTIONS list. */
export const SECTIONS = ["host", "sandbox", "session", "conf", "net", "agent"];

/**
 * Digest one doctor report down to what the model acts on: the verdict, the
 * blockers, every failing check with its copy-paste remedy, and the
 * per-section tallies that make the passed checks visible (a bare verdict
 * says nothing about what was tested — the sections do). Warnings and
 * skipped legs count but do not list — the report's own ids name them when
 * the model asks.
 * @param report - the collected (and live-merged) doctor report.
 * @returns the digest.
 */
export function digestReport(report: DoctorReportLike): DoctorDigest {
  const checks = report.checks ?? [];
  const failing = checks
    .filter((check) => check.status === "fail")
    .map((check) => ({
      id: check.id,
      detail: check.detail ?? "",
      remedy: check.remedy === undefined || check.remedy.length === 0 ? "no remedy — see docs/DIAGNOSTICS.md" : check.remedy,
    }));
  const blockers = report.blockers ?? failing.map((check) => check.id);
  const verdict = report.verdict ?? (blockers.length === 0 ? "ready" : "blocked");
  const warningCount = report.summary?.warn ?? checks.filter((check) => check.status === "warn").length;
  const skippedCount = report.summary?.skipped ?? checks.filter((check) => check.status === "skipped").length;
  const sections = SECTIONS
    .map((section) => {
      const rows = checks.filter((check) => sectionOf(check.id) === section && check.status !== "skipped");
      const count = (status: string) => rows.filter((check) => check.status === status).length;
      return {
        section,
        ok: count("ok"),
        warn: count("warn"),
        fail: count("fail"),
        unknown: count("unknown"),
      };
    })
    .filter((tally) => tally.ok + tally.warn + tally.fail + tally.unknown > 0);
  return {
    verdict,
    blockers,
    failing,
    warningCount,
    skippedCount,
    sections,
    ...(report.scope === undefined ? {} : { scope: report.scope }),
    distroVerdicts: report.distroVerdicts ?? [],
    note: verdict === "ready"
      ? "the first command should succeed; run the CLI (pnpm run doctor --bundle <path>) for the attachable file"
      : "apply each remedy above, then call this tool again — the re-run is the re-verification",
  };
}

/**
 * Render the digest as the tool's text output: one verdict line, one line
 * per tested section with its tallies (what was checked and how it came
 * out), then one line per failing check with its remedy. The model narrates
 * this; keeping it plain text keeps the transcript readable.
 * @param digest - the digested report.
 * @returns the multi-line text.
 */
export function renderDigest(digest: DoctorDigest): string {
  const lines: string[] = [`wsl doctor verdict: ${digest.verdict.toUpperCase()}`];
  for (const tally of digest.sections) {
    const parts = [`${tally.ok} ok`];
    if (tally.warn > 0) parts.push(`${tally.warn} warn`);
    if (tally.fail > 0) parts.push(`${tally.fail} fail`);
    if (tally.unknown > 0) parts.push(`${tally.unknown} unknown`);
    lines.push(`  ${tally.section}: ${parts.join(", ")}`);
  }
  for (const check of digest.failing) {
    lines.push(`fail ${check.id} — ${check.detail}`);
    if (check.remedy.length > 0) lines.push(`  fix: ${check.remedy}`);
  }
  if (digest.failing.length === 0) {
    lines.push(digest.note);
  } else {
    lines.push(`${digest.warningCount} warning(s), ${digest.skippedCount} skipped leg(s) — none blocking; ${digest.note}`);
  }
  return lines.join("\n");
}

/**
 * The doctor collector this run uses. No host row provides a `doctor`
 * service, so a required inject would fail the whole preset mount; the
 * collector resolves per call instead: a provided `doctor` service through
 * the optional `ctx.get` (cordis answers undefined for an absent name, and a
 * `get` needs no inject), else the plain `doctor` property (the test seam),
 * else the package's own `doctorReport` — the sanctioned in-process
 * collector, imported from the composition root.
 *
 * @param ctx - the cordis context the row mounted in.
 * @returns the collector: distro in, versioned doctor report out.
 */
async function doctorCollector(
  ctx: WslDoctorToolContext,
): Promise<DoctorCollector> {
  if (typeof ctx.get === "function") {
    const provided = ctx.get("doctor");
    if (typeof provided === "function") return provided as DoctorCollector; // the provided service's contract is this module's `doctor` slice
  } else if (typeof ctx.doctor === "function") {
    return ctx.doctor;
  }
  return doctorReport;
}

/**
 * Mount the tool.
 *
 * @param ctx - the cordis context (the preset realm, where the tools
 *   registry and the workingDirectory service are reachable).
 */
export async function apply(ctx: WslDoctorToolContext): Promise<void> {
  ctx.tools.register(defineTool({
    name: "wsl_doctor",
    description: "Run the WSL environment doctor for this session's distro and return the verdict: ready (the first command should succeed), or blocked with per-failure copy-paste remedies. Interactive by design: start with depth \"quick\" (prerequisites only, ~10 s) and narrate the result, then narrow with \"section\" (one of host/sandbox/session/conf/net/agent) or run depth \"full\" only when the user asked for a complete diagnosis — each call probes its scope and reports per-section tallies for everything it tested.",
    parameters: {
      distro: {
        type: "string",
        description: "Distro to examine. Omit to examine this session's own distro.",
      },
      depth: {
        type: "string",
        enum: ["quick", "full"],
        description: "quick: prerequisites only (~10 s) — the right first call. full: every check including the agent smokes and the registry update query. Default full.",
      },
      section: {
        type: "string",
        enum: ["host", "sandbox", "session", "conf", "net", "agent"],
        description: "Restrict the run to one section for a focused follow-up (e.g. session to re-check systemd/linger after a fix). Overrides depth.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          verdict: { type: "string", required: true, description: "ready or blocked." },
          blockers: { type: "string", required: true, description: "Comma-separated blocking check ids; empty when ready." },
          failing: { type: "string", required: true, description: "Per-section tallies followed by one line per failing check with its remedy." },
        },
      },
      render: (_args, value) => [{ type: "text", text: value.failing }],
    },
    async execute(args, exec): Promise<{ verdict: string, blockers: string, failing: string }> {
      const argv = args as { distro?: string, depth?: string, section?: string };
      let distro = argv.distro ?? "";
      if (distro.length === 0) {
        if (exec.agent === undefined) throw new Error("wsl_doctor requires an agent Session (or an explicit distro)");
        const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
        distro = distroOfUnc(cwd) ?? "";
      }
      if (distro.length === 0) {
        throw new Error("wsl_doctor could not resolve the session's distro from its working directory — pass one explicitly");
      }
      const quick = argv.section === undefined || argv.section.length === 0 ? argv.depth === "quick" : false;
      const sections = argv.section !== undefined && argv.section.length > 0 ? [argv.section] : undefined;
      const doctor = await doctorCollector(ctx);
      const digest = digestReport(await doctor(distro, { ...(quick ? { quick: true } : {}), ...(sections !== undefined ? { sections } : {}) }));
      return { verdict: digest.verdict, blockers: digest.blockers.join(", "), failing: renderDigest(digest) };
    }
  }));
}
