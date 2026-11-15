/**
 * @fileoverview Pattern matching engine for hook tool matchers and `if` conditions.
 * @packageDocumentation
 */

import { extractToolTarget, matchesToolRule } from "../policy/index.js";
import type { HookCommand, HookMatcher } from "./types.js";

/**
 * Checks whether a given tool name matches a hook matcher string pattern.
 *
 * Matching semantics:
 *   - Empty, undefined, or "*": matches all tools unconditionally.
 *   - Pipe-separated alphanumeric (e.g. "Bash|Write|Edit"): matches if toolName matches any segment.
 *   - Regex pattern: compiled to RegExp and tested.
 *
 * @param toolName - Target tool name to test (e.g. "Bash", "Write").
 * @param matcherPattern - Matcher expression from hooks.json.
 * @returns True if the tool name satisfies the pattern.
 *
 * @example
 * ```typescript
 * matchesToolNamePattern("Bash", "Bash|Write"); // => true
 * matchesToolNamePattern("Read", "*");          // => true
 * matchesToolNamePattern("Bash", "^(Bash)$");   // => true
 * ```
 */
export function matchesToolNamePattern(toolName: string, matcherPattern?: string): boolean {
  if (!matcherPattern || matcherPattern.trim() === "" || matcherPattern.trim() === "*") {
    return true;
  }

  const trimmed = matcherPattern.trim();

  // Pipe-separated or simple exact token matching
  if (/^[a-zA-Z0-9_|]+$/.test(trimmed)) {
    const candidates = trimmed.split("|").map((token) => token.trim());
    return candidates.includes(toolName);
  }

  // Regular expression fallback
  try {
    const regex = new RegExp(trimmed);
    return regex.test(toolName);
  } catch {
    return false;
  }
}

/**
 * Evaluates a hook command's optional `if` condition against a tool call.
 * Uses Greg's existing permission rule matching engine (`matchesToolRule`).
 *
 * @param toolName - Target tool name.
 * @param toolInput - Arguments passed to the tool.
 * @param workingDirectory - Execution working directory.
 * @param ifCondition - Permission rule string (e.g. "Bash(git push *)").
 * @returns True if the tool invocation satisfies the `if` condition.
 *
 * @example
 * ```typescript
 * evaluateIfCondition("Bash", { command: "git push origin main" }, process.cwd(), "Bash(git push *)");
 * // => true
 * ```
 */
export function evaluateIfCondition(
  toolName: string,
  toolInput: unknown,
  workingDirectory: string,
  ifCondition?: string,
): boolean {
  if (!ifCondition || ifCondition.trim() === "") {
    return true;
  }

  const target = extractToolTarget(toolName, toolInput, workingDirectory);
  return matchesToolRule(ifCondition.trim(), toolName, target);
}

/**
 * Resolves all HookCommand instances from a matcher list that match the target tool
 * and satisfy their `if` condition pre-filters.
 *
 * @param matchers - Configured hook matchers for the event.
 * @param toolName - Tool name being evaluated (optional for non-tool events).
 * @param toolInput - Tool input parameters (optional for non-tool events).
 * @param workingDirectory - Active working directory.
 * @returns Ordered array of active HookCommands ready to execute.
 *
 * @example
 * ```typescript
 * const hooks = resolveMatchingHooks(matchers, "Bash", { command: "ls" }, process.cwd());
 * ```
 */
export function resolveMatchingHooks(
  matchers: readonly HookMatcher[],
  toolName?: string,
  toolInput?: unknown,
  workingDirectory: string = process.cwd(),
): HookCommand[] {
  const result: HookCommand[] = [];

  for (const matcher of matchers) {
    // If a tool name is present, evaluate the tool name matcher pattern
    if (toolName && !matchesToolNamePattern(toolName, matcher.matcher)) {
      continue;
    }

    for (const hook of matcher.hooks) {
      // Evaluate if condition if toolName and toolInput are provided
      if (toolName && "if" in hook && hook.if) {
        const matchesIf = evaluateIfCondition(toolName, toolInput, workingDirectory, hook.if);
        if (!matchesIf) {
          continue;
        }
      }

      result.push(hook);
    }
  }

  return result;
}
