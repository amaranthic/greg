/**
 * @fileoverview Authoritative barrel export for the Greg hooks system.
 * @packageDocumentation
 */

export {
  commandHookSchema,
  promptHookSchema,
  hookCommandSchema,
  hookMatcherSchema,
  hooksConfigSchema,
  hookTypeSchema,
  hookEventSchema,
  type CommandHook,
  type PromptHook,
  type HookCommand,
  type HookMatcher,
  type HooksConfig,
  type HookType,
  type HookEvent,
  type HookInput,
  type HookOutput,
} from "./types.js";

export {
  loadHooksConfig,
  getHooksFilePath,
  getGlobalHooksFilePath,
  type ResolvedHooksConfig,
} from "./loader.js";

export { matchesToolNamePattern, evaluateIfCondition, resolveMatchingHooks } from "./matcher.js";

export {
  executeCommandHook,
  buildHookEnvironment,
  killAllActiveHookProcesses,
  type CommandHookResult,
  type CommandHookExecutionOptions,
} from "./runner.js";

export {
  executePromptHook,
  resolvePromptHookCandidateModels,
  parseEvaluatorDecision,
  type PromptHookResult,
  type PromptHookExecutionOptions,
} from "./promptHook.js";
