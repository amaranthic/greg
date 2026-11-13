/**
 * @fileoverview Pattern compilation and wildcard rule matching engine for tool permissions.
 * @packageDocumentation
 */

import {
  type UserFacingToolName,
  toUserFacingToolName,
  userFacingToolNames,
} from "./toolFilter.js";

/** Placeholder token used to protect escaped asterisks during compilation. */
const escapedStarPlaceholder = "\uE000";

/** Placeholder token used to protect escaped backslashes during compilation. */
const escapedBackslashPlaceholder = "\uE001";

/** Regular expression for restoring protected asterisk placeholders. */
const starPlaceholderRegex = new RegExp(escapedStarPlaceholder, "g");

/** Regular expression for restoring protected backslash placeholders. */
const backslashPlaceholderRegex = new RegExp(escapedBackslashPlaceholder, "g");

/**
 * Compiles a wildcard glob pattern into a full-string regular expression.
 * Supports escaped sequences, wildcard expansion, and optional trailing arguments.
 *
 * @param pattern - Input pattern string with wildcards (e.g. "git *", "src/core/*.ts").
 * @param caseInsensitive - Whether regex matching should ignore case.
 * @returns Executable regular expression anchored to the full string.
 *
 * @example
 * ```typescript
 * const regex = compileWildcardRegex("git *");
 * regex.test("git status"); // => true
 * regex.test("git");        // => true
 * ```
 */
export function compileWildcardRegex(pattern: string, caseInsensitive: boolean = false): RegExp {
  const trimmedPattern = pattern.trim();
  let processed = "";
  let index = 0;

  while (index < trimmedPattern.length) {
    const char = trimmedPattern[index];

    if (char === "\\" && index + 1 < trimmedPattern.length) {
      const nextChar = trimmedPattern[index + 1];
      if (nextChar === "*") {
        processed += escapedStarPlaceholder;
        index += 2;
        continue;
      }
      if (nextChar === "\\") {
        processed += escapedBackslashPlaceholder;
        index += 2;
        continue;
      }
    }

    processed += char;
    index++;
  }

  // Escape standard regex control characters except asterisk
  const escaped = processed.replace(/[.+?^${}()|[\]\\'"]/g, "\\$&");

  // Expand unescaped * to match any character sequence
  const withWildcards = escaped.replace(/\*/g, ".*");

  // Restore literal escape sequence placeholders
  let regexString = withWildcards
    .replace(starPlaceholderRegex, "\\*")
    .replace(backslashPlaceholderRegex, "\\\\");

  // Trailing space-asterisk convenience: "git *" matches both "git add" and bare "git"
  const unescapedStarCount = (processed.match(/\*/g) || []).length;
  if (regexString.endsWith(" .*") && unescapedStarCount === 1) {
    regexString = regexString.slice(0, -3) + "( .*)?";
  }

  const flags = `s${caseInsensitive ? "i" : ""}`;
  return new RegExp(`^${regexString}$`, flags);
}

/**
 * Tests whether a target input matches a wildcard rule pattern.
 *
 * @param pattern - Rule pattern string containing optional asterisks.
 * @param target - The actual runtime string (e.g. shell command, relative file path).
 * @param caseInsensitive - Whether to perform case-insensitive evaluation.
 * @returns True if the target strictly matches the pattern expression.
 *
 * @example
 * ```typescript
 * matchWildcardPattern("src/core/*.ts", "src/core/engine.ts"); // => true
 * ```
 */
export function matchWildcardPattern(
  pattern: string,
  target: string,
  caseInsensitive: boolean = false,
): boolean {
  if (pattern === "*" || pattern === "**") {
    return true;
  }

  const regex = compileWildcardRegex(pattern, caseInsensitive);
  return regex.test(target);
}

/**
 * Structured parsed tool permission rule representation.
 */
export interface ParsedToolRule {
  /** The canonical user-facing PascalCase tool name (e.g. "Bash", "Read", "Write"). */
  readonly toolName: UserFacingToolName;
  /** Inner pattern matched against tool argument target (e.g. "git *", "src/**"). */
  readonly pattern: string;
}

/**
 * Parses a declarative permission rule string into a structured tool and pattern pair.
 * Supports both scoped syntax `ToolName(pattern)` and bare tool names `ToolName`.
 *
 * @param rule - Raw permission rule string (e.g. "Bash(git *)", "Write(src/*)", "Read").
 * @returns ParsedToolRule record.
 * @throws {Error} If tool name is invalid or TaskManager is specified.
 *
 * @example
 * ```typescript
 * const parsed = parseToolRule("Bash(git status)");
 * // => { toolName: "Bash", pattern: "git status" }
 * ```
 */
export function parseToolRule(rule: string): ParsedToolRule {
  const trimmed = rule.trim();
  const openParenIndex = trimmed.indexOf("(");

  let rawToolName: string;
  let pattern: string;

  if (openParenIndex !== -1 && trimmed.endsWith(")")) {
    rawToolName = trimmed.slice(0, openParenIndex).trim();
    pattern = trimmed.slice(openParenIndex + 1, -1).trim();
  } else {
    rawToolName = trimmed;
    pattern = "*";
  }

  if (rawToolName === "TaskManager" || rawToolName.toLowerCase() === "taskmanager") {
    throw new Error(
      `Invalid permission rule "${rule}": TaskManager cannot be configured directly; it is coupled to Bash.`,
    );
  }

  if (!userFacingToolNames.includes(rawToolName as UserFacingToolName)) {
    throw new Error(
      `Invalid tool name "${rawToolName}" in rule "${rule}". Allowed tools are: ${userFacingToolNames.join(", ")}.`,
    );
  }

  return {
    toolName: rawToolName as UserFacingToolName,
    pattern: pattern.length > 0 ? pattern : "*",
  };
}

/**
 * Checks whether a given tool execution target matches a declarative rule string.
 *
 * @param rule - Permission rule string (e.g. "Bash(bun test *)", "Read(src/*)").
 * @param toolName - Current executing tool name (e.g. "bash", "readFile", "Read").
 * @param target - Tool execution parameter to validate (e.g. "bun test tests/settings.test.ts").
 * @returns True if both the tool name and target pattern match.
 *
 * @example
 * ```typescript
 * matchesToolRule("Bash(git *)", "bash", "git checkout main"); // => true
 * matchesToolRule("Read(src/*)", "readFile", "src/main.ts");    // => true
 * ```
 */
export function matchesToolRule(rule: string, toolName: string, target: string): boolean {
  const parsed = parseToolRule(rule);
  const userTool = toUserFacingToolName(toolName);
  if (!userTool || userTool !== parsed.toolName) {
    return false;
  }
  return matchWildcardPattern(parsed.pattern, target);
}
