/**
 * @fileoverview Unit tests for tool catalogue filtering and fail-closed exposure rules.
 * @packageDocumentation
 */

import { describe, expect, it } from "bun:test";
import {
  allBuiltInToolNames,
  planModeToolNames,
  resolveExposedTools,
  toHernexToolName,
  toUserFacingToolName,
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
    expect(planTools.has("taskManager")).toBe(false);
  });

  it("exposes only explicitly requested tools using PascalCase user format", () => {
    const selected = resolveExposedTools("Read,Write", "default");
    expect(selected.size).toBe(2);
    expect(selected.has("readFile")).toBe(true);
    expect(selected.has("writeFile")).toBe(true);
    expect(selected.has("bash")).toBe(false);
  });

  it("automatically couples taskManager when Bash is requested", () => {
    const bashSelected = resolveExposedTools("Read,Bash", "default");
    expect(bashSelected.has("readFile")).toBe(true);
    expect(bashSelected.has("bash")).toBe(true);
    expect(bashSelected.has("taskManager")).toBe(true);
    expect(bashSelected.has("writeFile")).toBe(false);
  });

  it("rejects unauthorized tool formats or invalid tools", () => {
    expect(() => resolveExposedTools("readFile", "default")).toThrow();
    expect(() => resolveExposedTools("TaskManager", "default")).toThrow();
    expect(() => resolveExposedTools("unknownTool", "default")).toThrow();
  });

  it("translates bidirectional tool names accurately", () => {
    expect(toHernexToolName("Read")).toBe("readFile");
    expect(toHernexToolName("Write")).toBe("writeFile");
    expect(toHernexToolName("Edit")).toBe("editFile");
    expect(toHernexToolName("Bash")).toBe("bash");
    expect(toHernexToolName("Glob")).toBe("glob");
    expect(toHernexToolName("Grep")).toBe("grep");
    expect(toHernexToolName("WebFetch")).toBe("webFetch");
    expect(toHernexToolName("WebSearch")).toBe("webSearch");

    expect(toUserFacingToolName("readFile")).toBe("Read");
    expect(toUserFacingToolName("writeFile")).toBe("Write");
    expect(toUserFacingToolName("editFile")).toBe("Edit");
    expect(toUserFacingToolName("bash")).toBe("Bash");
  });
});
