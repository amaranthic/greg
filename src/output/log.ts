/**
 * @fileoverview Stderr-exclusive diagnostic logging, tool activity reporting, and status formatting.
 * @packageDocumentation
 */

/**
 * Configuration options for StderrLogger.
 */
export interface StderrLoggerOptions {
  /** Whether verbose diagnostic output is enabled. */
  readonly isVerbose?: boolean | undefined;
  /** Whether model thinking messages are output to stderr. */
  readonly includeThoughts?: boolean | undefined;
}

/**
 * Diagnostic logger directing all human-readable activity strictly to process.stderr.
 * Ensures process.stdout remains strictly reserved for machine output.
 */
export class StderrLogger {
  private readonly isVerbose: boolean;
  private readonly includeThoughts: boolean;
  private isThinking = false;
  private thoughtStartedAt?: number;
  private hasEmittedNewlineAfterThought = true;

  public constructor(options?: StderrLoggerOptions) {
    this.isVerbose = Boolean(options?.isVerbose);
    this.includeThoughts = Boolean(options?.includeThoughts);
  }

  /**
   * Emits a startup execution banner and runtime diagnostic header.
   *
   * @param info - Runtime configuration details to log.
   */
  public header(info: {
    readonly threadId: string;
    readonly model: string;
    readonly provider: string;
    readonly permissionMode: string;
    readonly exposedToolsCount: number;
    readonly isNewThread: boolean;
    readonly isBare?: boolean;
  }): void {
    if (!this.isVerbose && process.stderr.isTTY !== true) {
      return;
    }

    const modeIndicator = `[${info.permissionMode}]`;
    const threadStatus = info.isNewThread ? "new" : "resumed";
    const bareIndicator = info.isBare ? " (bare)" : "";

    this.writeLine(
      `greg: model=${info.model} thread=${info.threadId} (${threadStatus}${bareIndicator}) mode=${modeIndicator} tools=${info.exposedToolsCount}`,
    );
  }

  /**
   * Streams a chunk of model reasoning/thinking text to process.stderr.
   *
   * @param chunk - Reasoning text segment from the model.
   */
  public thoughtDelta(chunk: string): void {
    if (!this.includeThoughts) {
      return;
    }
    if (!this.isThinking) {
      this.isThinking = true;
      this.thoughtStartedAt = Date.now();
      this.writeLine("-> thought");
    }
    process.stderr.write(chunk);
    this.hasEmittedNewlineAfterThought = chunk.endsWith("\n");
  }

  /**
   * Finalizes the active model thinking block on process.stderr.
   */
  public thoughtFinish(): void {
    if (!this.includeThoughts || !this.isThinking) {
      return;
    }
    this.isThinking = false;
    const durationMs =
      this.thoughtStartedAt !== undefined
        ? Math.max(0, Date.now() - this.thoughtStartedAt)
        : undefined;
    const durationSuffix =
      durationMs !== undefined ? ` [done ${Math.round(durationMs)}ms]` : " [done]";
    if (!this.hasEmittedNewlineAfterThought) {
      process.stderr.write("\n");
      this.hasEmittedNewlineAfterThought = true;
    }
    this.writeLine(`<- thought${durationSuffix}`);
  }

  /**
   * Logs tool invocation start.
   *
   * @param toolName - Name of the tool beginning execution.
   * @param target - The tool's primary target argument.
   */
  public toolStart(toolName: string, target?: string): void {
    if (this.isThinking) {
      this.thoughtFinish();
    }
    if (!this.isVerbose) {
      return;
    }
    const targetInfo = target ? ` (${target})` : "";
    this.writeLine(`-> tool: ${toolName}${targetInfo}...`);
  }

  /**
   * Logs tool completion, outcome, and execution duration.
   *
   * @param toolName - Name of the tool that finished.
   * @param isError - Whether execution resulted in failure.
   * @param durationMs - Optional execution duration in milliseconds.
   */
  public toolFinish(toolName: string, isError: boolean, durationMs?: number): void {
    if (this.isThinking) {
      this.thoughtFinish();
    }
    if (!this.isVerbose) {
      return;
    }
    const status = isError ? "error" : "done";
    const durationSuffix =
      typeof durationMs === "number" && !Number.isNaN(durationMs)
        ? ` ${Math.round(durationMs)}ms`
        : "";
    this.writeLine(`<- tool: ${toolName} [${status}${durationSuffix}]`);
  }

  /**
   * Logs a diagnostic informational message.
   *
   * @param message - Information text to log.
   */
  public info(message: string): void {
    if (this.isThinking) {
      this.thoughtFinish();
    }
    if (this.isVerbose) {
      this.writeLine(`info: ${message}`);
    }
  }

  /**
   * Logs a warning message.
   *
   * @param message - Warning text.
   */
  public warn(message: string): void {
    if (this.isThinking) {
      this.thoughtFinish();
    }
    this.writeLine(`warning: ${message}`);
  }

  /**
   * Logs an error message.
   *
   * @param message - Error text.
   */
  public error(message: string): void {
    if (this.isThinking) {
      this.thoughtFinish();
    }
    this.writeLine(`error: ${message}`);
  }

  /**
   * Writes a line strictly to process.stderr.
   *
   * @param line - Line content to write.
   */
  private writeLine(line: string): void {
    process.stderr.write(`${line}\n`);
  }
}
