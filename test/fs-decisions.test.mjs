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
  guardRefusal,
  isConfinedMutation,
  mutationModeRefusal,
  outsideDistroRefusal,
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

check("guardRefusal refuses the stale intents with the peer's wording", () => {
  const vanished = guardRefusal(
    { kind: "replaceIfVersion", version: "v1" },
    undefined,
    "/home/andy/f.txt",
  );
  assert.equal(vanished.code, "FS_STALE_VERSION");
  assert.equal(vanished.message, 'cannot write "/home/andy/f.txt": file no longer exists');

  const stale = guardRefusal(
    { kind: "replaceIfVersion", version: "v1" },
    { version: "v2" },
    "/home/andy/f.txt",
  );
  assert.equal(stale.code, "FS_STALE_VERSION");
  assert.equal(stale.message, 'cannot write "/home/andy/f.txt": file changed since it was read');

  const current = guardRefusal({ kind: "replaceIfVersion", version: "v2" }, { version: "v2" }, "/home/andy/f.txt");
  assert.equal(current, null, "a current version proceeds");
});

check("guardRefusal refuses an unobserved create and passes an unguarded write", () => {
  const unobserved = guardRefusal({ kind: "createIfAbsent" }, { version: "v1" }, "/home/andy/new.txt");
  assert.equal(unobserved.code, "FS_NOT_OBSERVED");
  assert.equal(unobserved.message, 'cannot overwrite existing "/home/andy/new.txt" without reading it first');
  assert.equal(guardRefusal({ kind: "createIfAbsent" }, undefined, "/home/andy/new.txt"), null, "the absent create proceeds");
  assert.equal(guardRefusal(undefined, { version: "v1" }, "/home/andy/f.txt"), null, "no intent means no guard");
});

check("substrateFailure keeps a coded refusal byte-for-byte and wraps everything else", () => {
  const coded = new FsCodedError('cannot write "/x": it already exists', "FS_NOT_OBSERVED");
  const kept = substrateFailure(coded);
  assert.deepEqual(kept, { message: coded.message, code: "FS_NOT_OBSERVED", cause: coded });

  const plain = new Error("wsl.exe blew up");
  const wrapped = substrateFailure(plain);
  assert.equal(wrapped.code, "FS_IO_ERROR");
  assert.match(wrapped.message, /the distro file substrate is unavailable: wsl\.exe blew up/);
  assert.match(wrapped.message, /substrate: \\"share\\"/, "the failure names the documented opt-out");
  assert.equal(wrapped.cause, plain, "the cause survives for the tool layer");

  const stringError = substrateFailure("a string failure");
  assert.match(stringError.message, /unavailable: a string failure\. Set/);
  assert.equal(stringError.cause, undefined, "a non-Error carries no cause");
});

for (const [name, fn] of checks) await runCheck(name, fn);

console.log(`\n${passed} fs-decision checks pass`);
