/**
 * The integration layer of `lib/index.js` — the guard chain and the agent
 * execution path — against the REAL classes with instance-level substitutes
 * for everything that would reach `wsl.exe` or a distro.
 *
 * The module doc in `test/syntax.mjs` used to excuse this file's absence:
 * "they import DSH peers that a bare checkout does not have". That stopped
 * being true when the peers landed in devDependencies (0.4.0) and CI began
 * installing them; the composition layer is also where two real bugs lived
 * (a RES field dropped between units, a composition shadowing upstream
 * rows), so it is exactly where tests pay.
 *
 * What is NOT here: anything that must spawn `wsl.exe`. The agent, the
 * substrate and the confinement are fakes at the seam; the real transport
 * is `test/probe/`'s business.
 *
 *   node test/provider.test.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { FsError, FsTargetKey } from "@deepseek-ai/dsh-fs";
import { SandboxUnavailableError } from "@deepseek-ai/dsh-sandbox";
import { WslShellExecutor, WslFileSystem } from "../lib/index.js";
import { FsCodedError } from "../lib/fsio-text.js";
import { WslAgent } from "../lib/agent.js";

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

const DISTRO = "ubuntu";
const WORKSPACE = "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj";

/** @typedef {Parameters<WslShellExecutor["execute"]>[0]} ShellExecSpec */
/** @typedef {Awaited<ReturnType<WslShellExecutor["execute"]>>} ShellExecution */
/** @typedef {Parameters<WslAgent["exec"]>[0]} AgentFrame */
/** @typedef {{ exec: WslAgent["exec"] }} ScriptedAgent */

/**
 * The spec shape these checks hand to `execute`/`withDefaultWorkdir`: the
 * fields under test. The executor's declared contract is the RESOLVED spec
 * (`onExpiry`/`stdoutMaxBytes` are `resolve()`'s to fill); several checks
 * deliberately pin `execute`'s own defaulting of an unresolved request, so
 * they cannot call `resolve()` first. One bridge keeps that intent visible.
 * @param {{ command: string, workdir: string, timeoutMs?: number, relativeWorkdir?: string, signal?: AbortSignal, env?: Record<string, string>, sandboxPolicy?: { mode: "read-only"|"workspace-write"|"danger-full-access", workspaceRoot: string } }} request - the fields under test.
 * @returns {Parameters<WslShellExecutor["withDefaultWorkdir"]>[0]} the same object, in the resolved-spec parameter type.
 */
const spec = (request) => /** @type {Parameters<WslShellExecutor["withDefaultWorkdir"]>[0]} */ (/** @type {unknown} */ (request));

/**
 * Presents a scripted frame-runner as the resident `WslAgent` the seam
 * returns; the real class carries protocol state these checks never drive.
 * @param {ScriptedAgent} fake - the scripted runner.
 * @returns {WslAgent} the same object, as the seam's declared agent type.
 */
const asAgent = (fake) => /** @type {WslAgent} */ (fake);

/**
 * The scripted substrate: `resolve` answers every Linux coordinate, and each
 * delegated method is scripted per check (the two delegation checks drive
 * them by name, see `methodTable`).
 * @typedef {object} MockSubstrate
 * @property {string[]} resolveCalls - the Linux coordinates `resolve` was handed.
 * @property {(linuxPath: string) => Promise<{ displayPath: string, targetKey: FsTargetKey }>} resolve
 * @property {(target: { displayPath: string }) => Promise<{ version: string, operation?: string }>} [writeText] - scripted by the fence check.
 */

/**
 * A by-name view of a mock's methods: the delegation checks script one method
 * per name and then call the provider's same-named route, which no static
 * interface can index.
 * @param {unknown} mock - the object whose methods are driven by name.
 * @returns {Record<string, (...args: unknown[]) => Promise<unknown>>} its methods.
 */
const methodTable = (mock) => /** @type {Record<string, (...args: unknown[]) => Promise<unknown>>} */ (mock);

/**
 * A sandbox core stand-in whose only live verdict is `usable`.
 * @param {boolean} verdict - what `usable` resolves to.
 * @returns {WslFileSystem["sandbox"]} the stub, as the property's declared core.
 */
const coreStub = (verdict) => /** @type {WslFileSystem["sandbox"]} */ (/** @type {unknown} */ ({ usable: async () => verdict }));

/**
 * The sandbox facts the executor stamps at settlement: the upstream
 * `ShellSandboxInfo` plus this plugin's `windowsDrive` mitigation flag, which
 * the upstream result type cannot describe.
 * @typedef {{ mode?: string, denied?: boolean, enforcement?: string, windowsDrive?: "masked"|"visible" }} WslSandboxFacts
 */

/**
 * Reads one settled result's sandbox facts through the WSL view.
 * @param {{ sandbox?: unknown }} result - a settled run result.
 * @returns {WslSandboxFacts | undefined} its sandbox facts, WSL-decorated.
 */
const factsOf = (result) => /** @type {WslSandboxFacts | undefined} */ (result.sandbox);

/**
 * The protected one-shot spawn seam, viewed for substitution: these checks
 * replace the spawn step with a scripted handle. `argvBuilder` is the prepare
 * form, the only form the checks use.
 * @typedef {object} OneShotSeam
 * @property {(resolved: ShellExecSpec, argvBuilder: (signal: AbortSignal) => Promise<readonly string[]>, onStarted?: (process: ShellExecution) => void) => Promise<ShellExecution>} executeArgv
 */

/**
 * Views an executor through the protected spawn seam.
 * @param {WslShellExecutor} executor - the executor to script.
 * @returns {OneShotSeam} the writable seam.
 */
const spawnView = (executor) => /** @type {OneShotSeam} */ (/** @type {unknown} */ (executor));

/**
 * A filesystem provider over a fake substrate; the agent never spawns.
 * @param {{ sandbox?: boolean, restrictToDistro?: boolean, policy?: { mode: "read-only"|"workspace-write"|"danger-full-access", workspaceRoot: string } }} [options] - the provider switches and the policy the fake resolves.
 * @returns {{ fs: WslFileSystem, substrate: MockSubstrate }} the provider and its scripted substrate.
 */
function makeFs({ sandbox = true, restrictToDistro = true, policy } = {}) {
  const resolved = policy ?? { mode: "workspace-write", workspaceRoot: WORKSPACE };
  const ctx = new Context();
  ctx.provide("sandboxPolicy", { defaultMode: resolved.mode, resolve: () => resolved });
  const fs = new WslFileSystem(ctx, WslFileSystem.Config({
    distro: DISTRO,
    sandbox,
    restrictToDistro,
  }));
  /** @type {MockSubstrate} */
  const substrate = {
    resolveCalls: [],
    resolve: async (linuxPath) => {
      substrate.resolveCalls.push(linuxPath);
      return { displayPath: linuxPath, targetKey: FsTargetKey(`\\\\wsl.localhost\\${DISTRO}${linuxPath.replaceAll("/", "\\")}`) };
    },
  };
  fs.agentSubstrate = async () => /** @type {Awaited<ReturnType<WslFileSystem["agentSubstrate"]>>} */ (/** @type {unknown} */ (substrate));
  return { fs, substrate };
}

/**
 * An executor whose agent and confinement are fakes at the seam.
 * @param {{ sandbox?: boolean }} [options] - the executor switch.
 * @returns {{ executor: WslShellExecutor, agent: ScriptedAgent, agentCalls: AgentFrame[] }} the executor, its scripted frame-runner, and every frame it saw.
 */
function makeExecutor({ sandbox = true } = {}) {
  const policy = { mode: "workspace-write", workspaceRoot: WORKSPACE };
  const ctx = new Context();
  ctx.provide("sandboxPolicy", { defaultMode: policy.mode, resolve: () => policy });
  const executor = new WslShellExecutor(ctx, WslShellExecutor.Config({
    distro: DISTRO,
    shell: "/bin/zsh",
    sandbox,
    agent: true,
  }));
  /** @type {AgentFrame[]} */
  const agentCalls = [];
  /** @type {ScriptedAgent} */
  const agent = {
    exec: async ({ cwd, argv, timeoutMs, maxOutputBytes }) => {
      agentCalls.push({ cwd, argv, timeoutMs, maxOutputBytes });
      return { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), truncated: { stdout: false, stderr: false } };
    },
  };
  executor.executionAgent = () => asAgent(agent);
  /**
   * The mounted core, scripted: `confine` wraps in a marker profile and records
   * every policy it was handed. `enforcement: "full"` deliberately differs from
   * the real core's constant, so a hardcoded `partial` would fail this fake; the
   * real core's probe/path surface is unused by these checks.
   * @typedef {object} ScriptedCore
   * @property {Array<{ mode: string, workspaceRoot: string }>} confineCalls - every policy the fake was handed.
   * @property {(argv: string[], policy: { mode: string, workspaceRoot: string }) => Promise<{ argv: string[], enforcement: "full", denialSignatures: string[], runnerFailureRules: Array<{ fatalSignatures: string[] }>, windowsDrive: "visible" }>} confine
   */
  /** @type {ScriptedCore} */
  const sandboxCore = {
    confineCalls: [],
    async confine(argv, policyObject) {
      this.confineCalls.push(policyObject);
      return {
        argv: ["/usr/bin/bwrap", "--ro-bind / /", "--", ...argv],
        enforcement: "full",
        denialSignatures: ["operation not permitted"],
        runnerFailureRules: [],
        windowsDrive: "visible",
      };
    },
  };
  executor.sandbox = /** @type {WslShellExecutor["sandbox"]} */ (/** @type {unknown} */ (sandboxCore));
  return { executor, agent, agentCalls };
}

// --- the filesystem guard chain -------------------------------------------

check("sandboxMode reports the policy while the sandbox is on, undefined when off", () => {
  const on = makeFs({ sandbox: true });
  assert.equal(on.fs.sandboxMode, "workspace-write");
  const off = makeFs({ sandbox: false });
  assert.equal(off.fs.sandboxMode, undefined);
});

check("the real agentSubstrate wiring builds over the shared agent and keeps stage-two routing", async () => {
  const { fs } = makeFs();
  delete (/** @type {{ agentSubstrate?: unknown }} */ (/** @type {unknown} */ (fs))).agentSubstrate; // undo the test override: exercise the REAL wiring
  const substrate = await fs.agentSubstrate();
  assert.ok(substrate, "the substrate constructs lazily over the shared agent (no spawn until used)");
  assert.equal(await fs.agentSubstrate(), substrate, "the wiring is memoized: one substrate per provider");
  // The confined routing through the REAL wiring, with only the bwrap probe
  // substituted (its probe needs a live wsl.exe).
  fs.sandbox = coreStub(true);
  const same = await fs.mutationAgent({ mode: "workspace-write", workspaceRoot: WORKSPACE });
  assert.ok(same.argvPrefix.length > 0, "mutations route to the confined resident through the same wiring");
});

check("worldPath mints the pinned distro's UNC for a Linux path", async () => {
  const { fs } = makeFs();
  assert.equal(await fs.worldPath("/home/andy/proj/a.ts"), "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj\\a.ts");
});

check("another distro's UNC is refused as a configuration fence, not a denial", async () => {
  const { fs } = makeFs();
  await assert.rejects(
    () => fs.worldPath("\\\\wsl.localhost\\debian\\etc\\hostname"),
    (error) => /** @type {{ code?: string }} */ (error).code === "FS_OUTSIDE_DISTRO" && !(error instanceof FsError === false),
  );
  try {
    await fs.worldPath("\\\\wsl.localhost\\debian\\etc\\hostname");
  } catch (error) {
    assert.equal(/** @type {{ code?: string }} */ (error).code, "FS_OUTSIDE_DISTRO", "no wider permission lifts this: it is not FS_SANDBOX_DENIED");
  }
});

check("restrictToDistro: false lets the foreign UNC through", async () => {
  const { fs } = makeFs({ restrictToDistro: false });
  assert.equal(await fs.worldPath("\\\\wsl.localhost\\debian\\etc\\hostname"), "\\\\wsl.localhost\\debian\\etc\\hostname");
});

check("resolve routes the Linux spelling to the substrate and maps its refusals", async () => {
  const { fs, substrate } = makeFs();
  const target = await fs.resolve("/home/andy/proj");
  assert.deepEqual(substrate.resolveCalls, ["/home/andy/proj"], "the substrate receives the distro coordinate");
  assert.equal(target.displayPath, "/home/andy/proj");
  substrate.resolve = async () => {
    throw new FsCodedError(`cannot list "/gone": not found`, "FS_NOT_FOUND");
  };
  await assert.rejects(() => fs.resolve("/gone"), (error) => /** @type {{ code?: string }} */ (error).code === "FS_NOT_FOUND", "the peer dialect is preserved");
});

check("checkedTarget passes the target through untouched when the sandbox is off", async () => {
  const { fs, substrate } = makeFs({ sandbox: false });
  const target = { displayPath: "/etc/shadow", targetKey: FsTargetKey("\\\\wsl.localhost\\ubuntu\\etc\\shadow") };
  const out = await fs.checkedTarget(target, { mode: "read-only", workspaceRoot: WORKSPACE });
  assert.equal(out, target);
  assert.deepEqual(substrate.resolveCalls, [], "no policy machinery ran");
});

check("read-only denies a mutation outright; danger-full-access is the approved escalation", async () => {
  const { fs } = makeFs();
  const target = { displayPath: "/home/andy/proj/a.ts", targetKey: FsTargetKey(`${WORKSPACE}\\a.ts`) };
  await assert.rejects(
    () => fs.checkedTarget(target, { mode: "read-only", workspaceRoot: WORKSPACE }),
    (error) => /** @type {{ code?: string }} */ (error).code === "FS_SANDBOX_DENIED",
  );
  const out = await fs.checkedTarget(target, { mode: "danger-full-access", workspaceRoot: WORKSPACE });
  assert.equal(out, target, "the escalation is not fenced");
});

check("workspace-write re-resolves and accepts a target under the workspace root", async () => {
  const { fs, substrate } = makeFs();
  const target = { displayPath: "/home/andy/proj/a.ts", targetKey: FsTargetKey(`${WORKSPACE}\\a.ts`) };
  const fresh = await fs.checkedTarget(target, { mode: "workspace-write", workspaceRoot: WORKSPACE });
  assert.deepEqual(substrate.resolveCalls, ["/home/andy/proj/a.ts"], "the re-resolve is the check: the identity checked is the identity mutated");
  assert.equal(fresh.displayPath, "/home/andy/proj/a.ts");
});

check("workspace-write refuses a target outside every writable root", async () => {
  const { fs, substrate } = makeFs();
  substrate.resolve = async (linuxPath) => ({
    displayPath: linuxPath,
    targetKey: FsTargetKey(`\\\\wsl.localhost\\${DISTRO}${linuxPath.replaceAll("/", "\\")}`),
  });
  const target = { displayPath: "/etc/passwd", targetKey: FsTargetKey("\\\\wsl.localhost\\ubuntu\\etc\\passwd") };
  await assert.rejects(
    () => fs.checkedTarget(target, { mode: "workspace-write", workspaceRoot: WORKSPACE }),
    (error) => /** @type {{ code?: string }} */ (error).code === "FS_SANDBOX_DENIED",
  );
});

check("peerError preserves the coded dialect and downgrades agent loss to I/O", () => {
  const { fs } = makeFs();
  const coded = fs.peerError(new FsCodedError("cannot write \"/x\": stale", "FS_STALE_VERSION"));
  assert.equal(coded.code, "FS_STALE_VERSION");
  assert.ok(coded.cause instanceof FsCodedError);
  const lost = fs.peerError(new SandboxUnavailableError("workspace-write", "bwrap missing"));
  assert.equal(lost.code, "FS_IO_ERROR");
  const out = fs.peerError(new Error("agent exited again; falling back permanently"));
  assert.equal(out.code, "FS_IO_ERROR", "an agent that is out reads as the substrate's I/O error");
});

check("the read and write delegations ride the substrate and map refusals", async () => {
  const { fs, substrate } = makeFs();
  const target = { displayPath: "/home/andy/proj/a.ts", targetKey: FsTargetKey(`${WORKSPACE}\\a.ts`) };
  /** @type {string[]} */
  const calls = [];
  const substrateMethods = methodTable(substrate);
  const fsMethods = methodTable(fs);
  /** @type {Array<[string, () => Promise<unknown>, unknown[]]>} */
  const delegations = [
    ["stat", async () => ({ type: "file", version: "v1" }), [target]],
    ["lstat", async () => ({ type: "file" }), ["/home/andy/proj/a.ts"]],
    ["readText", async () => "text", [target]],
    ["streamText", async () => ({ [Symbol.asyncIterator]: function* () {} }), [target]],
    ["readBytes", async () => new Uint8Array(0), [target, undefined, 1024]],
    ["readByteRange", async () => new Uint8Array(0), [target, { offset: 0, length: 4 }]],
    ["listDir", async () => [], [target]],
    ["writeText", async () => ({ version: "v2" }), [target, "content", undefined]],
    ["editText", async () => ({ version: "v3" }), [target, { oldString: "a", newString: "b" }, undefined]],
  ];
  for (const [name, stub, args] of delegations) {
    substrateMethods[name] = async () => {
      calls.push(name);
      return stub();
    };
    await fsMethods[name](...args);
  }
  assert.deepEqual(calls, ["stat", "lstat", "readText", "streamText", "readBytes", "readByteRange", "listDir", "writeText", "editText"]);
  // A refusal from the substrate surfaces in the peer dialect, on EVERY route:
  // each catch is its own mapping branch, and one lost mapping is the
  // RES-field bug class that lived here before.
  /** @type {Array<[string, unknown[]]>} */
  const refusals = [
    ["stat", [target]],
    ["lstat", ["/home/andy/proj/a.ts"]],
    ["readText", [target]],
    ["streamText", [target]],
    ["readBytes", [target, undefined, 1024]],
    ["readByteRange", [target, { offset: 0, length: 4 }]],
    ["listDir", [target]],
    ["writeText", [target, "content", undefined]],
    ["editText", [target, { oldString: "a", newString: "b" }, undefined]],
  ];
  for (const [name, refusalArgs] of refusals) {
    substrateMethods[name] = async () => {
      throw new FsCodedError(`cannot ${name} "/x": stale`, "FS_STALE_VERSION");
    };
    await assert.rejects(() => fsMethods[name](...refusalArgs), (error) => /** @type {{ code?: string }} */ (error).code === "FS_STALE_VERSION", `${name} maps refusals`);
  }
});

check("writeText fences the mutation through checkedTarget before publishing", async () => {
  const { fs, substrate } = makeFs();
  substrate.writeText = async (fenced) => {
    assert.equal(fenced.displayPath, "/home/andy/proj/a.ts", "the checked identity is the mutated identity");
    return { version: "v2", operation: "update" };
  };
  const target = { displayPath: "/home/andy/proj/a.ts", targetKey: FsTargetKey(`${WORKSPACE}\\a.ts`) };
  const outcome = await fs.writeText(target, "content", undefined, undefined, { mode: "workspace-write", workspaceRoot: WORKSPACE });
  assert.equal(outcome.version, "v2");
  // A read-only policy denies before the substrate is ever reached.
  substrate.writeText = async () => {
    throw new Error("must not be reached");
  };
  await assert.rejects(
    () => fs.writeText(target, "content", undefined, undefined, { mode: "read-only", workspaceRoot: WORKSPACE }),
    (error) => /** @type {{ code?: string }} */ (error).code === "FS_SANDBOX_DENIED",
  );
});

check("watch refuses a target that is not a distro path before arming", async () => {
  const { fs } = makeFs();
  await assert.rejects(
    () => fs.watch({ displayPath: "C:\\x", targetKey: FsTargetKey("C:\\x") }, () => {}, new AbortController().signal),
    (error) => /** @type {{ code?: string }} */ (error).code === "FS_IO_ERROR",
  );
});

check("a confined mutation without bwrap refuses with the bootstrap remedy", async () => {
  const { fs } = makeFs();
  fs.sandbox = coreStub(false);
  await assert.rejects(
    () => fs.mutationAgent({ mode: "workspace-write", workspaceRoot: WORKSPACE }),
    (error) => error instanceof SandboxUnavailableError,
  );
  try {
    await fs.mutationAgent({ mode: "workspace-write", workspaceRoot: WORKSPACE });
  } catch (error) {
    assert.match(/** @type {Error} */ (error).message, /bootstrap\.sh/, "the message carries the install command");
  }
});

check("a confined mutation with bwrap addresses the confined resident; escalation does not", async () => {
  const { fs } = makeFs();
  fs.sandbox = coreStub(true);
  const confined = await fs.mutationAgent({ mode: "workspace-write", workspaceRoot: WORKSPACE });
  assert.ok(confined instanceof WslAgent);
  assert.ok(confined.argvPrefix.length > 0, "the confined resident's whole lifetime runs inside the profile");
  const plain = await fs.mutationAgent({ mode: "danger-full-access", workspaceRoot: WORKSPACE });
  assert.equal(plain.argvPrefix.length, 0, "an escalated write means the plain resident");
});

// --- the executor's agent path ---------------------------------------------

check("the executor reports its mode through sandboxMode", () => {
  assert.equal(makeExecutor({ sandbox: true }).executor.sandboxMode, "workspace-write");
  assert.equal(makeExecutor({ sandbox: false }).executor.sandboxMode, undefined);
});

check("a configured shell is cached; a failed probe is retried, not pinned", async () => {
  const { executor } = makeExecutor();
  assert.equal(await executor.shell(), "/bin/zsh");
  assert.equal(executor.resolvedShell, "/bin/zsh");
  // Empty config with both probes failing (a wslPath that cannot spawn):
  // the answer must be the per-call fallback, and the cache must stay empty
  // so a later call — a warm distro, a fixed path — resolves the real shell.
  const ctx = new Context();
  ctx.provide("sandboxPolicy", { defaultMode: "workspace-write", resolve: () => ({ mode: "workspace-write", workspaceRoot: WORKSPACE }) });
  const retrying = new WslShellExecutor(ctx, WslShellExecutor.Config({
    distro: DISTRO,
    shell: "",
    sandbox: true,
    agent: true,
    wslPath: "definitely-not-wsl.exe",
  }));
  assert.equal(await retrying.shell(), "bash", "the fallback answers per call");
  assert.equal(retrying.resolvedShell.length, 0, "the placeholder is not cached: the next call retries");
});

check("shellName strips the shell to its model-facing basename; an exotic name falls back to bash", async () => {
  const { executor } = makeExecutor();
  assert.equal(await executor.shellName(), "zsh", "a zsh distro is never presented as bash");
  executor.resolvedShell = "/usr/bin/weird.shell";
  assert.equal(await executor.shellName(), "bash", "a name outside the POSIX alphabet reads as bash");
});

check("linuxOf falls back to the display spelling when the identity is not a distro path", () => {
  const { fs } = makeFs();
  assert.equal(fs.linuxOf({ displayPath: "/home/andy/proj/x", targetKey: FsTargetKey(`${WORKSPACE}\\x`) }), "/home/andy/proj/x");
  assert.equal(fs.linuxOf({ displayPath: "C:\\x", targetKey: FsTargetKey("C:\\x") }), "C:\\x", "the fallback keeps the display form");
});

check("a caller abort rejects as cancellation, not as the command's failure", async () => {
  const { executor } = makeExecutor();
  const controller = new AbortController();
  controller.abort(new Error("caller cancelled"));
  executor.executionAgent = () => asAgent({
    exec: async ({ signal }) => {
      assert.equal(signal?.aborted, true, "the abort reaches the agent frame's signal");
      throw controller.signal.reason;
    },
  });
  await assert.rejects(
    () => executor.execute(spec({ command: "echo hi", workdir: WORKSPACE, timeoutMs: 5000, signal: controller.signal })).then((e) => e.result()),
    /caller cancelled/,
  );
});

check("the executor's executionAgent hands back the distro's shared agent", () => {
  const { executor } = makeExecutor();
  delete (/** @type {{ executionAgent?: unknown }} */ (/** @type {unknown} */ (executor))).executionAgent; // undo the test fake: exercise the real wiring
  const agent = executor.executionAgent(DISTRO);
  assert.equal(agent, executor.executionAgent(DISTRO), "the shared singleton, keyed by distro");
  assert.equal(agent.argvPrefix.length, 0, "the plain resident carries no confinement prefix");
});

check("resolve stamps the home marker and the per-call policy", () => {
  const { executor } = makeExecutor();
  const resolved = executor.resolve({ command: "ls", sandboxPolicy: { mode: "workspace-write", workspaceRoot: WORKSPACE } });
  assert.equal(resolved.command, "ls");
  assert.equal(resolved.workdir, "", "no workdir means the distro home, resolved at execute time");
  assert.equal(resolved.sandboxPolicy?.mode, "workspace-write");
});

check("withDefaultWorkdir joins the relative tail under the resolved home", async () => {
  const { executor } = makeExecutor();
  executor.resolvedHome = "/home/andy";
  const joined = await executor.withDefaultWorkdir(spec({ command: "ls", workdir: "", relativeWorkdir: "proj" }));
  assert.equal(joined.workdir, "/home/andy/proj");
  const kept = await executor.withDefaultWorkdir(spec({ command: "ls", workdir: "/opt" }));
  assert.equal(kept.workdir, "/opt", "an absolute workdir never consults the home");
});

check("a confined agent command runs the confined argv in the distro coordinate", async () => {
  const { executor, agentCalls } = makeExecutor();
  const execution = await executor.execute(spec({
    command: "echo hi",
    workdir: WORKSPACE,
    timeoutMs: 5000,
    sandboxPolicy: { mode: "workspace-write", workspaceRoot: WORKSPACE },
  }));
  const result = await execution.result();
  assert.equal(result.exitCode, 0);
  assert.equal(agentCalls[0].cwd, "/home/andy/proj", "the UNC never reaches chdir — the agent carries the Linux path");
  assert.equal(agentCalls[0].argv[0], "/usr/bin/bwrap", "the confined argv runs, not the raw shell line");
  assert.deepEqual(factsOf(result), { mode: "workspace-write", denied: false, enforcement: "full", windowsDrive: "visible" });
});

check("the agent frame carries the resolved maxOutputBytes, not the volatile wrapper", async () => {
  const { executor, agentCalls } = makeExecutor();
  // The schema hands volatile fields out as `{ get, set }` wrappers (upstream's
  // Config types them as `Volatile<number>`). A frame carrying the wrapper made
  // `encodeExecFrame`'s `> 0` test false, and 0 is the agent's "uncapped" — the
  // documented cut at the caller's budget silently never ran.
  const budget = executor.config.maxOutputBytes;
  assert.equal(typeof budget.get, "function", "precondition: the field arrives as a volatile wrapper");
  await executor.execute(spec({
    command: "echo hi",
    workdir: WORKSPACE,
    timeoutMs: 5000,
    sandboxPolicy: { mode: "workspace-write", workspaceRoot: WORKSPACE },
  }));
  assert.equal(typeof agentCalls[0].maxOutputBytes, "number", "the frame carries a number, not the wrapper");
  assert.equal(agentCalls[0].maxOutputBytes, budget.get(), "and it is the configured budget, resolved");
});

check("a denial signature on a confined failure reports denied: true", async () => {
  const { executor } = makeExecutor();
  (/** @type {NonNullable<WslShellExecutor["sandbox"]>} */ (executor.sandbox)).confine = async (argv) => ({
    argv,
    enforcement: "full",
    denialSignatures: ["read-only file system"],
    runnerFailureRules: [],
    windowsDrive: "masked",
  });
  executor.executionAgent = () => asAgent({ exec: async () => ({ exitCode: 1, stdout: Buffer.alloc(0), stderr: Buffer.from("touch: cannot touch: Read-Only File System"), truncated: { stdout: false, stderr: false } }) });
  const execution = await executor.execute(spec({
    command: "touch /x",
    workdir: WORKSPACE,
    timeoutMs: 5000,
    sandboxPolicy: { mode: "read-only", workspaceRoot: WORKSPACE },
  }));
  const result = await execution.result();
  assert.equal(factsOf(result)?.denied, true);
  assert.equal(factsOf(result)?.windowsDrive, "masked");
});

check("danger-full-access runs unconfined and says so in the sandbox fact", async () => {
  const { executor, agentCalls } = makeExecutor();
  const execution = await executor.execute(spec({
    command: "echo hi",
    workdir: WORKSPACE,
    timeoutMs: 5000,
    sandboxPolicy: { mode: "danger-full-access", workspaceRoot: WORKSPACE },
  }));
  const result = await execution.result();
  assert.equal(agentCalls[0].argv[0], "/bin/zsh", "no bwrap prefix on the escalated run");
  assert.deepEqual(factsOf(result), { mode: "danger-full-access", denied: false });
});

check("distroArgv and argv compose the verbatim one-shot launch", () => {
  const { executor } = makeExecutor();
  const request = spec({ command: "x=1; echo \"$x\"", workdir: WORKSPACE });
  assert.deepEqual(executor.distroArgv(request, "/bin/zsh"), ["/bin/zsh", "-lc", "x=1; echo \"$x\""]);
  const argv = executor.argv(request, DISTRO, "/bin/zsh");
  assert.equal(argv[0], "wsl.exe");
  assert.deepEqual(argv.slice(1, 6), ["-d", DISTRO, "--cd", "/home/andy/proj", "--exec"]);
  assert.deepEqual(argv.slice(6), ["/bin/zsh", "-lc", "x=1; echo \"$x\""], "the command rides as one argv element: no second parse");
});

check("a workdir in another distro is refused before anything runs", async () => {
  const { executor, agentCalls } = makeExecutor();
  await assert.rejects(
    () => executor.execute(spec({ command: "ls", workdir: WORKSPACE.replace("ubuntu", "debian"), timeoutMs: 5000 })),
    /names a workspace in another WSL distro/,
  );
  assert.deepEqual(agentCalls, [], "the refusal precedes the agent");
});

check("the one-shot path runs the plain wsl.exe argv and decorates the same facts", async () => {
  const { executor } = makeExecutor();
  /** @type {Array<{ workdir: string, argv: readonly string[] }>} */
  const specs = [];
  spawnView(executor).executeArgv = async (resolved, argvBuilder, onProcess) => {
    const argv = await argvBuilder(new AbortController().signal);
    specs.push({ workdir: resolved.workdir, argv });
    // The confined one-shot stamps its per-process facts through this callback.
    if (onProcess) {
      const proc = /** @type {ShellExecution} */ (/** @type {unknown} */ ({ exitCode: 1 }));
      onProcess(proc);
      assert.equal(executor.processFacts.size, 1, "the confined one-shot stamps before settlement");
      executor.onProcessDone(proc, "denied: Operation not permitted", false, undefined);
      assert.equal(/** @type {WslSandboxFacts | undefined} */ (proc.sandbox)?.denied, true, "the background projection reads the stamp");
      assert.equal(executor.processFacts.size, 0);
    }
    return /** @type {ShellExecution} */ (/** @type {unknown} */ ({
      result: async () => ({ exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 5, stdout: { text: "", lossy: false, truncated: false }, stderr: { text: "", lossy: false, truncated: false } }),
    }));
  };
  /** @type {{ agent?: boolean }} */ (/** @type {unknown} */ (executor.config)).agent = false;
  const execution = await executor.execute(spec({
    command: "echo hi",
    workdir: WORKSPACE,
    timeoutMs: 5000,
    sandboxPolicy: { mode: "workspace-write", workspaceRoot: WORKSPACE },
  }));
  const result = await execution.result();
  assert.equal(result.exitCode, 0);
  assert.equal(specs[0].argv[0], "wsl.exe", "the one-shot path spawns wsl.exe");
  assert.equal(specs[0].argv[5], "--exec");
  assert.equal(specs[0].argv[6], "/usr/bin/bwrap", "confined here too");
  assert.deepEqual(factsOf(result), { mode: "workspace-write", denied: false, enforcement: "full", windowsDrive: "visible" });
});

check("an agent that is out falls back to the one-shot path, which is the point of the fallback", async () => {
  const { executor } = makeExecutor();
  const { AgentUnavailableError } = await import("../lib/agent-errors.js");
  executor.executionAgent = () => {
    throw new AgentUnavailableError("agent exited again; falling back permanently");
  };
  /** @type {Array<readonly string[]>} */
  const oneShots = [];
  spawnView(executor).executeArgv = async (resolved, argvBuilder) => {
    oneShots.push(await argvBuilder(new AbortController().signal));
    return /** @type {ShellExecution} */ (/** @type {unknown} */ ({
      result: async () => ({ exitCode: 0, signal: null, timedOut: false, aborted: false, timeoutMs: 5, stdout: { text: "", lossy: false, truncated: false }, stderr: { text: "", lossy: false, truncated: false } }),
    }));
  };
  const execution = await executor.execute(spec({ command: "echo hi", workdir: WORKSPACE, timeoutMs: 5000 }));
  const result = await execution.result();
  assert.equal(result.exitCode, 0);
  assert.equal(oneShots[0][0], "wsl.exe", "the fallback ran one-shot");
  assert.equal(oneShots[0][6], "/bin/zsh", "unconfined on the fallback: the escalation was not granted silently");
  assert.equal(factsOf(result), undefined, "the plain fallback is unfenced and says so: no sandbox fact");
});

check("spawnSpec pins the host cwd, WSL_UTF8, and the managed WSLENV translation", () => {
  const { executor } = makeExecutor();
  // The mounted config wraps volatile fields in getters; a direct construction
  // skips that, so the test supplies the same shape.
  const config = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (executor.config));
  for (const key of ["maxSpillBytes", "maxOutputBytes", "timeoutMs", "hostCwd"]) {
    config[key] = { get: () => (key === "hostCwd" ? "C:\\Windows" : 1024) };
  }
  // `spawnSpec` reads only `workdir`/`env` here; its declared parameter is the
  // resolved spec, whose other fields this check deliberately omits.
  const spawnRequest = /** @type {ShellExecSpec} */ (/** @type {unknown} */ ({ workdir: WORKSPACE, env: { DSH_HOME: "C:\\Users\\x" } }));
  const specified = executor.spawnSpec(spawnRequest, ["wsl.exe", "-d", DISTRO], 4096, new AbortController().signal);
  assert.equal(specified.cwd, "C:\\Windows", "the spawn starts on Windows, not in the Linux workdir");
  assert.equal(specified.env?.WSL_UTF8, "1", "UTF-8 diagnostics are load-bearing for the WSL_E reader");
  assert.equal(
    specified.env?.WSLENV,
    "NO_COLOR:TERM:PAGER:GIT_PAGER:DSH_HOME/p",
    "the base's passthrough names ride first; the managed fact carries its path flag",
  );
  assert.equal(specified.env?.DSH_HOME, "C:\\Users\\x", "the value itself travels untouched");
});

check("a confined background process carries the sandbox facts of its policy", async () => {
  const { executor } = makeExecutor();
  await executor.execute(spec({
    command: "server",
    workdir: WORKSPACE,
    timeoutMs: 5000,
    sandboxPolicy: { mode: "workspace-write", workspaceRoot: WORKSPACE },
  })).then((e) => e.result());
  // The handle's onStarted stamped one process; settle it with a denial-
  // matching stderr and read the stamp the background projection carries.
  assert.equal(executor.processFacts.size, 1, "the stamp lives until settlement");
  const [proc] = executor.processFacts.keys();
  proc.exitCode = 1;
  executor.onProcessDone(proc, "touch: Operation not permitted", false, undefined);
  assert.equal(executor.processFacts.size, 0, "settled facts are deleted, not accumulated");
  const facts = /** @type {WslSandboxFacts | undefined} */ (proc.sandbox);
  assert.deepEqual(
    { mode: facts?.mode, denied: facts?.denied, enforcement: facts?.enforcement, windowsDrive: facts?.windowsDrive },
    { mode: "workspace-write", denied: true, enforcement: "full", windowsDrive: "visible" },
    "the background projection answers what a foreground run would have",
  );
});

check("a confinement runner that fails to spawn reads as sandbox-unavailable, not a denial", async () => {
  const { executor } = makeExecutor();
  // The confined one-shot remaps a spawn failure NAMING the runner program:
  // bwrap missing is "the boundary is not applied", never "the command was
  // denied by it".
  // The resident is out: the executor falls back to the one-shot path,
  // which is where the confinement runner (bwrap) is spawned.
  const { AgentUnavailableError } = await import("../lib/agent-errors.js");
  executor.executionAgent = () => {
    throw new AgentUnavailableError("agent exited again; falling back permanently");
  };
  spawnView(executor).executeArgv = async (resolved, argvBuilder) => {
    await argvBuilder(new AbortController().signal);
    return /** @type {ShellExecution} */ (/** @type {unknown} */ ({
      result: async () => {
        throw Object.assign(new Error("spawn /usr/bin/bwrap ENOENT"), {
          code: "ENOENT",
          syscall: "spawn /usr/bin/bwrap",
          path: "/usr/bin/bwrap",
        });
      },
    }));
  };
  await assert.rejects(
    () => executor.execute(spec({
      command: "echo hi",
      // The workdir must be a real enterable directory for the runner
      // attribution to apply (isUsableWorkdir stat-s it); a tmp dir qualifies.
      workdir: mkdtempSync(join(tmpdir(), "provider-runner-")),
      timeoutMs: 5000,
      sandboxPolicy: { mode: "workspace-write", workspaceRoot: WORKSPACE },
    })).then((e) => e.result()),
    (error) => error instanceof SandboxUnavailableError,
  );
});

check("a WSL_E code on failure names the distro and refuses the denial framing", async () => {
  const { executor } = makeExecutor();
  executor.executionAgent = () => asAgent({
    exec: async () => ({ exitCode: 0xffffffff, stdout: Buffer.from(""), stderr: Buffer.from("wsl.exe: WSL_E_DISTRO_NOT_FOUND"), truncated: { stdout: false, stderr: false } }),
  });
  await assert.rejects(
    () => executor.execute(spec({ command: "echo hi", workdir: WORKSPACE, timeoutMs: 5000 })).then((e) => e.result()),
    /WSL_E_DISTRO_NOT_FOUND.*not a sandbox denial/s,
    "the distro being gone is not something wider permissions fix",
  );
});

check("a workdir the distro cannot enter is the command's own failure, with the remedy", async () => {
  const { executor } = makeExecutor();
  // The real CwdError class is what agent-exec synthesizes from: it carries
  // the Linux path, and the handle builds the relay-shaped stderr around it.
  const { CwdError } = await import("../lib/agent-errors.js");
  executor.executionAgent = () => asAgent({
    exec: async () => {
      throw new CwdError("/gone");
    },
  });
  await assert.rejects(
    () => executor.execute(spec({ command: "echo hi", workdir: "/gone", timeoutMs: 5000 })).then((e) => e.result()),
    /could not enter the working directory "\/gone"/,
  );
});

let failed = 0;
for (const [name, fn] of checks) await runCheck(name, fn);
failed = checks.length - passed;
console.log(`\n${passed}/${checks.length} provider checks pass`);
if (failed > 0) process.exitCode = 1;
