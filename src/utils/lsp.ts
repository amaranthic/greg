/**
 * @fileoverview Consolidated Language Server Protocol (LSP) configuration, schema,
 * default catalog, and atomic file persistence utilities.
 *
 * Provides full end-to-end management for language server configurations stored at
 * `$HERNEX_HOME/config/lsp.json`, including a curated default catalog for common
 * language servers when no user overrides are configured.
 *
 * @packageDocumentation
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * Regex pattern enforcing valid, non-wildcard file extensions.
 * Extensions must start with a dot and contain only alphanumeric characters or `+`.
 * Examples: `.ts`, `.tsx`, `.c++`, `.rs`
 */
const EXTENSION_PATTERN = /^\.[a-zA-Z0-9+]+$/;

/**
 * Zod schema defining and validating a single configured LSP server entry.
 *
 * Matches the underlying Hernex `LspServerConfig` specification.
 *
 * @example
 * ```typescript
 * const entry: LspServerEntry = {
 *   command: "typescript-language-server",
 *   args: ["--stdio"],
 *   extensions: [".ts", ".tsx", ".js", ".jsx"],
 *   languageId: "typescript",
 *   idleTimeoutMs: 300000,
 *   maxRestarts: 3,
 * };
 * ```
 */
export const lspServerEntrySchema = z.object({
  /**
   * Executable binary name or absolute path.
   * Must be resolvable on the system `PATH` or be an absolute path.
   */
  command: z.string().min(1, "LSP server command must not be empty"),

  /**
   * Optional command-line arguments passed to the binary.
   * Most servers require `["--stdio"]` to enable stdio transport.
   * @default []
   */
  args: z.array(z.string()).default([]),

  /**
   * Explicit file extensions this server handles.
   * Each extension must start with a dot.
   * Wildcards are not permitted.
   */
  extensions: z
    .array(
      z
        .string()
        .regex(
          EXTENSION_PATTERN,
          "Each extension must start with a dot and contain only alphanumeric characters (e.g. .ts, .py). Wildcards are not supported.",
        ),
    )
    .min(1, "At least one file extension must be specified"),

  /**
   * Optional extra environment variables injected into the subprocess environment.
   */
  env: z.record(z.string(), z.string()).optional(),

  /**
   * Optional LSP languageId override (e.g. "typescriptreact").
   * When omitted, Hernex derives it from the file extension.
   */
  languageId: z.string().min(1).optional(),

  /**
   * Milliseconds of inactivity before an idle server process is torn down.
   * Overrides the pool-level idle timeout for this specific server.
   */
  idleTimeoutMs: z.number().int().positive().optional(),

  /**
   * Maximum consecutive crash restart attempts before the circuit breaker trips.
   */
  maxRestarts: z.number().int().min(0).optional(),
});

/**
 * Inferred TypeScript type for a single validated LSP server configuration entry.
 */
export type LspServerEntry = z.infer<typeof lspServerEntrySchema>;

/**
 * Authoritative Zod schema for the top-level `lsp.json` configuration file.
 */
export const lspConfigSchema = z.object({
  /** Schema layout format version, fixed to literal 1. */
  version: z.literal(1).default(1),

  /**
   * Named map of LSP server entries.
   * Keys are user-chosen server identifiers (e.g. "typescript", "rust").
   */
  servers: z
    .record(z.string().min(1, "Server name must not be empty"), lspServerEntrySchema)
    .default({}),
});

/**
 * Fully parsed and validated representation of `lsp.json`.
 */
export type LspConfigFile = z.infer<typeof lspConfigSchema>;

/**
 * Curated catalog of standard language servers used as fallback when no servers
 * are configured in `lsp.json`.
 *
 * If the binary is not installed on the system PATH, the Hernex pool returns
 * a clean tool error without crashing the process.
 */
export const defaultLspServers: Readonly<Record<string, LspServerEntry>> = Object.freeze({
  typescript: {
    command: "typescript-language-server",
    args: ["--stdio"],
    extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
  },
  rust: {
    command: "rust-analyzer",
    args: [],
    extensions: [".rs"],
  },
  python: {
    command: "pyright-langserver",
    args: ["--stdio"],
    extensions: [".py", ".pyi"],
  },
  go: {
    command: "gopls",
    args: [],
    extensions: [".go"],
  },
  css: {
    command: "vscode-css-language-server",
    args: ["--stdio"],
    extensions: [".css", ".scss", ".less"],
  },
  html: {
    command: "vscode-html-language-server",
    args: ["--stdio"],
    extensions: [".html", ".htm"],
  },
  json: {
    command: "vscode-json-language-server",
    args: ["--stdio"],
    extensions: [".json", ".jsonc"],
  },
});

/**
 * Resolves the canonical file path to the LSP JSON config file within a designated home directory.
 *
 * @param homeDir - Designated home directory path (e.g. `$HERNEX_HOME`).
 * @returns Fully qualified file path to the LSP configuration file.
 *
 * @example
 * ```typescript
 * const configPath = getLspConfigFilePath("/home/user/.greg");
 * // => "/home/user/.greg/config/lsp.json"
 * ```
 */
export function getLspConfigFilePath(homeDir: string): string {
  return path.join(homeDir, "config", "lsp.json");
}

/**
 * Reads and validates the LSP configuration file from the specified home directory.
 * If the file does not exist, returns a default empty configuration.
 *
 * @param homeDir - Designated home directory path.
 * @returns A promise resolving to the validated LSP configuration object.
 *
 * @example
 * ```typescript
 * const config = await readLspConfig("/home/user/.greg");
 * console.log(Object.keys(config.servers));
 * ```
 */
export async function readLspConfig(homeDir: string): Promise<LspConfigFile> {
  const filePath = getLspConfigFilePath(homeDir);

  if (!existsSync(filePath)) {
    return lspConfigSchema.parse({});
  }

  try {
    const rawContent = await readFile(filePath, "utf-8");
    const parsedJson: unknown = JSON.parse(rawContent);
    return lspConfigSchema.parse(parsedJson);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read LSP configuration from "${filePath}": ${message}`);
  }
}

/**
 * Resolves the effective LSP configuration for agent execution.
 *
 * Reads user configurations from `lsp.json`. If no servers are configured,
 * it returns the configuration with `defaultLspServers` as the active catalog,
 * ensuring out-of-the-box language intelligence without manual setup overhead.
 *
 * @param homeDir - Designated home directory path.
 * @returns A promise resolving to the effective LSP configuration object.
 *
 * @example
 * ```typescript
 * const effective = await resolveEffectiveLspConfig("/home/user/.greg");
 * console.log(Object.keys(effective.servers)); // => ["typescript", "rust", ...]
 * ```
 */
export async function resolveEffectiveLspConfig(homeDir: string): Promise<LspConfigFile> {
  const config = await readLspConfig(homeDir);

  if (Object.keys(config.servers).length === 0) {
    return {
      version: config.version,
      servers: { ...defaultLspServers },
    };
  }

  return config;
}

/**
 * Atomically persists a validated LSP configuration object to disk under the specified home directory.
 * Follows the atomic write pattern: writes to a unique `.tmp` file, then renames to the target path.
 *
 * @param homeDir - Designated home directory path.
 * @param config - The LSP configuration object to persist.
 * @returns A promise that resolves when the file is safely persisted.
 *
 * @example
 * ```typescript
 * await writeLspConfig("/home/user/.greg", { version: 1, servers: {} });
 * ```
 */
export async function writeLspConfig(homeDir: string, config: LspConfigFile): Promise<void> {
  const validated = lspConfigSchema.parse(config);
  const targetPath = getLspConfigFilePath(homeDir);
  const targetDir = path.dirname(targetPath);

  await mkdir(targetDir, { recursive: true });

  const temporaryPath = path.join(
    targetDir,
    `.lsp.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );

  const payload = JSON.stringify(validated, null, 2) + "\n";
  await writeFile(temporaryPath, payload, "utf-8");
  await rename(temporaryPath, targetPath);
}

/**
 * Adds or overwrites a named LSP server entry in the configuration file.
 * If a server with the same name already exists, it is overwritten.
 *
 * @param homeDir - Designated home directory path.
 * @param name - User-chosen server name (e.g. `"typescript"`, `"rust"`).
 * @param entry - LSP server configuration entry to persist.
 * @returns A promise that resolves when the server has been persisted.
 *
 * @example
 * ```typescript
 * await addLspServer("/home/user/.greg", "typescript", {
 *   command: "typescript-language-server",
 *   args: ["--stdio"],
 *   extensions: [".ts", ".tsx"],
 * });
 * ```
 */
export async function addLspServer(
  homeDir: string,
  name: string,
  entry: LspServerEntry,
): Promise<void> {
  const current = await readLspConfig(homeDir);
  const updated: LspConfigFile = {
    ...current,
    servers: {
      ...current.servers,
      [name]: entry,
    },
  };
  await writeLspConfig(homeDir, updated);
}

/**
 * Removes a named LSP server entry from the configuration file.
 * Throws if the specified server name does not exist.
 *
 * @param homeDir - Designated home directory path.
 * @param name - Server name to remove.
 * @returns A promise that resolves when the server has been removed and config persisted.
 * @throws {Error} If no server with the given name is found.
 *
 * @example
 * ```typescript
 * await removeLspServer("/home/user/.greg", "typescript");
 * ```
 */
export async function removeLspServer(homeDir: string, name: string): Promise<void> {
  const current = await readLspConfig(homeDir);

  if (!Object.prototype.hasOwnProperty.call(current.servers, name)) {
    throw new Error(
      `LSP server "${name}" not found. Run \`greg lsp list\` to see configured servers.`,
    );
  }

  const updatedServers = { ...current.servers };
  delete updatedServers[name];

  const updated: LspConfigFile = {
    ...current,
    servers: updatedServers,
  };

  await writeLspConfig(homeDir, updated);
}
