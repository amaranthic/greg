/**
 * @fileoverview Output sinks managing stream separation across text, json, and stream-json formats.
 * @packageDocumentation
 */

import type { AgentEvent } from "@amaranthic/hernex";
import { installStreamJsonStdoutGuard, restoreStdoutGuard } from "./guard.js";

/**
 * Supported machine-readable stdout formatting options.
 */
export type OutputFormat = "text" | "json" | "stream-json";

/**
 * Common configuration options for initializing an OutputSink.
 */
export interface OutputSinkOptions {
  /** Active format identifier. */
  readonly format: OutputFormat;
  /** Active thread identifier. */
  readonly threadId: string;
  /** Resolved model string. */
  readonly model: string;
  /** Target provider name. */
  readonly provider: string;
  /** Canonical workspace directory path. */
  readonly workingDirectory: string;
}

/**
 * Unified interface contract for stream event emitters.
 */
export interface OutputSink {
  /** Emits an initial execution handshake event if supported by the format. */
  emitInit(): void;
  /** Handles an event yielded by the Hernex turn loop stream. */
  emit(event: AgentEvent): void;
  /** Finalizes stream output and writes closing payloads. */
  finish(exitCode: number): Promise<void>;
}

/**
 * Text sink streaming token chunks directly to standard output.
 */
export class TextSink implements OutputSink {
  private hasEmittedText = false;

  public emitInit(): void {
    // Text format emits no preamble to keep output pipe-friendly
  }

  public emit(event: AgentEvent): void {
    if (event.type === "tokenDelta") {
      process.stdout.write(event.text);
      this.hasEmittedText = true;
    }
  }

  public async finish(): Promise<void> {
    if (this.hasEmittedText) {
      process.stdout.write("\n");
    }
  }
}

/**
 * JSON sink collecting turn events and emitting a single structured JSON object on termination.
 */
export class JsonSink implements OutputSink {
  private readonly options: OutputSinkOptions;
  private accumulatedText = "";
  private finishReason = "unknown";
  private tokenUsage: unknown = null;
  private readonly checkpoints: string[] = [];
  private fatalError: unknown = null;

  public constructor(options: OutputSinkOptions) {
    this.options = options;
    installStreamJsonStdoutGuard();
  }

  public emitInit(): void {
    // Json sink emits only on finish
  }

  public emit(event: AgentEvent): void {
    if (event.type === "tokenDelta") {
      this.accumulatedText += event.text;
    } else if (event.type === "turnFinished") {
      this.finishReason = event.finishReason;
      this.tokenUsage = event.totalUsage;
    } else if (event.type === "checkpointCreated") {
      this.checkpoints.push(event.checkpointId);
    } else if (event.type === "error" && event.isFatal) {
      this.fatalError = event.error;
    }
  }

  public async finish(exitCode: number): Promise<void> {
    restoreStdoutGuard();

    const payload = {
      result: this.accumulatedText,
      threadId: this.options.threadId,
      model: this.options.model,
      provider: this.options.provider,
      finishReason: this.finishReason,
      usage: this.tokenUsage,
      checkpoints: this.checkpoints,
      exitCode,
      ...(this.fatalError ? { error: this.fatalError } : {}),
    };

    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  }
}

/**
 * StreamJson sink emitting line-delimited NDJSON events in real-time.
 */
export class StreamJsonSink implements OutputSink {
  private readonly options: OutputSinkOptions;

  public constructor(options: OutputSinkOptions) {
    this.options = options;
    installStreamJsonStdoutGuard();
  }

  public emitInit(): void {
    this.writeNdjson({
      type: "init",
      threadId: this.options.threadId,
      model: this.options.model,
      provider: this.options.provider,
      workingDirectory: this.options.workingDirectory,
    });
  }

  public emit(event: AgentEvent): void {
    if (event.type === "tokenDelta") {
      this.writeNdjson({ type: "tokenDelta", text: event.text });
    } else if (event.type === "thoughtDelta") {
      this.writeNdjson({ type: "thoughtDelta", text: event.text });
    } else if (event.type === "toolCallProposed") {
      this.writeNdjson({
        type: "toolCall",
        toolName: event.toolName,
        callId: event.callId,
        parameters: event.parameters,
      });
    } else if (event.type === "toolExecutionFinished") {
      this.writeNdjson({
        type: "toolResult",
        toolName: event.toolName,
        callId: event.callId,
        result: event.result,
        isError: event.isError,
      });
    } else if (event.type === "checkpointCreated") {
      this.writeNdjson({
        type: "checkpoint",
        checkpointId: event.checkpointId,
        sequence: event.sequence,
      });
    } else if (event.type === "turnFinished") {
      this.writeNdjson({
        type: "done",
        finishReason: event.finishReason,
        usage: event.totalUsage,
      });
    } else if (event.type === "error") {
      this.writeNdjson({
        type: "error",
        message: event.error.message,
        origin: event.origin,
        isFatal: event.isFatal,
      });
    }
  }

  public async finish(exitCode: number): Promise<void> {
    this.writeNdjson({
      type: "exit",
      exitCode,
    });
    restoreStdoutGuard();
  }

  private writeNdjson(record: Record<string, unknown>): void {
    process.stdout.write(JSON.stringify(record) + "\n");
  }
}

/**
 * Factory creating an authoritative OutputSink instance tailored to the requested format.
 *
 * @param options - Configuration options for the sink.
 * @returns Instantiated OutputSink.
 *
 * @example
 * ```typescript
 * const sink = createOutputSink({
 *   format: "stream-json",
 *   threadId: "session-01",
 *   model: "compatible/dummy",
 *   provider: "compatible",
 *   workingDirectory: process.cwd()
 * });
 * ```
 */
export function createOutputSink(options: OutputSinkOptions): OutputSink {
  switch (options.format) {
    case "json":
      return new JsonSink(options);
    case "stream-json":
      return new StreamJsonSink(options);
    case "text":
    default:
      return new TextSink();
  }
}
