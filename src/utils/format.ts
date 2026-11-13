/**
 * @fileoverview Formatting and parsing helpers for durations, bytes, and numbers.
 * @packageDocumentation
 */

/**
 * Parses a human-readable duration string into milliseconds.
 * Supports units: "ms", "s", "m", "h", "d". Defaults to seconds if unit is omitted.
 *
 * @param duration - Duration string to parse (e.g. "30m", "10s", "500ms", "1h").
 * @returns Parsed duration in milliseconds.
 *
 * @example
 * ```typescript
 * parseDurationMs("30m"); // => 1800000
 * parseDurationMs("10s"); // => 10000
 * ```
 */
export function parseDurationMs(duration: string): number {
  const trimmed = duration.trim().toLowerCase();
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/);

  if (!match) {
    const fallback = Number(trimmed);
    if (Number.isFinite(fallback) && fallback > 0) {
      return fallback;
    }
    throw new Error(
      `Invalid duration format: "${duration}". Expected format like "30m", "10s", or "500ms".`,
    );
  }

  const value = parseFloat(match[1]!);
  const unit = match[2] ?? "s";

  switch (unit) {
    case "ms":
      return Math.round(value);
    case "s":
      return Math.round(value * 1000);
    case "m":
      return Math.round(value * 60 * 1000);
    case "h":
      return Math.round(value * 60 * 60 * 1000);
    case "d":
      return Math.round(value * 24 * 60 * 60 * 1000);
    default:
      return Math.round(value * 1000);
  }
}

/**
 * Formats a duration in milliseconds into a concise human-readable string.
 *
 * @param ms - Duration in milliseconds.
 * @returns Formatted duration string (e.g. "450ms", "12.4s", "2m 15s").
 *
 * @example
 * ```typescript
 * formatDuration(12400); // => "12.4s"
 * ```
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Formats a byte count into a standard binary-prefixed size string.
 *
 * @param bytes - Count of bytes.
 * @returns Human-readable binary string (e.g. "512 B", "42.1 KiB", "3.2 MiB").
 *
 * @example
 * ```typescript
 * formatBytes(43110); // => "42.1 KiB"
 * ```
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(1)} KiB`;
  }
  const mib = kib / 1024;
  return `${mib.toFixed(1)} MiB`;
}

/**
 * Normalizes text into a clean single-line title constrained to a maximum character length.
 * Collapses internal whitespace, newlines, and tabs into a single space, trims, and truncates.
 *
 * @param text - Raw prompt or input string to normalize.
 * @param maxLength - Maximum permitted character count (defaults to 80).
 * @returns Clean single-line title string, or undefined if text contains no non-whitespace characters.
 *
 * @example
 * ```typescript
 * normalizeThreadTitle("Review this patch\nfor regressions");
 * // => "Review this patch for regressions"
 * ```
 */
export function normalizeThreadTitle(
  text?: string | undefined,
  maxLength: number = 80,
): string | undefined {
  if (!text) {
    return undefined;
  }
  const flattened = text.replace(/\s+/g, " ").trim();
  if (flattened.length === 0) {
    return undefined;
  }
  return flattened.length > maxLength ? flattened.slice(0, maxLength) : flattened;
}
