/**
 * @fileoverview High-level engine runner bridging Greg CLI options to the Hernex AgentEngine.
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import {
  AgentEngine,
  FileCheckpointStore,
  FileThreadStore,
  ToolRegistry,
  type AgentReasoningLevel,
  type StepTokenUsage,
} from "@amaranthic/hernex";
import { exitCodes, type ExitCode } from "../constants/index.js";
import {
  createOutputSink,
  StderrLogger,
  StreamJsonSink,
  type OutputFormat,
  type PermissionDenialRecord,
  type RunMetrics,
} from "../output/index.js";
import {
  evaluateToolPermission,
  extractToolTarget,
  resolveExposedTools,
  type ToolPolicyOptions,
} from "../policy/index.js";
import {
  normalizeModelString,
  resolveProviderApiKey,
  resolveProviderBaseUrl,
  type ResolvedConfiguration,
} from "../settings/index.js";
import { parseDurationMs } from "../utils/index.js";
import { SignalLifecycle } from "./signals.js";
import { readStreamJsonLines } from "./input.js";

/**
 * Execution parameters driving a single Greg run.
 */
export interface ExecutionOptions {
  /** The instruction prompt to execute. */
  readonly prompt: string;
  /** Optional human-readable title for the persistent thread. */
  readonly title?: string | undefined;
  /** Resolved system configuration. */
  readonly configuration: ResolvedConfiguration;
  /** Chosen output format for standard output. */
  readonly outputFormat: OutputFormat;
  /** Chosen input format for standard input ingestion. */
  readonly inputFormat?: "text" | "stream-json" | undefined;
  /** Optional specific thread ID to resume or continue. */
  readonly resumeThreadId?: string | undefined;
  /** Whether to automatically find and continue the latest workspace thread. */
  readonly continueLatest?: boolean | undefined;
  /** Specific sequence number to truncate/resume conversation at. */
  readonly resumeSessionAt?: number | undefined;
  /** Whether to run ephemerally without persisting state or snapshots to disk. */
  readonly noSessionPersistence?: boolean | undefined;
  /** Optional tool filter string (e.g. "default", "readFile,writeFile", or ""). */
  readonly toolsFilter?: string | undefined;
  /** Whether to bypass all permission checks. */
  readonly dangerouslySkipPermissions?: boolean | undefined;
  /** System prompt instruction string to set or override. */
  readonly systemPrompt?: string | undefined;
  /** System prompt instruction text to append. */
  readonly appendSystemPrompt?: string | undefined;
  /** Optional JSON Schema constraint for structured output validation. */
  readonly jsonSchema?: Record<string, unknown> | undefined;
  /** Whether verbose diagnostic output is enabled on standard error. */
  readonly verbose?: boolean | undefined;
}

/**
 * Performs lightweight recursive schema validation against an interpreted JSON object.
 *
 * @param payload - Parsed JSON object to validate.
 * @param schema - Target JSON schema definition.
 * @returns Object with valid flag and optional error message.
 */
export function validateAgainstJsonSchema(
  payload: unknown,
  schema: Record<string, unknown>,
): { readonly valid: boolean; readonly error?: string } {
  const expectedType = typeof schema.type === "string" ? schema.type.toLowerCase() : undefined;

  if (expectedType === "object") {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return {
        valid: false,
        error: `Expected object, received ${payload === null ? "null" : Array.isArray(payload) ? "array" : typeof payload}`,
      };
    }

    const obj = payload as Record<string, unknown>;

    if (Array.isArray(schema.required)) {
      for (const requiredKey of schema.required) {
        if (
          typeof requiredKey === "string" &&
          (obj[requiredKey] === undefined || !(requiredKey in obj))
        ) {
          return { valid: false, error: `Missing required property: "${requiredKey}"` };
        }
      }
    }

    if (typeof schema.properties === "object" && schema.properties !== null) {
      const properties = schema.properties as Record<string, Record<string, unknown>>;
      for (const [key, propSchema] of Object.entries(properties)) {
        if (
          key in obj &&
          obj[key] !== undefined &&
          typeof propSchema === "object" &&
          propSchema !== null
        ) {
          const propValidation = validateAgainstJsonSchema(obj[key], propSchema);
          if (!propValidation.valid) {
            return { valid: false, error: `Property "${key}": ${propValidation.error}` };
          }
        }
      }
    }
    return { valid: true };
  }

  if (expectedType === "array") {
    if (!Array.isArray(payload)) {
      return { valid: false, error: `Expected array, received ${typeof payload}` };
    }
    if (typeof schema.items === "object" && schema.items !== null) {
      const itemSchema = schema.items as Record<string, unknown>;
      for (let i = 0; i < payload.length; i++) {
        const itemValidation = validateAgainstJsonSchema(payload[i], itemSchema);
        if (!itemValidation.valid) {
          return { valid: false, error: `Item [${i}]: ${itemValidation.error}` };
        }
      }
    }
    return { valid: true };
  }

  if (expectedType === "string") {
    if (typeof payload !== "string") {
      return { valid: false, error: `Expected string, received ${typeof payload}` };
    }
    return { valid: true };
  }

  if (expectedType === "number" || expectedType === "integer") {
    if (typeof payload !== "number" || !Number.isFinite(payload)) {
      return { valid: false, error: `Expected number, received ${typeof payload}` };
    }
    return { valid: true };
  }

  if (expectedType === "boolean") {
    if (typeof payload !== "boolean") {
      return { valid: false, error: `Expected boolean, received ${typeof payload}` };
    }
    return { valid: true };
  }

  return { valid: true };
}

/**
 * Orchestrates the full lifecycle of a print-mode agent execution turn.
 *
 * @param options - Execution parameters.
 * @param workingDirectory - Workspace directory (defaults to process.cwd()).
 * @returns Promise resolving to the final POSIX exit code.
 *
 * @example
 * ```typescript
 * const code = await executePrintRun({
 *   prompt: "Fix formatting bug",
 *   configuration: resolvedConfig,
 *   outputFormat: "text"
 * });
 * process.exit(code);
 * ```
 */
export async function executePrintRun(
  options: ExecutionOptions,
  workingDirectory: string = process.cwd(),
): Promise<ExitCode> {
  const { configuration, outputFormat, verbose } = options;
  const logger = new StderrLogger(verbose ? { isVerbose: true } : {});
  const signalLifecycle = new SignalLifecycle();

  const isPersistent = !options.noSessionPersistence;
  const threadStore = isPersistent
    ? new FileThreadStore({ homeDirectory: configuration.homeDirectory })
    : undefined;
  const checkpointStore = isPersistent
    ? new FileCheckpointStore({ homeDirectory: configuration.homeDirectory })
    : undefined;

  // Resolve target thread identifier
  let targetThreadId: string;
  let isNewThread = true;

  if (options.resumeThreadId) {
    targetThreadId = options.resumeThreadId;
    isNewThread = false;
  } else if (options.continueLatest && threadStore) {
    const existingThreads = await threadStore.listThreads({
      workingDirectory,
      limit: 1,
    });
    if (existingThreads.length > 0 && existingThreads[0]) {
      targetThreadId = existingThreads[0].id;
      isNewThread = false;
    } else {
      targetThreadId = randomUUID();
    }
  } else {
    targetThreadId = randomUUID();
  }

  // Ensure persistent thread record is created if new
  if (isNewThread && threadStore) {
    await threadStore.createThread({
      id: targetThreadId,
      ...(options.title ? { title: options.title } : {}),
      workingDirectory,
      model: configuration.model,
      ...(configuration.settings.effort
        ? { reasoning: configuration.settings.effort as AgentReasoningLevel }
        : {}),
    });
  }

  // Setup tool registry and catalogue exposure filtering
  const toolRegistry = new ToolRegistry({ includeDefaults: true });
  const exposedTools = resolveExposedTools(
    options.toolsFilter,
    configuration.settings.permissionMode,
  );

  // Unregister any built-in tool that was not authorized into exposedTools
  for (const registeredTool of toolRegistry.list()) {
    if (!exposedTools.has(registeredTool.name)) {
      toolRegistry.unregister(registeredTool.name);
    }
  }

  // Setup permission policy options
  const policyOptions: ToolPolicyOptions = {
    permissionMode: configuration.settings.permissionMode,
    allowedTools: configuration.settings.allowedTools,
    disallowedTools: configuration.settings.disallowedTools,
    dangerouslySkipPermissions: options.dangerouslySkipPermissions,
  };

  // Compile full system instructions
  let finalInstructions: string | undefined;
  if (options.systemPrompt) {
    finalInstructions = options.systemPrompt;
  }
  if (options.appendSystemPrompt) {
    finalInstructions = finalInstructions
      ? `${finalInstructions}\n\n${options.appendSystemPrompt}`
      : options.appendSystemPrompt;
  }
  if (options.jsonSchema) {
    const schemaInstruction = `You MUST format your final answer strictly as a JSON object matching this JSON Schema (output ONLY valid raw JSON with no markdown fences and no extra commentary):\n${JSON.stringify(options.jsonSchema, null, 2)}`;
    finalInstructions = finalInstructions
      ? `${finalInstructions}\n\n${schemaInstruction}`
      : schemaInstruction;
  }

  // Configure output sink
  const sink = createOutputSink({
    format: outputFormat,
    threadId: targetThreadId,
    model: configuration.model,
    provider: configuration.provider,
    workingDirectory,
  });

  logger.header({
    threadId: targetThreadId,
    model: configuration.model,
    provider: configuration.provider,
    permissionMode: configuration.settings.permissionMode,
    exposedToolsCount: exposedTools.size,
    isNewThread,
  });

  sink.emitInit();

  const runStartedAt = Date.now();
  let firstTokenAt: number | undefined;
  let numTurns = 1;
  let stopReason = "completed";
  let totalUsage: StepTokenUsage | undefined;
  const permissionDenials: PermissionDenialRecord[] = [];

  let engine: AgentEngine;
  let permissionDeniedEncountered = false;

  const authHook = async (context: {
    readonly toolName: string;
    readonly parameters: unknown;
    readonly workingDirectory: string;
  }) => {
    const decision = evaluateToolPermission(context, policyOptions);
    if (decision.decision === "deny") {
      permissionDeniedEncountered = true;
      const target = extractToolTarget(
        context.toolName,
        context.parameters,
        context.workingDirectory,
      );
      const denialRecord: PermissionDenialRecord = {
        tool: context.toolName,
        target,
        reason: decision.reason,
        timestamp: Date.now(),
      };
      permissionDenials.push(denialRecord);
      if (sink instanceof StreamJsonSink) {
        sink.emitPermissionDenial(denialRecord);
      }
      logger.error(decision.reason);
    }
    return decision;
  };

  const candidateModels: readonly string[] = [
    configuration.model,
    ...(configuration.fallbackModels ?? []),
  ];

  const createEngineForModel = async (targetModel: string): Promise<AgentEngine> => {
    const normalized = normalizeModelString(targetModel);
    const candidateApiKey = resolveProviderApiKey(normalized.provider, configuration.apiKey);
    const candidateBaseUrl = resolveProviderBaseUrl(normalized.provider, configuration.baseUrl);

    if (!isNewThread && threadStore) {
      const metadata = await threadStore.getThread(targetThreadId);
      if (!metadata) {
        throw new Error(`Thread not found: "${targetThreadId}"`);
      }
      let messages = await threadStore.getMessages(targetThreadId);
      if (options.resumeSessionAt !== undefined && options.resumeSessionAt >= 0) {
        messages = messages.slice(0, options.resumeSessionAt);
      }
      return new AgentEngine(
        {
          threadId: targetThreadId,
          workingDirectory: metadata.workingDirectory,
          model: targetModel,
          apiKey: candidateApiKey,
          baseUrl: candidateBaseUrl,
          tools: toolRegistry,
          persist: isPersistent,
          checkpoint: isPersistent,
          abortSignal: signalLifecycle.signal,
          hooks: {
            onAuthorizeTool: authHook,
          },
          ...(threadStore ? { threadStore } : {}),
          ...(checkpointStore ? { checkpointStore } : {}),
          ...(finalInstructions ? { instructions: finalInstructions } : {}),
          ...(configuration.settings.effort
            ? { reasoning: configuration.settings.effort as AgentReasoningLevel }
            : {}),
          ...(configuration.settings.maxTurns ? { maxSteps: configuration.settings.maxTurns } : {}),
        },
        messages,
        metadata.turnCount,
      );
    }

    return new AgentEngine({
      threadId: targetThreadId,
      workingDirectory,
      model: targetModel,
      apiKey: candidateApiKey,
      baseUrl: candidateBaseUrl,
      tools: toolRegistry,
      persist: isPersistent,
      checkpoint: isPersistent,
      abortSignal: signalLifecycle.signal,
      hooks: {
        onAuthorizeTool: authHook,
      },
      ...(threadStore ? { threadStore } : {}),
      ...(checkpointStore ? { checkpointStore } : {}),
      ...(finalInstructions ? { instructions: finalInstructions } : {}),
      ...(configuration.settings.effort
        ? { reasoning: configuration.settings.effort as AgentReasoningLevel }
        : {}),
      ...(configuration.settings.maxTurns ? { maxSteps: configuration.settings.maxTurns } : {}),
    });
  };

  // Wall-clock timeout management
  const timeoutMs = parseDurationMs(configuration.settings.timeout);
  let timeoutTriggered = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  let exitCode: ExitCode = exitCodes.success;
  let turnText = "";

  try {
    for (let modelIndex = 0; modelIndex < candidateModels.length; modelIndex++) {
      const currentModel = candidateModels[modelIndex]!;

      try {
        engine = await createEngineForModel(currentModel);
      } catch (initError) {
        const message = initError instanceof Error ? initError.message : String(initError);
        if (modelIndex < candidateModels.length - 1) {
          const nextModel = candidateModels[modelIndex + 1];
          logger.error(
            `Model "${currentModel}" initialization failed: ${message}. Falling back to "${nextModel}"...`,
          );
          continue;
        }
        logger.error(`Failed to initialize engine with model "${currentModel}": ${message}`);
        exitCode = exitCodes.runtimeError;
        break;
      }

      if (!timer && timeoutMs > 0) {
        timer = setTimeout(() => {
          timeoutTriggered = true;
          logger.error(`Execution timed out after ${timeoutMs}ms`);
          signalLifecycle.requestAbort("Execution timed out", exitCodes.timeout);
          engine.abort("Execution timed out");
        }, timeoutMs);
        timer.unref();
      }

      try {
        turnText = "";
        let modelTurnFailed = false;
        exitCode = exitCodes.success;

        const promptsToExecute: string[] = [];
        if (options.prompt && options.prompt.trim().length > 0) {
          promptsToExecute.push(options.prompt);
        }
        if (options.inputFormat === "stream-json") {
          for await (const streamPrompt of readStreamJsonLines()) {
            promptsToExecute.push(streamPrompt);
          }
        }

        for (const currentPrompt of promptsToExecute) {
          for await (const event of engine.runTurn(currentPrompt)) {
            if (event.type === "tokenDelta") {
              turnText += event.text;
              if (firstTokenAt === undefined) {
                firstTokenAt = Date.now();
              }
            } else if (event.type === "thoughtDelta") {
              if (firstTokenAt === undefined) {
                firstTokenAt = Date.now();
              }
            } else if (event.type === "turnFinished") {
              numTurns = event.turnIndex;
              stopReason = event.finishReason;
              totalUsage = event.totalUsage;
            }

            sink.emit(event);

            if (event.type === "toolExecutionStarted") {
              logger.toolStart(event.toolName);
            } else if (event.type === "toolExecutionFinished") {
              logger.toolFinish(event.toolName, event.isError);
            } else if (event.type === "error" && event.isFatal) {
              modelTurnFailed = true;
              exitCode = exitCodes.runtimeError;
            }
          }
        }

        if (modelTurnFailed && modelIndex < candidateModels.length - 1) {
          const nextModel = candidateModels[modelIndex + 1];
          logger.error(
            `Model "${currentModel}" failed during turn. Falling back to "${nextModel}"...`,
          );
          continue;
        }

        if (options.jsonSchema && exitCode === exitCodes.success) {
          let cleaned = turnText.trim();
          if (cleaned.startsWith("```json")) {
            cleaned = cleaned.slice(7);
          } else if (cleaned.startsWith("```")) {
            cleaned = cleaned.slice(3);
          }
          if (cleaned.endsWith("```")) {
            cleaned = cleaned.slice(0, -3);
          }
          cleaned = cleaned.trim();

          try {
            const parsedJson = JSON.parse(cleaned);
            const validation = validateAgainstJsonSchema(parsedJson, options.jsonSchema);
            if (!validation.valid) {
              logger.error(`Output failed JSON schema validation: ${validation.error}`);
              exitCode = exitCodes.runtimeError;
            }
          } catch (parseError) {
            logger.error(
              `Output is not valid JSON matching schema: ${(parseError as Error).message}`,
            );
            exitCode = exitCodes.runtimeError;
          }
        }

        // Successful completion of turn
        break;
      } catch (turnError) {
        if (timeoutTriggered) {
          exitCode = exitCodes.timeout;
          break;
        } else if (permissionDeniedEncountered) {
          exitCode = exitCodes.permissionDenied;
          break;
        } else if (modelIndex < candidateModels.length - 1) {
          const nextModel = candidateModels[modelIndex + 1];
          const message = turnError instanceof Error ? turnError.message : String(turnError);
          logger.error(
            `Model "${currentModel}" execution failed: ${message}. Falling back to "${nextModel}"...`,
          );
          continue;
        } else {
          const message = turnError instanceof Error ? turnError.message : String(turnError);
          logger.error(`Turn execution aborted: ${message}`);
          exitCode = exitCodes.runtimeError;
          break;
        }
      }
    }
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (timeoutTriggered) {
      exitCode = exitCodes.timeout;
    } else if (permissionDeniedEncountered) {
      exitCode = exitCodes.permissionDenied;
    }

    const metrics: RunMetrics = {
      runStartedAt,
      firstTokenAt,
      durationApiMs: Math.max(0, Date.now() - runStartedAt),
      numTurns,
      stopReason,
      totalUsage,
      permissionDenials,
    };

    await sink.finish(exitCode, metrics);
  }

  return exitCode;
}
