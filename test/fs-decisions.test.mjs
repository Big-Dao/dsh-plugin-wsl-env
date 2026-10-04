/**
 * Assertion checks for the filesystem provider's policy decisions — the
 * refusal dialect the model reads on every guarded path, extracted from
 * `lib/index.js` into a peer-free module so the SECURITY-DECISION layer has
 * unit tests of its own (the audit's H3: these used to live inline in a file
 * no unit test could import).
 *
 * Not covered here: the provider wiring that calls these decisions
 * (`lib/index.js` imports the DSH peers) — that remains the probes' territory.
 *
 *   node test/fs-decisions.test.mjs
 */
import assert from "node:assert/strict";
import { FsCodedError } from "../lib/fsio-text.js";
import {
  isConfinedMutation,
  mutationModeRefusal,
  outsideDistroRefusal,
  shareSubstrateRefusal,
  substrateFailure,
  workspaceWriteDenial,
} from "../lib/fs-decisions.js";

let passed = 0;
const checks = [];
const check = (name, fn) => checks.push([name, fn]);
const runCheck = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
};

const WORKSPACE_POLICY = { mode: "workspace-write", workspaceRoot: "\\\\wsl.localhost\\ubuntu\\home\\andy\\proj" };

check("outsideDistroRefusal refuses a foreign-distro path while restrictToDistro holds", () => {
  const refusal = outsideDistroRefusal({
    path: "\\\\wsl.localhost\\debian\\home\\x",
    world: "\\\\wsl.localhost\\debian\\home\\x",
    distro: "ubuntu",
    restrictToDistro: true,
  });
  assert.equal(refusal.code, "FS_OUTSIDE_DISTRO", "deliberately NOT a sandbox denial: no permission lifts it");
  assert.match(refusal.message, /names a path in another WSL distro/);
  assert.match(refusal.message, /pins its filesystem to "ubuntu"/);
  assert.match(refusal.message, /restrictToDistro: true/);
});

check("outsideDistroRefusal passes the pinned distro, a relaxed fence, and non-UNC paths", () => {
  const base = { path: "\\\\wsl.localhost\\ubuntu\\home\\x", world: "\\\\wsl.localhost\\ubuntu\\home\\x", distro: "ubuntu" };
  assert.equal(outsideDistroRefusal({ ...base, restrictToDistro: true }), null, "the pinned distro is home");
  assert.equal(outsideDistroRefusal({ ...base, restrictToDistro: false }), null, "a relaxed fence refuses nothing");
  assert.equal(
    outsideDistroRefusal({ path: "C:\\Users\\x", world: "C:\\Users\\x", distro: "ubuntu", restrictToDistro: true }),
    null,
    "a Windows drive path is not a distro path",
  );
});

check("isConfinedMutation routes mutations to the confined resident", () => {
  assert.equal(isConfinedMutation({ policy: WORKSPACE_POLICY, sandboxEnabled: true }), true);
  assert.equal(isConfinedMutation({ policy: { mode: "read-only", workspaceRoot: "/" }, sandboxEnabled: true }), true, "read-only still confines (the mode refusal fires before routing)");
  assert.equal(isConfinedMutation({ policy: { mode: "danger-full-access", workspaceRoot: "/" }, sandboxEnabled: true }), false, "the approved escalation rides the plain resident");
  assert.equal(isConfinedMutation({ policy: WORKSPACE_POLICY, sandboxEnabled: false }), false, "a disabled sandbox confines nothing");
  assert.equal(isConfinedMutation({ policy: undefined, sandboxEnabled: true }), false, "no policy means the caller pre-checked");
});

check("mutationModeRefusal denies read-only outright and lets the escalation through", () => {
  const refusal = mutationModeRefusal("read-only", "/home/andy/f.txt");
  assert.equal(refusal.code, "FS_SANDBOX_DENIED");
  assert.equal(refusal.message, 'cannot write "/home/andy/f.txt": file access denied under read-only mode');
  assert.equal(mutationModeRefusal("danger-full-access", "/etc/passwd"), null, "the escalation is not fenced here");
  assert.equal(mutationModeRefusal("workspace-write", "/home/andy/f.txt"), null, "workspace-write defers to containment");
});

check("workspaceWriteDenial is the containment refusal", () => {
  const denial = workspaceWriteDenial("/etc/hosts");
  assert.equal(denial.code, "FS_SANDBOX_DENIED");
  assert.equal(denial.message, 'cannot write "/etc/hosts": file access denied under workspace-write mode');
});

check("substrateFailure keeps a coded refusal byte-for-byte and wraps everything else", () => {
  const coded = new FsCodedError('cannot write "/x": it already exists', "FS_NOT_OBSERVED");
  const kept = substrateFailure(coded);
  assert.deepEqual(kept, { message: coded.message, code: "FS_NOT_OBSERVED", cause: coded });

  const plain = new Error("wsl.exe blew up");
  const wrapped = substrateFailure(plain);
  assert.equal(wrapped.code, "FS_IO_ERROR");
  assert.match(wrapped.message, /the distro file substrate is unavailable: wsl\.exe blew up/);
  assert.match(wrapped.message, /wsl\.exe -l -v/, "the failure names the recovery path, not a share opt-out");
  assert.doesNotMatch(wrapped.message, /share/, "the retired substrate is not offered as a way out");
  assert.equal(wrapped.cause, plain, "the cause survives for the tool layer");

  const stringError = substrateFailure("a string failure");
  assert.match(stringError.message, /unavailable: a string failure\. The resident agent/);
  assert.equal(stringError.cause, undefined, "a non-Error carries no cause");
});

check("shareSubstrateRefusal refuses the retired substrate and admits the agent", () => {
  const refusal = shareSubstrateRefusal("share");
  assert.match(refusal.message, /substrate "share" is no longer available/);
  assert.match(refusal.message, /9p share/, "the migration says what retired and why");
  assert.match(refusal.message, /Delete the substrate line/, "the migration names the fix");
  assert.equal(shareSubstrateRefusal("agent"), null, "the agent substrate proceeds");
  assert.equal(shareSubstrateRefusal(undefined), null, "an unset substrate proceeds");
});

for (const [name, fn] of checks) await runCheck(name, fn);

console.log(`\n${passed} fs-decision checks pass`);
