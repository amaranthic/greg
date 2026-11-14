/**
 * @fileoverview Authoritative barrel export for the output and logging module.
 * @packageDocumentation
 */

export { stdoutGuardMarker, installStreamJsonStdoutGuard, restoreStdoutGuard } from "./guard.js";

export {
  createOutputSink,
  TextSink,
  JsonSink,
  StreamJsonSink,
  type OutputFormat,
  type OutputSink,
  type OutputSinkOptions,
  type PermissionDenialRecord,
  type RunMetrics,
} from "./sink.js";

export { StderrLogger } from "./log.js";
