/**
 * Assertion checks for the pure text mechanics — the peer-faithful decode,
 * line-ending, and abort primitives every read/write/edit rides on. These are
 * the refusal-dialect edges the share era could never reach (invalid UTF-8,
 * stream decode failures, aborts), so they get direct unit tests here.
 *
 *   node test/fsio-text.test.mjs
 */
import assert from "node:assert/strict";
import {
  decodeUtf8,
  decodeUtf8Stream,
  detectLineEndings,
  FsCodedError,
  normalizeLineEndings,
  restoreLineEndings,
  throwIfAborted,
} from "../lib/fsio-text.js";

let passed = 0;
/** @type {Array<[string, () => void | Promise<void>]>} */
const checks = [];
/**
 * Defers one check; the loop at the bottom runs each through `runCheck`.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const check = (name, fn) => checks.push([name, fn]);
/**
 * Runs one check now, printing its verdict; a throw fails the process exit code.
 * @param {string} name - the check's name.
 * @param {() => void | Promise<void>} fn - the check's assertions.
 */
const runCheck = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.log(`FAIL  ${name}\n      ${/** @type {Error} */ (error).message}`);
    process.exitCode = 1;
  }
};

check("decodeUtf8 accepts valid UTF-8 and rejects invalid byte sequences", () => {
  assert.equal(decodeUtf8(Buffer.from("héllo"), "read", "/a.txt"), "héllo");
  assert.throws(
    () => decodeUtf8(Buffer.from([0xff, 0xfe, 0x41]), "read", "/a.txt"),
    (error) => error instanceof FsCodedError && error.code === "FS_NOT_TEXT" && /invalid UTF-8 text/.test(error.message),
  );
});

check("decodeUtf8Stream flushes a split sequence and fails an invalid one", () => {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const head = decoder.decode(Buffer.from([0xe4, 0xbd]), { stream: true });
  const tail = decodeUtf8Stream(decoder, Buffer.from([0xa0]), "read", "/a.txt");
  assert.equal(head + tail, "你");
  const bad = new TextDecoder("utf-8", { fatal: true });
  bad.decode(Buffer.from([0xe4, 0xbd]), { stream: true });
  assert.throws(
    () => decodeUtf8Stream(bad, Buffer.from([0xff]), "read", "/a.txt"),
    (error) => error instanceof FsCodedError && error.code === "FS_NOT_TEXT",
  );
  const flush = new TextDecoder("utf-8", { fatal: true });
  flush.decode(Buffer.from("ok"), { stream: true });
  assert.equal(decodeUtf8Stream(flush, undefined, "read", "/a.txt"), "", "an empty chunk flushes the decoder");
});

check("detectLineEndings picks the majority style from a 4 KiB sample", () => {
  assert.equal(detectLineEndings("a\nb\nc"), "LF");
  assert.equal(detectLineEndings("a\r\nb\r\nc"), "CRLF");
  assert.equal(detectLineEndings(`${"x\r\n".repeat(3000)}tail`), "CRLF", "sampling stops at the 4 KiB window");
});

check("restoreLineEndings round-trips both styles", () => {
  assert.equal(restoreLineEndings("a\nb", "LF"), "a\nb");
  assert.equal(restoreLineEndings("a\r\nb", "LF"), "a\r\nb", "LF content passes through unchanged");
  assert.equal(restoreLineEndings("a\nb", "CRLF"), "a\r\nb", "CRLF content is re-normalized then re-CRLF'd");
  assert.equal(normalizeLineEndings("a\r\nb\r\n"), "a\nb\n");
});

check("throwIfAborted refuses an aborted signal with the structured code", () => {
  throwIfAborted(undefined, "read");
  const reason = new Error("caller cancelled");
  const aborted = new AbortController();
  aborted.abort(reason);
  assert.throws(
    () => throwIfAborted(aborted.signal, "read"),
    (error) => error instanceof FsCodedError && error.code === "FS_ABORTED" && error.cause === reason,
  );
});

for (const [name, fn] of checks) await runCheck(name, fn);

console.log(`\n${passed} fsio-text checks pass`);
