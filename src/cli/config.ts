/**
 * @fileoverview Subcommands for inspecting and modifying Greg configuration settings.
 * @packageDocumentation
 */

import { defineCommand } from "citty";
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
 * Command for retrieving a single configuration key or the entire configuration object.
 */
export const configGetCommand = defineCommand({
  meta: {
    name: "get",
    description: "Display a specific configuration setting or the entire active configuration",
  },
  args: {
    key: {
      type: "positional",
      description: "Optional setting key name to retrieve",
      required: false,
    },
    home: {
      type: "string",
      description: "Override home directory path",
    },
  },
  async run({ args }) {
    const home = resolveHomeDirectory(args.home);
    const settings = await readSettingsFile(home);

    if (args.key) {
      const val = getSettingValue(settings, args.key);
      if (val === undefined) {
        writeToStderr(`Setting "${args.key}" is not set.\n`);
        process.exit(1);
      }
      writeToStdout(
        typeof val === "object" ? JSON.stringify(val, null, 2) + "\n" : `${String(val)}\n`,
      );
    } else {
      writeToStdout(JSON.stringify(settings, null, 2) + "\n");
    }
  },
});

/**
 * Command for setting a configuration property value with automatic validation.
 */
export const configSetCommand = defineCommand({
  meta: {
    name: "set",
    description: "Persist a configuration setting key and value",
  },
  args: {
    key: {
      type: "positional",
      description: "Setting key name to modify",
      required: true,
    },
    value: {
      type: "positional",
      description: "Value to set",
      required: true,
    },
    home: {
      type: "string",
      description: "Override home directory path",
    },
  },
  async run({ args }) {
    const home = resolveHomeDirectory(args.home);
    const current = await readSettingsFile(home);

    try {
      const updated = setSettingValue(current, args.key, args.value);
      await writeSettingsFile(home, updated);
      writeToStdout(`Set "${args.key}" successfully.\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeToStderr(`Failed to set "${args.key}": ${msg}\n`);
      process.exit(1);
    }
  },
});

/**
 * Command for appending a value to an array-based setting (e.g. allowedTools).
 */
export const configAddCommand = defineCommand({
  meta: {
    name: "add",
    description: "Append an item to an array configuration setting",
  },
  args: {
    key: {
      type: "positional",
      description: "Array setting key name",
      required: true,
    },
    value: {
      type: "positional",
      description: "Item string to add",
      required: true,
    },
    home: {
      type: "string",
      description: "Override home directory path",
    },
  },
  async run({ args }) {
    const home = resolveHomeDirectory(args.home);
    const current = await readSettingsFile(home);

    try {
      const updated = addSettingValue(current, args.key, args.value);
      await writeSettingsFile(home, updated);
      writeToStdout(`Added "${args.value}" to "${args.key}".\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeToStderr(`Failed to add to "${args.key}": ${msg}\n`);
      process.exit(1);
    }
  },
});

/**
 * Command for removing an item from an array-based setting.
 */
export const configRemoveCommand = defineCommand({
  meta: {
    name: "remove",
    description: "Remove an item from an array configuration setting",
  },
  args: {
    key: {
      type: "positional",
      description: "Array setting key name",
      required: true,
    },
    value: {
      type: "positional",
      description: "Item string to remove",
      required: true,
    },
    home: {
      type: "string",
      description: "Override home directory path",
    },
  },
  async run({ args }) {
    const home = resolveHomeDirectory(args.home);
    const current = await readSettingsFile(home);

    try {
      const updated = removeSettingValue(current, args.key, args.value);
      await writeSettingsFile(home, updated);
      writeToStdout(`Removed "${args.value}" from "${args.key}".\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeToStderr(`Failed to remove from "${args.key}": ${msg}\n`);
      process.exit(1);
    }
  },
});

/**
 * Command for resetting a configuration setting key back to its default value.
 */
export const configUnsetCommand = defineCommand({
  meta: {
    name: "unset",
    description: "Reset a configuration setting key to its schema default",
  },
  args: {
    key: {
      type: "positional",
      description: "Setting key name to unset",
      required: true,
    },
    home: {
      type: "string",
      description: "Override home directory path",
    },
  },
  async run({ args }) {
    const home = resolveHomeDirectory(args.home);
    const current = await readSettingsFile(home);

    try {
      const updated = unsetSettingValue(current, args.key);
      await writeSettingsFile(home, updated);
      writeToStdout(`Unset "${args.key}".\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeToStderr(`Failed to unset "${args.key}": ${msg}\n`);
      process.exit(1);
    }
  },
});

/**
 * Top-level config command bundling all setting management subcommands.
 */
export const configCommand = defineCommand({
  meta: {
    name: "config",
    description: "Manage global and workspace configuration settings",
  },
  subCommands: {
    get: configGetCommand,
    set: configSetCommand,
    add: configAddCommand,
    remove: configRemoveCommand,
    unset: configUnsetCommand,
  },
});
