/**
 * @fileoverview Subprocess execution engine for shell command hooks.
 * @packageDocumentation
 */

import { spawn, type ChildProcess } from "node:child_process";
import { gregVersion, hookExitCodes } from "../constants/index.js";
import type { CommandHook, HookInput, HookOutput } from "./types.js";

/**
 * Options controlling command hook execution lifecycle and cancellation.
 */
export interface CommandHookExecutionOptions {
  /** Optional cancellation signal to gracefully abort the child process. */
  readonly signal?: AbortSignal | undefined;
}

/** Set of actively running child processes for emergency termination. */
const activeHookProcesses = new Set<ChildProcess>();

/**
 * Forcefully terminates all currently active hook child processes and their process groups.
 */
export function killAllActiveHookProcesses(): void {
  for (const child of activeHookProcesses) {
    killChildProcessGroup(child, "SIGKILL");
  }
  activeHookProcesses.clear();
}

/**
 * Kills a child process and its process group safely across platforms.
 *
 * @param child - Child process to terminate.
 * @param signal - Signal to send.
 */
function killChildProcessGroup(child: ChildProcess, signal: NodeJS.Signals = "SIGKILL"): void {
  if (!child.pid || child.killed) {
    return;
  }
  try {
    if (process.platform !== "win32") {
      try {
        process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    } else {
      child.kill(signal);
    }
  } catch {
    // Child process already terminated
  }
}

// Emergency process exit hook ensuring child hook processes are never orphaned
process.once("exit", () => {
  killAllActiveHookProcesses();
});

/**
 * Result returned by the command hook runner.
 */
export interface CommandHookResult {
  /** Whether the hook vetoed the operation (exit code 2 or decision: "block"). */
  readonly blocked: boolean;
  /** Blocking reason message if blocked; undefined otherwise. */
  readonly blockReason?: string | undefined;
  /** Updated tool input arguments to apply before tool execution. */
  readonly updatedInput?: Record<string, unknown> | undefined;
  /** Additional context text to inject into the LLM conversation context. */
  readonly additionalContext?: string | undefined;
  /** True if a non-blocking error occurred (any exit code other than 0 or 2). */
  readonly nonBlockingError: boolean;
  /** Error message for non-blocking errors. */
  readonly errorMessage?: string | undefined;
  /** Raw standard output string emitted by the hook. */
  readonly stdout: string;
  /** Raw standard error string emitted by the hook. */
  readonly stderr: string;
}

/**
 * Interpolates environment variable templates in string values using process.env.
 * Supports `$VAR` and `${VAR}` syntax.
 *
 * @param value - Raw template string.
 * @returns Interpolated string.
 */
function interpolateEnvTemplate(value: string): string {
  return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}|\$([A-Z_][A-Z0-9_]*)/g, (_, braced, unbraced) => {
    const varName = braced ?? unbraced;
    return process.env[varName] ?? "";
  });
}

/**
 * Builds the comprehensive environment variable dictionary for the child process.
 * Injects GREG_* variables and interpolates hook-configured `env` properties.
 *
 * @param hook - Target command hook configuration.
 * @param input - Structured hook input payload.
 * @returns Fully populated process environment object.
 */
export function buildHookEnvironment(hook: CommandHook, input: HookInput): NodeJS.ProcessEnv {
  const customEnv: Record<string, string> = {};

  if (hook.env) {
    for (const [key, rawValue] of Object.entries(hook.env)) {
      customEnv[key] = interpolateEnvTemplate(rawValue);
    }
  }

  return {
    ...process.env,
    GREG_PROJECT_DIR: input.projectDir,
    GREG_CWD: input.cwd,
    GREG_HOOK_EVENT: input.hookEvent,
    GREG_SESSION_ID: input.sessionId,
    GREG_TURN_INDEX: String(input.turnIndex),
    GREG_MODEL: input.model,
    GREG_VERSION: gregVersion,
    ...(input.toolName ? { GREG_TOOL_NAME: input.toolName } : {}),
    ...(input.toolStatus ? { GREG_TOOL_STATUS: input.toolStatus } : {}),
    ...(input.toolDurationMs !== undefined
      ? { GREG_TOOL_DURATION_MS: String(input.toolDurationMs) }
      : {}),
    ...customEnv,
  };
}

/**
 * Spawns a shell command hook, delivers serialized JSON input via stdin,
 * and interprets exit codes and structured JSON output.
 *
 * @param hook - Target command hook configuration.
 * @param input - Structured hook input payload.
 * @param options - Optional execution controls such as cancellation signal.
 * @returns A promise resolving to the interpreted CommandHookResult.
 *
 * @example
 * ```typescript
 * const result = await executeCommandHook(hook, hookInput);
 * if (result.blocked) {
 *   console.error(`Blocked: ${result.blockReason}`);
 * }
 * ```
 */
export async function executeCommandHook(
  hook: CommandHook,
  input: HookInput,
  options?: CommandHookExecutionOptions,
): Promise<CommandHookResult> {
  const timeoutMs = hook.timeoutMs !== undefined ? hook.timeoutMs : hook.timeout * 1000;
  const envVars = buildHookEnvironment(hook, input);
  const shellOption = hook.shell === "powershell" ? "pwsh" : true;

  if (options?.signal?.aborted) {
    return {
      blocked: true,
      blockReason: "Hook execution aborted by signal",
      nonBlockingError: false,
      stdout: "",
      stderr: "",
    };
  }

  return new Promise<CommandHookResult>((resolve) => {
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;

    const child = spawn(hook.command, [], {
      cwd: input.cwd,
      env: envVars,
      shell: shellOption,
      windowsHide: true,
      detached: process.platform !== "win32",
    });

    activeHookProcesses.add(child);

    const cleanupChild = (): void => {
      clearTimeout(timeoutTimer);
      if (options?.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
      activeHookProcesses.delete(child);
    };

    const onAbort = (): void => {
      if (!settled) {
        settled = true;
        cleanupChild();
        killChildProcessGroup(child, "SIGKILL");
        resolve({
          blocked: true,
          blockReason: `Hook execution aborted by signal: "${hook.command}"`,
          nonBlockingError: false,
          stdout: stdoutBuffer,
          stderr: stderrBuffer,
        });
      }
    };

    if (options?.signal) {
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    const timeoutTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanupChild();
        killChildProcessGroup(child, "SIGTERM");
        setTimeout(() => {
          killChildProcessGroup(child, "SIGKILL");
        }, 100).unref();
        resolve({
          blocked: true,
          blockReason: `Hook execution timed out after ${timeoutMs}ms: "${hook.command}"`,
          nonBlockingError: false,
          stdout: stdoutBuffer,
          stderr: stderrBuffer,
        });
      }
    }, timeoutMs);

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");

    // Prevent uncaught EPIPE errors if child exits early before stdin write completes
    child.stdin.on("error", () => {
      // Intentionally swallowed: process closed stdin before write completed
    });

    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderrBuffer += chunk;
    });

    child.on("error", (error: Error) => {
      if (!settled) {
        settled = true;
        cleanupChild();
        resolve({
          blocked: false,
          nonBlockingError: true,
          errorMessage: `Failed to spawn hook command "${hook.command}": ${error.message}`,
          stdout: stdoutBuffer,
          stderr: stderrBuffer,
        });
      }
    });

    child.on("close", (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanupChild();

      const exitCode = code ?? 0;

      // 1. Exit code 2: Explicit blocking veto
      if (exitCode === hookExitCodes.blockingVeto) {
        const reason = stderrBuffer.trim() || `Hook exited with code ${hookExitCodes.blockingVeto}`;
        resolve({
          blocked: true,
          blockReason: reason,
          nonBlockingError: false,
          stdout: stdoutBuffer,
          stderr: stderrBuffer,
        });
        return;
      }

      // 2. Exit code 0: Success; optionally parses structured JSON output
      if (exitCode === hookExitCodes.success) {
        let hookOutput: HookOutput | null = null;
        const trimmedStdout = stdoutBuffer.trim();

        if (trimmedStdout.startsWith("{") && trimmedStdout.endsWith("}")) {
          try {
            hookOutput = JSON.parse(trimmedStdout) as HookOutput;
          } catch {
            // Not JSON or partial JSON; treat as plain text output
          }
        }

        // If direct parse failed, attempt resilient regex extraction for embedded JSON block
        if (!hookOutput) {
          const jsonMatch = trimmedStdout.match(
            /\{[\s\S]*?"(?:decision|updatedInput|additionalContext)"[\s\S]*?\}/,
          );
          if (jsonMatch) {
            try {
              hookOutput = JSON.parse(jsonMatch[0]) as HookOutput;
            } catch {
              // Ignore malformed regex match
            }
          }
        }

        if (hookOutput?.decision === "block") {
          resolve({
            blocked: true,
            blockReason: hookOutput.reason ?? "Blocked by hook",
            updatedInput: hookOutput.updatedInput,
            additionalContext: hookOutput.additionalContext,
            nonBlockingError: false,
            stdout: stdoutBuffer,
            stderr: stderrBuffer,
          });
          return;
        }

        resolve({
          blocked: false,
          updatedInput: hookOutput?.updatedInput,
          additionalContext: hookOutput?.additionalContext,
          nonBlockingError: false,
          stdout: stdoutBuffer,
          stderr: stderrBuffer,
        });
        return;
      }

      // 3. Other non-zero exit codes: Non-blocking warning error
      resolve({
        blocked: false,
        nonBlockingError: true,
        errorMessage: `Hook command exited with non-blocking code ${exitCode}: ${stderrBuffer.trim() || "No error output"}`,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
      });
    });

    // Write input JSON payload and close stdin immediately
    try {
      const payload = JSON.stringify(input) + "\n";
      child.stdin.write(payload, "utf-8");
      child.stdin.end();
    } catch {
      // Child process may have closed before stdin write
    }
  });
}
