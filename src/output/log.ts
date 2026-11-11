/**
 * @fileoverview Stderr-exclusive diagnostic logging, tool activity reporting, and status formatting.
 * @packageDocumentation
 */

/**
 * Diagnostic logger directing all human-readable activity strictly to process.stderr.
 * Ensures process.stdout remains strictly reserved for machine output.
 */
export class StderrLogger {
  private readonly isVerbose: boolean;

  public constructor(options?: { isVerbose?: boolean }) {
    this.isVerbose = Boolean(options?.isVerbose);
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
  }): void {
    if (!this.isVerbose && process.stderr.isTTY !== true) {
      return;
    }

    const modeIndicator = `[${info.permissionMode}]`;
    const threadStatus = info.isNewThread ? "new" : "resumed";

    this.writeLine(
      `greg: model=${info.model} thread=${info.threadId} (${threadStatus}) mode=${modeIndicator} tools=${info.exposedToolsCount}`,
    );
  }

  /**
   * Logs tool invocation start.
   *
   * @param toolName - Name of the tool beginning execution.
   * @param target - The tool's primary target argument.
   */
  public toolStart(toolName: string, target?: string): void {
    if (!this.isVerbose) {
      return;
    }
    const targetInfo = target ? ` (${target})` : "";
    this.writeLine(`-> tool: ${toolName}${targetInfo}...`);
  }

  /**
   * Logs tool completion and outcome.
   *
   * @param toolName - Name of the tool that finished.
   * @param isError - Whether execution resulted in failure.
   */
  public toolFinish(toolName: string, isError: boolean): void {
    if (!this.isVerbose) {
      return;
    }
    const status = isError ? "error" : "done";
    this.writeLine(`<- tool: ${toolName} [${status}]`);
  }

  /**
   * Logs a diagnostic informational message.
   *
   * @param message - Information text to log.
   */
  public info(message: string): void {
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
    this.writeLine(`warning: ${message}`);
  }

  /**
   * Logs an error message.
   *
   * @param message - Error text.
   */
  public error(message: string): void {
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
