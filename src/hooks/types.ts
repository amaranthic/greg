/**
 * @fileoverview Zod v4 schemas and TypeScript types for Greg's hooks configuration system.
 * @packageDocumentation
 */

import { z } from "zod";

/**
 * Supported hook execution types in Greg. Agent-type hooks are intentionally omitted.
 */
export const hookTypeSchema = z.enum(["command", "prompt"]);

/**
 * Type representing one of the allowed hook execution types.
 */
export type HookType = z.infer<typeof hookTypeSchema>;

/**
 * Supported hook events that Greg fires during the agent lifecycle.
 */
export const hookEventSchema = z.enum([
  "PreToolUse",
  "PostToolUse",
  "UserPromptSubmit",
  "Stop",
]);

/**
 * Type representing one of the valid hook event names.
 */
export type HookEvent = z.infer<typeof hookEventSchema>;

/**
 * Schema for a shell command hook.
 * Spawns a child process, feeds HookInput JSON on stdin, and reads exit code + stdout.
 */
export const commandHookSchema = z.object({
  /** Hook execution mechanism discriminator. */
  type: z.literal("command"),
  /** Shell command string to execute. */
  command: z.string().min(1),
  /**
   * Optional tool-scoped filter using permission rule syntax (e.g. "Bash(git push *)").
   * Evaluated before spawning to avoid unnecessary subprocess overhead.
   */
  if: z.string().optional(),
  /** Shell interpreter; defaults to bash. */
  shell: z.enum(["bash", "powershell"]).default("bash"),
  /** Timeout in seconds before the child process is killed. Defaults to 60s. */
  timeout: z.number().positive().default(60),
  /** Text shown in CLI output while this hook is running. */
  statusMessage: z.string().optional(),
  /** If true, deregistered automatically after one successful execution. */
  once: z.boolean().default(false),
  /**
   * Additional environment variables injected into the child process environment.
   * Values may reference the parent process environment with $VAR_NAME syntax.
   */
  env: z.record(z.string(), z.string()).optional(),
});

/**
 * Type representing a validated command hook configuration.
 */
export type CommandHook = z.infer<typeof commandHookSchema>;

/**
 * Schema for a prompt-based LLM evaluation hook.
 * Runs an isolated, ephemeral, in-memory generateText call with read-only tools.
 * No messages, tool calls, or transcript data are persisted to disk.
 */
export const promptHookSchema = z.object({
  /** Hook execution mechanism discriminator. */
  type: z.literal("prompt"),
  /**
   * Evaluation instruction for the LLM. Use $ARGUMENTS as a placeholder for the
   * JSON-serialized HookInput that is substituted at runtime.
   */
  prompt: z.string().min(1),
  /**
   * Optional additional instructions appended to the base evaluator system prompt.
   * Use to provide domain-specific rules without replacing the standard verification framing.
   */
  appendSystemPrompt: z.string().optional(),
  /**
   * Primary model in "provider/modelId" format (e.g. "google/gemini-2.5-flash").
   * If omitted, falls back to Greg's currently active runtime model.
   */
  model: z.string().optional(),
  /**
   * Ordered fallback models tried left-to-right if the primary model fails or times out.
   * Each entry must be "provider/modelId" format.
   *
   * NOTE: Unlike Greg's main engine fallback resolution — which performs strict fail-fast
   * validation at startup and throws if any fallback provider is unrecognized — prompt hook
   * fallbacks use graceful skipping. If a provider is unrecognized, the API key is missing,
   * or the model string is malformed, that candidate is silently bypassed and the next entry
   * is attempted. This prevents a misconfigured hook fallback from aborting the agent run.
   */
  fallbackModels: z.array(z.string()).default([]),
  /** Timeout in seconds for the LLM evaluation call. Defaults to 30s. */
  timeout: z.number().positive().default(30),
  /** Text shown in CLI output while this hook is evaluating. */
  statusMessage: z.string().optional(),
  /** If true, deregistered automatically after one successful execution. */
  once: z.boolean().default(false),
});

/**
 * Type representing a validated prompt hook configuration.
 */
export type PromptHook = z.infer<typeof promptHookSchema>;

/**
 * Discriminated union of all supported hook execution types.
 */
export const hookCommandSchema = z.discriminatedUnion("type", [
  commandHookSchema,
  promptHookSchema,
]);

/**
 * Type representing any validated hook command (command or prompt).
 */
export type HookCommand = z.infer<typeof hookCommandSchema>;

/**
 * A matcher entry binding a tool name pattern to one or more hooks.
 * The `matcher` field is matched against the tool name using pipe-separated
 * exact names, wildcards, or regex.
 */
export const hookMatcherSchema = z.object({
  /**
   * Pattern matched against the tool name (e.g. "Bash", "Bash|Write", "*", or regex).
   * Omit or set to "*" to match all tools.
   */
  matcher: z.string().optional(),
  /** One or more hooks to execute when the matcher matches. */
  hooks: z.array(hookCommandSchema).min(1),
});

/**
 * Type representing a hook matcher binding pattern to commands.
 */
export type HookMatcher = z.infer<typeof hookMatcherSchema>;

/**
 * Top-level hooks configuration file schema for `.greg/config/hooks.json`
 * and `~/.greg/config/hooks.json`.
 */
export const hooksConfigSchema = z.object({
  /**
   * When true in the project hooks.json (.greg/config/hooks.json), the global
   * hooks file (~/.greg/config/hooks.json) is entirely ignored for this project.
   * This provides project-level isolation from developer-global hook scripts.
   */
  disableGlobalHooks: z.boolean().default(false),
  /**
   * Master kill-switch that disables all hook execution without deleting configuration.
   * Useful for debugging or temporarily suspending hooks in a project or globally.
   */
  disableAllHooks: z.boolean().default(false),
  /** Hook matchers grouped by lifecycle event. */
  hooks: z
    .object({
      PreToolUse: z.array(hookMatcherSchema).optional(),
      PostToolUse: z.array(hookMatcherSchema).optional(),
      UserPromptSubmit: z.array(hookMatcherSchema).optional(),
      Stop: z.array(hookMatcherSchema).optional(),
    })
    .default({}),
});

/**
 * Type representing the fully parsed hooks configuration file.
 */
export type HooksConfig = z.infer<typeof hooksConfigSchema>;

/**
 * The structured JSON payload fed to hook child processes on stdin.
 * Fields are intentionally minimal — only what is needed.
 */
export interface HookInput {
  /** Greg session identifier. */
  readonly sessionId: string;
  /** The hook lifecycle event that fired. */
  readonly hookEvent: HookEvent;
  /** Absolute path to the project root directory. */
  readonly projectDir: string;
  /** Active working directory. */
  readonly cwd: string;
  /** Active model string (provider/modelId). */
  readonly model: string;
  /** Current agent turn index (1-based). */
  readonly turnIndex: number;
  /** Tool name, present for PreToolUse and PostToolUse events. */
  readonly toolName?: string | undefined;
  /** Serialized tool input arguments, present for PreToolUse and PostToolUse events. */
  readonly toolInput?: unknown | undefined;
  /** Tool execution status, present for PostToolUse events. */
  readonly toolStatus?: "success" | "error" | undefined;
  /** Tool execution duration in milliseconds, present for PostToolUse events. */
  readonly toolDurationMs?: number | undefined;
  /** User prompt text, present for UserPromptSubmit events. */
  readonly userPrompt?: string | undefined;
  /** Last assistant message text, present for Stop events. */
  readonly lastAssistantMessage?: string | undefined;
}

/**
 * Structured JSON output optionally returned by hook child processes on stdout.
 * All fields are optional — a hook may emit no stdout and simply rely on its exit code.
 */
export interface HookOutput {
  /**
   * Explicit block decision. When "block", the tool call or turn is denied using
   * the `reason` field as the explanation.
   */
  readonly decision?: "block";
  /** Human-readable reason accompanying a block decision. */
  readonly reason?: string;
  /**
   * Updated tool input arguments. When present on a PreToolUse hook, Greg replaces
   * the original tool arguments with this object before executing the tool.
   */
  readonly updatedInput?: Record<string, unknown>;
  /**
   * Additional context text to inject into the LLM conversation context.
   * The model sees this as supplementary information before generating the next response.
   */
  readonly additionalContext?: string;
}
