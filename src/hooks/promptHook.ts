/**
 * @fileoverview Isolated, in-memory prompt-based LLM verification hook execution using Hernex AgentEngine.
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import {
  AgentEngine,
  GlobTool,
  GrepTool,
  ReadFileTool,
  ToolRegistry,
  type AgentEvent,
} from "@amaranthic/hernex";
import { defaultProviderBaseUrls } from "../constants/index.js";
import {
  normalizeModelString,
  resolveProviderApiKey,
  resolveProviderBaseUrl,
  type ResolvedConfiguration,
} from "../settings/index.js";
import type { HookInput, PromptHook } from "./types.js";

/**
 * Result returned by the prompt hook evaluator.
 */
export interface PromptHookResult {
  /** Whether the prompt evaluator vetoed the operation. */
  readonly blocked: boolean;
  /** Blocking reason message if blocked; undefined otherwise. */
  readonly blockReason?: string | undefined;
  /** Additional context to inject into the LLM conversation context. */
  readonly additionalContext?: string | undefined;
  /** True if a non-blocking error occurred during evaluation. */
  readonly nonBlockingError: boolean;
  /** Error message for non-blocking errors. */
  readonly errorMessage?: string | undefined;
}

/**
 * Options controlling prompt hook execution lifecycle.
 */
export interface PromptHookExecutionOptions {
  /** Optional cancellation signal to gracefully abort prompt evaluation. */
  readonly signal?: AbortSignal | undefined;
}

/**
 * Parsed output structure expected from the prompt evaluator model.
 */
interface EvaluatorDecision {
  readonly ok: boolean;
  readonly reason?: string | undefined;
}

/**
 * Base evaluation system prompt establishing strict verification behavior.
 */
const defaultBaseEvaluatorPrompt = `You are an automated code and safety evaluation hook for the Greg agent runtime.
Your role is to strictly verify the provided operation against safety, policy, and functional constraints.
You have read-only tools (ReadFile, Glob, Grep) to inspect workspace files if needed.

When you reach a conclusion, respond strictly with a JSON object in this exact format:
{
  "ok": true,
  "reason": "Optional explanation"
}
or
{
  "ok": false,
  "reason": "Detailed explanation of why the check failed and what must be fixed"
}`;

/**
 * Creates an isolated, read-only ToolRegistry containing strictly non-mutating inspection tools.
 *
 * @returns Isolated ToolRegistry containing ReadFileTool, GlobTool, and GrepTool.
 */
function createReadOnlyToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry({ includeDefaults: false });
  registry.register(new ReadFileTool());
  registry.register(new GlobTool());
  registry.register(new GrepTool());
  return registry;
}

/**
 * Resolves the ordered candidate models for a prompt hook.
 *
 * NOTE: Unlike Greg's main engine fallback resolution (which strictly fails fast
 * at startup if an unrecognized provider is specified in fallbackModels), prompt
 * hooks gracefully skip invalid or unrecognized providers. If a provider is
 * unrecognized, missing credentials, or malformed, it is silently bypassed so
 * subsequent valid fallbacks can execute without breaking or aborting the agent run.
 *
 * @param hook - Prompt hook configuration.
 * @param configuration - Active runtime configuration.
 * @returns Ordered array of valid candidate models to attempt.
 */
export function resolvePromptHookCandidateModels(
  hook: PromptHook,
  configuration: ResolvedConfiguration,
): string[] {
  const candidates: string[] = [];
  const rawList = [hook.model ?? configuration.model, ...(hook.fallbackModels ?? [])];

  for (const raw of rawList) {
    if (!raw || raw.trim().length === 0) {
      continue;
    }
    const normalized = normalizeModelString(raw.trim());
    const lowerProvider = normalized.provider.toLowerCase();

    // Check if provider is known to Hernex / Greg
    if (!Object.prototype.hasOwnProperty.call(defaultProviderBaseUrls, lowerProvider)) {
      // Gracefully skip unrecognized providers for prompt hooks
      continue;
    }

    candidates.push(normalized.model);
  }

  return candidates;
}

/**
 * Extracts and parses the structured `{ ok: boolean, reason?: string }` decision
 * from the evaluator's textual response.
 *
 * @param rawText - Raw text emitted by the evaluator model.
 * @returns Parsed decision, or null if no valid JSON block was found.
 */
export function parseEvaluatorDecision(rawText: string): EvaluatorDecision | null {
  const trimmed = rawText.trim();

  // Try direct parse first
  try {
    const directParsed = JSON.parse(trimmed) as unknown;
    if (directParsed && typeof directParsed === "object" && "ok" in directParsed) {
      const decision = directParsed as { ok: unknown; reason?: unknown };
      if (typeof decision.ok === "boolean") {
        return {
          ok: decision.ok,
          reason: typeof decision.reason === "string" ? decision.reason : undefined,
        };
      }
    }
  } catch {
    // Not a direct JSON string, attempt regex extraction
  }

  // Find json code blocks or inline {...} containing "ok"
  const jsonMatch = trimmed.match(/\{[\s\S]*?"ok"[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const extracted = JSON.parse(jsonMatch[0]) as unknown;
      if (extracted && typeof extracted === "object" && "ok" in extracted) {
        const decision = extracted as { ok: unknown; reason?: unknown };
        if (typeof decision.ok === "boolean") {
          return {
            ok: decision.ok,
            reason: typeof decision.reason === "string" ? decision.reason : undefined,
          };
        }
      }
    } catch {
      // Malformed JSON fragment
    }
  }

  return null;
}

/**
 * Executes a prompt-based LLM verification hook using an isolated, in-memory Hernex AgentEngine.
 *
 * ARCHITECTURAL GUARANTEES:
 * 1. Isolated In-Memory Lifecycle: Uses Hernex AgentEngine with persist: false and checkpoint: false.
 *    Messages, tool calls, and results are never written to disk, thread stores, or transcripts.
 * 2. Read-Only Safety Boundary: Evaluator is granted only read-only tools (ReadFileTool, GlobTool, GrepTool)
 *    to inspect files referenced in hook arguments; mutating tools (Write, Edit, Bash) are absent.
 * 3. Graceful Fallback Skipping: Unlike the main engine's strict fail-fast validation,
 *    unrecognized providers in `fallbackModels` are skipped gracefully without aborting
 *    the agent's turn.
 * 4. System Prompt Composition: Combines the base evaluator verification prompt with
 *    any hook-specified `appendSystemPrompt`.
 * 5. Structured Decision Extraction: Parses `{ ok: boolean, reason?: string }` from model output.
 *
 * @param hook - Target prompt hook configuration.
 * @param input - Structured hook input payload.
 * @param configuration - Active runtime configuration.
 * @returns A promise resolving to the PromptHookResult.
 *
 * @example
 * ```typescript
 * const result = await executePromptHook(hook, hookInput, config);
 * if (result.blocked) {
 *   console.error(result.blockReason);
 * }
 * ```
 */
export async function executePromptHook(
  hook: PromptHook,
  input: HookInput,
  configuration: ResolvedConfiguration,
  options?: PromptHookExecutionOptions,
): Promise<PromptHookResult> {
  if (options?.signal?.aborted) {
    return {
      blocked: true,
      blockReason: "Prompt hook evaluation aborted by signal",
      nonBlockingError: false,
    };
  }

  const candidateModels = resolvePromptHookCandidateModels(hook, configuration);

  if (candidateModels.length === 0) {
    return {
      blocked: false,
      nonBlockingError: true,
      errorMessage: "No valid model candidates available for prompt hook evaluation",
    };
  }

  const timeoutMs = hook.timeoutMs !== undefined ? hook.timeoutMs : hook.timeout * 1000;

  // Substitute $ARGUMENTS placeholder with serialized JSON input
  const serializedInput = JSON.stringify(input, null, 2);
  const userPrompt = hook.prompt.includes("$ARGUMENTS")
    ? hook.prompt.replaceAll("$ARGUMENTS", serializedInput)
    : `${hook.prompt}\n\nOperation Details:\n${serializedInput}`;

  const composedSystemPrompt = hook.appendSystemPrompt
    ? `${defaultBaseEvaluatorPrompt}\n\nAdditional Evaluation Instructions:\n${hook.appendSystemPrompt}`
    : defaultBaseEvaluatorPrompt;

  let lastError: Error | undefined;

  for (const candidateModel of candidateModels) {
    const normalized = normalizeModelString(candidateModel);
    const candidateApiKey = resolveProviderApiKey(normalized.provider, configuration.apiKey);
    const candidateBaseUrl = resolveProviderBaseUrl(normalized.provider, configuration.baseUrl);

    try {
      const abortController = new AbortController();

      const onParentAbort = (): void => {
        abortController.abort(new Error("Prompt hook aborted by parent signal"));
      };

      if (options?.signal) {
        options.signal.addEventListener("abort", onParentAbort, { once: true });
      }

      const timeoutTimer = setTimeout(() => {
        abortController.abort(new Error(`Prompt hook timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      // Create isolated read-only tool registry
      const readOnlyTools = createReadOnlyToolRegistry();

      // Instantiate completely in-memory, non-persisted Hernex AgentEngine
      const engine = new AgentEngine({
        threadId: randomUUID(),
        workingDirectory: input.projectDir,
        model: candidateModel,
        apiKey: candidateApiKey,
        baseUrl: candidateBaseUrl,
        tools: readOnlyTools,
        persist: false,
        checkpoint: false,
        instructions: composedSystemPrompt,
        abortSignal: abortController.signal,
        maxSteps: 25,
      });

      let turnText = "";

      try {
        for await (const event of engine.runTurn(userPrompt)) {
          if (event.type === "tokenDelta") {
            turnText += event.text;
          }
        }
      } finally {
        clearTimeout(timeoutTimer);
        if (options?.signal) {
          options.signal.removeEventListener("abort", onParentAbort);
        }
      }

      const decision = parseEvaluatorDecision(turnText);

      if (decision) {
        if (!decision.ok) {
          return {
            blocked: true,
            blockReason: decision.reason ?? "Blocked by prompt evaluation hook",
            nonBlockingError: false,
          };
        }

        return {
          blocked: false,
          nonBlockingError: false,
        };
      }

      // If output structure was missing or malformed, treat as success without blocking
      return {
        blocked: false,
        nonBlockingError: false,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // Gracefully continue to next candidate model
      continue;
    }
  }

  return {
    blocked: false,
    nonBlockingError: true,
    errorMessage: `Prompt hook evaluation failed across all candidate models: ${lastError?.message ?? "Unknown error"}`,
  };
}
