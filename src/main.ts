#!/usr/bin/env bun
/**
 * @fileoverview Main CLI entrypoint for Greg — the autonomous print agent.
 * @packageDocumentation
 */

import { defineCommand, runMain } from "citty";
import {
  checkpointsCommand,
  configCommand,
  executeRunAction,
  threadsCommand,
} from "./cli/index.js";
import { gregVersion } from "./constants/index.js";

/**
 * The root Greg command definition.
 */
export const mainCommand = defineCommand({
  meta: {
    name: "greg",
    version: gregVersion,
    description: "The post-modern autonomous print agent powered by Hernex",
  },
  args: {
    prompt: {
      type: "positional",
      description: "Instruction prompt for the agent (reads from piped stdin if omitted)",
      required: false,
    },
    print: {
      type: "boolean",
      alias: "p",
      description: "Run in print mode (default behavior for prompt or piped input)",
    },
    outputFormat: {
      type: "string",
      alias: "o",
      description: "Output format: text | json | stream-json",
      default: "text",
    },
    model: {
      type: "string",
      alias: "m",
      description: "Model override (e.g. anthropic/claude-3-7-sonnet, compatible/dummy)",
    },
    effort: {
      type: "string",
      alias: "e",
      description: "Reasoning effort level: none | minimal | low | medium | high | xhigh | max",
    },
    maxTurns: {
      type: "string",
      alias: "s",
      description: "Maximum turn loop steps before stopping (default: 50)",
    },
    timeout: {
      type: "string",
      alias: "t",
      description: "Wall-clock timeout e.g. 30m, 10s (default: 30m)",
    },
    systemPrompt: {
      type: "string",
      description: "Override default system prompt instructions",
    },
    appendSystemPrompt: {
      type: "string",
      description: "Append instructions to the system prompt",
    },
    permissionMode: {
      type: "string",
      description: "Permission mode: default | acceptEdits | plan | bypassPermissions",
    },
    allowedTools: {
      type: "string",
      description: "Tool rules to allow without prompting (e.g. 'Bash(git *)')",
    },
    disallowedTools: {
      type: "string",
      description: "Tool rules to deny (always takes precedence over allows)",
    },
    tools: {
      type: "string",
      description:
        "Filter exposed tools catalogue (e.g. 'default', 'readFile,writeFile', '' for none)",
    },
    dangerouslySkipPermissions: {
      type: "boolean",
      description: "Bypass all tool permission checks",
    },
    continue: {
      type: "boolean",
      alias: "c",
      description: "Continue the latest conversation thread in the workspace",
    },
    resume: {
      type: "string",
      alias: "r",
      description: "Resume a specific conversation thread by ID",
    },
    resumeSessionAt: {
      type: "string",
      description: "Branch conversation at a specific transcript sequence index",
    },
    noSessionPersistence: {
      type: "boolean",
      description: "Run ephemerally without persisting history or snapshots",
    },
    home: {
      type: "string",
      description: "Override state storage and configuration home directory",
    },
    bare: {
      type: "boolean",
      description: "Suppress loading persistent settings files",
    },
    verbose: {
      type: "boolean",
      description: "Emit diagnostic tool activity and status to stderr",
    },
    apiKey: {
      type: "string",
      description: "Explicit provider API key override",
    },
    baseUrl: {
      type: "string",
      description: "Explicit provider base URL override",
    },
  },
  subCommands: {
    config: configCommand,
    threads: threadsCommand,
    checkpoints: checkpointsCommand,
  },
  async run({ rawArgs, args }) {
    const knownSubCommands = ["config", "threads", "checkpoints"];
    const isSubCommand = rawArgs.some((arg) => knownSubCommands.includes(arg));
    if (isSubCommand) {
      return;
    }
    await executeRunAction(args);
  },
});

// Run if called as primary module
runMain(mainCommand);
