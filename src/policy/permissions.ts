/**
 * @fileoverview Deterministic tool authorization policy engine and mode evaluation.
 * @packageDocumentation
 */

import path from "node:path";
import type { PermissionMode } from "../settings/index.js";
import { matchesToolRule } from "./ruleMatch.js";

/**
 * Context payload provided to the authorization hook before tool execution.
 */
export interface ToolAuthorizationContext {
  /** The model-facing name of the tool requesting execution. */
  readonly toolName: string;
  /** Parameter object supplied by the model. */
  readonly parameters: unknown;
  /** Active working directory for path normalization. */
  readonly workingDirectory: string;
}

/**
 * Configuration options governing tool authorization decisions.
 */
export interface ToolPolicyOptions {
  /** Active declarative permission mode. */
  readonly permissionMode: PermissionMode;
  /** List of pattern strings matching tools allowed to run without prompts. */
  readonly allowedTools: readonly string[];
  /** List of pattern strings matching tools explicitly denied from execution. */
  readonly disallowedTools: readonly string[];
  /** Whether to bypass all permission checks. */
  readonly dangerouslySkipPermissions?: boolean | undefined;
}

/**
 * Outcome returned by the authorization evaluation hook.
 */
export type ToolPermissionDecision =
  { readonly decision: "allow" } | { readonly decision: "deny"; readonly reason: string };

/**
 * Extracts a normalized matching target from tool invocation parameters.
 *
 * @param toolName - Tool identifier name.
 * @param parameters - Parameter payload.
 * @param workingDirectory - Canonical workspace directory.
 * @returns String representation suitable for pattern matching.
 */
export function extractToolTarget(
  toolName: string,
  parameters: unknown,
  workingDirectory: string,
): string {
  const normalizedName = toolName.toLowerCase();
  const params = (
    typeof parameters === "object" && parameters !== null ? parameters : {}
  ) as Record<string, unknown>;

  if (normalizedName === "bash") {
    return typeof params.command === "string" ? params.command : "";
  }

  if (
    normalizedName === "readfile" ||
    normalizedName === "writefile" ||
    normalizedName === "editfile"
  ) {
    const rawPath =
      typeof params.filePath === "string"
        ? params.filePath
        : typeof params.path === "string"
          ? params.path
          : undefined;

    if (rawPath) {
      const resolved = path.resolve(workingDirectory, rawPath);
      const relative = path.relative(workingDirectory, resolved);
      if (relative.startsWith("..") || path.isAbsolute(relative)) {
        return resolved.replace(/\\/g, "/");
      }
      return relative.replace(/\\/g, "/");
    }
    return "*";
  }

  if (normalizedName === "glob" || normalizedName === "grep") {
    return typeof params.pattern === "string" ? params.pattern : "*";
  }

  if (normalizedName === "webfetch") {
    return typeof params.url === "string" ? params.url : "*";
  }

  if (normalizedName === "websearch") {
    return typeof params.query === "string" ? params.query : "*";
  }

  return "*";
}

/**
 * Determines whether a tool is a read-only reconnaissance tool.
 *
 * @param toolName - Candidate tool name.
 * @returns True if tool is read-only.
 */
export function isReadOnlyTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return (
    normalized === "readfile" ||
    normalized === "glob" ||
    normalized === "grep" ||
    normalized === "webfetch" ||
    normalized === "websearch"
  );
}

/**
 * Determines whether a tool is a filesystem mutation tool.
 *
 * @param toolName - Candidate tool name.
 * @returns True if tool modifies the workspace filesystem.
 */
export function isFileMutationTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return normalized === "writefile" || normalized === "editfile";
}

/**
 * Evaluates whether a proposed tool execution is permitted under current policy options.
 * Enforces strict precedence:
 * 1. Disallowed rules evaluate first and override all allows and bypass flags.
 * 2. Bypass mode / skip permissions flag.
 * 3. Allowed rules.
 * 4. Permission mode defaults.
 * 5. Actionable fail-closed rejection.
 *
 * Special Invariant:
 * TaskManagerTool is coupled to BashTool — it is allowed if and only if Bash is allowed.
 *
 * @param context - The tool invocation context.
 * @param options - Configured policy rules and permission mode.
 * @returns Deterministic ToolPermissionDecision.
 *
 * @example
 * ```typescript
 * const decision = evaluateToolPermission(
 *   { toolName: "bash", parameters: { command: "git status" }, workingDirectory: process.cwd() },
 *   { permissionMode: "default", allowedTools: ["Bash(git *)"], disallowedTools: [] }
 * );
 * console.log(decision.decision); // => "allow"
 * ```
 */
export function evaluateToolPermission(
  context: ToolAuthorizationContext,
  options: ToolPolicyOptions,
): ToolPermissionDecision {
  const normalizedToolName = context.toolName.toLowerCase();
  const target = extractToolTarget(context.toolName, context.parameters, context.workingDirectory);

  // 1. Explicit Disallow Rules — ALWAYS evaluate first and win over everything
  for (const denyRule of options.disallowedTools) {
    if (matchesToolRule(denyRule, normalizedToolName, target)) {
      return {
        decision: "deny",
        reason: `Permission denied: Tool execution "${context.toolName}(${target})" is explicitly disallowed by rule "${denyRule}".`,
      };
    }
  }

  // Coupling Invariant: TaskManager is coupled to BashTool
  if (normalizedToolName === "taskmanager") {
    if (options.permissionMode === "plan") {
      return {
        decision: "deny",
        reason: "Permission denied: TaskManager is not permitted in plan mode.",
      };
    }

    // Check if any rule disallows Bash globally
    for (const denyRule of options.disallowedTools) {
      if (matchesToolRule(denyRule, "bash", "*")) {
        return {
          decision: "deny",
          reason: `Permission denied: TaskManager requires Bash authorization, which is disallowed by rule "${denyRule}".`,
        };
      }
    }

    // If bypass is active, TaskManager is allowed with Bash
    if (
      options.permissionMode === "bypassPermissions" ||
      options.dangerouslySkipPermissions === true
    ) {
      return { decision: "allow" };
    }

    // In default or acceptEdits mode, TaskManager is permitted if Bash is explicitly allowed
    let isBashAllowed = false;
    for (const allowRule of options.allowedTools) {
      if (matchesToolRule(allowRule, "bash", "*")) {
        isBashAllowed = true;
        break;
      }
    }

    if (!isBashAllowed) {
      return {
        decision: "deny",
        reason:
          "Permission denied: TaskManager is coupled to Bash authorization. Allow Bash execution with --allowed-tools 'Bash(*)' or --permission-mode bypassPermissions.",
      };
    }

    return { decision: "allow" };
  }

  // 2. Bypass Mode
  if (
    options.permissionMode === "bypassPermissions" ||
    options.dangerouslySkipPermissions === true
  ) {
    return { decision: "allow" };
  }

  // 3. Explicit Allow Rules
  for (const allowRule of options.allowedTools) {
    if (matchesToolRule(allowRule, normalizedToolName, target)) {
      return { decision: "allow" };
    }
  }

  // 4. Mode Defaults
  if (options.permissionMode === "plan") {
    if (isReadOnlyTool(normalizedToolName)) {
      return { decision: "allow" };
    }
    return {
      decision: "deny",
      reason: `Permission denied: Mutating tool "${context.toolName}" is not permitted in plan mode.`,
    };
  }

  if (options.permissionMode === "acceptEdits") {
    if (isReadOnlyTool(normalizedToolName) || isFileMutationTool(normalizedToolName)) {
      return { decision: "allow" };
    }
    return {
      decision: "deny",
      reason: `Permission denied: Shell execution "${context.toolName}(${target})" is not permitted in acceptEdits mode. Allow with --allowed-tools '${context.toolName}(${target})'.`,
    };
  }

  // Default mode: Only read-only tools permitted by default
  if (isReadOnlyTool(normalizedToolName)) {
    return { decision: "allow" };
  }

  if (isFileMutationTool(normalizedToolName)) {
    return {
      decision: "deny",
      reason: `Permission denied: Workspace mutation "${context.toolName}(${target})" not allowed in mode default. Allow with --allowed-tools '${context.toolName}(${target})' or --permission-mode acceptEdits.`,
    };
  }

  return {
    decision: "deny",
    reason: `Permission denied: Tool execution "${context.toolName}(${target})" not allowed in mode default. Allow with --allowed-tools '${context.toolName}(${target})'.`,
  };
}
