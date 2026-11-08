/**
 * The `/wsl-doctor` UI command: the human runs the environment doctor through
 * the command plane — the browser button drops a `/wsl-doctor` line, the
 * commands registry executes it against a session, and the settled text
 * renders in the UI detached from model history. No model turn happens: the
 * command and its output add no tokens and never enter a request (the
 * `dsh-commands` contract), which is the point — the diagnosis must not
 * depend on the plugin's model-facing runtime being healthy.
 *
 * The handler does NOT collect the report in-process. It spawns the
 * standalone doctor CLI (`scripts/doctor.mjs --json`) as a host subprocess:
 * the CLI loads no peer dependency and no host service (its two peer-tainted
 * imports are inlined and drift-pinned by test), so a diagnosis answers even
 * when the plugin's own module graph is the thing that is broken. Formatting
 * reuses `digestReport`/`renderDigest` from the tool module so the UI command
 * and the model tool present identical itemized output.
 *
 * Grammar: `/wsl-doctor [quick|full|<section>] [--distro <name>]` — an empty
 * line means quick. Without an explicit distro the session's own working
 * directory names the distro; when that also fails, the CLI's effective
 * configuration decides (the shipped preset's `auto` probes every installed
 * distro). Unknown tokens settle as a direct command error with usage text.
 *
 * This is a TypeScript source built to `lib/wsl-doctor-command.js`; edit THIS
 * file and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl-env/wsl-doctor-command
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { distroOfUnc } from "./distro-route.js";
import { digestReport, renderDigest, SECTIONS, type DoctorDigest, type DoctorReportLike } from "./wsl-doctor-tool.js";

export const name = "wsl-doctor-command";

/**
 * No required inject: a headless deployment has no commands registry, and a
 * required inject would fail the whole composition mount over a surface this
 * row cannot use. The registry resolves per mount through the optional
 * `ctx.get` (cordis answers undefined for an absent name; a `get` needs no
 * inject), with a plain property as the test seam — the same shape the
 * `wsl_doctor` tool uses for its optional collector.
 */
export const inject: string[] = [];

/** The host commands registry slice this row consumes. */
export interface CommandsRegistrySlice {
  register: (definition: WslDoctorCommandDefinition) => unknown;
}

/** The invocation face the registry hands a handler. */
export interface WslDoctorCommandInvocation {
  /** The receiving agent, when the command ran against a session. */
  agent?: unknown;
  /** Everything after the command name, separator whitespace trimmed. */
  rawInput: string;
  /** The dispatcher's abort signal; cancelling stops awaiting and kills the child. */
  signal?: AbortSignal;
}

/** The command definition face this row registers. */
export interface WslDoctorCommandDefinition {
  name: string;
  description: string;
  input?: { hint: string };
  handler: (invocation: WslDoctorCommandInvocation) => Promise<WslDoctorCommandResult>;
}

/** The settled result the adapter renders detached from model history. */
export interface WslDoctorCommandResult {
  kind: "success" | "error";
  text: string;
}

/** The context slice this service consumes. */
export type WslDoctorCommandContext = {
  /** The commands registry, when the deployment has a command adapter. */
  commands?: CommandsRegistrySlice;
  /** The harness's cwd service, used to name the session's distro. */
  workingDirectory?: { ensure: (agent: unknown, signal?: unknown) => Promise<string> };
  /** Optional cordis-style lookup: how production resolves both without an inject. */
  get?: (name: string) => unknown;
  /** The test seam: a provided CLI runner replaces the real subprocess. */
  doctorCli?: DoctorCliRunner;
};

/** The CLI runner seam: argv in (node-less — the runner owns the runtime), JSON text out. */
export type DoctorCliRunner = (argv: string[], signal?: AbortSignal) => Promise<string>;

/** The parsed `/wsl-doctor` line. */
export interface ParsedDoctorInput {
  /** quick → `--quick`; full → no flag; section → `--sections <name>`. */
  mode: "quick" | "full" | "section";
  /** The section name, when `mode` is `"section"`. */
  section?: string;
  /** The explicit distro, or empty to resolve from the session's cwd. */
  distro: string;
}

/** The doctor CLI this row spawns, resolved from the built module's package root. */
export const DOCTOR_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "doctor.mjs");

/** The usage text a grammar violation settles with. */
export const USAGE = "用法：/wsl-doctor [quick|full|<section>] [--distro <名称>]\n" +
  "section ∈ " + SECTIONS.join(" | ") + "；空输入等价 quick。省略 --distro 时用当前会话的工作目录推断 distro。";

/**
 * Parse the raw input after the command name. Tokens: one mode word or
 * section name, plus an optional `--distro <name>` / `--distro=<name>`; a
 * second bare token is accepted as the distro name.
 *
 * @param rawInput - everything after the command name.
 * @returns the parsed mode, optional section, and optional distro.
 * @throws when a token matches nothing — the caller settles usage text.
 */
export function parseDoctorInput(rawInput: string): ParsedDoctorInput {
  const parsed: ParsedDoctorInput = { mode: "quick", distro: "" };
  const tokens = rawInput.trim().split(/\s+/).filter((token) => token.length > 0);
  let expectingDistro = false;
  for (const token of tokens) {
    if (expectingDistro) {
      parsed.distro = token;
      expectingDistro = false;
      continue;
    }
    if (token === "--distro") {
      expectingDistro = true;
      continue;
    }
    if (token.startsWith("--distro=")) {
      parsed.distro = token.slice("--distro=".length);
      continue;
    }
    if (token === "quick" || token === "full") {
      parsed.mode = token;
      continue;
    }
    if ((SECTIONS as readonly string[]).includes(token)) {
      parsed.mode = "section";
      parsed.section = token;
      continue;
    }
    if (parsed.distro.length === 0) {
      parsed.distro = token;
      continue;
    }
    throw new Error(`无法识别的参数：${token}`);
  }
  if (expectingDistro) throw new Error("--distro 需要一个名称");
  return parsed;
}

/**
 * The default CLI runner: spawn the standalone doctor as a host subprocess.
 * `process.execPath` is the Electron binary inside the harness, so
 * `ELECTRON_RUN_AS_NODE=1` turns it into plain node for the child; under a
 * plain node runtime the variable is ignored. Exit code 1 is a *blocked
 * verdict*, which is a successful diagnosis — the JSON on stdout still parses;
 * only a spawn failure or unparseable output is an infrastructure error.
 *
 * @param argv - flags after the script path (no node, no script — added here).
 * @param signal - the dispatcher's abort signal; abort kills the child.
 * @returns the CLI's stdout (one JSON report).
 */
export function runDoctorCli(argv: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [DOCTOR_SCRIPT, ...argv], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => rejectPromise(error));
    child.on("close", (code) => {
      const text = stdout.trim();
      if (text.startsWith("{")) {
        resolvePromise(text);
        return;
      }
      rejectPromise(new Error(`doctor CLI 未能给出报告（exit ${code ?? "signal"}）${stderr.trim().length > 0 ? `：${stderr.trim().slice(0, 400)}` : ""}`));
    });
  });
}

/**
 * Resolve the commands registry: the provided `commands` service through the
 * optional `ctx.get`, else the plain property (the test seam). Absent means a
 * headless deployment — the row stays a no-op instead of failing the mount.
 *
 * @param ctx - the cordis context the row mounted in.
 * @returns the registry, or undefined when the deployment has no command adapter.
 */
function resolveCommands(ctx: WslDoctorCommandContext): CommandsRegistrySlice | undefined {
  if (typeof ctx.get === "function") {
    const provided = ctx.get("commands");
    if (provided !== undefined && provided !== null && typeof (provided as CommandsRegistrySlice).register === "function") {
      return provided as CommandsRegistrySlice; // the provided service's contract is this module's `register` slice
    }
  }
  return ctx.commands;
}

/**
 * Resolve the distro an invocation targets: the explicit `--distro` wins;
 * otherwise the receiving agent's working directory names a distro when it is
 * a WSL UNC path; otherwise empty — the CLI's effective configuration decides
 * (the shipped preset's `auto` probes every installed distro).
 *
 * @param ctx - the cordis context (for the cwd service).
 * @param invocation - the registry's invocation face.
 * @param distro - the explicitly requested distro, possibly empty.
 * @returns the distro name, possibly empty.
 */
async function resolveDistro(ctx: WslDoctorCommandContext, invocation: WslDoctorCommandInvocation, distro: string): Promise<string> {
  if (distro.length > 0) return distro;
  if (invocation.agent === undefined) return "";
  // The cwd service resolves through `ctx.get` in production (no inject, no
  // proxy throw); the plain property is the test seam's face.
  const cwdService = typeof ctx.get === "function"
    ? (ctx.get("workingDirectory") as WslDoctorCommandContext["workingDirectory"]) // the service's contract is this module's `ensure` slice; narrowed below
    : ctx.workingDirectory;
  if (cwdService === undefined || typeof cwdService.ensure !== "function") return "";
  try {
    const cwd = await cwdService.ensure(invocation.agent, invocation.signal);
    return distroOfUnc(cwd) ?? "";
  } catch {
    // A cwd that cannot resolve (no session, unreadable directory) must not
    // fail the diagnosis: the CLI's own target selection is the fallback.
    return "";
  }
}

/**
 * Format the CLI's JSON report into the itemized text the UI renders — the
 * same digest the `wsl_doctor` tool returns, so both surfaces itemize every
 * check identically.
 *
 * @param json - the CLI's stdout, one versioned JSON report.
 * @param distro - the distro the run named, for the session-distro markers.
 * @returns the rendered report text.
 */
export function formatDoctorReport(json: string, distro: string): string {
  const report = JSON.parse(json) as DoctorReportLike;
  const digest: DoctorDigest = digestReport(report, distro.length > 0 ? distro : undefined);
  return renderDigest(digest);
}

/**
 * Mount the command.
 *
 * @param ctx - the cordis context (the composition root, where the commands
 *   registry and the harness cwd service are reachable).
 */
export async function apply(ctx: WslDoctorCommandContext): Promise<void> {
  const commands = resolveCommands(ctx);
  // No command adapter: nothing to register, nothing to fail. The doctor CLI
  // (`pnpm run doctor`) stays the surface for headless deployments.
  if (commands === undefined) return;
  // The test seam is a plain object: read `doctorCli` only when the cordis
  // property proxy is absent, or the read itself throws ("cannot get property
  // ... without inject") — the same guard the tool module uses for `doctor`.
  const runCli: DoctorCliRunner =
    typeof ctx.get !== "function" && typeof ctx.doctorCli === "function" ? ctx.doctorCli : runDoctorCli;
  commands.register({
    name: "wsl-doctor",
    description: "运行 WSL 环境诊断（独立 doctor CLI）：结果直接显示在此，不进入模型对话。省略参数为快速诊断。",
    input: { hint: "[quick|full|<section>] [--distro <名称>]" },
    handler: async (invocation: WslDoctorCommandInvocation): Promise<WslDoctorCommandResult> => {
      let parsed: ParsedDoctorInput;
      try {
        parsed = parseDoctorInput(invocation.rawInput);
      } catch (error) {
        return { kind: "error", text: `${error instanceof Error ? error.message : String(error)}\n\n${USAGE}` };
      }
      const distro = await resolveDistro(ctx, invocation, parsed.distro);
      const argv = ["--json"];
      if (parsed.mode === "quick") argv.push("--quick");
      if (parsed.mode === "section" && parsed.section !== undefined) argv.push("--sections", parsed.section);
      if (distro.length > 0) argv.push("--distro", distro);
      try {
        const json = await runCli(argv, invocation.signal);
        return { kind: "success", text: formatDoctorReport(json, distro) };
      } catch (error) {
        return { kind: "error", text: `doctor 运行失败：${error instanceof Error ? error.message : String(error)}` };
      }
    },
  });
}
