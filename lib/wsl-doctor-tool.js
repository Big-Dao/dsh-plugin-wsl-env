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
/**
 * Digest one doctor report down to what the model acts on: the verdict, the
 * blockers, and every failing check with its copy-paste remedy. Warnings and
 * skipped legs count but do not list — the report's own ids name them when
 * the model asks.
 * @param report - the collected (and live-merged) doctor report.
 * @returns the digest.
 */
export function digestReport(report) {
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
    return {
        verdict,
        blockers,
        failing,
        warningCount,
        skippedCount,
        distroVerdicts: report.distroVerdicts ?? [],
        note: verdict === "ready"
            ? "the first command should succeed; run the CLI (pnpm run doctor --bundle <path>) for the attachable file"
            : "apply each remedy above, then call this tool again — the re-run is the re-verification",
    };
}
/**
 * Render the digest as the tool's text output: one verdict line, one line
 * per failing check with its remedy. The model narrates this; keeping it
 * plain text keeps the transcript readable.
 * @param digest - the digested report.
 * @returns the multi-line text.
 */
export function renderDigest(digest) {
    const lines = [`wsl doctor verdict: ${digest.verdict.toUpperCase()}`];
    for (const check of digest.failing) {
        lines.push(`fail ${check.id} — ${check.detail}`);
        if (check.remedy.length > 0)
            lines.push(`  fix: ${check.remedy}`);
    }
    if (digest.failing.length === 0) {
        lines.push(digest.note);
    }
    else {
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
async function doctorCollector(ctx) {
    if (typeof ctx.get === "function") {
        const provided = ctx.get("doctor");
        if (typeof provided === "function")
            return provided; // the provided service's contract is this module's `doctor` slice
    }
    else if (typeof ctx.doctor === "function") {
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
export async function apply(ctx) {
    ctx.tools.register(defineTool({
        name: "wsl_doctor",
        description: "Run the WSL environment doctor for this session's distro and return the verdict: ready (the first command should succeed), or blocked with per-failure copy-paste remedies. Slow by design (~10 s): it probes wsl.exe, the sandbox, systemd and the agent chain, then re-verifies nothing silently.",
        parameters: { distro: {
                type: "string",
                description: "Distro to examine. Omit to examine this session's own distro.",
            } },
        output: {
            schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                    verdict: { type: "string", required: true, description: "ready or blocked." },
                    blockers: { type: "string", required: true, description: "Comma-separated blocking check ids; empty when ready." },
                    failing: { type: "string", required: true, description: "One line per failing check: id, detail, remedy." },
                },
            },
            render: (_args, value) => [{ type: "text", text: value.failing }],
        },
        async execute(args, exec) {
            let distro = args.distro ?? "";
            if (distro.length === 0) {
                if (exec.agent === undefined)
                    throw new Error("wsl_doctor requires an agent Session (or an explicit distro)");
                const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
                distro = distroOfUnc(cwd) ?? "";
            }
            if (distro.length === 0) {
                throw new Error("wsl_doctor could not resolve the session's distro from its working directory — pass one explicitly");
            }
            const doctor = await doctorCollector(ctx);
            const digest = digestReport(await doctor(distro));
            return { verdict: digest.verdict, blockers: digest.blockers.join(", "), failing: renderDigest(digest) };
        }
    }));
}
