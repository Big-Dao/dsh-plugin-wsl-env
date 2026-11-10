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
import { t } from "./messages.js";
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
interface ToolRegistrySlice {
  register: (tool: unknown) => unknown;
}

/** The harness's `workingDirectory` service slice (cwd resolution). */
interface WorkingDirectoryToolSlice {
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
type DoctorCollector = (distro: string, options?: { quick?: boolean, sections?: readonly string[], signal?: AbortSignal }) => Promise<DoctorReportLike>;

/** The context slice this service consumes. */
type WslDoctorToolContext = {
  tools: ToolRegistrySlice;
  workingDirectory: WorkingDirectoryToolSlice;
  /** Optional cordis-style lookup: how production resolves `doctor` without an inject. */
  get?: (name: string) => unknown;
  /** The in-process collector: a provided `doctor` service, or the test seam's fake. */
  doctor?: DoctorCollector;
};

/** One failing check as the digest carries it: what failed and what to do. */
interface FailingCheck {
  id: string;
  detail: string;
  remedy: string;
  /** The distro the failing check ran in; absent for host-wide checks. */
  distro?: string;
}

/** Per-distro tallies: what was tested in each distro and how it came out. */
interface DistroTally {
  name: string;
  ok: number;
  warn: number;
  fail: number;
  unknown: number;
  info: number;
  skipped: number;
  /** This distro is the session's own — the run's primary subject. */
  session?: boolean;
  /** The distro's own verdict when the report carried one. */
  verdict?: string;
}

/** One check as the itemized listing carries it: what was tested and how it came out. */
interface CheckItem {
  id: string;
  /** The check's display name; falls back to the id when the report omits it. */
  title: string;
  status: string;
  detail: string;
  distro?: string;
  remedy?: string;
  /** Synthetic catalog row: this run's scope never executed the check. */
  scopeSkip?: true;
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
  /** Per-distro tallies in first-appearance order — the grouped summary. */
  distros: DistroTally[];
  /** Every check the report carried, in report order — the itemized listing. */
  items: CheckItem[];
  /**
   * Catalog ids the report did not carry: checks a scoped run never executed,
   * plus conditional ids whose trigger did not fire (a quiet full run's
   * `distro.present` / `fix.git-trust`).
   */
  notRun: number;
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
  if (id.startsWith("agent.") || id === "functional.exec" || id === "functional.fs" || id === "functional.native") return "agent";
  return "host";
}

/** The sections in report order, matching the doctor CLI's SECTIONS list. */
export const SECTIONS = ["host", "sandbox", "session", "conf", "net", "agent"];

/** The pseudo-distro a check lands under when this run's scope never executed it. */
const NOT_RUN = "(not run)";
/** The detail a scope-filtered skip row carries; the marker the renderer buckets on. */
const SCOPE_SKIP_DETAIL = "not run in this scope";
/** The detail prefix a CLI-gated skip row carries (the blocker follows it). */
const SKIP_DETAIL_PREFIX = "skipped: ";

/**
 * Every check id the doctor can emit — the CLI's whole probing surface,
 * including the ids that only appear conditionally (`distro.present` for a
 * configured-but-missing distro, `fix.git-trust` for a `--fix` run) and the
 * `tools.*` ids the optional-tool loop constructs. The itemized listing uses
 * this to show the checks a scoped (quick or section) run did NOT execute as
 * explicit `[SKIP]` rows instead of silently dropping them; the parity test
 * in `test/wsl-doctor-tool.test.mjs` re-extracts the ids from the CLI source
 * and fails when the catalog drifts. A full run carries no scope, so a
 * conditional id whose trigger never fired (no distro is missing, no
 * `--fix`) also surfaces there under the generic `no scope recorded`
 * reason — for those ids the honest reading is "did not fire", not
 * "out of scope".
 */
export const CHECK_CATALOG: readonly string[] = [
  "agent.cache",
  "agent.handshake",
  "agent.home-writable",
  "agent.native",
  "config.deprecated",
  "config.effective",
  "config.preset-trap",
  "config.wslconfig",
  "distro.clock",
  "distro.disk",
  "distro.dns",
  "distro.identity",
  "distro.present",
  "distro.reachable",
  "distro.unc",
  "distro.wsl-conf-automount",
  "distro.wsl-conf-boot",
  "distro.wsl-conf-interop",
  "distro.wsl-mode",
  "fix.git-trust",
  "functional.exec",
  "functional.fs",
  "functional.native",
  "functional.sandbox",
  "git.win-safe",
  "host.disk",
  "host.distros",
  "host.platform",
  "peers.versions",
  "runtime.scopes",
  "sandbox.bwrap",
  "sandbox.bwrap-usable",
  "session.linger",
  "session.systemd",
  "session.systemd-run",
  "session.user-manager",
  "tools.git",
  "tools.inotifywait",
  "tools.rg",
];

/**
 * Digest one doctor report down to what the model acts on: the verdict, the
 * blockers, every failing check with its copy-paste remedy, and the
 * per-section tallies that make the passed checks visible (a bare verdict
 * says nothing about what was tested — the sections do). Warnings and
 * skipped legs count but do not list — the report's own ids name them when
 * the model asks.
 * @param report - the collected (and live-merged) doctor report.
 * @param sessionDistro - the distro this session runs in, when known; the
 *   matching tally is flagged so the rendered summary can name it.
 * @returns the digest.
 */
export function digestReport(report: DoctorReportLike, sessionDistro?: string): DoctorDigest {
  const checks = report.checks ?? [];
  const failing = checks
    .filter((check) => check.status === "fail")
    .map((check) => ({
      id: check.id,
      detail: check.detail ?? "",
      remedy: check.remedy === undefined || check.remedy.length === 0 ? "no remedy — see docs/DIAGNOSTICS.md" : check.remedy,
      ...(check.distro === undefined ? {} : { distro: check.distro }),
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
  // Per-distro tallies in first-appearance order. Host-wide checks carry no
  // distro and group under "(host)" so the summary stays complete.
  const distroVerdictByName = new Map(report.distroVerdicts?.map((row) => [row.name, row.verdict]) ?? []);
  const distroMap = new Map<string, DistroTally>();
  for (const check of checks) {
    const name = check.distro ?? "(host)";
    let tally = distroMap.get(name);
    if (tally === undefined) {
      tally = { name, ok: 0, warn: 0, fail: 0, unknown: 0, info: 0, skipped: 0 };
      distroMap.set(name, tally);
    }
    if (check.status === "ok") tally.ok += 1;
    else if (check.status === "warn") tally.warn += 1;
    else if (check.status === "fail") tally.fail += 1;
    else if (check.status === "unknown") tally.unknown += 1;
    else if (check.status === "info") tally.info += 1;
    else if (check.status === "skipped") tally.skipped += 1;
  }
  const distros = [...distroMap.values()].map((tally) => {
    const verdict = distroVerdictByName.get(tally.name);
    return {
      ...tally,
      ...(sessionDistro !== undefined && tally.name === sessionDistro ? { session: true } : {}),
      ...(verdict === undefined ? {} : { verdict }),
    };
  });
  // Scope the listing never drops silently: every catalog id the report did
  // not carry joins the items as an explicit skip row, so a quick or
  // section-scoped answer still shows the full check surface. The same set
  // feeds `notRun`, which the panel renders as "the full run covers N more".
  const reported = new Set(checks.map((check) => check.id));
  const notRunIds = CHECK_CATALOG.filter((id) => !reported.has(id));
  return {
    verdict,
    blockers,
    failing,
    warningCount,
    skippedCount,
    sections,
    distros,
    items: (() => {
      const rows: CheckItem[] = checks.map((check) => ({
        id: check.id,
        title: check.title ?? check.id,
        status: check.status,
        detail: check.detail ?? "",
        ...(check.distro === undefined ? {} : { distro: check.distro }),
        ...(check.remedy === undefined || check.remedy.length === 0
          ? check.status === "fail" ? { remedy: "no remedy — see docs/DIAGNOSTICS.md" } : {}
          : { remedy: check.remedy }),
      }));
      for (const id of notRunIds) {
        rows.push({ id, title: id, status: "skipped", detail: SCOPE_SKIP_DETAIL, distro: NOT_RUN, scopeSkip: true });
      }
      return rows;
    })(),
    notRun: notRunIds.length,
    ...(report.scope === undefined ? {} : { scope: report.scope }),
    distroVerdicts: report.distroVerdicts ?? [],
    note: verdict === "ready"
      ? t("doctorDigestNoteReady", {})
      : t("doctorDigestNoteBlocked", {}),
  };
}

/**
 * Render the digest as the tool's text output, in the style of a regular
 * diagnostic tool: one verdict line, then an itemized listing — every check
 * the report carried, grouped by distro, each with an explicit status marker
 * (`[OK]` / `[WARN]` / `[FAIL]` / `[INFO]` / `[SKIP]` / `[??]`), its name and
 * what it found. A failed check carries its copy-paste remedy on the next
 * line; a warned check carries its detail, which is already the remedy's
 * context. The model narrates this; keeping it plain text keeps the
 * transcript readable.
 * @param digest - the digested report.
 * @returns the multi-line text.
 */
export function renderDigest(digest: DoctorDigest): string {
  const lines: string[] = [t("doctorDigestVerdict", { verdict: digest.verdict.toUpperCase() })];
  const mark = (status: string): string => {
    if (status === "ok") return "[ OK ]";
    if (status === "warn") return "[WARN]";
    if (status === "fail") return "[FAIL]";
    if (status === "info") return "[INFO]";
    if (status === "skipped") return "[SKIP]";
    return "[ ?? ]";
  };
  // Group the itemized listing by distro in first-appearance order; the
  // session distro is labeled so the reader knows which group is "here".
  const sessionName = digest.distros.find((tally) => tally.session)?.name;
  const groups: Array<{ name: string, items: CheckItem[] }> = [];
  for (const item of digest.items) {
    const name = item.distro ?? "(host)";
    let group = groups.find((entry) => entry.name === name);
    if (group === undefined) {
      group = { name, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  for (const group of groups) {
    const tally = digest.distros.find((entry) => entry.name === group.name);
    const label = group.name === "(host)"
      ? t("doctorDigestHostLabel", {})
      : group.name === NOT_RUN
        ? t("doctorDigestNotRunLabel", {})
        : sessionName !== undefined && group.name === sessionName ? t("doctorDigestSessionLabel", { name: group.name }) : group.name;
    lines.push("", `== ${label} =`);
    // Skip rows carry no actionable content — one summary line per group
    // instead of one row per check, so the checks that actually ran keep
    // the reader's attention. Two distinct reasons share the bucket and must
    // not blur: out-of-scope checks (the run's profile never touched them)
    // collapse into one line that names the scope's shape, while a failed
    // prerequisite's gated smoke legs keep one line each — their blocker is
    // the actionable fact.
    const skipped = group.items.filter((item) => item.status === "skipped");
    const scoped = skipped.filter((item) => item.detail === SCOPE_SKIP_DETAIL);
    const gated = skipped.filter((item) => item.detail !== SCOPE_SKIP_DETAIL);
    for (const item of group.items) {
      if (item.status === "skipped") continue;
      const name = item.title === item.id ? item.id : `${item.id} — ${item.title}`;
      lines.push(`${mark(item.status)} ${name}${item.detail.length > 0 ? `: ${item.detail}` : ""}`);
      if (item.status === "fail" && item.remedy !== undefined && item.remedy.length > 0) {
        lines.push(t("doctorDigestFixPrefix", { remedy: item.remedy }));
      }
    }
    if (scoped.length > 0) {
      const reason = digest.scope === undefined
        ? t("doctorSkipReasonGeneric", {})
        : digest.scope.quick
          ? t("doctorSkipReasonQuick", {})
          : t("doctorSkipReasonSections", { sections: digest.scope.sections.join(", ") });
      lines.push(t("doctorDigestSkipRow", { n: scoped.length, reason, ids: scoped.map((item) => item.id).join(", ") }));
    }
    for (const item of gated) {
      const detail = item.detail.startsWith(SKIP_DETAIL_PREFIX) ? item.detail.slice(SKIP_DETAIL_PREFIX.length) : item.detail;
      lines.push(t("doctorSkipGated", { id: item.id, reason: detail }));
    }
    if (tally !== undefined) {
      const counts: string[] = [];
      if (tally.ok > 0) counts.push(t("doctorTallyOk", { n: tally.ok }));
      if (tally.warn > 0) counts.push(t("doctorTallyWarn", { n: tally.warn }));
      if (tally.fail > 0) counts.push(t("doctorTallyFail", { n: tally.fail }));
      if (tally.unknown > 0) counts.push(t("doctorTallyUnknown", { n: tally.unknown }));
      if (tally.info > 0) counts.push(t("doctorTallyInfo", { n: tally.info }));
      if (tally.skipped > 0) counts.push(t("doctorTallySkipped", { n: tally.skipped }));
      if (counts.length > 0) lines.push(`-- ${counts.join(", ")}`);
    }
  }
  const blockers = digest.failing.map((check) =>
    check.distro !== undefined && digest.distros.length > 1 ? `${check.distro}/${check.id}` : check.id
  );
  if (digest.failing.length === 0) {
    lines.push("", digest.note);
  } else {
    lines.push("", t("doctorDigestBlockedTail", { blockers: blockers.join(", "), warnings: digest.warningCount, skipped: digest.skippedCount, note: digest.note }));
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
    description: "Run the WSL environment doctor for this session's distro and return the verdict: ready (the first command should succeed), or blocked with per-failure copy-paste remedies. Interactive by design: start with depth \"quick\" (prerequisites only, ~10 s for the session's own distro) and narrate the result, then narrow with \"section\" (one of host/sandbox/session/conf/net/agent) or run depth \"full\" only when the user asked for a complete diagnosis — each call probes its scope and itemizes every check it tested with an explicit status marker, grouped by distro.",
    parameters: {
      distro: {
        type: "string",
        description: "Distro to examine. Omit to examine this session's own distro.",
      },
      depth: {
        type: "string",
        enum: ["quick", "full"],
        description: "quick (default): prerequisites only (~10 s) — the right first call. full: every check including the agent smokes and the registry update query — pass it only when the user asked for a complete diagnosis.",
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
          report: { type: "string", required: true, description: "Itemized per-check listing grouped by distro — each check with an explicit [OK]/[WARN]/[FAIL] status marker, what it found, and the copy-paste fix for every failure." },
        },
      },
      render: (_args, value) => [{ type: "text", text: value.report }],
    },
    async execute(args, exec): Promise<{ verdict: string, blockers: string, report: string }> {
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
      const quick = argv.section === undefined || argv.section.length === 0 ? argv.depth !== "full" : false;
      const sections = argv.section !== undefined && argv.section.length > 0 ? [argv.section] : undefined;
      const doctor = await doctorCollector(ctx);
      const digest = digestReport(
        await doctor(distro, {
          ...(quick ? { quick: true } : {}),
          ...(sections !== undefined ? { sections } : {}),
          // The run is a subprocess: the caller's cancellation (Esc on the
          // tool call) kills it instead of leaving it to finish unwatched.
          ...(exec.signal === undefined ? {} : { signal: exec.signal }),
        }),
        distro,
      );
      return { verdict: digest.verdict, blockers: digest.blockers.join(", "), report: renderDigest(digest) };
    }
  }));
}
