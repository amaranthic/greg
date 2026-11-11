/**
 * @fileoverview Authoritative barrel export for the settings module.
 * @packageDocumentation
 */

export {
  reasoningEffortSchema,
  permissionModeSchema,
  settingsSchema,
  type ReasoningEffort,
  type PermissionMode,
  type Settings,
  type PartialSettings,
} from "./schema.js";

export {
  getSettingsFilePath,
  readSettingsFile,
  writeSettingsFile,
  getSettingValue,
  setSettingValue,
  addSettingValue,
  removeSettingValue,
  unsetSettingValue,
} from "./file.js";

export {
  resolveHomeDirectory,
  normalizeModelString,
  resolveProviderBaseUrl,
  resolveProviderApiKey,
  resolveEffectiveConfiguration,
  type CliOverrideOptions,
  type ResolvedConfiguration,
} from "./resolve.js";
