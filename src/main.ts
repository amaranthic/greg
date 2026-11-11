#!/usr/bin/env bun
/**
 * @fileoverview Main CLI entrypoint for Greg — the autonomous print agent.
 * @packageDocumentation
 */

import { Command } from "commander";
import {
  createCheckpointsCommand,
  createConfigCommand,
  createThreadsCommand,
  executeRunAction,
  type RunCommandArgs,
} from "./cli/index.js";
import { gregVersion } from "./constants/index.js";

/**
 * Normalizes command line arguments to seamlessly accept both kebab-case and camelCase flags.
 *
 * @param argv - Raw argument vector.
 * @returns Normalized argument vector.
 */
export function normalizeArgv(argv: readonly string[]): string[] {
  let isDoubleDash = false;
  return argv.map((arg) => {
    if (arg === "--") {
      isDoubleDash = true;
      return arg;
    }
    if (isDoubleDash || !arg.startsWith("--") || arg.startsWith("---")) {
      return arg;
    }
    const eqIdx = arg.indexOf("=");
    if (eqIdx !== -1) {
      const flag = arg.slice(2, eqIdx);
      const val = arg.slice(eqIdx);
      const camel = flag.replace(/-([a-z0-9])/gi, (_, c: string) => c.toUpperCase());
      return `--${camel}${val}`;
    }
    const flag = arg.slice(2);
    const camel = flag.replace(/-([a-z0-9])/gi, (_, c: string) => c.toUpperCase());
    return `--${camel}`;
  });
}

/**
 * Creates and constructs the authoritative Greg CLI program.
 *
 * @returns Root commander Command instance.
 *
 * @example
 * ```typescript
 * const program = createProgram();
 * await program.parseAsync(process.argv);
 * ```
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name("greg")
    .version(gregVersion, "-v, --version", "Display version information")
    .description("The post-modern autonomous print agent powered by Hernex")
    .argument("[prompt]", "Instruction prompt for the agent (reads from piped stdin if omitted)")
    .option(
      "-p, --print [prompt]",
      "Run in print mode (default behavior for prompt or piped input)",
    )
    .option("-o, --outputFormat <format>", "Output format: text | json | stream-json", "text")
    .option(
      "-m, --model <model>",
      "Model override (e.g. anthropic/claude-3-7-sonnet, compatible/dummy)",
    )
    .option(
      "-e, --effort <effort>",
      "Reasoning effort level: none | minimal | low | medium | high | xhigh | max",
    )
    .option("-s, --maxTurns <number>", "Maximum turn loop steps before stopping")
    .option("-t, --timeout <timeout>", "Wall-clock timeout e.g. 30m, 10s")
    .option("--systemPrompt <prompt>", "Override default system prompt instructions")
    .option("--appendSystemPrompt <prompt>", "Append instructions to the system prompt")
    .option(
      "--permissionMode <mode>",
      "Permission mode: default | acceptEdits | plan | bypassPermissions",
    )
    .option("--allowedTools <rules>", "Tool rules to allow without prompting (e.g. 'Bash(git *)')")
    .option("--disallowedTools <rules>", "Tool rules to deny (always takes precedence over allows)")
    .option(
      "--tools <tools>",
      "Filter exposed tools catalogue (e.g. 'default', 'readFile,writeFile', '' for none)",
    )
    .option("--dangerouslySkipPermissions", "Bypass all tool permission checks")
    .option("-c, --continue", "Continue the latest conversation thread in the workspace")
    .option("-r, --resume <id>", "Resume a specific conversation thread by ID")
    .option(
      "--resumeSessionAt <index>",
      "Branch conversation at a specific transcript sequence index",
    )
    .option("--noSessionPersistence", "Run ephemerally without persisting history or snapshots")
    .option("--home <dir>", "Override state storage and configuration home directory")
    .option("--bare", "Suppress loading persistent settings files")
    .option("--verbose", "Emit diagnostic tool activity and status to stderr")
    .option("--apiKey <key>", "Explicit provider API key override")
    .option("--baseUrl <url>", "Explicit provider base URL override")
    .action(async (promptArgument?: string, options: Record<string, unknown> = {}) => {
      const effectivePrompt =
        promptArgument ?? (typeof options.print === "string" ? options.print : undefined);

      const runArgs: RunCommandArgs = {
        ...options,
        prompt: effectivePrompt,
      };

      await executeRunAction(runArgs);
    });

  // Attach subcommands
  program.addCommand(createConfigCommand());
  program.addCommand(createThreadsCommand());
  program.addCommand(createCheckpointsCommand());

  return program;
}

// Execute CLI
const program = createProgram();
await program.parseAsync(normalizeArgv(process.argv));
