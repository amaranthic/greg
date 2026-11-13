/**
 * @fileoverview Authoritative barrel export for the policy and permissions module.
 * @packageDocumentation
 */

export {
  compileWildcardRegex,
  matchWildcardPattern,
  parseToolRule,
  matchesToolRule,
  type ParsedToolRule,
} from "./ruleMatch.js";

export {
  extractToolTarget,
  isReadOnlyTool,
  isFileMutationTool,
  evaluateToolPermission,
  type ToolAuthorizationContext,
  type ToolPolicyOptions,
  type ToolPermissionDecision,
} from "./permissions.js";

export {
  userFacingToolNames,
  type UserFacingToolName,
  allBuiltInToolNames,
  planModeToolNames,
  toHernexToolName,
  toUserFacingToolName,
  resolveExposedTools,
} from "./toolFilter.js";
