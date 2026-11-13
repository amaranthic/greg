/**
 * @fileoverview Tool catalogue visibility filtering with fail-closed semantics.
 * @packageDocumentation
 */

import type { PermissionMode } from "../settings/index.js";

/** All standard built-in tools supported by the Hernex runtime. */
export const allBuiltInToolNames: readonly string[] = [
  "readFile",
  "writeFile",
  "editFile",
  "glob",
  "grep",
  "bash",
  "taskManager",
  "webFetch",
  "webSearch",
];

/** Read-only tools exposed during plan mode reconnaissance. */
export const planModeToolNames: readonly string[] = [
  "readFile",
  "glob",
  "grep",
  "webFetch",
  "webSearch",
];

/**
 * Filters the active tool catalogue based on CLI filter flags and permission mode.
 *
 * Invariants:
 * 1. An empty filter string (`""`) or empty array **fails closed**, exposing zero tools.
 * 2. In `plan` mode, mutating and shell tools are excluded from the model catalogue.
 * 3. Passing `"default"` or undefined exposes the full catalogue appropriate for the mode.
 *
 * @param filterInput - Raw string or list of tool names (e.g. "default", "readFile,bash", or "").
 * @param mode - Active permission mode.
 * @returns Set of tool names to register with the engine.
 *
 * @example
 * ```typescript
 * const tools = resolveExposedTools("readFile,writeFile", "default");
 * // => Set { "readFile", "writeFile" }
 *
 * const empty = resolveExposedTools("", "default");
 * // => Set {} (fails closed)
 * ```
 */
export function resolveExposedTools(
  filterInput?: string | readonly string[],
  mode: PermissionMode = "default",
): Set<string> {
  // If explicitly empty, fail closed immediately
  if (filterInput !== undefined) {
    if (typeof filterInput === "string") {
      const trimmed = filterInput.trim();
      if (trimmed.length === 0) {
        return new Set();
      }
    } else if (Array.isArray(filterInput) && filterInput.length === 0) {
      return new Set();
    }
  }

  let candidates: string[];

  if (filterInput === undefined || filterInput === "default") {
    candidates = mode === "plan" ? [...planModeToolNames] : [...allBuiltInToolNames];
  } else {
    const rawTokens: readonly string[] =
      typeof filterInput === "string" ? filterInput.split(",") : filterInput;

    candidates = rawTokens
      .map((token: string) => token.trim())
      .filter((token: string) => token.length > 0);
  }

  // Filter against mode restrictions (plan mode excludes mutations)
  if (mode === "plan") {
    candidates = candidates.filter((name) =>
      planModeToolNames.map((n) => n.toLowerCase()).includes(name.toLowerCase()),
    );
  }

  // Match canonical tool casing from allBuiltInToolNames
  const resolved = new Set<string>();
  for (const candidate of candidates) {
    const matched = allBuiltInToolNames.find(
      (builtIn) => builtIn.toLowerCase() === candidate.toLowerCase(),
    );
    if (matched) {
      resolved.add(matched);
    }
  }

  return resolved;
}
