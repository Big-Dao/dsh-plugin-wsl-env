/**
 * Manual end-to-end check for the native-agent host wiring (ADR 0002 stage 4,
 * opt-in). It copies the spike binary into the distro cache, acquires a real
 * session runtime with the native entrypoint, runs one command and one FS op,
 * then releases the scope.
 *
 *   node scripts/native-wiring-check.mjs
 *
 * It uses the packaged `agent/native/linux-x86_64/dsh-wsl-agent`; set
 * `DSH_WSL_AGENT_NATIVE` to override it (for example with a fresh spike build),
 * and `DSH_WSL_AGENT_WSL` / `WSL_DISTRO_NAME` to override the transport/distro.
 */
import { ensureNativeBackend, NATIVE_AGENT_ENV } from "../lib/native-agent.js";
import { SessionRuntimes, setSessionNativeAgent } from "../lib/session-runtime.js";

const source = process.env[NATIVE_AGENT_ENV] ?? new URL("../agent/native/linux-x86_64/dsh-wsl-agent", import.meta.url).pathname;
const wslPath = process.env.DSH_WSL_AGENT_WSL ?? "wsl.exe";
const distro = process.env.WSL_DISTRO_NAME ?? "ubuntu";

const path = await ensureNativeBackend({ wslPath, distro, source });
if (path === undefined) {
  console.error(`native backend unavailable (source: ${source})`);
  process.exit(1);
}
console.log(`native binary: ${path}`);
setSessionNativeAgent(distro, path);
const registry = new SessionRuntimes();
const entry = registry.acquire({ distro, wslPath, workspaceRoot: process.cwd(), mode: "workspace-write" });
try {
  const result = await entry.agent.exec({ cwd: "/", argv: ["sh", "-c", "printf native-ok"], timeoutMs: 5000 });
  console.log(`exec: exit=${result.exitCode} stdout=${JSON.stringify(result.stdout.toString())}`);
  if (result.exitCode !== 0 || result.stdout.toString() !== "native-ok") throw new Error("native exec did not round-trip");
  const stat = await entry.agent.fs({ op: "stat", args: ["/"] });
  console.log(`fs stat "/": exit=${stat.exitCode} stdout=${JSON.stringify(stat.stdout.toString())}`);
  if (stat.exitCode !== 0 || !stat.stdout.toString().startsWith("d\t")) throw new Error("native fs stat failed");
} finally {
  await registry.release(entry.key);
}
console.log("native wiring check passed");
