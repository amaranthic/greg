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
    .option("-o, --output-format <format>", "Output format: text | json | stream-json", "text")
    .option("--input-format <format>", "Input format: text | stream-json", "text")
    .option(
      "-m, --model <model>",
      "Model override (e.g. anthropic/claude-3-7-sonnet, compatible/dummy)",
    )
    .option(
      "--fallback-model <provider/modelId>",
      "Comma-separated fallback models tried left-to-right on failure (e.g. google/gemini-flash-latest,openrouter/openrouter/free)",
    )
    .option(
      "-e, --effort <effort>",
      "Reasoning effort level: none | minimal | low | medium | high | xhigh | max",
    )
    .option("-s, --max-turns <number>", "Maximum turn loop steps before stopping")
    .option(
      "--max-retries <number>",
      "Maximum retry attempts for transport and stream errors (default: 10, max: 15)",
    )
    .option("-t, --timeout <timeout>", "Wall-clock timeout e.g. 30m, 10s")
    .option("--json-schema <schema>", "JSON Schema for structured output validation")
    .option("--system-prompt <prompt>", "Override default system prompt instructions")
    .option("--append-system-prompt <prompt>", "Append instructions to the system prompt")
    .option(
      "--permission-mode <mode>",
      "Permission mode: default | acceptEdits | plan | bypassPermissions",
    )
    .option("--allowed-tools <rules>", "Tool rules to allow without prompting (e.g. 'Bash(git *)')")
    .option(
      "--disallowed-tools <rules>",
      "Tool rules to deny (always takes precedence over allows)",
    )
    .option(
      "--tools <tools>",
      "Filter exposed tools catalogue (e.g. 'default', 'readFile,writeFile', '' for none)",
    )
    .option("--dangerously-skip-permissions", "Bypass all tool permission checks")
    .option("-c, --continue", "Continue the latest conversation thread in the workspace")
    .option("-r, --resume <id>", "Resume a specific conversation thread by ID")
    .option(
      "--resume-session-at <index>",
      "Branch conversation at a specific transcript sequence index",
    )
    .option("--no-session-persistence", "Run ephemerally without persisting history or snapshots")
    .option("--home <dir>", "Override state storage and configuration home directory")
    .option("--bare", "Suppress hooks, ambient instruction discovery, and persistent settings")
    .option("--verbose", "Emit diagnostic tool activity and status to stderr")
    .option("--api-key <key>", "Explicit provider API key override")
    .option("--base-url <url>", "Explicit provider base URL override")
    .action(async (promptArgument?: unknown) => {
      const options = program.opts<Record<string, unknown>>();
      const effectivePrompt =
        typeof promptArgument === "string"
          ? promptArgument
          : typeof options.print === "string"
            ? options.print
            : undefined;

      const isNoSessionPersistence = options.sessionPersistence === false;

      const runArgs: RunCommandArgs = {
        ...options,
        noSessionPersistence: isNoSessionPersistence ? true : undefined,
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
await program.parseAsync(process.argv);
