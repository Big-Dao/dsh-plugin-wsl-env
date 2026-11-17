/**
 * The in-app doctor's effective-provider check for the three root-plane
 * takeovers.
 *
 * The plugin replaces `subprocess`, `fs` and `directoryPicker` by disabling
 * the shipped rows and mounting same-name providers. That swap can fail at
 * runtime — most visibly on a HMR plugin upgrade, where the outgoing bundle
 * layer re-activates the shipped rows before the incoming layer disables them
 * again (see docs/UPSTREAM-SERVICE-SWAP.md). The failed rows leave no log line
 * a user reads, and the doctor's standalone CLI cannot see live services at
 * all, so the in-app surfaces inspect the context instead and report which
 * provider is serving each name.
 *
 * `missing` for one name only is possible in a composition that intentionally
 * disables the row; the check stays silent when NONE of the three is served,
 * which is the shape of every context that cannot see the composition root
 * (the test seam, a preset realm, the standalone CLI).
 *
 * This is a TypeScript source built to `lib/takeover-report.js`; edit THIS
 * file and run `pnpm run build` — the artifact under `lib/` is generated.
 *
 * @module dsh-plugin-wsl-env/takeover-report
 */
import { WslRoutingFileSystem } from "./fs-routing.js";
import { WslDirectoryPicker } from "./picker.js";
import { WslSubprocessRuntime } from "./subprocess.js";
/** The service names this plugin replaces with its own providers. */
export const TAKEOVER_SERVICES = ["subprocess", "fs", "directoryPicker"];
/**
 * Whether one value is this plugin's provider for the named service.
 *
 * @param service - the service name.
 * @param value - the value read from the context.
 * @returns true for this plugin's class of that service.
 */
function isPluginProvider(service, value) {
    switch (service) {
        case "subprocess":
            return value instanceof WslSubprocessRuntime;
        case "fs":
            return value instanceof WslRoutingFileSystem;
        case "directoryPicker":
            return value instanceof WslDirectoryPicker;
    }
}
/**
 * Read which provider serves each takeover name in this context.
 *
 * A context that cannot look services up (a test seam, the standalone CLI
 * report) yields an empty snapshot, and the merge then adds no row.
 *
 * @param ctx - the context to inspect.
 * @returns one entry per takeover name, in {@link TAKEOVER_SERVICES} order.
 */
export function takeoverSnapshot(ctx) {
    const lookup = ctx.get;
    if (typeof lookup !== "function")
        return [];
    return TAKEOVER_SERVICES.map((service) => {
        let value;
        try {
            value = lookup(service);
        }
        catch {
            // A context that refuses the read contributes no provider, exactly as
            // an absent one does; the doctor reports what it could observe.
            value = undefined;
        }
        if (value === undefined || value === null)
            return { service, state: "missing" };
        if (isPluginProvider(service, value))
            return { service, state: "plugin" };
        const name = value.constructor?.name;
        return {
            service,
            state: "other",
            ...(typeof name === "string" && name.length > 0 ? { provider: name } : {}),
        };
    });
}
/**
 * Fold the effective-provider snapshot into a doctor report as one check.
 *
 * A context that cannot see any of the three services adds no row: it has no
 * evidence about the takeovers, and inventing a finding would be noise in
 * every preset realm and every unit test. When at least one service is
 * served, the row names all three so a single `warn` says exactly which half
 * of the swap landed.
 *
 * @param report - the doctor report (not mutated).
 * @param snapshot - {@link takeoverSnapshot}'s answer.
 * @returns the report with the `providers.takeover` row appended, when it has evidence.
 */
export function mergeTakeoverReport(report, snapshot) {
    if (snapshot.length === 0)
        return report;
    if (snapshot.every((entry) => entry.state === "missing"))
        return report;
    const inactive = snapshot.filter((entry) => entry.state !== "plugin");
    const status = inactive.length === 0 ? "ok" : "warn";
    const describe = (entry) => entry.state === "plugin"
        ? "plugin"
        : entry.state === "missing"
            ? "missing"
            : entry.provider ?? "another provider";
    const check = {
        id: "providers.takeover",
        status,
        title: "WSL service takeovers",
        detail: `effective providers: ${snapshot.map((entry) => `${entry.service}=${describe(entry)}`).join(", ")}`,
        ...(status === "warn"
            ? { remedy: "restart DSH so the new composition applies the takeover; if a service stays on the shipped provider, quit DSH and install the plugin with the app closed — see docs/LIMITATIONS.md" }
            : {}),
    };
    const checks = [...(report.checks ?? []), check];
    const summary = { ...report.summary };
    summary[status] = (summary[status] ?? 0) + 1;
    return { ...report, checks, summary };
}
