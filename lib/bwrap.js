/**
 * The distro-side `bwrap` command line, shared by every confinement site.
 *
 * Two callers compose a confined command and they must agree on it exactly:
 * `lib/sandbox.js` wraps a *single* command (`confine()`, and the usability
 * probe), and `lib/agent-confined.js` wraps a *resident* whose whole lifetime
 * runs inside the profile — it hands the prefix to the transport, which inserts
 * it between `wsl.exe --exec` and the `sh <script>` pair.
 *
 * That split is why this module exists. The two sites used to assemble the argv
 * themselves, and only one of them prepended the program: the confined resident's
 * prefix began at `--ro-bind`, so `wsl.exe --exec` tried to run a `--ro-bind`
 * executable, the agent exited 1 during its handshake, and every confined
 * mutation failed with `FS_IO_ERROR: … agent exited during handshake`. The
 * verified probe could not see it because it inlined its own copy of the argv.
 *
 * This module imports nothing, so a bare checkout can assert the argv both sites
 * actually produce.
 *
 * @module dsh-plugin-wsl/bwrap
 */

/**
 * Build the bwrap profile arguments for one file-effect policy, exactly as
 * upstream's `bwrapProfileArgs` does.
 *
 * `--ro-bind / /` makes the whole distro read-only, `--dev /dev` supplies the
 * `/dev/null` sink a shell needs, `--unshare-pid` keeps the sandbox's process
 * view its own, and `--proc /proc` gives it a matching `/proc`. Under
 * `workspace-write` the workspace is bound read-write and `/tmp` becomes an
 * ephemeral tmpfs — the temp area the mode promises, without exposing the
 * distro's real `/tmp`.
 *
 * `options.maskWindowsDrive` mounts an empty tmpfs over `/mnt` AFTER the
 * read-only root, shadowing the Windows drive: the drive's files disappear
 * from the command's view, which severs interop as a side effect — a Windows
 * executable on the drive can no longer be reached to launch, and the drive's
 * data cannot be read or exfiltrated. It is a narrowing, not a closure: a
 * command may still WRITE an executable into the workspace and run it
 * (binfmt interop dispatches on file content, not location), so `enforcement`
 * stays `partial` — see `lib/sandbox.js`.
 *
 * @param policy - the policy to express as bwrap mounts.
 * @param options - profile options.
 * @param options.maskWindowsDrive - shadow `/mnt` with an empty tmpfs.
 * @returns profile arguments, before the `--` separator and the command argv.
 */
export function bwrapProfileArgs(policy, options = {}) {
  const args = ["--ro-bind", "/", "/", "--dev", "/dev", "--unshare-pid", "--proc", "/proc", "--die-with-parent"];
  if (policy.mode === "workspace-write") {
    args.push("--tmpfs", "/tmp");
    args.push("--bind", policy.workspaceRoot, policy.workspaceRoot);
  }
  if (options.maskWindowsDrive) {
    args.push("--tmpfs", "/mnt");
  }
  return args;
}

/**
 * The argv prefix that runs one command (or one resident) inside the profile.
 *
 * The prefix is a complete command from the distro's point of view: it names the
 * program (`bwrap`), the profile, and the `--` separator that ends bwrap's own
 * options. `workspaceRoot` must already be spelled as a Linux path inside the
 * distro; the callers own that translation.
 *
 * @param policy - the resolved policy: `mode`, plus the Linux `workspaceRoot`.
 * @param options - profile options, passed through to {@link bwrapProfileArgs}.
 * @returns argv to insert before the command, as the transport receives it.
 */
export function bwrapArgvPrefix(policy, options = {}) {
  return ["bwrap", ...bwrapProfileArgs(policy, options), "--"];
}
