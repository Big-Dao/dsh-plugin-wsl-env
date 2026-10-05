/**
 * @param {string} verb - the operation being attempted, for the message.
 * @param {string} displayPath - the caller-facing path.
 * @returns {FsCodedError} the structured not-text failure.
 */
export function notTextError(verb: string, displayPath: string): FsCodedError;
/**
 * Decode a buffer as strict UTF-8, rejecting invalid byte sequences the way
 * the peer's fsio does.
 * @param {Buffer} buffer - the bytes to decode.
 * @param {string} verb - the operation being attempted, for the message.
 * @param {string} displayPath - the caller-facing path.
 * @returns {string} the decoded text.
 * @throws {FsCodedError} with `FS_NOT_TEXT` on invalid UTF-8.
 */
export function decodeUtf8(buffer: Buffer, verb: string, displayPath: string): string;
/**
 * Decode one streamed chunk, carrying multi-byte sequences across chunks.
 * @param {import("node:util").TextDecoder} decoder - the streaming decoder owned by the caller.
 * @param {Buffer|undefined} chunk - the next chunk, or `undefined` to flush.
 * @param {string} verb - the operation being attempted, for the message.
 * @param {string} displayPath - the caller-facing path.
 * @returns {string} the decoded text.
 * @throws {FsCodedError} with `FS_NOT_TEXT` on invalid UTF-8.
 */
export function decodeUtf8Stream(decoder: import("node:util").TextDecoder, chunk: Buffer | undefined, verb: string, displayPath: string): string;
/**
 * Collapse CRLF to LF — the canonical in-memory form every edit/diff basis uses.
 * @param {string} content - the text to normalize.
 * @returns {string} the text with every CRLF collapsed to LF.
 */
export function normalizeLineEndings(content: string): string;
/** @param {string} raw - decoded text in whatever line-ending style the file had. */
export function detectLineEndings(raw: string): "CRLF" | "LF";
/**
 * Convert LF-normalized content back to the style detected at read time.
 * @param {string} content - the LF-normalized (edited) text.
 * @param {"LF"|"CRLF"} lineEndings - the original file's style.
 * @returns {string} the content in the original file's line-ending style.
 */
export function restoreLineEndings(content: string, lineEndings: "LF" | "CRLF"): string;
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
export function applyLiteralEdit(content: string, oldString: string, newString: string, replaceAll: boolean | undefined, displayPath: string): {
    content: string;
    replacements: number;
};
/**
 * Abort boundary mirroring the peer's `throwIfAborted`.
 * @param {AbortSignal|undefined} signal - the caller's signal.
 * @param {string} verb - the operation being attempted, for the message.
 * @throws {FsCodedError} with `FS_ABORTED` when the signal is done.
 */
export function throwIfAborted(signal: AbortSignal | undefined, verb: string): void;
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
export const BINARY_SAMPLE_BYTES: 8192;
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
    constructor(message: string, code: string, cause?: Error);
    code: string;
}
