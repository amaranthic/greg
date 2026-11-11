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
      await sink.finish(0);

      const parsed = JSON.parse(output);
      expect(parsed.result).toBe("Structured answer");
      expect(parsed.threadId).toBe("test-thread-01");
      expect(parsed.finishReason).toBe("completed");
      expect(parsed.usage.totalTokens).toBe(30);
      expect(parsed.exitCode).toBe(0);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  it("creates StreamJsonSink and emits NDJSON events", async () => {
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
      await sink.finish(0);

      const lines = output.trim().split("\n");
      expect(lines.length).toBeGreaterThanOrEqual(2);
      const initEvent = JSON.parse(lines[0]!);
      expect(initEvent.type).toBe("init");
      expect(initEvent.threadId).toBe("test-thread-01");

      const tokenEvent = JSON.parse(lines[1]!);
      expect(tokenEvent.type).toBe("tokenDelta");
      expect(tokenEvent.text).toBe("NDJSON chunk");
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
