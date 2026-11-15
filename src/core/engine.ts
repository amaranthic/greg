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
  type BeforeTurnResult,
  type ModelMessage,
  type PermissionDecision,
  type StepTokenUsage,
  type StopDecision,
  type TurnFinishReason,
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
  toUserFacingToolName,
  type ToolPolicyOptions,
} from "../policy/index.js";
import {
  normalizeModelString,
  resolveProviderApiKey,
  resolveProviderBaseUrl,
  type ResolvedConfiguration,
} from "../settings/index.js";
import {
  executeCommandHook,
  executePromptHook,
  killAllActiveHookProcesses,
  loadHooksConfig,
  resolveMatchingHooks,
  type HookInput,
  type ResolvedHooksConfig,
} from "../hooks/index.js";
import { parseDurationMs } from "../utils/index.js";
import { SignalLifecycle } from "./signals.js";
import { readStreamJsonLines } from "./input.js";

/**
 * Internal result structure for PostTool hooks.
 */
interface PostToolResult {
  readonly updatedResult?: unknown | undefined;
  readonly additionalContext?: string | undefined;
}

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

  signalLifecycle.registerCleanup(() => {
    killAllActiveHookProcesses();
  });

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

  // Load effective project and global hooks configuration
  const hooksConfig = await loadHooksConfig(workingDirectory, configuration.homeDirectory);

  const authHook = async (context: {
    readonly toolName: string;
    readonly parameters: unknown;
    readonly workingDirectory: string;
  }): Promise<PermissionDecision> => {
    // 1. Evaluate declarative permission policy
    const policyDecision = evaluateToolPermission(context, policyOptions);
    if (policyDecision.decision === "deny") {
      permissionDeniedEncountered = true;
      const target = extractToolTarget(
        context.toolName,
        context.parameters,
        context.workingDirectory,
      );
      const denialRecord: PermissionDenialRecord = {
        tool: context.toolName,
        target,
        reason: policyDecision.reason,
        timestamp: Date.now(),
      };
      permissionDenials.push(denialRecord);
      if (sink instanceof StreamJsonSink) {
        sink.emitPermissionDenial(denialRecord);
      }
      logger.error(policyDecision.reason);
      return policyDecision;
    }

    // 2. Evaluate PreToolUse hooks
    const canonicalToolName = toUserFacingToolName(context.toolName) ?? context.toolName;
    const matchingHooks = resolveMatchingHooks(
      hooksConfig.PreToolUse,
      canonicalToolName,
      context.parameters,
      context.workingDirectory,
    );

    let effectiveParameters = context.parameters;

    for (const hook of matchingHooks) {
      const hookInput: HookInput = {
        sessionId: targetThreadId,
        hookEvent: "PreToolUse",
        projectDir: workingDirectory,
        cwd: context.workingDirectory,
        model: configuration.model,
        turnIndex: engine ? engine.currentTurn + 1 : 1,
        toolName: canonicalToolName,
        toolInput: effectiveParameters,
      };

      const hookOptions = { signal: signalLifecycle.signal };
      const result =
        hook.type === "command"
          ? await executeCommandHook(hook, hookInput, hookOptions)
          : await executePromptHook(hook, hookInput, configuration, hookOptions);

      if (result.nonBlockingError && result.errorMessage) {
        logger.warn(result.errorMessage);
      }

      if (result.blocked) {
        const reason = result.blockReason ?? `Tool ${canonicalToolName} blocked by PreToolUse hook`;
        permissionDeniedEncountered = true;
        const target = extractToolTarget(
          context.toolName,
          effectiveParameters,
          context.workingDirectory,
        );
        const denialRecord: PermissionDenialRecord = {
          tool: context.toolName,
          target,
          reason,
          timestamp: Date.now(),
        };
        permissionDenials.push(denialRecord);
        if (sink instanceof StreamJsonSink) {
          sink.emitPermissionDenial(denialRecord);
        }
        logger.error(reason);
        return { decision: "deny", reason };
      }

      if ("updatedInput" in result && result.updatedInput) {
        effectiveParameters = result.updatedInput;
      }
    }

    return {
      decision: "allow",
      ...(effectiveParameters !== context.parameters
        ? { updatedParameters: effectiveParameters }
        : {}),
    };
  };

  const postToolHook = async (context: {
    readonly toolName: string;
    readonly parameters: unknown;
    readonly result: unknown;
    readonly isError: boolean;
    readonly durationMs: number;
    readonly workingDirectory: string;
  }): Promise<PostToolResult | void> => {
    const canonicalToolName = toUserFacingToolName(context.toolName) ?? context.toolName;
    const matchingHooks = resolveMatchingHooks(
      hooksConfig.PostToolUse,
      canonicalToolName,
      context.parameters,
      context.workingDirectory,
    );

    if (matchingHooks.length === 0) {
      return;
    }

    const additionalContexts: string[] = [];

    for (const hook of matchingHooks) {
      const hookInput: HookInput = {
        sessionId: targetThreadId,
        hookEvent: "PostToolUse",
        projectDir: workingDirectory,
        cwd: context.workingDirectory,
        model: configuration.model,
        turnIndex: engine ? engine.currentTurn : 1,
        toolName: canonicalToolName,
        toolInput: context.parameters,
        toolStatus: context.isError ? "error" : "success",
        toolDurationMs: context.durationMs,
      };

      const hookOptions = { signal: signalLifecycle.signal };
      const result =
        hook.type === "command"
          ? await executeCommandHook(hook, hookInput, hookOptions)
          : await executePromptHook(hook, hookInput, configuration, hookOptions);

      if (result.nonBlockingError && result.errorMessage) {
        logger.warn(result.errorMessage);
      }

      if (result.additionalContext) {
        additionalContexts.push(result.additionalContext);
      }
    }

    if (additionalContexts.length > 0) {
      return {
        additionalContext: additionalContexts.join("\n\n"),
      };
    }
  };

  const beforeTurnHook = async (context: {
    readonly turnIndex: number;
    readonly userPrompt: string;
  }): Promise<BeforeTurnResult | void> => {
    const matchingHooks = resolveMatchingHooks(hooksConfig.UserPromptSubmit);

    if (matchingHooks.length === 0) {
      return;
    }

    const additionalInstructions: string[] = [];

    for (const hook of matchingHooks) {
      const hookInput: HookInput = {
        sessionId: targetThreadId,
        hookEvent: "UserPromptSubmit",
        projectDir: workingDirectory,
        cwd: workingDirectory,
        model: configuration.model,
        turnIndex: context.turnIndex,
        userPrompt: context.userPrompt,
      };

      const hookOptions = { signal: signalLifecycle.signal };
      const result =
        hook.type === "command"
          ? await executeCommandHook(hook, hookInput, hookOptions)
          : await executePromptHook(hook, hookInput, configuration, hookOptions);

      if (result.nonBlockingError && result.errorMessage) {
        logger.warn(result.errorMessage);
      }

      if (result.blocked) {
        const reason = result.blockReason ?? "Turn vetoed by UserPromptSubmit hook";
        logger.error(reason);
        return { veto: true, vetoReason: reason };
      }

      if (result.additionalContext) {
        additionalInstructions.push(result.additionalContext);
      }
    }

    if (additionalInstructions.length > 0) {
      return {
        injectedInstructions: additionalInstructions.join("\n\n"),
      };
    }
  };

  const shouldStopHook = async (context: {
    readonly turnIndex: number;
    readonly finishReason: TurnFinishReason;
    readonly transcript?: readonly ModelMessage[] | undefined;
  }): Promise<StopDecision> => {
    const matchingHooks = resolveMatchingHooks(hooksConfig.Stop);

    if (matchingHooks.length === 0) {
      return { shouldStop: true };
    }

    let lastAssistantText: string | undefined;
    if (context.transcript && context.transcript.length > 0) {
      for (let i = context.transcript.length - 1; i >= 0; i--) {
        const message = context.transcript[i];
        if (message && message.role === "assistant") {
          if (typeof message.content === "string") {
            lastAssistantText = message.content;
            break;
          } else if (Array.isArray(message.content)) {
            lastAssistantText = (message.content as Array<{ type: string; text?: string }>)
              .filter((c) => c.type === "text" && c.text)
              .map((c) => c.text)
              .join("\n");
            break;
          }
        }
      }
    }

    for (const hook of matchingHooks) {
      const hookInput: HookInput = {
        sessionId: targetThreadId,
        hookEvent: "Stop",
        projectDir: workingDirectory,
        cwd: workingDirectory,
        model: configuration.model,
        turnIndex: context.turnIndex,
        lastAssistantMessage: lastAssistantText,
      };

      const hookOptions = { signal: signalLifecycle.signal };
      const result =
        hook.type === "command"
          ? await executeCommandHook(hook, hookInput, hookOptions)
          : await executePromptHook(hook, hookInput, configuration, hookOptions);

      if (result.nonBlockingError && result.errorMessage) {
        logger.warn(result.errorMessage);
      }

      if (result.blocked) {
        const reason = result.blockReason ?? "Verification failed";
        logger.warn(`Stop hook vetoed turn completion: ${reason}`);
        return {
          shouldStop: false,
          reminderPrompt: `Stop hook feedback:\n${reason}`,
        };
      }
    }

    return { shouldStop: true };
  };

  const candidateModels: readonly string[] = [
    configuration.model,
    ...(configuration.fallbackModels ?? []),
  ];

  const createEngineForModel = async (targetModel: string): Promise<AgentEngine> => {
    const normalized = normalizeModelString(targetModel);
    const candidateApiKey = resolveProviderApiKey(normalized.provider, configuration.apiKey);
    const candidateBaseUrl = resolveProviderBaseUrl(normalized.provider, configuration.baseUrl);

    const agentHooks = {
      onAuthorizeTool: authHook,
      onPostTool: postToolHook,
      onBeforeTurn: beforeTurnHook,
      onShouldStop: shouldStopHook,
    };

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
          hooks: agentHooks,
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
      hooks: agentHooks,
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
              logger.error(event.error.message);
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
