/**
 * The text mechanics of the distro-side filesystem, replicated from
 * `@deepseek-ai/dsh-fs-local`'s fsio module so `lib/fsio-agent.js` can run the
 * same orchestration without importing the peer.
 *
 * Everything here is pure and validation-only: no I/O, no Node fs. The
 * replication is deliberate and temporary — once the upstream package exports
 * its fsio module (the export is proposed in docs/UPSTREAM-FSIO-EXPORT.md),
 * these functions are deleted in favour of the imported originals. Until then
 * they are kept byte-for-byte faithful, including error messages, because the
 * tool layer matches on both the `code` and what the model reads — and that
 * faithfulness is verified, not assumed: docs/PEER-PARITY.md records the
 * function-by-function comparison against the pinned peer's shipped code.
 *
 * @module dsh-plugin-wsl/fsio-text
 */

/** The byte prefix scanned for a NUL before a read is declared binary. */
export const BINARY_SAMPLE_BYTES = 8192;

/**
 * A coded filesystem failure. `code` carries the `FS_*` token the provider
 * maps onto the peer's `FsError`; the class stays local so this module imports
 * no peer and stays unit-testable in a bare checkout.
 */
export class FsCodedError extends Error {
  /**
   * @param {string} message - human-readable, model-facing.
   * @param {string} code - the `FS_*` token.
   * @param {Error} [cause] - the underlying failure, when there is one.
   */
  constructor(message, code, cause) {
    super(message, cause === undefined ? {} : { cause });
    this.name = "FsCodedError";
    this.code = code;
  }
}

/**
 * @param {string} verb - the operation being attempted, for the message.
 * @param {string} displayPath - the caller-facing path.
 * @returns {FsCodedError} the structured not-text failure.
 */
export function notTextError(verb, displayPath) {
  return new FsCodedError(`cannot ${verb} "${displayPath}": invalid UTF-8 text`, "FS_NOT_TEXT");
}

/**
 * Decode a buffer as strict UTF-8, rejecting invalid byte sequences the way
 * the peer's fsio does.
 * @param {Buffer} buffer - the bytes to decode.
 * @param {string} verb - the operation being attempted, for the message.
 * @param {string} displayPath - the caller-facing path.
 * @returns {string} the decoded text.
 * @throws {FsCodedError} with `FS_NOT_TEXT` on invalid UTF-8.
 */
export function decodeUtf8(buffer, verb, displayPath) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw notTextError(verb, displayPath);
  }
}

/**
 * Decode one streamed chunk, carrying multi-byte sequences across chunks.
 * @param {import("node:util").TextDecoder} decoder - the streaming decoder owned by the caller.
 * @param {Buffer|undefined} chunk - the next chunk, or `undefined` to flush.
 * @param {string} verb - the operation being attempted, for the message.
 * @param {string} displayPath - the caller-facing path.
 * @returns {string} the decoded text.
 * @throws {FsCodedError} with `FS_NOT_TEXT` on invalid UTF-8.
 */
export function decodeUtf8Stream(decoder, chunk, verb, displayPath) {
  try {
    return chunk ? decoder.decode(chunk, { stream: true }) : decoder.decode();
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw notTextError(verb, displayPath);
  }
}

/**
 * Collapse CRLF to LF — the canonical in-memory form every edit/diff basis uses.
 * @param {string} content - the text to normalize.
 * @returns {string} the text with every CRLF collapsed to LF.
 */
export function normalizeLineEndings(content) {
  return content.replaceAll("\r\n", "\n");
}

/** @param {string} raw - decoded text in whatever line-ending style the file had. */
export function detectLineEndings(raw) {
  const sample = raw.slice(0, 4096);
  const crlfCount = sample.split("\r\n").length - 1;
  return crlfCount > sample.split("\n").length - 1 - crlfCount ? "CRLF" : "LF";
}

/**
 * Convert LF-normalized content back to the style detected at read time.
 * @param {string} content - the LF-normalized (edited) text.
 * @param {"LF"|"CRLF"} lineEndings - the original file's style.
 * @returns {string} the content in the original file's line-ending style.
 */
export function restoreLineEndings(content, lineEndings) {
  if (lineEndings === "LF") return content;
  return normalizeLineEndings(content).replaceAll("\n", "\r\n");
}

/**
 * @param {string} content - the haystack.
 * @param {string} search - the needle.
 * @returns {number} how many times `search` appears in `content`.
 */
function countOccurrences(content, search) {
  return content.split(search).length - 1;
}

/**
 * Apply a literal replacement to LF-normalized content — the peer's edit
 * algorithm, replicated: CRLF inside the needle is normalized before
 * matching, an empty needle is refused, and a multi-match needle is ambiguous
 * unless `replaceAll` is set.
 *
 * @param {string} content - the current file content, already LF-normalized.
 * @param {string} oldString - literal text to find.
 * @param {string} newString - literal replacement text.
 * @param {boolean|undefined} replaceAll - replace every match instead of requiring one.
 * @param {string} displayPath - the caller-facing path for error messages.
 * @returns {{content: string, replacements: number}} the edited text and count.
 * @throws {FsCodedError} with `FS_EDIT_NOT_FOUND` or `FS_AMBIGUOUS_EDIT`.
 */
export function applyLiteralEdit(content, oldString, newString, replaceAll, displayPath) {
  const oldNorm = normalizeLineEndings(oldString);
  if (oldNorm.length === 0) throw new FsCodedError("old_string must be a non-empty string", "FS_EDIT_NOT_FOUND");
  const newNorm = normalizeLineEndings(newString);
  const replacements = countOccurrences(content, oldNorm);
  if (replacements === 0) throw new FsCodedError(`old_string was not found in "${displayPath}"`, "FS_EDIT_NOT_FOUND");
  if (!replaceAll && replacements > 1) {
    throw new FsCodedError(
      `old_string matched ${replacements} times in "${displayPath}"; provide a more specific old_string or set replace_all to true`,
      "FS_AMBIGUOUS_EDIT",
    );
  }
  return {
    content: content.split(oldNorm).join(newNorm),
    replacements,
  };
}

/**
 * Abort boundary mirroring the peer's `throwIfAborted`.
 * @param {AbortSignal|undefined} signal - the caller's signal.
 * @param {string} verb - the operation being attempted, for the message.
 * @throws {FsCodedError} with `FS_ABORTED` when the signal is done.
 */
export function throwIfAborted(signal, verb) {
  if (signal?.aborted) {
    throw new FsCodedError(`${verb} aborted`, "FS_ABORTED", signal.reason instanceof Error ? signal.reason : undefined);
  }
}
