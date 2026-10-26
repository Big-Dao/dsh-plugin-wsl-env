/**
 * Confined residents: one long-lived agent per (distro, policy) pair, running
 * its WHOLE lifetime inside the bwrap profile that policy asks for — so every
 * filesystem op it performs is enforced by the kernel's mount table, not just
 * by the host-side check that chose it.
 *
 * This is stage two of the substrate's enforcement story. Stage one routed
 * every op through the plain agent with the policy check deciding what may
 * pass; stage two routes *mutations* to a confined resident whose view of the
 * filesystem already matches the granted rights, so a bug in the check cannot
 * become a write outside the workspace — the kernel refuses it.
 *
 * Keying is the whole design: the profile is fixed for an agent's lifetime,
 * so a change in the policy (the Permissions selector, a session move) simply
 * addresses a different key, and the previous resident retires through its own
 * idle timer. Escalated writes (`danger-full-access`) keep addressing the
 * plain agent, which is what an approved escalation means.
 *
 * The argv it hands the transport is a whole command — program, profile, `--` —
 * assembled by the peer-free `lib/bwrap.js`, which both confinement sites share.
 * That import is why this module needs no DSH peer either: a bare checkout can
 * construct the factory and assert the command it produces, which is what
 * `test/agent.test.mjs` does. It used to import the sandbox's own profile
 * builder and assemble the prefix itself, missing the program; the probe inlined
 * a third copy, so nothing compared production's command with a working one and
 * every confined mutation failed the resident's handshake.
 *
 * This is a TypeScript source built to `lib/agent-confined.js`; edit THIS file
 * and run `pnpm run build` — the artifact under `lib/` is generated, and
 * `pnpm test` fails when it drifts.
 *
 * @module dsh-plugin-wsl/agent-confined
 */
import { spawn } from "node:child_process";
import { bwrapArgvPrefix } from "./bwrap.js";
import { toLinuxPath } from "./paths.js";
import { agentScriptDigest, agentScriptPath } from "./agent-shared.js";
import { pinnedWindowsEnv, WslAgent } from "./agent.js";
const confinedAgents = new Map();
/**
 * Make sure the workspace root exists in the distro before the confined
 * resident's first spawn: the bwrap profile binds the root
 * (`--bind <root> <root>`) and bwrap refuses a missing bind source — on a
 * freshly imported distro the first write's workspace may not exist yet, and
 * the resident would exit during its handshake with a bare code 1 and no
 * hint (WSL-305). Idempotent (`mkdir -p`), and its outcome is deliberately
 * ignored here: bwrap remains the authority on whether the profile can be
 * built, and its refusal now reaches the caller through the handshake
 * error's stderr tail.
 *
 * @param options - the transport, distro, root, and an injectable spawn.
 * @returns resolves once the `mkdir -p` has been issued (settled, whatever
 * its result — bwrap decides).
 */
export function ensureWorkspaceRoot({ wslPath, distro, root, spawnFn }) {
    return new Promise((resolve) => {
        const doSpawn = spawnFn ?? ((file, args, options) => spawn(file, args, options));
        const child = doSpawn(wslPath, ["-d", distro, "--exec", "mkdir", "-p", root], {
            stdio: "ignore",
            windowsHide: true,
            env: pinnedWindowsEnv(process.env),
        });
        child.on("error", () => resolve());
        child.on("exit", () => resolve());
    });
}
/**
 * The confined agent for one distro and one resolved policy, created on first
 * use and shared for the process lifetime. A success is remembered; a failed
 * start is not (the agent's own rebuild rules take over from there).
 *
 * @param request - the confinement request.
 * @returns the confined resident for this key.
 */
export function confinedAgent({ distro, wslPath = "wsl.exe", policy, maskWindowsDrive = false, realTmp = true }) {
    const key = `${wslPath}\0${distro}\0${policy.mode}\0${policy.workspaceRoot}\0${maskWindowsDrive ? "masked" : "visible"}\0${realTmp ? "real" : "ephemeral"}`;
    let agent = confinedAgents.get(key);
    if (agent === undefined) {
        const linuxRoot = toLinuxPath(policy.workspaceRoot, { distro });
        agent = new WslAgent({
            distro,
            wslPath,
            scriptPath: toLinuxPath(agentScriptPath),
            expectedDigest: agentScriptDigest,
            // The prefix is a whole command from the distro's point of view — program,
            // profile, `--` — because the transport inserts it between
            // `wsl.exe --exec` and the `sh <script>` pair (`lib/agent.js`'s
            // `spawnDefault`). Both confinement sites share that assembly in
            // `lib/bwrap.js`, whose module doc records what happened when they did not.
            argvPrefix: bwrapArgvPrefix({ mode: policy.mode, workspaceRoot: linuxRoot }, { maskWindowsDrive, realTmp }),
            // workspace-write is the only mode that binds the workspace root, and
            // bwrap refuses a missing bind source (WSL-305): on a freshly imported
            // distro the first write's workspace may not exist yet, and the resident
            // used to exit during its handshake with a bare code 1. Create the root
            // before the first spawn; every later start re-runs it harmlessly.
            prepare: policy.mode === "workspace-write"
                ? () => ensureWorkspaceRoot({ wslPath, distro, root: linuxRoot }).then(() => undefined)
                : undefined,
        });
        confinedAgents.set(key, agent);
    }
    return agent;
}
/** Test hook: forget every confined resident (the plain agent has no factory state). */
export function resetConfinedAgents() {
    confinedAgents.clear();
}
export default confinedAgent;
