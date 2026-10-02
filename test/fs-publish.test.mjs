/**
 * Assertion checks for the in-distro publication step. Pure module, so this
 * runs everywhere including CI.
 *
 * Not covered here: the real publication through a live filesystem — the
 * agent mechanics are probed by `test/probe/agent.sh`, and the write path's
 * observable behaviour by `test/probe/run.sh`.
 *
 *   node test/fs-publish.test.mjs
 */
import assert from "node:assert/strict";
import { publicationArgv, publicationScript } from "../lib/fs-publish.js";

let passed = 0;
const check = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
};

check("the argv carries the paths as positional parameters, never inside the script text", () => {
  const argv = publicationArgv("/home/you/a b/file.ts", "/home/you/.tmp/x");
  assert.deepEqual(argv.slice(0, 3), ["sh", "-c", publicationScript()]);
  assert.equal(argv[3], "publish");
  assert.equal(argv[4], "/home/you/a b/file.ts");
  assert.equal(argv[5], "/home/you/.tmp/x");
  assert.ok(!publicationScript().includes("/home/you"), "no path may be baked into the script body");
});

check("the script copies the mode only when the target exists", () => {
  const script = publicationScript();
  assert.match(script, /if \[ -e "\$1" \]; then/);
  assert.match(script, /chmod --reference="\$1" "\$2"/);
});

check("the script renames atomically and distinguishes its failure modes", () => {
  const script = publicationScript();
  assert.match(script, /mv -f "\$2" "\$1"/);
  assert.match(script, /exit 3/);
  assert.match(script, /exit 4/);
});

check("paths with spaces, quotes and dollar signs travel as data, not code", () => {
  const argv = publicationArgv('/home/you/weird"$dir"/a b', "/tmp/s t");
  assert.equal(argv[4], '/home/you/weird"$dir"/a b');
  assert.equal(argv[5], "/tmp/s t");
});

console.log(`\n${passed} publication checks pass`);
