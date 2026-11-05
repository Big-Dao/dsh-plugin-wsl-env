/**
 * Batched-read comparison for the GUI-preview shape (WSL-312 acceptance).
 *
 * The WSL-206 probe (`gui-preview.mjs`) measures provider-level latency
 * through the routed backend; this one answers the protocol question: does
 * the v7 `FSB` batch frame make the preview's stat+list+read shape cheaper
 * than five individual FS frames? It drives the resident agent directly over
 * the production transport, on BOTH backends, and prints ms/view for each.
 *
 *   test/probe/gui-preview-batch.sh   # via env.sh; passes the args through
 *
 * Args: <distro> <workspace-linux> <shell-agent-script> [native-binary].
 */
import { spawn } from "node:child_process";
import { WslAgent } from "../../lib/agent.js";

// Positional args first (the Electron-as-Node launcher is not guaranteed to
// preserve every environment variable), then the environment for a direct
// `node gui-preview-batch.mjs` run.
const [argDistro, argWorkspace, argScript, argNative] = process.argv.slice(2);
const distro = argDistro ?? process.env.DSH_WSL_ENV_DISTRO;
const workspace = argWorkspace ?? process.env.DSH_WSL_ENV_WORKSPACE_LINUX;
const scriptPath = argScript ?? process.env.DSH_WSL_ENV_AGENT_SCRIPT;
if (!distro || !workspace || !scriptPath) {
  console.error("gui-preview-batch: pass <distro> <workspace-linux> <agent-script> [native-binary] or set DSH_WSL_ENV_DISTRO, DSH_WSL_ENV_WORKSPACE_LINUX and DSH_WSL_ENV_AGENT_SCRIPT");
  process.exit(1);
}

/**
 * POSIX-join one child onto the workspace argument. This client runs on the
 * Windows host, so `node:path` would join with backslashes — the distro side
 * needs the Linux spelling.
 * @param {string} child - the child name.
 * @returns {string} the distro-side path.
 */
const linuxChild = (child) => `${workspace.replace(/\/+$/, "")}/${child}`;

const nativeBinary = argNative ?? linuxChild("agent/native/linux-x86_64/dsh-wsl-agent");

/**
 * One resident over the production transport: `wsl.exe -d <distro> --exec
 * <backend>`, the same spawn the session runtime uses.
 * @param {"shell" | "native"} backend - which agent backend to drive.
 * @returns {WslAgent} the agent.
 */
const resident = (backend) => new WslAgent({
  distro,
  scriptPath: backend === "native" ? nativeBinary : scriptPath,
  idleMs: 0,
  signalable: backend !== "native",
  serialRequests: true,
  spawnTransport: () => backend === "native"
    ? spawn("wsl.exe", ["-d", distro, "--exec", nativeBinary], { stdio: ["pipe", "pipe", "pipe"] })
    : spawn("wsl.exe", ["-d", distro, "--exec", "sh", scriptPath], { stdio: ["pipe", "pipe", "pipe"] }),
});

/** The preview shape: stat the directory, list it, stat one child, page-read it, stat again. */
const ops = () => [
  { op: "stat", args: [workspace] },
  { op: "list", args: [workspace] },
  { op: "stat", args: [linuxChild("README.md")] },
  { op: "read", args: [linuxChild("README.md"), "0", "65536"] },
  { op: "stat", args: [workspace] },
];

let failed = 0;
for (const backend of /** @type {Array<"shell" | "native">} */ (["shell", "native"])) {
  const agent = resident(backend);
  await agent.start();
  try {
    // Warm the process so the first measurement is not spawn cost.
    await agent.fs({ op: "stat", args: [workspace] });
    const rounds = 5;
    const individualStart = performance.now();
    for (let round = 0; round < rounds; round += 1) {
      for (const { op, args } of ops()) {
        const result = await agent.fs({ op, args });
        if (result.exitCode !== 0) throw new Error(`${backend}: ${op} failed: ${result.stderr.toString()}`);
      }
    }
    const individualMs = (performance.now() - individualStart) / rounds;

    const batchStart = performance.now();
    for (let round = 0; round < rounds; round += 1) {
      const result = await agent.fsb({ ops: ops() });
      if (result.exitCode !== 0) throw new Error(`${backend}: batch failed: ${result.stderr.toString()}`);
      if (!result.stdout.toString().startsWith("OK 1|")) throw new Error(`${backend}: the batch did not answer every op`);
    }
    const batchMs = (performance.now() - batchStart) / rounds;

    console.log(`GUI-preview shape (${ops().length} ops) over ${distro} [${backend}]:`);
    console.log(`  individual frames: ${individualMs.toFixed(2)} ms/view`);
    console.log(`  one batch frame:   ${batchMs.toFixed(2)} ms/view`);
    console.log(`  saved:             ${(individualMs - batchMs).toFixed(2)} ms/view (${(individualMs / batchMs).toFixed(1)}x)`);
  } finally {
    await agent.close();
  }
}
process.exit(failed);
