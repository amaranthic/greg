/**
 * @fileoverview Central application constants, exit codes, and default provider configuration.
 * @packageDocumentation
 */

import packageJson from "../../package.json" with { type: "json" };

/**
 * The current published package version for `@amaranthic/greg`.
 */
export const gregVersion: string = packageJson.version || "0.0.0";

/**
 * Standard POSIX exit codes emitted by the print agent runtime.
 */
export const exitCodes = {
  /** Execution completed successfully without error. */
  success: 0,
  /** Runtime error, model failure, or execution exception. */
  runtimeError: 1,
  /** Fail-closed permission check denied execution. */
  permissionDenied: 2,
  /** Execution was aborted due to wall-clock timeout. */
  timeout: 4,
} as const;

/**
 * Type representing one of the valid POSIX exit code values.
 */
export type ExitCode = (typeof exitCodes)[keyof typeof exitCodes];

/**
 * Hook subprocess exit code protocol.
 *
 * These codes are intentionally separate from Greg's own process exit codes (`exitCodes`).
 * They define the communication contract between child hook processes and the Greg runtime.
 *
 * Exit code 0: Success. Execution continues. If stdout contains valid JSON with
 *   `{ decision: "block" }`, the tool or turn is denied with the supplied reason.
 *   If stdout contains `{ updatedInput }`, tool arguments are mutated before execution.
 *   If stdout contains `{ additionalContext }`, the text is injected into the LLM context.
 *
 * Exit code 2: Explicit blocking veto. Dedicated veto protocol — aborts tool execution
 *   or prevents turn completion. The hook's stderr is passed directly as the blocking
 *   reason to the LLM or displayed to the user. This mirrors Claude Code's exit code 2
 *   semantics but is applied strictly to hook child processes, never to Greg's own process.
 *
 * Any other non-zero code (e.g. 1, 127): Non-blocking warning. Tool execution is NOT
 *   aborted. The error is logged to stderr and recorded in the run metrics, but the
 *   agent run continues normally.
 */
export const hookExitCodes = {
  /** Hook completed successfully; optionally carries structured JSON output. */
  success: 0,
  /** Explicit blocking veto: aborts tool or prevents stop. stderr is the reason. */
  blockingVeto: 2,
} as const;

/** Type representing the two protocol-significant hook exit code values. */
export type HookExitCode = (typeof hookExitCodes)[keyof typeof hookExitCodes];

/**
 * Built-in default base URLs for each provider supported by the underlying Hernex engine.
 */
export const defaultProviderBaseUrls: Readonly<Record<string, string>> = {
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  openai: "https://api.openai.com/v1",
  deepseek: "https://api.deepseek.com/v1",
  groq: "https://api.groq.com/openai/v1",
  xai: "https://api.x.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  togetherai: "https://api.together.xyz/v1",
  mistral: "https://api.mistral.ai/v1",
  cohere: "https://api.cohere.com/v2",
  alibaba: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  compatible: "http://localhost:8080/v1",
};

/**
 * Default fallback model identifier when no model is explicitly configured.
 */
export const defaultModelString = "dummy";

/**
 * Maximum allowable byte count when ingesting input from standard input (512 KiB).
 */
export const maxStdinBufferBytes = 512 * 1024;

/**
 * Default wall-clock execution timeout in human duration syntax.
 */
export const defaultTimeoutDuration = "30m";

/**
 * Default agent turn loop maximum turn count.
 */
export const defaultMaxTurns = 50;

/**
 * Default sample prompt instruction prepended when input is provided strictly via stdin without an explicit user prompt.
 */
export const defaultStdinPrompt = "Process and respond to the following input:";

/**
 * Maximum character length for derived thread titles.
 */
export const maxThreadTitleLength = 80;
