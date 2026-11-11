/**
 * @fileoverview Atomic reading, writing, and algorithmic manipulation of persisted settings.
 * @packageDocumentation
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { settingsSchema, type Settings } from "./schema.js";

/**
 * Resolves the canonical file path to the settings JSON file within a designated home directory.
 *
 * @param homeDir - Designated home directory path.
 * @returns Fully qualified file path to the configuration file.
 *
 * @example
 * ```typescript
 * const configPath = getSettingsFilePath("/home/user/.greg");
 * // => "/home/user/.greg/config/settings.json"
 * ```
 */
export function getSettingsFilePath(homeDir: string): string {
  return path.join(homeDir, "config", "settings.json");
}

/**
 * Reads and validates the settings file from the specified home directory.
 * If the file does not exist, returns a fresh object populated with schema defaults.
 *
 * @param homeDir - Designated home directory path.
 * @returns A promise resolving to the validated settings object.
 *
 * @example
 * ```typescript
 * const settings = await readSettingsFile("~/.greg");
 * console.log(settings.model);
 * ```
 */
export async function readSettingsFile(homeDir: string): Promise<Settings> {
  const filePath = getSettingsFilePath(homeDir);

  if (!existsSync(filePath)) {
    return settingsSchema.parse({});
  }

  try {
    const rawContent = await readFile(filePath, "utf-8");
    const parsedJson: unknown = JSON.parse(rawContent);
    return settingsSchema.parse(parsedJson);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read settings from "${filePath}": ${message}`);
  }
}

/**
 * Atomically persists a validated settings object to disk under the specified home directory.
 *
 * @param homeDir - Designated home directory path.
 * @param settings - The settings object to write.
 * @returns A promise that resolves when the file is safely persisted.
 *
 * @example
 * ```typescript
 * await writeSettingsFile("~/.greg", updatedSettings);
 * ```
 */
export async function writeSettingsFile(homeDir: string, settings: Settings): Promise<void> {
  const validated = settingsSchema.parse(settings);
  const targetPath = getSettingsFilePath(homeDir);
  const targetDir = path.dirname(targetPath);

  await mkdir(targetDir, { recursive: true });

  const temporaryPath = path.join(
    targetDir,
    `.settings.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );

  const payload = JSON.stringify(validated, null, 2) + "\n";
  await writeFile(temporaryPath, payload, "utf-8");
  await rename(temporaryPath, targetPath);
}

/**
 * Algorithmically retrieves a configuration value by key name.
 *
 * @param settings - The current settings object.
 * @param key - The property name to retrieve.
 * @returns The value associated with the key, or undefined if not recognized.
 *
 * @example
 * ```typescript
 * const model = getSettingValue(settings, "model");
 * ```
 */
export function getSettingValue(settings: Settings, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(settings, key)) {
    return (settings as Record<string, unknown>)[key];
  }
  return undefined;
}

/**
 * Algorithmically parses and sets a configuration property value with schema validation.
 *
 * @param settings - Current settings instance.
 * @param key - The configuration key to modify.
 * @param rawValue - The unparsed string input from user or CLI.
 * @returns A freshly validated Settings instance with the updated value.
 *
 * @example
 * ```typescript
 * const updated = setSettingValue(settings, "maxTurns", "60");
 * ```
 */
export function setSettingValue(settings: Settings, key: string, rawValue: string): Settings {
  if (!(key in settingsSchema.shape)) {
    throw new Error(`Unrecognized configuration key: "${key}"`);
  }

  let parsedValue: unknown = rawValue;

  try {
    parsedValue = JSON.parse(rawValue);
  } catch {
    // If not JSON, treat as raw literal string
    parsedValue = rawValue;
  }

  const candidate: Record<string, unknown> = {
    ...settings,
    [key]: parsedValue,
  };

  return settingsSchema.parse(candidate);
}

/**
 * Algorithmically appends a value to an array-based setting (such as allowedTools or disallowedTools).
 *
 * @param settings - Current settings instance.
 * @param key - Target array property key.
 * @param item - Value item to append if not already present.
 * @returns A freshly validated Settings instance containing the appended item.
 *
 * @example
 * ```typescript
 * const updated = addSettingValue(settings, "allowedTools", "Bash(bun test *)");
 * ```
 */
export function addSettingValue(settings: Settings, key: string, item: string): Settings {
  if (!(key in settingsSchema.shape)) {
    throw new Error(`Unrecognized configuration key: "${key}"`);
  }
  const existing = (settings as Record<string, unknown>)[key];

  if (!Array.isArray(existing)) {
    throw new Error(`Setting "${key}" is not an array property`);
  }

  const existingArray = existing as readonly unknown[];
  if (existingArray.includes(item)) {
    return settings;
  }

  const candidate: Record<string, unknown> = {
    ...settings,
    [key]: [...existingArray, item],
  };

  return settingsSchema.parse(candidate);
}

/**
 * Algorithmically removes an item from an array-based configuration setting.
 *
 * @param settings - Current settings instance.
 * @param key - Target array property key.
 * @param item - Value item to remove from the array.
 * @returns A freshly validated Settings instance with the item excluded.
 *
 * @example
 * ```typescript
 * const updated = removeSettingValue(settings, "allowedTools", "Bash(bun test *)");
 * ```
 */
export function removeSettingValue(settings: Settings, key: string, item: string): Settings {
  if (!(key in settingsSchema.shape)) {
    throw new Error(`Unrecognized configuration key: "${key}"`);
  }
  const existing = (settings as Record<string, unknown>)[key];

  if (!Array.isArray(existing)) {
    throw new Error(`Setting "${key}" is not an array property`);
  }

  const candidate: Record<string, unknown> = {
    ...settings,
    [key]: (existing as readonly unknown[]).filter((element) => element !== item),
  };

  return settingsSchema.parse(candidate);
}

/**
 * Algorithmically resets a configuration property to its default schema value.
 *
 * @param settings - Current settings instance.
 * @param key - The property key to unset.
 * @returns A freshly validated Settings instance with the key reset.
 *
 * @example
 * ```typescript
 * const reset = unsetSettingValue(settings, "model");
 * ```
 */
export function unsetSettingValue(settings: Settings, key: string): Settings {
  if (!(key in settingsSchema.shape)) {
    throw new Error(`Unrecognized configuration key: "${key}"`);
  }
  const candidate: Record<string, unknown> = { ...settings };
  delete candidate[key];

  return settingsSchema.parse(candidate);
}
