/**
 * @fileoverview Authoritative barrel export for general utilities.
 * @packageDocumentation
 */

export { parseDurationMs, formatDuration, formatBytes } from "./format.js";

export { writeToStdout, writeToStderr, gracefulExit } from "./process.js";
