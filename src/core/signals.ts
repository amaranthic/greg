/**
 * @fileoverview Process termination signals, abort lifecycle, and emergency resource cleanup.
 * @packageDocumentation
 */

import { exitCodes, type ExitCode } from "../constants/index.js";

/**
 * Manages runtime cancellation signals, AbortController lifecycle, and emergency termination.
 */
export class SignalLifecycle {
  private readonly abortController: AbortController = new AbortController();
  private readonly cleanups: Array<() => void | Promise<void>> = [];
  private isTerminating = false;
  private exitCode: ExitCode = exitCodes.success;

  public constructor() {
    this.installSignalHandlers();
  }

  /**
   * The underlying AbortSignal to pass into async operations and engine loops.
   */
  public get signal(): AbortSignal {
    return this.abortController.signal;
  }

  /**
   * Registers a cleanup callback executed during normal or emergency termination.
   *
   * @param cleanup - Async or sync cleanup function.
   */
  public registerCleanup(cleanup: () => void | Promise<void>): void {
    this.cleanups.push(cleanup);
  }

  /**
   * Requests an immediate graceful abort with a specific exit code.
   *
   * @param reason - Descriptive reason for aborting.
   * @param code - Resulting exit code.
   */
  public requestAbort(reason: string, code: ExitCode = exitCodes.runtimeError): void {
    this.exitCode = code;
    if (!this.abortController.signal.aborted) {
      this.abortController.abort(new Error(reason));
    }
  }

  /**
   * Executes all registered cleanups in reverse order and terminates the process.
   *
   * @param code - Final POSIX exit code.
   */
  public async terminate(code?: ExitCode): Promise<void> {
    if (this.isTerminating) {
      return;
    }
    this.isTerminating = true;

    const finalCode = code ?? this.exitCode;

    while (this.cleanups.length > 0) {
      const cleanup = this.cleanups.pop();
      if (cleanup) {
        try {
          await cleanup();
        } catch {
          // Swallow errors during shutdown to prevent abort deadlocks
        }
      }
    }

    process.exit(finalCode);
  }

  /**
   * Binds process-level POSIX signal listeners for SIGINT and SIGTERM.
   */
  private installSignalHandlers(): void {
    const handleSignal = (signal: string): void => {
      this.requestAbort(`Received signal ${signal}`, exitCodes.runtimeError);
      void this.terminate(exitCodes.runtimeError);
    };

    process.once("SIGINT", () => handleSignal("SIGINT"));
    process.once("SIGTERM", () => handleSignal("SIGTERM"));
  }
}
