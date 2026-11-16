/**
 * @fileoverview Atomic reading, writing, and manipulation of the LSP configuration file.
 *
 * The LSP config lives at `$HERNEX_HOME/config/lsp.json`, sibling to `settings.json`.
 * All writes follow the same atomic rename pattern used by `settings/file.ts`:
 * write to a `.tmp` file, then rename to the target path.
 *
 * @packageDocumentation
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { lspConfigSchema, type LspConfigFile, type LspServerEntry } from "./schema.js";

/**
 * Resolves the canonical file path to the LSP JSON config file within a designated home directory.
 *
 * @param homeDir - Designated home directory path (e.g. `$HERNEX_HOME`).
 * @returns Fully qualified file path to the LSP configuration file.
 *
 * @example
 * ```typescript
 * const lspPath = getLspConfigFilePath("/home/user/.greg");
 * // => "/home/user/.greg/config/lsp.json"
 * ```
 */
export function getLspConfigFilePath(homeDir: string): string {
  return path.join(homeDir, "config", "lsp.json");
}

/**
 * Reads and validates the LSP configuration file from the specified home directory.
 * If the file does not exist, returns a default empty configuration from schema defaults.
 *
 * @param homeDir - Designated home directory path.
 * @returns A promise resolving to the validated LSP configuration object.
 *
 * @example
 * ```typescript
 * const config = await readLspConfig("/home/user/.greg");
 * console.log(Object.keys(config.servers)); // => []
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
 * Atomically persists a validated LSP configuration object to disk under the specified home directory.
 * Follows the atomic write pattern: write to a `.tmp` file, then rename to the target path.
 *
 * @param homeDir - Designated home directory path.
 * @param config - The LSP configuration object to write.
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
 * If a server with the same name already exists, it is silently overwritten.
 *
 * @param homeDir - Designated home directory path.
 * @param name - User-chosen server name (e.g. `"typescript"`, `"rust"`).
 * @param entry - LSP server configuration entry to add.
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
