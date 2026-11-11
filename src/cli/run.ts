/**
 * @fileoverview Main execution handler for root print-mode agent turns.
 * @packageDocumentation
 */

import { executePrintRun } from "../core/index.js";
import { readPipedStdin } from "../core/index.js";
import type { OutputFormat } from "../output/index.js";
import { resolveEffectiveConfiguration, type CliOverrideOptions } from "../settings/index.js";
import { writeToStderr } from "../utils/index.js";

/**
 * Parsed CLI arguments passed from the root command dispatcher.
 */
export interface RunCommandArgs {
  readonly prompt?: string | undefined;
  readonly print?: boolean | string | undefined;
  readonly outputFormat?: string | undefined;
  readonly model?: string | undefined;
  readonly effort?: string | undefined;
  readonly maxTurns?: string | undefined;
  readonly timeout?: string | undefined;
  readonly systemPrompt?: string | undefined;
  readonly appendSystemPrompt?: string | undefined;
  readonly permissionMode?: string | undefined;
  readonly allowedTools?: string | string[] | undefined;
  readonly disallowedTools?: string | string[] | undefined;
  readonly tools?: string | undefined;
  readonly dangerouslySkipPermissions?: boolean | undefined;
  readonly continue?: boolean | undefined;
  readonly resume?: string | undefined;
  readonly resumeSessionAt?: string | undefined;
  readonly noSessionPersistence?: boolean | undefined;
  readonly home?: string | undefined;
  readonly bare?: boolean | undefined;
  readonly verbose?: boolean | undefined;
  readonly apiKey?: string | undefined;
  readonly baseUrl?: string | undefined;
}

/**
 * Executes a print agent run from parsed command-line flags.
 *
 * @param args - Parsed command arguments.
 * @returns Promise resolving when execution finishes.
 */
export async function executeRunAction(args: RunCommandArgs): Promise<void> {
  let effectivePrompt = args.prompt?.trim();

  // If -p was passed with an inline prompt string, take it
  if (
    (!effectivePrompt || effectivePrompt.length === 0) &&
    typeof args.print === "string" &&
    args.print.trim().length > 0
  ) {
    effectivePrompt = args.print.trim();
  }

  // If no positional prompt was provided, attempt reading from piped stdin
  if (!effectivePrompt || effectivePrompt.length === 0) {
    try {
      const piped = await readPipedStdin();
      if (piped && piped.trim().length > 0) {
        effectivePrompt = piped.trim();
      }
    } catch (stdinErr) {
      writeToStderr(`Error reading stdin: ${(stdinErr as Error).message}\n`);
      process.exit(1);
    }
  }

  if (!effectivePrompt || effectivePrompt.length === 0) {
    writeToStderr(
      "Error: Input must be provided either as a prompt argument or through piped stdin.\n",
    );
    process.exit(1);
  }

  // Parse list arguments
  const parseList = (val?: string | string[]): string[] | undefined => {
    if (!val) {
      return undefined;
    }
    if (Array.isArray(val)) {
      return val;
    }
    return val
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  };

  const parsedMaxTurns = args.maxTurns ? parseInt(args.maxTurns, 10) : undefined;
  const parsedResumeSessionAt = args.resumeSessionAt
    ? parseInt(args.resumeSessionAt, 10)
    : undefined;

  const overrides: CliOverrideOptions = {
    model: args.model,
    effort: args.effort as any,
    permissionMode: args.permissionMode as any,
    allowedTools: parseList(args.allowedTools),
    disallowedTools: parseList(args.disallowedTools),
    maxTurns: Number.isFinite(parsedMaxTurns) ? parsedMaxTurns : undefined,
    timeout: args.timeout,
    apiKey: args.apiKey,
    baseUrl: args.baseUrl,
    home: args.home,
    bare: args.bare,
  };

  let resolvedConfig;
  try {
    resolvedConfig = await resolveEffectiveConfiguration(overrides, process.cwd());
  } catch (configError) {
    writeToStderr(`Configuration error: ${(configError as Error).message}\n`);
    process.exit(1);
  }

  const rawFormat = (args.outputFormat ?? "text").toLowerCase();
  const validFormats: OutputFormat[] = ["text", "json", "stream-json"];
  const outputFormat: OutputFormat = validFormats.includes(rawFormat as OutputFormat)
    ? (rawFormat as OutputFormat)
    : "text";

  const exitCode = await executePrintRun({
    prompt: effectivePrompt,
    configuration: resolvedConfig,
    outputFormat,
    resumeThreadId: args.resume,
    continueLatest: args.continue,
    resumeSessionAt: parsedResumeSessionAt,
    noSessionPersistence: args.noSessionPersistence,
    toolsFilter: args.tools,
    dangerouslySkipPermissions: args.dangerouslySkipPermissions,
    systemPrompt: args.systemPrompt,
    appendSystemPrompt: args.appendSystemPrompt,
    verbose: args.verbose,
  });

  process.exit(exitCode);
}
