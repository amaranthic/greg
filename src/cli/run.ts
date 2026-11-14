/**
 * @fileoverview Main execution handler for root print-mode agent turns.
 * @packageDocumentation
 */

import { defaultStdinPrompt, maxThreadTitleLength } from "../constants/index.js";
import { executePrintRun, readPipedStdin } from "../core/index.js";
import type { OutputFormat } from "../output/index.js";
import { resolveEffectiveConfiguration, type CliOverrideOptions } from "../settings/index.js";
import { normalizeThreadTitle, writeToStderr } from "../utils/index.js";

/**
 * Parsed CLI arguments passed from the root command dispatcher.
 */
export interface RunCommandArgs {
  readonly prompt?: string | undefined;
  readonly print?: boolean | string | undefined;
  readonly inputFormat?: string | undefined;
  readonly outputFormat?: string | undefined;
  readonly model?: string | undefined;
  readonly fallbackModel?: string | string[] | undefined;
  readonly effort?: string | undefined;
  readonly maxTurns?: string | undefined;
  readonly timeout?: string | undefined;
  readonly jsonSchema?: string | undefined;
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
  let userPrompt = args.prompt?.trim();

  // If -p was passed with an inline prompt string, take it
  if (
    (!userPrompt || userPrompt.length === 0) &&
    typeof args.print === "string" &&
    args.print.trim().length > 0
  ) {
    userPrompt = args.print.trim();
  }

  // Attempt reading piped stdin if available
  let pipedStdin: string | undefined;
  try {
    pipedStdin = await readPipedStdin();
    if (pipedStdin) {
      pipedStdin = pipedStdin.trim();
    }
  } catch (stdinErr) {
    writeToStderr(`Error reading stdin: ${(stdinErr as Error).message}\n`);
    process.exit(1);
  }

  const hasUserPrompt = typeof userPrompt === "string" && userPrompt.length > 0;
  const hasPipedStdin = typeof pipedStdin === "string" && pipedStdin.length > 0;

  const rawInputFormat = (args.inputFormat ?? "text").toLowerCase();
  if (rawInputFormat !== "text" && rawInputFormat !== "stream-json") {
    writeToStderr(
      `Error: Invalid input format "${args.inputFormat}". Choices: "text", "stream-json".\n`,
    );
    process.exit(1);
  }

  const rawFormat = (args.outputFormat ?? "text").toLowerCase();
  const validFormats: OutputFormat[] = ["text", "json", "stream-json"];
  const outputFormat: OutputFormat = validFormats.includes(rawFormat as OutputFormat)
    ? (rawFormat as OutputFormat)
    : "text";

  if (rawInputFormat === "stream-json" && outputFormat !== "stream-json") {
    writeToStderr("Error: --input-format=stream-json requires output-format=stream-json.\n");
    process.exit(1);
  }

  const isStreamJsonInput = rawInputFormat === "stream-json";
  if (!hasUserPrompt && !hasPipedStdin && !isStreamJsonInput) {
    writeToStderr(
      "Error: Input must be provided either as a prompt argument or through piped stdin.\n",
    );
    process.exit(1);
  }

  let effectivePrompt: string;
  let rawTitleSource: string;

  if (hasUserPrompt && hasPipedStdin) {
    // Both user prompt and stdin: prompt directive on top, stdin delineated below. Title is user prompt.
    effectivePrompt = `${userPrompt}\n\n---\nStandard Input:\n${pipedStdin}`;
    rawTitleSource = userPrompt!;
  } else if (hasUserPrompt) {
    // Only user prompt
    effectivePrompt = userPrompt!;
    rawTitleSource = userPrompt!;
  } else if (hasPipedStdin) {
    // Only stdin: sample prompt prepended, but title derived from normalized stdin text
    effectivePrompt = `${defaultStdinPrompt}\n\n---\nStandard Input:\n${pipedStdin}`;
    rawTitleSource = pipedStdin!;
  } else {
    effectivePrompt = "";
    rawTitleSource = "Stream JSON Session";
  }

  const derivedTitle = normalizeThreadTitle(rawTitleSource, maxThreadTitleLength);

  // Parse comma-separated list arguments respecting tool parentheses e.g. "Bash(ls *), writeFile(src/*)"
  const parseList = (val?: string | string[]): string[] | undefined => {
    if (!val) {
      return undefined;
    }
    if (Array.isArray(val)) {
      return val;
    }
    const items: string[] = [];
    let current = "";
    let depth = 0;

    for (let i = 0; i < val.length; i++) {
      const char = val[i];
      if (char === "(") {
        depth++;
        current += char;
      } else if (char === ")") {
        depth = Math.max(0, depth - 1);
        current += char;
      } else if (char === "," && depth === 0) {
        const trimmed = current.trim();
        if (trimmed.length > 0) {
          items.push(trimmed);
        }
        current = "";
      } else {
        current += char;
      }
    }

    const trailing = current.trim();
    if (trailing.length > 0) {
      items.push(trailing);
    }

    return items;
  };

  const parsedMaxTurns = args.maxTurns ? parseInt(args.maxTurns, 10) : undefined;
  const parsedResumeSessionAt = args.resumeSessionAt
    ? parseInt(args.resumeSessionAt, 10)
    : undefined;

  const overrides: CliOverrideOptions = {
    model: args.model,
    fallbackModels: parseList(args.fallbackModel),
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

  let parsedJsonSchema: Record<string, unknown> | undefined;
  if (args.jsonSchema !== undefined) {
    const trimmed = args.jsonSchema.trim();
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        writeToStderr("Error: --json-schema must be a JSON object\n");
        process.exit(1);
      }
      parsedJsonSchema = parsed as Record<string, unknown>;
    } catch (err) {
      writeToStderr(`Error: --json-schema is not valid JSON: ${(err as Error).message}\n`);
      process.exit(1);
    }
  }

  const exitCode = await executePrintRun({
    prompt: effectivePrompt,
    title: derivedTitle,
    configuration: resolvedConfig,
    inputFormat: rawInputFormat as "text" | "stream-json",
    outputFormat,
    resumeThreadId: args.resume,
    continueLatest: args.continue,
    resumeSessionAt: parsedResumeSessionAt,
    noSessionPersistence: args.noSessionPersistence,
    toolsFilter: args.tools,
    dangerouslySkipPermissions: args.dangerouslySkipPermissions,
    systemPrompt: args.systemPrompt,
    appendSystemPrompt: args.appendSystemPrompt,
    jsonSchema: parsedJsonSchema,
    verbose: args.verbose,
  });

  process.exit(exitCode);
}
