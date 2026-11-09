export declare const name = "wsl-doctor-command";
/**
 * No required inject: a headless deployment has no commands registry, and a
 * required inject would fail the whole composition mount over a surface this
 * row cannot use. The registry resolves per mount through the optional
 * `ctx.get` (cordis answers undefined for an absent name; a `get` needs no
 * inject), with a plain property as the test seam — the same shape the
 * `wsl_doctor` tool uses for its optional collector.
 */
export declare const inject: string[];
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
    input?: {
        hint: string;
    };
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
    workingDirectory?: {
        ensure: (agent: unknown, signal?: unknown) => Promise<string>;
    };
    /** Optional cordis-style lookup: how production resolves both without an inject. */
    get?: (name: string) => unknown;
    /** The test seam: a provided CLI runner replaces the real subprocess. */
    doctorCli?: DoctorCliRunner;
};
/** The CLI runner seam: argv in (node-less — the runner owns the runtime), JSON text out. */
type DoctorCliRunner = (argv: string[], signal?: AbortSignal) => Promise<string>;
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
export declare const DOCTOR_SCRIPT: string;
/** The usage text a grammar violation settles with. */
export declare const USAGE: string;
/**
 * Parse the raw input after the command name. Tokens: one mode word or
 * section name, plus an optional `--distro <name>` / `--distro=<name>`; a
 * second bare token is accepted as the distro name.
 *
 * @param rawInput - everything after the command name.
 * @returns the parsed mode, optional section, and optional distro.
 * @throws when a token matches nothing — the caller settles usage text.
 */
export declare function parseDoctorInput(rawInput: string): ParsedDoctorInput;
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
export declare function runDoctorCli(argv: string[], signal?: AbortSignal): Promise<string>;
/**
 * Format the CLI's JSON report into the itemized text the UI renders — the
 * same digest the `wsl_doctor` tool returns, so both surfaces itemize every
 * check identically.
 *
 * @param json - the CLI's stdout, one versioned JSON report.
 * @param distro - the distro the run named, for the session-distro markers.
 * @returns the rendered report text.
 */
export declare function formatDoctorReport(json: string, distro: string): string;
/**
 * Mount the command.
 *
 * @param ctx - the cordis context (the composition root, where the commands
 *   registry and the harness cwd service are reachable).
 */
export declare function apply(ctx: WslDoctorCommandContext): Promise<void>;
export {};
