/**
 * @fileoverview Safe standard stream I/O and graceful process termination helpers.
 * @packageDocumentation
 */

import type { ExitCode } from "../constants/index.js";

/**
 * Writes text directly to standard output.
 *
 * @param text - Text string to write.
 */
export function writeToStdout(text: string): void {
  process.stdout.write(text);
}

/**
 * Writes text directly to standard error.
 *
 * @param text - Text string to write.
 */
export function writeToStderr(text: string): void {
  process.stderr.write(text);
}

/**
 * Flushes active streams and terminates the current process with the given exit code.
 *
 * @param code - POSIX exit code to exit with.
 */
export function gracefulExit(code: ExitCode | number): never {
  process.exit(code);
}
