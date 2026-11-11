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
