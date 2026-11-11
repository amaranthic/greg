/**
 * @fileoverview Authoritative barrel export for the core execution microkernel.
 * @packageDocumentation
 */

export { readPipedStdin } from "./input.js";

export { SignalLifecycle } from "./signals.js";

export { executePrintRun, type ExecutionOptions } from "./engine.js";
