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
} from "@amaranthic/hernex";
import { exitCodes, type ExitCode } from "../constants/index.js";
import { createOutputSink, StderrLogger, type OutputFormat } from "../output/index.js";
import {
  evaluateToolPermission,
  resolveExposedTools,
  type ToolPolicyOptions,
} from "../policy/index.js";
import type { ResolvedConfiguration } from "../settings/index.js";
import { parseDurationMs } from "../utils/index.js";
import { SignalLifecycle } from "./signals.js";

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
  /** Whether verbose diagnostic output is enabled on standard error. */
  readonly verbose?: boolean | undefined;
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
      logger.error(decision.reason);
    }
    return decision;
  };

  try {
    if (!isNewThread && threadStore) {
      const metadata = await threadStore.getThread(targetThreadId);
      if (!metadata) {
        throw new Error(`Thread not found: "${targetThreadId}"`);
      }
      let messages = await threadStore.getMessages(targetThreadId);
      if (options.resumeSessionAt !== undefined && options.resumeSessionAt >= 0) {
        messages = messages.slice(0, options.resumeSessionAt);
      }
      engine = new AgentEngine(
        {
          threadId: targetThreadId,
          workingDirectory: metadata.workingDirectory,
          model: configuration.model,
          apiKey: configuration.apiKey,
          baseUrl: configuration.baseUrl,
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
    } else {
      engine = new AgentEngine({
        threadId: targetThreadId,
        workingDirectory,
        model: configuration.model,
        apiKey: configuration.apiKey,
        baseUrl: configuration.baseUrl,
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
    }
  } catch (initError) {
    const message = initError instanceof Error ? initError.message : String(initError);
    logger.error(`Failed to initialize engine: ${message}`);
    await sink.finish(exitCodes.runtimeError);
    return exitCodes.runtimeError;
  }

  // Wall-clock timeout management
  const timeoutMs = parseDurationMs(configuration.settings.timeout);
  let timeoutTriggered = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      timeoutTriggered = true;
      logger.error(`Execution timed out after ${timeoutMs}ms`);
      signalLifecycle.requestAbort("Execution timed out", exitCodes.timeout);
      engine.abort("Execution timed out");
    }, timeoutMs);
    timer.unref();
  }

  let exitCode: ExitCode = exitCodes.success;

  try {
    for await (const event of engine.runTurn(options.prompt)) {
      sink.emit(event);

      if (event.type === "toolExecutionStarted") {
        logger.toolStart(event.toolName);
      } else if (event.type === "toolExecutionFinished") {
        logger.toolFinish(event.toolName, event.isError);
      } else if (event.type === "error" && event.isFatal) {
        exitCode = exitCodes.runtimeError;
      }
    }
  } catch (turnError) {
    if (timeoutTriggered) {
      exitCode = exitCodes.timeout;
    } else if (permissionDeniedEncountered) {
      exitCode = exitCodes.permissionDenied;
    } else {
      const message = turnError instanceof Error ? turnError.message : String(turnError);
      logger.error(`Turn execution aborted: ${message}`);
      exitCode = exitCodes.runtimeError;
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
    await sink.finish(exitCode);
  }

  return exitCode;
}
