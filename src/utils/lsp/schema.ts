/**
 * @fileoverview Zod v4 schema definitions for the LSP (Language Server Protocol) configuration file.
 *
 * The LSP configuration is stored separately from `settings.json` at:
 * `$HERNEX_HOME/config/lsp.json`
 *
 * @packageDocumentation
 */

import { z } from "zod";

/**
 * Regex pattern enforcing valid, non-wildcard file extensions.
 * Extensions must start with a dot and contain only alphanumeric characters or `+`.
 * Examples: `.ts`, `.tsx`, `.c++`, `.rs`
 */
const EXTENSION_PATTERN = /^\.[a-zA-Z0-9+]+$/;

/**
 * Zod schema for a single configured LSP server entry.
 *
 * @example
 * ```typescript
 * const entry: LspServerEntry = {
 *   command: "typescript-language-server",
 *   args: ["--stdio"],
 *   extensions: [".ts", ".tsx", ".js", ".jsx"],
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
   * **Wildcards are not permitted.**
   *
   * @example [".ts", ".tsx"]
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
   * Merged on top of the sanitized safe host environment.
   */
  env: z.record(z.string(), z.string()).optional(),
});

/**
 * Fully parsed and validated single LSP server entry.
 */
export type LspServerEntry = z.infer<typeof lspServerEntrySchema>;

/**
 * Authoritative Zod schema for the top-level `lsp.json` configuration file.
 * Contains a named map of LSP server entries keyed by a user-chosen server name.
 *
 * @example
 * ```json
 * {
 *   "version": 1,
 *   "servers": {
 *     "typescript": {
 *       "command": "typescript-language-server",
 *       "args": ["--stdio"],
 *       "extensions": [".ts", ".tsx"]
 *     }
 *   }
 * }
 * ```
 */
export const lspConfigSchema = z.object({
  /** Schema layout format version, fixed to literal 1. */
  version: z.literal(1).default(1),

  /**
   * Named map of LSP server entries.
   * Keys are user-chosen server names (e.g. "typescript", "rust").
   * When multiple entries claim the same extension, the first registered wins.
   * @default {}
   */
  servers: z
    .record(z.string().min(1, "Server name must not be empty"), lspServerEntrySchema)
    .default({}),
});

/**
 * Fully parsed and validated representation of `lsp.json`.
 */
export type LspConfigFile = z.infer<typeof lspConfigSchema>;
