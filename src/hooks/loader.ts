/**
 * @fileoverview Loader and merger for Greg hooks configuration files.
 * @packageDocumentation
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { hooksConfigSchema, type HookEvent, type HookMatcher, type HooksConfig } from "./types.js";

/**
 * Resolved, merged collection of hook matchers categorized by lifecycle event.
 */
export interface ResolvedHooksConfig {
  /** Ordered PreToolUse matchers. Project matchers precede global matchers. */
  readonly PreToolUse: readonly HookMatcher[];
  /** Ordered PostToolUse matchers. Project matchers precede global matchers. */
  readonly PostToolUse: readonly HookMatcher[];
  /** Ordered Start matchers. Project matchers precede global matchers. */
  readonly Start: readonly HookMatcher[];
  /** Ordered Stop matchers. Project matchers precede global matchers. */
  readonly Stop: readonly HookMatcher[];
}

/**
 * Empty resolved hooks configuration fallback.
 */
const emptyResolvedHooks: ResolvedHooksConfig = {
  PreToolUse: [],
  PostToolUse: [],
  Start: [],
  Stop: [],
};

/**
 * Resolves the canonical file path to the hooks configuration JSON file.
 *
 * @param baseDir - Directory containing the .greg folder or home directory.
 * @returns Fully qualified path to hooks.json.
 */
export function getHooksFilePath(baseDir: string): string {
  return path.join(baseDir, ".greg", "config", "hooks.json");
}

/**
 * Resolves the canonical file path to the global hooks configuration JSON file.
 *
 * @param homeDir - User home directory (e.g. ~/.greg).
 * @returns Fully qualified path to global hooks.json.
 */
export function getGlobalHooksFilePath(homeDir: string): string {
  return path.join(homeDir, "config", "hooks.json");
}

/**
 * Safely reads and validates a single hooks.json file.
 * Returns null if the file does not exist.
 *
 * @param filePath - Path to hooks.json file.
 * @returns Parsed HooksConfig or null.
 */
async function readHooksFile(filePath: string): Promise<HooksConfig | null> {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const rawContent = await readFile(filePath, "utf-8");
    const parsedJson: unknown = JSON.parse(rawContent);
    return hooksConfigSchema.parse(parsedJson);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load hooks configuration from "${filePath}": ${message}`);
  }
}

/**
 * Resolves the effective hooks configuration for a Greg execution.
 *
 * Loading rules:
 *   1. Project config: `<workingDirectory>/.greg/config/hooks.json`
 *   2. Global config: `<homeDir>/config/hooks.json`
 *      (skipped if project config declares `disableGlobalHooks: true`)
 *
 * If either config sets `disableAllHooks: true`, an empty configuration is returned.
 * Project matchers precede global matchers in execution order.
 *
 * @param workingDirectory - Project root directory.
 * @param homeDir - Greg home directory (defaults to ~/.greg equivalent).
 * @returns A promise resolving to the merged ResolvedHooksConfig.
 *
 * @example
 * ```typescript
 * const hooks = await loadHooksConfig(process.cwd(), "/home/user/.greg");
 * console.log(`Loaded ${hooks.PreToolUse.length} PreToolUse matchers`);
 * ```
 */
export async function loadHooksConfig(
  workingDirectory: string,
  homeDir: string,
): Promise<ResolvedHooksConfig> {
  const projectHooksPath = getHooksFilePath(workingDirectory);
  const globalHooksPath = getGlobalHooksFilePath(homeDir);

  const projectConfig = await readHooksFile(projectHooksPath);

  // If project config disables all hooks, fail-closed immediately with empty hooks
  if (projectConfig?.disableAllHooks) {
    return emptyResolvedHooks;
  }

  let globalConfig: HooksConfig | null = null;
  const skipGlobal = projectConfig?.disableGlobalHooks === true;

  if (!skipGlobal && projectHooksPath !== globalHooksPath) {
    globalConfig = await readHooksFile(globalHooksPath);
  }

  // If global config disables all hooks, return empty hooks
  if (globalConfig?.disableAllHooks) {
    return emptyResolvedHooks;
  }

  const events: readonly HookEvent[] = ["PreToolUse", "PostToolUse", "Start", "Stop"];

  const merged: Record<HookEvent, HookMatcher[]> = {
    PreToolUse: [],
    PostToolUse: [],
    Start: [],
    Stop: [],
  };

  for (const event of events) {
    const projectMatchers = projectConfig?.hooks[event] ?? [];
    const globalMatchers = globalConfig?.hooks[event] ?? [];

    merged[event] = [...projectMatchers, ...globalMatchers];
  }

  return merged;
}
