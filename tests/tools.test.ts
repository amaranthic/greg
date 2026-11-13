/**
 * @fileoverview Unit tests for tool catalogue filtering and fail-closed exposure rules.
 * @packageDocumentation
 */

import { describe, expect, it } from "bun:test";
import {
  allBuiltInToolNames,
  planModeToolNames,
  resolveExposedTools,
} from "../src/policy/index.js";

describe("Tool Catalogue Exposure & Fail-Closed Filtering", () => {
  it("fails closed on explicitly empty filter", () => {
    const emptyString = resolveExposedTools("", "default");
    expect(emptyString.size).toBe(0);

    const emptyArray = resolveExposedTools([], "default");
    expect(emptyArray.size).toBe(0);

    const whitespace = resolveExposedTools("   ", "default");
    expect(whitespace.size).toBe(0);
  });

  it("exposes all default tools when filter is undefined or 'default'", () => {
    const defaultFilter = resolveExposedTools(undefined, "default");
    expect(defaultFilter.size).toBe(allBuiltInToolNames.length);
    for (const tool of allBuiltInToolNames) {
      expect(defaultFilter.has(tool)).toBe(true);
    }

    const explicitDefault = resolveExposedTools("default", "default");
    expect(explicitDefault.size).toBe(allBuiltInToolNames.length);
  });

  it("filters exposed tools to read-only in plan mode", () => {
    const planTools = resolveExposedTools(undefined, "plan");
    expect(planTools.size).toBe(planModeToolNames.length);
    expect(planTools.has("readFile")).toBe(true);
    expect(planTools.has("glob")).toBe(true);
    expect(planTools.has("grep")).toBe(true);
    expect(planTools.has("webFetch")).toBe(true);
    expect(planTools.has("webSearch")).toBe(true);
    expect(planTools.has("writeFile")).toBe(false);
    expect(planTools.has("bash")).toBe(false);
  });

  it("exposes only explicitly requested tools", () => {
    const selected = resolveExposedTools("readFile,writeFile", "default");
    expect(selected.size).toBe(2);
    expect(selected.has("readFile")).toBe(true);
    expect(selected.has("writeFile")).toBe(true);
    expect(selected.has("bash")).toBe(false);
  });
});
