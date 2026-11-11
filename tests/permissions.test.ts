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

    const readTarget = extractToolTarget("readFile", { path: "src/main.ts" }, cwd);
    expect(readTarget).toBe("src/main.ts");

    const globTarget = extractToolTarget("glob", { pattern: "*.json" }, cwd);
    expect(globTarget).toBe("*.json");
  });

  it("categorizes tools correctly", () => {
    expect(isReadOnlyTool("readFile")).toBe(true);
    expect(isReadOnlyTool("glob")).toBe(true);
    expect(isReadOnlyTool("grep")).toBe(true);
    expect(isReadOnlyTool("writeFile")).toBe(false);
    expect(isReadOnlyTool("bash")).toBe(false);

    expect(isFileMutationTool("writeFile")).toBe(true);
    expect(isFileMutationTool("editFile")).toBe(true);
    expect(isFileMutationTool("readFile")).toBe(false);
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
      { toolName: "readFile", parameters: { path: "package.json" }, workingDirectory: cwd },
      { permissionMode: "default", allowedTools: [], disallowedTools: [] },
    );
    expect(readDecision.decision).toBe("allow");

    // File mutations denied by default without allow rule
    const writeDecision = evaluateToolPermission(
      { toolName: "writeFile", parameters: { path: "src/foo.ts" }, workingDirectory: cwd },
      { permissionMode: "default", allowedTools: [], disallowedTools: [] },
    );
    expect(writeDecision.decision).toBe("deny");

    // File mutations allowed with explicit rule
    const allowedWrite = evaluateToolPermission(
      { toolName: "writeFile", parameters: { path: "src/foo.ts" }, workingDirectory: cwd },
      { permissionMode: "default", allowedTools: ["writeFile(src/*)"], disallowedTools: [] },
    );
    expect(allowedWrite.decision).toBe("allow");

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
      { toolName: "writeFile", parameters: { path: "test.txt" }, workingDirectory: cwd },
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
    // Read-only allowed in plan
    const readDecision = evaluateToolPermission(
      { toolName: "readFile", parameters: { path: "test.txt" }, workingDirectory: cwd },
      { permissionMode: "plan", allowedTools: [], disallowedTools: [] },
    );
    expect(readDecision.decision).toBe("allow");

    // Mutations denied in plan
    const writeDecision = evaluateToolPermission(
      { toolName: "writeFile", parameters: { path: "test.txt" }, workingDirectory: cwd },
      { permissionMode: "plan", allowedTools: [], disallowedTools: [] },
    );
    expect(writeDecision.decision).toBe("deny");
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
