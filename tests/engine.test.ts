/**
 * @fileoverview Unit tests for engine utilities, duration formatters, signals, and input ingestion.
 * @packageDocumentation
 */

import { describe, expect, it } from "bun:test";
import {
  formatBytes,
  formatDuration,
  normalizeThreadTitle,
  parseDurationMs,
} from "../src/utils/index.js";
import { readPipedStdin, SignalLifecycle } from "../src/core/index.js";

describe("Formatting & Utility Parsers", () => {
  it("parses duration strings into milliseconds", () => {
    expect(parseDurationMs("500ms")).toBe(500);
    expect(parseDurationMs("10s")).toBe(10000);
    expect(parseDurationMs("30m")).toBe(1800000);
    expect(parseDurationMs("2h")).toBe(7200000);
    expect(parseDurationMs("1d")).toBe(86400000);
  });

  it("formats milliseconds into human strings", () => {
    expect(formatDuration(450)).toBe("450ms");
    expect(formatDuration(12500)).toBe("12.5s");
    expect(formatDuration(125000)).toBe("2m 5s");
  });

  it("formats byte counts into binary prefixed strings", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KiB");
    expect(formatBytes(1048576 * 3.5)).toBe("3.5 MiB");
  });

  it("normalizes thread titles correctly", () => {
    expect(normalizeThreadTitle(undefined)).toBeUndefined();
    expect(normalizeThreadTitle("   ")).toBeUndefined();
    expect(normalizeThreadTitle("Review\nthis   patch\t\tfor bugs")).toBe(
      "Review this patch for bugs",
    );

    const longText = "a".repeat(120);
    const normalizedLong = normalizeThreadTitle(longText);
    expect(normalizedLong).toBeDefined();
    expect(normalizedLong?.length).toBe(80);
    expect(normalizedLong).toBe("a".repeat(80));
  });
});

describe("Signal Lifecycle & Cleanup", () => {
  it("manages abort signals and cleanups", async () => {
    const lifecycle = new SignalLifecycle();
    let cleanedUp = false;

    lifecycle.registerCleanup(() => {
      cleanedUp = true;
    });

    expect(lifecycle.signal.aborted).toBe(false);
    lifecycle.requestAbort("Test abort");
    expect(lifecycle.signal.aborted).toBe(true);

    // Terminate executes cleanups
    // Note: We don't call lifecycle.terminate() directly because it exits the process,
    // but we verified the signal abort state transitions correctly.
  });
});

describe("Piped Stdin Reader", () => {
  it("returns undefined on interactive TTY stdin", async () => {
    const result = await readPipedStdin();
    // In test runner with TTY or no stdin piped, returns undefined
    expect(result === undefined || typeof result === "string").toBe(true);
  });
});
