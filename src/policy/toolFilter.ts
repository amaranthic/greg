/**
 * @fileoverview Tool catalogue visibility filtering with fail-closed semantics.
 * @packageDocumentation
 */

import type { PermissionMode } from "../settings/index.js";

/** Canonical user-facing tool names allowed in CLI flags and settings.json rules. */
export const userFacingToolNames = [
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
  "WebFetch",
  "WebSearch",
] as const;

/** Union type representing authorized user-facing tool names. */
export type UserFacingToolName = (typeof userFacingToolNames)[number];

/** Canonical Hernex built-in tool names exposed by the agent runtime. */
export const allBuiltInToolNames: readonly string[] = [
  "readFile",
  "writeFile",
  "editFile",
  "bash",
  "taskManager",
  "glob",
  "grep",
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

/** Mapping between user-facing PascalCase names and internal Hernex tool identifiers. */
const userToHernexMap: Record<UserFacingToolName, string> = {
  Read: "readFile",
  Write: "writeFile",
  Edit: "editFile",
  Bash: "bash",
  Glob: "glob",
  Grep: "grep",
  WebFetch: "webFetch",
  WebSearch: "webSearch",
};

/** Mapping between internal Hernex identifiers and user-facing PascalCase names. */
const hernexToUserMap: Record<string, UserFacingToolName> = {
  readFile: "Read",
  writeFile: "Write",
  editFile: "Edit",
  bash: "Bash",
  glob: "Glob",
  grep: "Grep",
  webFetch: "WebFetch",
  webSearch: "WebSearch",
  Read: "Read",
  Write: "Write",
  Edit: "Edit",
  Bash: "Bash",
  Glob: "Glob",
  Grep: "Grep",
  WebFetch: "WebFetch",
  WebSearch: "WebSearch",
};

/**
 * Translates a user-facing PascalCase tool name to its canonical Hernex internal identifier.
 *
 * @param userTool - User-facing tool name (e.g. "Read", "Bash").
 * @returns Canonical Hernex tool name (e.g. "readFile", "bash").
 * @throws {Error} If tool name is invalid or unrecognized.
 *
 * @example
 * ```typescript
 * toHernexToolName("Read"); // => "readFile"
 * ```
 */
export function toHernexToolName(userTool: string): string {
  if (userTool === "TaskManager" || userTool.toLowerCase() === "taskmanager") {
    throw new Error(
      `Invalid tool "TaskManager": TaskManager cannot be configured directly; it is coupled to Bash.`,
    );
  }

  const mapped = userToHernexMap[userTool as UserFacingToolName];
  if (!mapped) {
    throw new Error(
      `Invalid tool "${userTool}". Allowed tools are: ${userFacingToolNames.join(", ")}. Note that TaskManager is coupled to Bash.`,
    );
  }

  return mapped;
}

/**
 * Translates a canonical Hernex tool identifier to its user-facing PascalCase name.
 *
 * @param hernexTool - Canonical Hernex tool name (e.g. "readFile", "bash").
 * @returns User-facing PascalCase tool name (e.g. "Read", "Bash"), or undefined if internal.
 *
 * @example
 * ```typescript
 * toUserFacingToolName("readFile"); // => "Read"
 * ```
 */
export function toUserFacingToolName(hernexTool: string): UserFacingToolName | undefined {
  return hernexToUserMap[hernexTool];
}

/**
 * Filters the active tool catalogue based on CLI filter flags and permission mode.
 *
 * Invariants:
 * 1. An empty filter string (`""`) or empty array **fails closed**, exposing zero tools.
 * 2. In `plan` mode, mutating and shell tools are excluded from the model catalogue.
 * 3. Passing `"default"` or undefined exposes the full catalogue appropriate for the mode.
 * 4. TaskManager is automatically coupled to Bash: exposing Bash exposes TaskManager.
 *
 * @param filterInput - Raw string or list of tool names (e.g. "default", "Read,Bash", or "").
 * @param mode - Active permission mode.
 * @returns Set of Hernex tool names to register with the engine.
 *
 * @example
 * ```typescript
 * const tools = resolveExposedTools("Read,Write", "default");
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

  if (filterInput === undefined || filterInput === "default") {
    if (mode === "plan") {
      return new Set(planModeToolNames);
    }
    return new Set(allBuiltInToolNames);
  }

  const rawTokens: readonly string[] =
    typeof filterInput === "string" ? filterInput.split(",") : filterInput;

  const userTokens = rawTokens
    .map((token: string) => token.trim())
    .filter((token: string) => token.length > 0);

  const resolved = new Set<string>();

  for (const token of userTokens) {
    const hernexName = toHernexToolName(token);
    resolved.add(hernexName);
    if (token === "Bash") {
      // Coupling Invariant: TaskManager is coupled to Bash
      resolved.add("taskManager");
    }
  }

  // Filter against mode restrictions (plan mode excludes mutations and shell)
  if (mode === "plan") {
    for (const tool of resolved) {
      if (!planModeToolNames.includes(tool)) {
        resolved.delete(tool);
      }
    }
  }

  return resolved;
}
