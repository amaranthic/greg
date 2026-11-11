/**
 * @fileoverview Subcommands for inspecting and modifying Greg configuration settings.
 * @packageDocumentation
 */

import { Command } from "commander";
import {
  addSettingValue,
  getSettingValue,
  readSettingsFile,
  removeSettingValue,
  resolveHomeDirectory,
  setSettingValue,
  unsetSettingValue,
  writeSettingsFile,
} from "../settings/index.js";
import { writeToStderr, writeToStdout } from "../utils/index.js";

/**
 * Options common to configuration subcommands.
 */
export interface ConfigSubcommandOptions {
  /** Optional home directory override. */
  readonly home?: string | undefined;
}

/**
 * Creates the commander Command for the `config` subcommand tree.
 *
 * @returns Fully configured commander Command instance for `config`.
 *
 * @example
 * ```typescript
 * const configCmd = createConfigCommand();
 * program.addCommand(configCmd);
 * ```
 */
export function createConfigCommand(): Command {
  const config = new Command("config").description(
    "Manage global and workspace configuration settings",
  );

  config
    .command("get [key]")
    .description("Display a specific configuration setting or the entire active configuration")
    .option("--home <dir>", "Override home directory path")
    .action(async (key: string | undefined, options: ConfigSubcommandOptions, cmd: Command) => {
      const mergedOptions = { ...cmd.optsWithGlobals(), ...options };
      const home = resolveHomeDirectory(mergedOptions.home);
      const settings = await readSettingsFile(home);

      if (key) {
        const val = getSettingValue(settings, key);
        if (val === undefined) {
          writeToStderr(`Setting "${key}" is not set.\n`);
          process.exit(1);
        }
        writeToStdout(
          typeof val === "object" ? JSON.stringify(val, null, 2) + "\n" : `${String(val)}\n`,
        );
      } else {
        writeToStdout(JSON.stringify(settings, null, 2) + "\n");
      }
    });

  config
    .command("set <key> <value>")
    .description("Persist a configuration setting key and value")
    .option("--home <dir>", "Override home directory path")
    .action(async (key: string, value: string, options: ConfigSubcommandOptions, cmd: Command) => {
      const mergedOptions = { ...cmd.optsWithGlobals(), ...options };
      const home = resolveHomeDirectory(mergedOptions.home);
      const current = await readSettingsFile(home);

      try {
        const updated = setSettingValue(current, key, value);
        await writeSettingsFile(home, updated);
        writeToStdout(`Set "${key}" successfully.\n`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeToStderr(`Failed to set "${key}": ${msg}\n`);
        process.exit(1);
      }
    });

  config
    .command("add <key> <value>")
    .description("Append an item to an array configuration setting")
    .option("--home <dir>", "Override home directory path")
    .action(async (key: string, value: string, options: ConfigSubcommandOptions, cmd: Command) => {
      const mergedOptions = { ...cmd.optsWithGlobals(), ...options };
      const home = resolveHomeDirectory(mergedOptions.home);
      const current = await readSettingsFile(home);

      try {
        const updated = addSettingValue(current, key, value);
        await writeSettingsFile(home, updated);
        writeToStdout(`Added "${value}" to "${key}".\n`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeToStderr(`Failed to add to "${key}": ${msg}\n`);
        process.exit(1);
      }
    });

  config
    .command("remove <key> <value>")
    .description("Remove an item from an array configuration setting")
    .option("--home <dir>", "Override home directory path")
    .action(async (key: string, value: string, options: ConfigSubcommandOptions, cmd: Command) => {
      const mergedOptions = { ...cmd.optsWithGlobals(), ...options };
      const home = resolveHomeDirectory(mergedOptions.home);
      const current = await readSettingsFile(home);

      try {
        const updated = removeSettingValue(current, key, value);
        await writeSettingsFile(home, updated);
        writeToStdout(`Removed "${value}" from "${key}".\n`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeToStderr(`Failed to remove from "${key}": ${msg}\n`);
        process.exit(1);
      }
    });

  config
    .command("unset <key>")
    .description("Reset a configuration setting key to its schema default")
    .option("--home <dir>", "Override home directory path")
    .action(async (key: string, options: ConfigSubcommandOptions, cmd: Command) => {
      const mergedOptions = { ...cmd.optsWithGlobals(), ...options };
      const home = resolveHomeDirectory(mergedOptions.home);
      const current = await readSettingsFile(home);

      try {
        const updated = unsetSettingValue(current, key);
        await writeSettingsFile(home, updated);
        writeToStdout(`Unset "${key}".\n`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeToStderr(`Failed to unset "${key}": ${msg}\n`);
        process.exit(1);
      }
    });

  return config;
}
