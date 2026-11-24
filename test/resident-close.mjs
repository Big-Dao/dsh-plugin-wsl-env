/**
 * The fake residents' shared teardown.
 *
 * Three script-style suites (fsio-agent, fs-substrate, agent-fs-script) each
 * embed a fake resident over the real agent script and carried a
 * byte-identical `close()`. A resident that ignores SHUTDOWN must not wedge
 * teardown: the exit is awaited under a deadline, then the child is killed,
 * and only then is the scratch dir removed — without the bound a cleanup
 * failure is a file-level hang no assertion can report.
 *
 * @module dsh-plugin-wsl-env/test/resident-close
 */
import { rmSync } from "node:fs";

/**
 * Close one fake resident and remove its scratch dir.
 *
 * @param {{ stdin: { write(chunk: string): unknown }, once(event: "exit", listener: (...args: unknown[]) => void): unknown, exitCode: number | null, signalCode: string | null, kill(signal?: number | NodeJS.Signals): unknown }} child - the resident process (a spawned child or a fake over one).
 * @param {string} dir - the scratch directory it owned.
 */
export async function closeResident(child, dir) {
  child.stdin.write("SHUTDOWN\n");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2000).unref()),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2000).unref()),
    ]);
  }
  rmSync(dir, { recursive: true, force: true });
}
