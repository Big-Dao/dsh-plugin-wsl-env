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
 * This is a TypeScript source built to `lib/fsio-text.js`; edit THIS file and
 * run `pnpm run build` — the artifact under `lib/` is generated, and `pnpm test`
 * fails when it drifts.
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
  /** The `FS_*` token, for callers that must not match on the message. */
  declare code: string;

  /**
   * @param message - human-readable, model-facing.
   * @param code - the `FS_*` token.
   * @param cause - the underlying failure, when there is one.
   */
  constructor(message: string, code: string, cause?: Error) {
    super(message, cause === undefined ? {} : { cause });
    this.name = "FsCodedError";
    this.code = code;
  }
}

/**
 * The structured not-text failure.
 *
 * @param verb - the operation being attempted, for the message.
 * @param displayPath - the caller-facing path.
 * @returns the refusal every decode failure raises.
 */
export function notTextError(verb: string, displayPath: string): FsCodedError {
  return new FsCodedError(`cannot ${verb} "${displayPath}": invalid UTF-8 text`, "FS_NOT_TEXT");
}

/**
 * Decode a buffer as strict UTF-8, rejecting invalid byte sequences the way
 * the peer's fsio does.
 *
 * @param buffer - the bytes to decode.
 * @param verb - the operation being attempted, for the message.
 * @param displayPath - the caller-facing path.
 * @returns the decoded text.
 * @throws {FsCodedError} with `FS_NOT_TEXT` on invalid UTF-8.
 */
export function decodeUtf8(buffer: Buffer, verb: string, displayPath: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw notTextError(verb, displayPath);
  }
}

/**
 * Decode one streamed chunk, carrying multi-byte sequences across chunks.
 *
 * @param decoder - the streaming decoder owned by the caller.
 * @param chunk - the next chunk, or `undefined` to flush.
 * @param verb - the operation being attempted, for the message.
 * @param displayPath - the caller-facing path.
 * @returns the decoded text.
 * @throws {FsCodedError} with `FS_NOT_TEXT` on invalid UTF-8.
 */
export function decodeUtf8Stream(decoder: import("node:util").TextDecoder, chunk: Buffer | undefined, verb: string, displayPath: string): string {
  try {
    return chunk ? decoder.decode(chunk, { stream: true }) : decoder.decode();
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw notTextError(verb, displayPath);
  }
}

/**
 * Collapse CRLF to LF — the canonical in-memory form every edit/diff basis uses.
 *
 * @param content - the text to normalize.
 * @returns the text with every CRLF collapsed to LF.
 */
export function normalizeLineEndings(content: string): string {
  return content.replaceAll("\r\n", "\n");
}

/**
 * The line-ending style a file was read with.
 *
 * @param raw - decoded text in whatever line-ending style the file had.
 * @returns the dominant style of the first 4096 bytes.
 */
export function detectLineEndings(raw: string): "LF" | "CRLF" {
  const sample = raw.slice(0, 4096);
  const crlfCount = sample.split("\r\n").length - 1;
  return crlfCount > sample.split("\n").length - 1 - crlfCount ? "CRLF" : "LF";
}

/**
 * Convert LF-normalized content back to the style detected at read time.
 *
 * @param content - the LF-normalized (edited) text.
 * @param lineEndings - the original file's style.
 * @returns the content in the original file's line-ending style.
 */
export function restoreLineEndings(content: string, lineEndings: "LF" | "CRLF"): string {
  if (lineEndings === "LF") return content;
  return normalizeLineEndings(content).replaceAll("\n", "\r\n");
}

/**
 * Count how many times `search` appears in `content`.
 *
 * @param content - the haystack.
 * @param search - the needle.
 * @returns the occurrence count.
 */
function countOccurrences(content: string, search: string): number {
  return content.split(search).length - 1;
}

/**
 * Apply a literal replacement to LF-normalized content — the peer's edit
 * algorithm, replicated: CRLF inside the needle is normalized before
 * matching, an empty needle is refused, and a multi-match needle is ambiguous
 * unless `replaceAll` is set.
 *
 * @param content - the current file content, already LF-normalized.
 * @param oldString - literal text to find.
 * @param newString - literal replacement text.
 * @param replaceAll - replace every match instead of requiring one.
 * @param displayPath - the caller-facing path for error messages.
 * @returns the edited text and count.
 * @throws {FsCodedError} with `FS_EDIT_NOT_FOUND` or `FS_AMBIGUOUS_EDIT`.
 */
export function applyLiteralEdit(content: string, oldString: string, newString: string, replaceAll: boolean | undefined, displayPath: string): { content: string, replacements: number } {
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
 *
 * @param signal - the caller's signal.
 * @param verb - the operation being attempted, for the message.
 * @throws {FsCodedError} with `FS_ABORTED` when the signal is done.
 */
export function throwIfAborted(signal: AbortSignal | undefined, verb: string): void {
  if (signal?.aborted) {
    throw new FsCodedError(`${verb} aborted`, "FS_ABORTED", signal.reason instanceof Error ? signal.reason : undefined);
  }
}
