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

/**
 * Asynchronously yields raw message lines or user prompt strings from a stream-json stdin feed.
 *
 * @returns AsyncGenerator yielding validated user prompt strings extracted from stream-json lines.
 */
export async function* readStreamJsonLines(): AsyncGenerator<string, void, void> {
  if (process.stdin.isTTY) {
    return;
  }

  let buffer = "";
  for await (const chunk of process.stdin) {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    buffer += text;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (trimmed.length === 0) {
        continue;
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === "object" && parsed !== null) {
          if (parsed.type === "user" && typeof parsed.message === "string") {
            yield parsed.message;
          } else if (typeof parsed.prompt === "string") {
            yield parsed.prompt;
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  if (buffer.trim().length > 0) {
    try {
      const parsed = JSON.parse(buffer.trim());
      if (typeof parsed === "object" && parsed !== null) {
        if (parsed.type === "user" && typeof parsed.message === "string") {
          yield parsed.message;
        } else if (typeof parsed.prompt === "string") {
          yield parsed.prompt;
        }
      }
    } catch {
      // Skip trailing malformed
    }
  }
}
