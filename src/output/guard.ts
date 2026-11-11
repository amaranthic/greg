/**
 * @fileoverview Stream guard diverting stray non-JSON writes to stderr during stream-json output.
 * @packageDocumentation
 */

/**
 * Sentinel marker prefixed to diverted non-JSON lines on standard error.
 */
export const stdoutGuardMarker = "[stdout-guard]";

let isInstalled = false;
let isWriting = false;
let writeBuffer = "";
let originalStdoutWrite: typeof process.stdout.write | null = null;

/**
 * Tests whether a line represents valid JSON or an empty whitespace separator.
 *
 * @param line - Line content to inspect.
 * @returns True if line parses cleanly as JSON or is blank.
 */
function isJsonLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return true;
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Installs an intercepting guard on `process.stdout.write` when `--output-format=stream-json` is active.
 *
 * Incoming writes are buffered line-by-line. Valid NDJSON lines pass through to standard output;
 * any unformatted string (e.g. debug logs, library banners, unhandled traces) is diverted to
 * `process.stderr` with a `[stdout-guard]` tag so machine clients never receive broken JSON streams.
 *
 * @example
 * ```typescript
 * installStreamJsonStdoutGuard();
 * ```
 */
export function installStreamJsonStdoutGuard(): void {
  if (isInstalled) {
    return;
  }
  isInstalled = true;

  originalStdoutWrite = process.stdout.write.bind(process.stdout);

  // Override stdout write function
  process.stdout.write = function (
    chunk: string | Uint8Array,
    encodingOrCb?: BufferEncoding | ((err?: Error) => void),
    callback?: (err?: Error) => void,
  ): boolean {
    if (isWriting || !originalStdoutWrite) {
      return originalStdoutWrite
        ? originalStdoutWrite(chunk, encodingOrCb as any, callback as any)
        : true;
    }

    isWriting = true;
    try {
      const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");

      writeBuffer += text;
      let newlineIndex: number;

      while ((newlineIndex = writeBuffer.indexOf("\n")) !== -1) {
        const line = writeBuffer.slice(0, newlineIndex);
        writeBuffer = writeBuffer.slice(newlineIndex + 1);

        if (isJsonLine(line)) {
          originalStdoutWrite(`${line}\n`, "utf-8");
        } else {
          process.stderr.write(`${stdoutGuardMarker} ${line}\n`, "utf-8");
        }
      }
    } finally {
      isWriting = false;
    }

    if (typeof encodingOrCb === "function") {
      encodingOrCb();
    } else if (typeof callback === "function") {
      callback();
    }

    return true;
  } as typeof process.stdout.write;
}

/**
 * Restores original unhooked `process.stdout.write` functionality.
 */
export function restoreStdoutGuard(): void {
  if (!isInstalled || !originalStdoutWrite) {
    return;
  }
  // Flush remaining writeBuffer if any
  if (writeBuffer.length > 0) {
    if (isJsonLine(writeBuffer)) {
      originalStdoutWrite(`${writeBuffer}\n`, "utf-8");
    } else {
      process.stderr.write(`${stdoutGuardMarker} ${writeBuffer}\n`, "utf-8");
    }
    writeBuffer = "";
  }

  process.stdout.write = originalStdoutWrite;
  originalStdoutWrite = null;
  isInstalled = false;
}
