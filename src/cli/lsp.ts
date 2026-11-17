/**
 * @fileoverview Commander subcommand tree for managing LSP (Language Server Protocol) server configuration.
 *
 * Provides three subcommands:
 * - `greg lsp add <name>` — Register a new LSP server entry.
 * - `greg lsp remove <name>` — Remove a registered LSP server entry.
 * - `greg lsp list` — Display all configured LSP servers.
 *
 * @packageDocumentation
 */

import { Command } from "commander";
import { resolveHomeDirectory } from "../settings/index.js";
import {
  addLspServer,
  lspServerEntrySchema,
  readLspConfig,
  removeLspServer,
  type LspServerEntry,
} from "../utils/index.js";
import { writeToStderr, writeToStdout } from "../utils/index.js";

/**
 * Options common to all LSP subcommands.
 */
export interface LspSubcommandOptions {
  /** Optional home directory override forwarded from parent command or flag. */
  readonly home?: string | undefined;
}

/**
 * Options specific to `greg lsp add`.
 */
export interface LspAddOptions extends LspSubcommandOptions {
  /** Executable binary name or path for the LSP server. */
  readonly command: string;
  /** Command-line arguments to pass to the LSP server binary. */
  readonly args?: string[] | undefined;
  /** File extensions this server handles (e.g. `.ts`, `.tsx`). */
  readonly extensions: string[];
  /** Extra environment variables in `KEY=VALUE` format. */
  readonly env?: string[] | undefined;
  /** Optional LSP languageId override (e.g. "typescriptreact"). */
  readonly languageId?: string | undefined;
  /** Per-server idle timeout in milliseconds before tearing down. */
  readonly idleTimeout?: string | undefined;
  /** Maximum consecutive crash restart attempts before circuit breaker trips. */
  readonly maxRestarts?: string | undefined;
}

/**
 * Options specific to `greg lsp list`.
 */
export interface LspListOptions extends LspSubcommandOptions {
  /** When true, prints raw JSON instead of a formatted table. */
  readonly json?: boolean | undefined;
}

/**
 * Parses a list of `KEY=VALUE` environment variable strings into a record.
 *
 * @param rawPairs - Array of raw `KEY=VALUE` strings from CLI.
 * @returns A `Record<string, string>` of parsed environment variables, or `undefined` if empty.
 * @throws {Error} If any entry is not in `KEY=VALUE` format.
 *
 * @example
 * ```typescript
 * parseEnvPairs(["NODE_ENV=production", "DEBUG=true"]);
 * // => { NODE_ENV: "production", DEBUG: "true" }
 * ```
 */
function parseEnvPairs(rawPairs: string[]): Record<string, string> | undefined {
  if (rawPairs.length === 0) {
    return undefined;
  }

  const result: Record<string, string> = {};

  for (const pair of rawPairs) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) {
      throw new Error(
        `Invalid environment variable format "${pair}". Expected KEY=VALUE (e.g. NODE_ENV=production).`,
      );
    }
    const key = pair.slice(0, eqIndex).trim();
    const value = pair.slice(eqIndex + 1);
    if (key.length === 0) {
      throw new Error(`Invalid environment variable format "${pair}": key must not be empty.`);
    }
    result[key] = value;
  }

  return result;
}

/**
 * Formats a configured LSP server list as a human-readable aligned table.
 *
 * @param servers - Map of server name to entry from the config file.
 * @returns Formatted table string ready for stdout output.
 *
 * @example
 * ```typescript
 * const table = formatLspTable(config.servers);
 * writeToStdout(table);
 * ```
 */
function formatLspTable(servers: Record<string, LspServerEntry>): string {
  const entries = Object.entries(servers);

  if (entries.length === 0) {
    return "No LSP servers configured. Run: greg lsp add --command <cmd> --extensions <ext...>\n";
  }

  const headers = ["Name", "Command", "Extensions", "Args"];
  const rows = entries.map(([name, entry]) => [
    name,
    entry.command,
    entry.extensions.join(" "),
    entry.args.length > 0 ? entry.args.join(" ") : "(none)",
  ]);

  const colWidths = headers.map((header, colIndex) =>
    Math.max(header.length, ...rows.map((row) => row[colIndex]!.length)),
  );

  const pad = (str: string, width: number): string => str.padEnd(width);

  const headerRow = headers.map((h, i) => pad(h, colWidths[i]!)).join("  ");
  const separator = colWidths.map((w) => "-".repeat(w)).join("  ");
  const dataRows = rows.map((row) => row.map((cell, i) => pad(cell, colWidths[i]!)).join("  "));

  return [headerRow, separator, ...dataRows, ""].join("\n");
}

/**
 * Creates the commander Command for the `lsp` subcommand tree.
 *
 * @returns Fully configured commander Command instance for `lsp`.
 *
 * @example
 * ```typescript
 * const lspCmd = createLspCommand();
 * program.addCommand(lspCmd);
 * ```
 */
export function createLspCommand(): Command {
  const lsp = new Command("lsp").description(
    "Manage LSP (Language Server Protocol) server configuration",
  );

  // ── lsp add ─────────────────────────────────────────────────────────────────
  lsp
    .command("add <name>")
    .description("Register a new LSP server entry (overwrites if name already exists)")
    .requiredOption(
      "--command <binary>",
      "Executable binary name or absolute path of the LSP server",
    )
    .option(
      "--args <args...>",
      "Command-line arguments to pass to the LSP server (e.g. --args --stdio)",
    )
    .requiredOption(
      "--extensions <extensions...>",
      "File extensions this server handles (e.g. --extensions .ts .tsx)",
    )
    .option(
      "--env <vars...>",
      "Extra environment variables in KEY=VALUE format (e.g. --env NODE_ENV=production)",
    )
    .option(
      "--language-id <id>",
      "Explicit LSP languageId override (e.g. --language-id typescriptreact)",
    )
    .option(
      "--idle-timeout <ms>",
      "Per-server idle timeout in milliseconds before process teardown",
    )
    .option(
      "--max-restarts <count>",
      "Maximum consecutive crash restarts before circuit breaker opens",
    )
    .option("--home <dir>", "Override home directory path")
    .action(async (name: string, options: LspAddOptions, cmd: Command) => {
      const mergedOptions = { ...cmd.optsWithGlobals(), ...options } as LspAddOptions;
      const home = resolveHomeDirectory(mergedOptions.home);

      // Validate name is non-empty (commander already enforces the argument exists)
      if (!name || name.trim().length === 0) {
        writeToStderr("Error: Server name must not be empty.\n");
        process.exit(1);
      }

      const idleTimeoutMs = mergedOptions.idleTimeout
        ? Number.parseInt(mergedOptions.idleTimeout, 10)
        : undefined;
      const maxRestarts = mergedOptions.maxRestarts
        ? Number.parseInt(mergedOptions.maxRestarts, 10)
        : undefined;

      // Validate extensions via schema (provides clear error messages)
      const rawEntry = {
        command: mergedOptions.command,
        args: mergedOptions.args ?? [],
        extensions: mergedOptions.extensions,
        env: mergedOptions.env ? parseEnvPairsOrExit(mergedOptions.env) : undefined,
        languageId: mergedOptions.languageId,
        idleTimeoutMs,
        maxRestarts,
      };

      let validatedEntry: LspServerEntry;
      try {
        validatedEntry = lspServerEntrySchema.parse(rawEntry);
      } catch (parseErr) {
        const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
        writeToStderr(`Error: Invalid LSP server configuration: ${message}\n`);
        process.exit(1);
      }

      try {
        await addLspServer(home, name.trim(), validatedEntry);

        let extraDetails = "";
        if (validatedEntry.languageId) {
          extraDetails += `  Language ID: ${validatedEntry.languageId}\n`;
        }
        if (validatedEntry.idleTimeoutMs !== undefined) {
          extraDetails += `  Idle Timeout: ${validatedEntry.idleTimeoutMs}ms\n`;
        }
        if (validatedEntry.maxRestarts !== undefined) {
          extraDetails += `  Max Restarts: ${validatedEntry.maxRestarts}\n`;
        }

        writeToStdout(
          `LSP server "${name.trim()}" registered successfully.\n` +
            `  Command:     ${validatedEntry.command}\n` +
            `  Args:        ${validatedEntry.args.length > 0 ? validatedEntry.args.join(" ") : "(none)"}\n` +
            `  Extensions:  ${validatedEntry.extensions.join(" ")}\n` +
            extraDetails,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeToStderr(`Error: Failed to save LSP server: ${msg}\n`);
        process.exit(1);
      }
    });

  // ── lsp remove ──────────────────────────────────────────────────────────────
  lsp
    .command("remove <name>")
    .description("Remove a registered LSP server entry by name")
    .option("--home <dir>", "Override home directory path")
    .action(async (name: string, options: LspSubcommandOptions, cmd: Command) => {
      const mergedOptions = { ...cmd.optsWithGlobals(), ...options };
      const home = resolveHomeDirectory(mergedOptions.home);

      try {
        await removeLspServer(home, name);
        writeToStdout(`LSP server "${name}" removed successfully.\n`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeToStderr(`Error: ${msg}\n`);
        process.exit(1);
      }
    });

  // ── lsp list ────────────────────────────────────────────────────────────────
  lsp
    .command("list")
    .description("List all configured LSP servers")
    .option("--json", "Output raw JSON instead of a formatted table")
    .option("--home <dir>", "Override home directory path")
    .action(async (options: LspListOptions, cmd: Command) => {
      const mergedOptions = { ...cmd.optsWithGlobals(), ...options } as LspListOptions;
      const home = resolveHomeDirectory(mergedOptions.home);

      try {
        const config = await readLspConfig(home);

        if (mergedOptions.json) {
          writeToStdout(JSON.stringify(config.servers, null, 2) + "\n");
        } else {
          writeToStdout(formatLspTable(config.servers));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeToStderr(`Error: Failed to read LSP configuration: ${msg}\n`);
        process.exit(1);
      }
    });

  return lsp;
}

/**
 * Helper: parses env pairs and exits on error.
 *
 * @param rawPairs - Raw KEY=VALUE strings.
 * @returns Parsed record or exits process with code 1 on failure.
 */
function parseEnvPairsOrExit(rawPairs: string[]): Record<string, string> | undefined {
  try {
    return parseEnvPairs(rawPairs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeToStderr(`Error: ${msg}\n`);
    process.exit(1);
  }
}
