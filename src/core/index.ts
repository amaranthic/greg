/**
 * @fileoverview Authoritative barrel export for the core execution microkernel.
 * @packageDocumentation
 */

export { readPipedStdin, readStreamJsonLines } from "./input.js";

export { SignalLifecycle } from "./signals.js";

export { executePrintRun, validateAgainstJsonSchema, type ExecutionOptions } from "./engine.js";
