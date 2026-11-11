/**
 * @fileoverview Multi-layer settings, credential, and model normalization resolution.
 * @packageDocumentation
 */

import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { defaultModelString, defaultProviderBaseUrls } from "../constants/index.js";
import { readSettingsFile } from "./file.js";
import {
  settingsSchema,
  type PermissionMode,
  type ReasoningEffort,
  type Settings,
} from "./schema.js";

/**
 * Input options provided via command-line flags to override persisted configuration.
 */
export interface CliOverrideOptions {
  /** Explicit model string identifier override. */
  readonly model?: string | undefined;
  /** Explicit reasoning effort level override. */
  readonly effort?: ReasoningEffort | undefined;
  /** Explicit declarative permission mode override. */
  readonly permissionMode?: PermissionMode | undefined;
  /** Additional allowed tools list passed on the command line. */
  readonly allowedTools?: readonly string[] | undefined;
  /** Additional disallowed tools list passed on the command line. */
  readonly disallowedTools?: readonly string[] | undefined;
  /** Maximum turn count override. */
  readonly maxTurns?: number | undefined;
  /** Timeout duration override string. */
  readonly timeout?: string | undefined;
  /** Explicit API key override. */
  readonly apiKey?: string | undefined;
  /** Explicit base URL override. */
  readonly baseUrl?: string | undefined;
  /** Override for the home storage and configuration directory. */
  readonly home?: string | undefined;
  /** Whether to suppress loading user and project settings files. */
  readonly bare?: boolean | undefined;
}

/**
 * Result bundle containing resolved settings, credentials, and normalized model descriptors.
 */
export interface ResolvedConfiguration {
  /** Effective merged settings object. */
  readonly settings: Settings;
  /** Resolved canonical home directory path. */
  readonly homeDirectory: string;
  /** Fully normalized model identifier with provider prefix. */
  readonly model: string;
  /** Extracted provider name string. */
  readonly provider: string;
  /** Extracted model identifier without provider prefix. */
  readonly modelId: string;
  /** Authoritative non-empty base URL for model API communication. */
  readonly baseUrl: string;
  /** Authoritative non-empty API key for provider requests. */
  readonly apiKey: string;
}

/**
 * Resolves the canonical home directory taking into account CLI flag, environment variable, and defaults.
 *
 * @param cliHome - Optional explicit CLI override directory.
 * @returns Fully normalized absolute directory path.
 *
 * @example
 * ```typescript
 * const home = resolveHomeDirectory("/custom/dir");
 * ```
 */
export function resolveHomeDirectory(cliHome?: string): string {
  let candidate: string;

  if (cliHome && cliHome.trim().length > 0) {
    candidate = cliHome.trim();
  } else if (process.env.HERNEX_HOME && process.env.HERNEX_HOME.trim().length > 0) {
    candidate = process.env.HERNEX_HOME.trim();
  } else {
    candidate = path.join(os.homedir(), ".greg");
  }

  if (candidate === "~" || candidate.startsWith(`~${path.sep}`)) {
    candidate = path.join(os.homedir(), candidate.slice(1));
  }

  return path.resolve(candidate);
}

/**
 * Normalizes a raw model string, automatically prepending the compatible provider if no slash exists.
 *
 * @param rawModel - Raw model name or string.
 * @returns An object containing the full normalized model string, provider, and modelId.
 *
 * @example
 * ```typescript
 * const res = normalizeModelString("dummy");
 * // => { model: "compatible/dummy", provider: "compatible", modelId: "dummy" }
 * ```
 */
export function normalizeModelString(rawModel?: string): {
  readonly model: string;
  readonly provider: string;
  readonly modelId: string;
} {
  const trimmed = rawModel && rawModel.trim().length > 0 ? rawModel.trim() : defaultModelString;
  const firstSlashIndex = trimmed.indexOf("/");

  if (firstSlashIndex === -1) {
    return {
      model: `compatible/${trimmed}`,
      provider: "compatible",
      modelId: trimmed,
    };
  }

  const provider = trimmed.slice(0, firstSlashIndex).trim();
  const modelId = trimmed.slice(firstSlashIndex + 1).trim();

  return {
    model: trimmed,
    provider,
    modelId,
  };
}

/**
 * Resolves the base URL for a given provider, respecting CLI flags, environment variables, and defaults.
 *
 * @param provider - Provider identifier name (e.g. "anthropic", "openai", "google").
 * @param cliBaseUrl - Optional explicit CLI flag value.
 * @returns Non-empty base URL string.
 */
export function resolveProviderBaseUrl(provider: string, cliBaseUrl?: string): string {
  if (cliBaseUrl && cliBaseUrl.trim().length > 0) {
    return cliBaseUrl.trim();
  }

  const normalizedProvider = provider.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const specificEnvVar = `${normalizedProvider}_BASE_URL`;

  const envSpecific = process.env[specificEnvVar];
  if (envSpecific && envSpecific.trim().length > 0) {
    return envSpecific.trim();
  }

  const envGeneric = process.env.BASE_URL;
  if (envGeneric && envGeneric.trim().length > 0) {
    return envGeneric.trim();
  }

  const defaultUrl = defaultProviderBaseUrls[provider.toLowerCase()];
  if (defaultUrl) {
    return defaultUrl;
  }

  return "http://localhost:8080/v1";
}

/**
 * Resolves the API key for a given provider, checking CLI overrides, specific environment variables, and fallbacks.
 *
 * @param provider - Provider identifier name.
 * @param cliApiKey - Optional explicit CLI flag value.
 * @returns Non-empty API key string.
 */
export function resolveProviderApiKey(provider: string, cliApiKey?: string): string {
  if (cliApiKey && cliApiKey.trim().length > 0) {
    return cliApiKey.trim();
  }

  const normalizedProvider = provider.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const specificEnvVar = `${normalizedProvider}_API_KEY`;

  const envSpecific = process.env[specificEnvVar];
  if (envSpecific && envSpecific.trim().length > 0) {
    return envSpecific.trim();
  }

  // Handle special case for Gemini API key alias
  if (provider.toLowerCase() === "google") {
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey && geminiKey.trim().length > 0) {
      return geminiKey.trim();
    }
  }

  const envGeneric = process.env.API_KEY;
  if (envGeneric && envGeneric.trim().length > 0) {
    return envGeneric.trim();
  }

  return "dummy";
}

/**
 * Merges layered settings from global files, workspace project files, and CLI overrides.
 *
 * @param options - CLI flag options.
 * @param cwd - Current working directory for resolving local project settings.
 * @returns A promise resolving to the final merged and validated ResolvedConfiguration.
 *
 * @example
 * ```typescript
 * const config = await resolveEffectiveConfiguration({ model: "anthropic/claude-3-7-sonnet" });
 * ```
 */
export async function resolveEffectiveConfiguration(
  options: CliOverrideOptions = {},
  cwd: string = process.cwd(),
): Promise<ResolvedConfiguration> {
  const homeDirectory = resolveHomeDirectory(options.home);

  // Set HERNEX_HOME so Hernex internal stores align with this home root
  process.env.HERNEX_HOME = homeDirectory;

  let baseSettings: Settings;

  if (options.bare) {
    baseSettings = settingsSchema.parse({});
  } else {
    // 1. Read global settings
    baseSettings = await readSettingsFile(homeDirectory);

    // 2. Read workspace project settings (.greg/settings.json) if present
    const projectConfigPath = path.join(cwd, ".greg", "settings.json");
    if (existsSync(projectConfigPath)) {
      try {
        const projectRaw = await readFile(projectConfigPath, "utf-8");
        const parsedProject = JSON.parse(projectRaw);
        baseSettings = settingsSchema.parse({
          ...baseSettings,
          ...parsedProject,
        });
      } catch {
        // Fall back gracefully if workspace settings are malformed
      }
    }
  }

  // 3. Apply CLI flag overrides
  const effectiveModelRaw = options.model ?? baseSettings.model;
  const normalizedModel = normalizeModelString(effectiveModelRaw);

  const mergedAllowedTools = options.allowedTools
    ? [...new Set([...baseSettings.allowedTools, ...options.allowedTools])]
    : baseSettings.allowedTools;

  const mergedDisallowedTools = options.disallowedTools
    ? [...new Set([...baseSettings.disallowedTools, ...options.disallowedTools])]
    : baseSettings.disallowedTools;

  const effectiveSettings = settingsSchema.parse({
    ...baseSettings,
    model: normalizedModel.model,
    effort: options.effort ?? baseSettings.effort,
    permissionMode: options.permissionMode ?? baseSettings.permissionMode,
    allowedTools: mergedAllowedTools,
    disallowedTools: mergedDisallowedTools,
    maxTurns: options.maxTurns ?? baseSettings.maxTurns,
    timeout: options.timeout ?? baseSettings.timeout,
  });

  const baseUrl = resolveProviderBaseUrl(normalizedModel.provider, options.baseUrl);
  const apiKey = resolveProviderApiKey(normalizedModel.provider, options.apiKey);

  return {
    settings: effectiveSettings,
    homeDirectory,
    model: normalizedModel.model,
    provider: normalizedModel.provider,
    modelId: normalizedModel.modelId,
    baseUrl,
    apiKey,
  };
}
