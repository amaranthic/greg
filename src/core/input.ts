/**
 * @fileoverview Safe piped standard input ingestion with maximum buffer byte limit protection.
 * @packageDocumentation
 */

import { maxStdinBufferBytes } from "../constants/index.js";

/**
 * Reads all incoming data from process.stdin when input is piped into the process.
 * If stdin is attached to a TTY (interactive terminal), immediately returns undefined.
 * Enforces a strict byte ceiling to protect against unbounded memory consumption.
 *
 * @param maxBytes - Maximum byte capacity before truncating (defaults to 512 KiB).
 * @returns Promise resolving to the UTF-8 piped string, or undefined if not piped.
 *
 * @example
 * ```typescript
 * const piped = await readPipedStdin();
 * if (piped) {
 *   prompt = `${piped}\n\n${userPrompt}`;
 * }
 * ```
 */
export async function readPipedStdin(
  maxBytes: number = maxStdinBufferBytes,
): Promise<string | undefined> {
  // If standard input is connected directly to a terminal, no piped input is waiting
  if (process.stdin.isTTY) {
    return undefined;
  }

  return new Promise<string | undefined>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    const onData = (chunk: Buffer | string): void => {
      const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += bufferChunk.length;

      if (totalBytes > maxBytes) {
        process.stdin.removeListener("data", onData);
        process.stdin.removeListener("end", onEnd);
        process.stdin.removeListener("error", onError);
        reject(
          new Error(
            `Piped standard input exceeded maximum allowable ceiling of ${maxBytes} bytes (512 KiB)`,
          ),
        );
        return;
      }

      chunks.push(bufferChunk);
    };

    const onEnd = (): void => {
      cleanup();
      if (chunks.length === 0) {
        resolve(undefined);
        return;
      }
      const aggregated = Buffer.concat(chunks).toString("utf-8").trim();
      resolve(aggregated.length > 0 ? aggregated : undefined);
    };

    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };

    const cleanup = (): void => {
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", onEnd);
      process.stdin.removeListener("error", onError);
    };

    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);
    process.stdin.resume();
  });
}
