/**
 * @fileoverview Unit tests for OutputSink implementations and stdout stream guarding.
 * @packageDocumentation
 */

import { describe, expect, it } from "bun:test";
import {
  createOutputSink,
  installStreamJsonStdoutGuard,
  restoreStdoutGuard,
  stdoutGuardMarker,
} from "../src/output/index.js";

describe("Output Sinks Formatting", () => {
  const options = {
    format: "text" as const,
    threadId: "test-thread-01",
    model: "compatible/dummy",
    provider: "compatible",
    workingDirectory: process.cwd(),
  };

  it("creates TextSink and handles token events", async () => {
    let output = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: any) => {
      output += chunk;
      return true;
    };

    try {
      const sink = createOutputSink(options);
      sink.emitInit();
      sink.emit({ type: "tokenDelta", text: "Hello " });
      sink.emit({ type: "tokenDelta", text: "world!" });
      await sink.finish(0);
      expect(output).toBe("Hello world!\n");
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it("creates JsonSink and emits structured payload on finish", async () => {
    let output = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: any) => {
      output += chunk;
      return true;
    };

    try {
      const sink = createOutputSink({ ...options, format: "json" });
      sink.emitInit();
      sink.emit({ type: "tokenDelta", text: "Structured answer" });
      sink.emit({
        type: "turnFinished",
        turnIndex: 1,
        finishReason: "completed",
        totalUsage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
          reasoningTokens: 0,
        },
      });

      const startTime = Date.now() - 50;
      await sink.finish(0, {
        runStartedAt: startTime,
        firstTokenAt: startTime + 10,
        durationApiMs: 40,
        numTurns: 1,
        stopReason: "completed",
        totalUsage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
          reasoningTokens: 0,
        },
        permissionDenials: [
          {
            tool: "Bash",
            target: "rm -rf /",
            reason: 'Tool "Bash" command denied',
            timestamp: startTime + 5,
          },
        ],
      });

      const parsed = JSON.parse(output);
      expect(parsed.type).toBe("result");
      expect(parsed.subtype).toBe("success");
      expect(parsed.result).toBe("Structured answer");
      expect(parsed.threadId).toBe("test-thread-01");
      expect(parsed.sessionId).toBe("test-thread-01");
      expect(parsed.finishReason).toBe("completed");
      expect(parsed.stopReason).toBe("completed");
      expect(parsed.usage.totalTokens).toBe(30);
      expect(parsed.permissionDenials).toHaveLength(1);
      expect(parsed.permissionDenials[0].tool).toBe("Bash");
      expect(parsed.ttftMs).toBeGreaterThanOrEqual(10);
      expect(parsed.durationMs).toBeGreaterThanOrEqual(50);
      expect(parsed.exitCode).toBe(0);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it("creates StreamJsonSink and emits NDJSON events including permission denials and result frame", async () => {
    let output = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk: any) => {
      output += chunk;
      return true;
    };

    try {
      const sink = createOutputSink({ ...options, format: "stream-json" });
      sink.emitInit();
      sink.emit({ type: "tokenDelta", text: "NDJSON chunk" });

      if ("emitPermissionDenial" in sink) {
        (sink as any).emitPermissionDenial({
          tool: "Edit",
          target: "src/secret.ts",
          reason: "Denied file mutation",
          timestamp: Date.now(),
        });
      }

      const startTime = Date.now() - 40;
      await sink.finish(0, {
        runStartedAt: startTime,
        firstTokenAt: startTime + 10,
        durationApiMs: 30,
        numTurns: 1,
        stopReason: "completed",
        totalUsage: {
          promptTokens: 5,
          completionTokens: 10,
          totalTokens: 15,
        },
        permissionDenials: [
          {
            tool: "Edit",
            target: "src/secret.ts",
            reason: "Denied file mutation",
            timestamp: startTime + 5,
          },
        ],
      });

      const lines = output.trim().split("\n");
      expect(lines.length).toBeGreaterThanOrEqual(4);
      const initEvent = JSON.parse(lines[0]!);
      expect(initEvent.type).toBe("init");
      expect(initEvent.threadId).toBe("test-thread-01");

      const tokenEvent = JSON.parse(lines[1]!);
      expect(tokenEvent.type).toBe("tokenDelta");
      expect(tokenEvent.text).toBe("NDJSON chunk");

      const denialEvent = JSON.parse(lines[2]!);
      expect(denialEvent.type).toBe("permissionDenied");
      expect(denialEvent.tool).toBe("Edit");

      const resultEvent = JSON.parse(lines[lines.length - 2]!);
      expect(resultEvent.type).toBe("result");
      expect(resultEvent.subtype).toBe("success");
      expect(resultEvent.permissionDenials).toHaveLength(1);

      const exitEvent = JSON.parse(lines[lines.length - 1]!);
      expect(exitEvent.type).toBe("exit");
      expect(exitEvent.exitCode).toBe(0);
    } finally {
      restoreStdoutGuard();
      process.stdout.write = originalWrite;
    }
  });
});

describe("StreamJson Stdout Guard", () => {
  it("diverts non-JSON stdout lines to stderr with marker", () => {
    let stderrOutput = "";
    const origStderr = process.stderr.write;
    process.stderr.write = (chunk: any) => {
      stderrOutput += chunk.toString();
      return true;
    };

    try {
      installStreamJsonStdoutGuard();

      // Stray console.log / print that is not valid JSON
      process.stdout.write("Warning: rogue dependency log\n");

      // Valid NDJSON line
      process.stdout.write(JSON.stringify({ type: "token", text: "valid" }) + "\n");

      expect(stderrOutput).toContain(stdoutGuardMarker);
      expect(stderrOutput).toContain("Warning: rogue dependency log");
    } finally {
      restoreStdoutGuard();
      process.stderr.write = origStderr;
    }
  });
});
