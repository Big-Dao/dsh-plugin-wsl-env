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
import { mergeAutoPresetSeam } from "./doctor-live.js";

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
interface CommandsRegistrySlice {
  register: (definition: WslDoctorCommandDefinition) => unknown;
}

/** The invocation face the registry hands a handler. */
interface WslDoctorCommandInvocation {
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
interface WslDoctorCommandResult {
  kind: "success" | "error";
  text: string;
}

/** The context slice this service consumes. */
type WslDoctorCommandContext = {
  /** The commands registry, when the deployment has a command adapter. */
  commands?: CommandsRegistrySlice;
  /** The harness's cwd service, used to name the session's distro. */
  workingDirectory?: WorkingDirectorySlice;
  /** Optional cordis-style lookup: how production resolves both without an inject. */
  get?: (name: string) => unknown;
  /** The test seam: a provided CLI runner replaces the real subprocess. */
  doctorCli?: DoctorCliRunner;
};

/** The harness's `workingDirectory` service slice. */
interface WorkingDirectorySlice {
  /** The Session's current directory, recorded synchronously when available. */
  get?: (session: unknown) => string | null | undefined;
  /** Resolve (and repair) the Session's current directory. */
  ensure?: (agent: unknown, signal?: unknown) => Promise<string>;
}

/**
 * The agent face a command invocation carries: its Session (whose header
 * records the cwd the session opened with) and its own cordis context.
 *
 * The `workingDirectory` service is agent-scoped — the tool row injects it
 * inside the agent's preset, and `wsl-cwd-prompt` reads it from `agent.ctx` —
 * so the app-level command row must reach it through the agent, not through
 * its own `ctx.get`. Reading it from the row's context alone silently missed
 * it and left the distro unresolved, which made the doctor fall back to the
 * configuration's `auto` and probe every installed distro (minutes on a
 * machine with several).
 */
interface WslDoctorAgentSlice {
  session?: { header?: { cwd?: string } };
  ctx?: { get?: (name: string) => unknown };
}

/** How long the cwd service may take before the command gives up on it. */
const CWD_SERVICE_TIMEOUT_MS = 5_000;

/**
 * How long a distro-scoped doctor CLI run may take. A scoped quick run takes
 * seconds and a scoped full run ~15 s, so only a stall reaches this; it sits
 * below the command dispatcher's own deadline so the run settles with a
 * message naming what happened instead of the dispatcher's opaque "operation
 * was aborted".
 */
export const DOCTOR_CLI_TIMEOUT_MS = 120_000;

/**
 * How long an UNRESOLVED-target run may take. Without a distro the CLI's
 * effective configuration decides, and the shipped `auto` probes every
 * installed distro — minutes on a machine with several, with no progress to
 * show in the UI. Failing fast with the narrowing hint beats a card that sits
 * "executing" for the dispatcher's whole budget.
 */
export const DOCTOR_CLI_SWEEP_TIMEOUT_MS = 60_000;


/** The CLI runner seam: argv in (node-less — the runner owns the runtime), JSON text out. */
type DoctorCliRunner = (argv: string[], signal?: AbortSignal, timeoutMs?: number) => Promise<string>;

/** The parsed `/wsl-doctor` line. */
interface ParsedDoctorInput {
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
 * The run is bounded by {@link DOCTOR_CLI_TIMEOUT_MS}. Without a deadline a
 * doctor that never reports keeps the command "executing" until the command
 * dispatcher aborts it, and that abort surfaces as an opaque "operation was
 * aborted" that names neither what ran nor how to narrow it.
 *
 * @param argv - flags after the script path (no node, no script — added here).
 * @param signal - the dispatcher's abort signal; abort kills the child.
 * @param timeoutMs - the deadline; tests shrink it to exercise the timeout.
 * @returns the CLI's stdout (one JSON report).
 */
export function runDoctorCli(argv: string[], signal?: AbortSignal, timeoutMs: number = DOCTOR_CLI_TIMEOUT_MS): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [DOCTOR_SCRIPT, ...argv], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      signal,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      finish();
    };
    const deadline = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // Already exited: the close handler settles the run.
      }
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("error", (error) => {
      // An abort arrives here as an AbortError; normalize it so the settled
      // message names the run rather than the DOMException.
      settle(() => rejectPromise((error as NodeJS.ErrnoException).name === "AbortError" ? new Error("doctor CLI 已取消") : error));
    });
    child.on("close", (code, signalName) => {
      const text = stdout.trim();
      if (text.startsWith("{")) {
        settle(() => resolvePromise(text));
        return;
      }
      if (timedOut) {
        settle(() => rejectPromise(new Error(
          `doctor CLI 在 ${timeoutMs / 1000} 秒内没有给出报告；用 --distro <名称> 收窄到单个发行版，或改用 quick / <分区> 重试`,
        )));
        return;
      }
      settle(() => rejectPromise(new Error(`doctor CLI 未能给出报告（exit ${code ?? signalName ?? "signal"}）${stderr.trim().length > 0 ? `：${stderr.trim().slice(0, 400)}` : ""}`)));
    });
  });
}

/**
 * Await a promise for at most `ms` milliseconds, returning undefined when the
 * budget runs out. Used for the cwd service: naming the distro is a
 * convenience, and a stalled resolution must never delay the diagnosis.
 *
 * @param promise - the pending resolution.
 * @param ms - the budget.
 * @returns the value, or undefined when the budget ran out.
 */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), ms); }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
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
 * otherwise the Session's own working directory names a distro when it is a
 * WSL UNC path; otherwise empty — the CLI's effective configuration decides
 * (the shipped preset's `auto` probes every installed distro).
 *
 * The `workingDirectory` service is agent-scoped: the preset's tool row
 * injects it, and `wsl-cwd-prompt` reads it from `agent.ctx`. The app-level
 * command row therefore reaches it through the invocation's agent, not through
 * its own `ctx.get` — reading only the row's context silently missed the
 * service, left the distro unresolved, and turned the run into the
 * configuration's `auto` sweep over every installed distro. The Session
 * header's `cwd` is the service-free fallback: it names the distro the
 * session opened in even when the live value is unreachable.
 *
 * @param ctx - the cordis context (the row's own scope, the last resort).
 * @param invocation - the registry's invocation face.
 * @param distro - the explicitly requested distro, possibly empty.
 * @returns the distro name, possibly empty.
 */
async function resolveDistro(ctx: WslDoctorCommandContext, invocation: WslDoctorCommandInvocation, distro: string): Promise<string> {
  if (distro.length > 0) return distro;
  const agent = invocation.agent as WslDoctorAgentSlice | undefined;
  if (agent === undefined) return "";
  const session = agent.session;
  /** Every candidate service, in the order the resolution tries them. */
  const services: Array<WorkingDirectorySlice | undefined> = [];
  try {
    const scoped = agent.ctx?.get?.("workingDirectory");
    if (scoped !== undefined && scoped !== null) services.push(scoped as WorkingDirectorySlice); // the service's contract is this module's slice
  } catch {
    // A context that refuses the read contributes no service; the header cwd
    // below still names the distro.
  }
  try {
    const rowScoped = typeof ctx.get === "function"
      ? (ctx.get("workingDirectory") as WslDoctorCommandContext["workingDirectory"]) // absent at app scope in production; harmless when present
      : ctx.workingDirectory;
    if (rowScoped !== undefined && rowScoped !== null) services.push(rowScoped);
  } catch {
    // Same reason: the row's context is not where the service lives.
  }
  // The live value first (a mid-session `cd` can move the session to another
  // distro), then the header's own cwd, then the async resolution.
  for (const service of services) {
    try {
      const current = service?.get?.(session);
      const fromCurrent = distroOfUnc(current ?? undefined);
      if (fromCurrent !== undefined) return fromCurrent;
    } catch {
      // A throwing get contributes nothing.
    }
  }
  const fromHeader = distroOfUnc(session?.header?.cwd);
  if (fromHeader !== undefined) return fromHeader;
  for (const service of services) {
    if (typeof service?.ensure !== "function") continue;
    let pending: Promise<string> | undefined;
    try {
      pending = service.ensure(agent, invocation.signal);
    } catch {
      // A synchronous throw is a failed resolution, never a failed command.
      continue;
    }
    const resolved = await within(pending, CWD_SERVICE_TIMEOUT_MS);
    const fromService = distroOfUnc(resolved);
    if (fromService !== undefined) return fromService;
  }
  return "";
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
  const digest: DoctorDigest = digestReport(mergeAutoPresetSeam(report), distro.length > 0 ? distro : undefined);
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
  // The test seam is a plain object: `doctorCli`, when the context carries it,
  // replaces the subprocess. Reading it may throw under the cordis property
  // proxy ("cannot get property ... without inject"), so the read is guarded —
  // the same shape the tool module uses for its optional `doctor`.
  const runCli: DoctorCliRunner = (() => {
    try {
      if (typeof ctx.doctorCli === "function") return ctx.doctorCli;
    } catch {
      // Production: the row's context has no such property.
    }
    return runDoctorCli;
  })();
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
      // A resolved target is one distro and finishes in seconds; an unresolved
      // one hands the choice to the configuration, whose `auto` sweeps every
      // installed distro — bounded tightly so it cannot sit "executing".
      const budget = distro.length > 0 ? DOCTOR_CLI_TIMEOUT_MS : DOCTOR_CLI_SWEEP_TIMEOUT_MS;
      try {
        const json = await runCli(argv, invocation.signal, budget);
        return { kind: "success", text: formatDoctorReport(json, distro) };
      } catch (error) {
        const target = distro.length > 0
          ? `发行版 ${distro}`
          : "配置指定的目标（未从会话工作目录解析出发行版，auto 会逐个检查所有已安装发行版）";
        return { kind: "error", text: `doctor 运行失败（${target}）：${error instanceof Error ? error.message : String(error)}` };
      }
    },
  });
}
