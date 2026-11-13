/**
 * @fileoverview Unit tests for the deterministic tool authorization policy engine.
 * @packageDocumentation
 */

import { describe, expect, it } from "bun:test";
import {
  evaluateToolPermission,
  extractToolTarget,
  isFileMutationTool,
  isReadOnlyTool,
} from "../src/policy/index.js";

describe("Tool Target Extraction & Categorization", () => {
  it("extracts targets from tool parameters", () => {
    const cwd = "/test/workspace";
    const bashTarget = extractToolTarget("bash", { command: "git status" }, cwd);
    expect(bashTarget).toBe("git status");

    // File tools use filePath (standard Hernex schema)
    const readTarget = extractToolTarget("readFile", { filePath: "src/main.ts" }, cwd);
    expect(readTarget).toBe("src/main.ts");

    const writeTarget = extractToolTarget("writeFile", { filePath: "src/core/engine.ts" }, cwd);
    expect(writeTarget).toBe("src/core/engine.ts");

    const editTarget = extractToolTarget(
      "editFile",
      { filePath: "./tests/permissions.test.ts" },
      cwd,
    );
    expect(editTarget).toBe("tests/permissions.test.ts");

    // Glob and Grep tools extract strictly pattern
    const globTarget = extractToolTarget("glob", { pattern: "*.json" }, cwd);
    expect(globTarget).toBe("*.json");

    const grepTarget = extractToolTarget(
      "grep",
      { pattern: "export const *", directoryPath: "src", filePath: "src/index.ts" },
      cwd,
    );
    expect(grepTarget).toBe("export const *");

    // Web tools extract url and query respectively
    const fetchTarget = extractToolTarget(
      "webFetch",
      { url: "https://github.com/amaranthic/greg" },
      cwd,
    );
    expect(fetchTarget).toBe("https://github.com/amaranthic/greg");

    const searchTarget = extractToolTarget("webSearch", { query: "bun test documentation" }, cwd);
    expect(searchTarget).toBe("bun test documentation");

    // TaskManager has no target rules; returns wildcard
    const taskTarget = extractToolTarget("taskManager", { action: "list" }, cwd);
    expect(taskTarget).toBe("*");
  });

  it("categorizes tools correctly", () => {
    expect(isReadOnlyTool("readFile")).toBe(true);
    expect(isReadOnlyTool("glob")).toBe(true);
    expect(isReadOnlyTool("grep")).toBe(true);
    expect(isReadOnlyTool("webFetch")).toBe(true);
    expect(isReadOnlyTool("webSearch")).toBe(true);
    expect(isReadOnlyTool("writeFile")).toBe(false);
    expect(isReadOnlyTool("bash")).toBe(false);
    expect(isReadOnlyTool("taskManager")).toBe(false);

    expect(isFileMutationTool("writeFile")).toBe(true);
    expect(isFileMutationTool("editFile")).toBe(true);
    expect(isFileMutationTool("readFile")).toBe(false);
    expect(isFileMutationTool("webFetch")).toBe(false);
  });
});

describe("Deterministic Policy Evaluation Precedence", () => {
  const cwd = process.cwd();

  it("explicit deny rules always win over allows and bypass", () => {
    const decision = evaluateToolPermission(
      { toolName: "bash", parameters: { command: "rm -rf /" }, workingDirectory: cwd },
      {
        permissionMode: "bypassPermissions",
        dangerouslySkipPermissions: true,
        allowedTools: ["Bash(*)"],
        disallowedTools: ["Bash(rm *)"],
      },
    );
    expect(decision.decision).toBe("deny");
  });

  it("bypass mode allows all tools when no deny rule matches", () => {
    const decision = evaluateToolPermission(
      { toolName: "bash", parameters: { command: "git status" }, workingDirectory: cwd },
      {
        permissionMode: "bypassPermissions",
        allowedTools: [],
        disallowedTools: [],
      },
    );
    expect(decision.decision).toBe("allow");
  });

  it("evaluates default mode rules", () => {
    // Read-only tools allowed by default
    const readDecision = evaluateToolPermission(
      { toolName: "readFile", parameters: { filePath: "package.json" }, workingDirectory: cwd },
      { permissionMode: "default", allowedTools: [], disallowedTools: [] },
    );
    expect(readDecision.decision).toBe("allow");

    // File mutations denied by default without allow rule
    const writeDecision = evaluateToolPermission(
      { toolName: "writeFile", parameters: { filePath: "src/foo.ts" }, workingDirectory: cwd },
      { permissionMode: "default", allowedTools: [], disallowedTools: [] },
    );
    expect(writeDecision.decision).toBe("deny");

    // File mutations allowed with explicit rule using filePath
    const allowedWrite = evaluateToolPermission(
      { toolName: "writeFile", parameters: { filePath: "src/foo.ts" }, workingDirectory: cwd },
      { permissionMode: "default", allowedTools: ["writeFile(src/*)"], disallowedTools: [] },
    );
    expect(allowedWrite.decision).toBe("allow");

    // Web fetch allowed by default in default mode (read-only) or explicit allow
    const fetchDecision = evaluateToolPermission(
      {
        toolName: "webFetch",
        parameters: { url: "https://github.com/amaranthic/greg" },
        workingDirectory: cwd,
      },
      { permissionMode: "default", allowedTools: [], disallowedTools: [] },
    );
    expect(fetchDecision.decision).toBe("allow");

    // Web fetch disallowed by pattern
    const fetchDenied = evaluateToolPermission(
      {
        toolName: "webFetch",
        parameters: { url: "https://malicious.com/payload" },
        workingDirectory: cwd,
      },
      {
        permissionMode: "default",
        allowedTools: [],
        disallowedTools: ["webFetch(*malicious.com*)"],
      },
    );
    expect(fetchDenied.decision).toBe("deny");

    // Shell denied by default without rule
    const bashDecision = evaluateToolPermission(
      { toolName: "bash", parameters: { command: "ls" }, workingDirectory: cwd },
      { permissionMode: "default", allowedTools: [], disallowedTools: [] },
    );
    expect(bashDecision.decision).toBe("deny");
  });

  it("evaluates acceptEdits mode", () => {
    // File mutations auto-allowed in acceptEdits
    const writeDecision = evaluateToolPermission(
      { toolName: "writeFile", parameters: { filePath: "test.txt" }, workingDirectory: cwd },
      { permissionMode: "acceptEdits", allowedTools: [], disallowedTools: [] },
    );
    expect(writeDecision.decision).toBe("allow");

    // Bash still denied in acceptEdits without rule
    const bashDecision = evaluateToolPermission(
      { toolName: "bash", parameters: { command: "ls" }, workingDirectory: cwd },
      { permissionMode: "acceptEdits", allowedTools: [], disallowedTools: [] },
    );
    expect(bashDecision.decision).toBe("deny");
  });

  it("evaluates plan mode", () => {
    // Read-only filesystem allowed in plan
    const readDecision = evaluateToolPermission(
      { toolName: "readFile", parameters: { filePath: "test.txt" }, workingDirectory: cwd },
      { permissionMode: "plan", allowedTools: [], disallowedTools: [] },
    );
    expect(readDecision.decision).toBe("allow");

    // Web tools are read-only and explicitly allowed in plan mode
    const fetchDecision = evaluateToolPermission(
      { toolName: "webFetch", parameters: { url: "https://example.com" }, workingDirectory: cwd },
      { permissionMode: "plan", allowedTools: [], disallowedTools: [] },
    );
    expect(fetchDecision.decision).toBe("allow");

    const searchDecision = evaluateToolPermission(
      { toolName: "webSearch", parameters: { query: "query" }, workingDirectory: cwd },
      { permissionMode: "plan", allowedTools: [], disallowedTools: [] },
    );
    expect(searchDecision.decision).toBe("allow");

    // Mutations denied in plan
    const writeDecision = evaluateToolPermission(
      { toolName: "writeFile", parameters: { filePath: "test.txt" }, workingDirectory: cwd },
      { permissionMode: "plan", allowedTools: [], disallowedTools: [] },
    );
    expect(writeDecision.decision).toBe("deny");

    // Shell denied in plan
    const bashDecision = evaluateToolPermission(
      { toolName: "bash", parameters: { command: "ls" }, workingDirectory: cwd },
      { permissionMode: "plan", allowedTools: [], disallowedTools: [] },
    );
    expect(bashDecision.decision).toBe("deny");
  });

  it("enforces TaskManager coupling to BashTool", () => {
    // Denying Bash(*) denies TaskManager
    const deniedDecision = evaluateToolPermission(
      { toolName: "taskManager", parameters: { action: "list" }, workingDirectory: cwd },
      { permissionMode: "bypassPermissions", allowedTools: [], disallowedTools: ["Bash(*)"] },
    );
    expect(deniedDecision.decision).toBe("deny");

    // In default mode, TaskManager is denied if Bash is not allowed
    const unallowedDecision = evaluateToolPermission(
      { toolName: "taskManager", parameters: { action: "list" }, workingDirectory: cwd },
      { permissionMode: "default", allowedTools: [], disallowedTools: [] },
    );
    expect(unallowedDecision.decision).toBe("deny");

    // In default mode, TaskManager is allowed when Bash(*) is allowed
    const allowedDecision = evaluateToolPermission(
      { toolName: "taskManager", parameters: { action: "list" }, workingDirectory: cwd },
      { permissionMode: "default", allowedTools: ["Bash(*)"], disallowedTools: [] },
    );
    expect(allowedDecision.decision).toBe("allow");
  });
});
