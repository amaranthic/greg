/**
 * @fileoverview Unit tests for wildcard pattern compilation and rule matching.
 * @packageDocumentation
 */

import { describe, expect, it } from "bun:test";
import {
  compileWildcardRegex,
  matchesToolRule,
  matchWildcardPattern,
  parseToolRule,
} from "../src/policy/index.js";

describe("Wildcard Pattern Matching Engine", () => {
  it("matches exact strings and simple wildcards", () => {
    expect(matchWildcardPattern("git status", "git status")).toBe(true);
    expect(matchWildcardPattern("git *", "git checkout main")).toBe(true);
    expect(matchWildcardPattern("git *", "npm test")).toBe(false);
  });

  it("handles optional trailing argument for single-wildcard patterns", () => {
    // "git *" should match both "git commit" and bare "git"
    expect(matchWildcardPattern("git *", "git")).toBe(true);
    expect(matchWildcardPattern("git *", "git status")).toBe(true);
  });

  it("handles path matching and wildcards", () => {
    expect(matchWildcardPattern("src/core/*.ts", "src/core/engine.ts")).toBe(true);
    expect(matchWildcardPattern("src/core/*.ts", "src/output/sink.ts")).toBe(false);
    expect(matchWildcardPattern("*", "anything")).toBe(true);
    expect(matchWildcardPattern("**", "nested/deep/file.ts")).toBe(true);
  });

  it("handles escape sequences for literal asterisks", () => {
    expect(matchWildcardPattern("echo \\*", "echo *")).toBe(true);
    expect(matchWildcardPattern("echo \\*", "echo hello")).toBe(false);
  });

  it("anchors matches to full string", () => {
    const regex = compileWildcardRegex("git status");
    expect(regex.test("git status")).toBe(true);
    expect(regex.test("sudo git status")).toBe(false);
    expect(regex.test("git status --short")).toBe(false);
  });
});

describe("Tool Rule Parsing & Matching", () => {
  it("parses scoped tool rules and bare tool names in canonical PascalCase format", () => {
    const scoped = parseToolRule("Bash(bun test *)");
    expect(scoped.toolName).toBe("Bash");
    expect(scoped.pattern).toBe("bun test *");

    const bare = parseToolRule("Read");
    expect(bare.toolName).toBe("Read");
    expect(bare.pattern).toBe("*");
  });

  it("rejects TaskManager or unapproved formats in rule strings", () => {
    expect(() => parseToolRule("TaskManager")).toThrow();
    expect(() => parseToolRule("TaskManager(*)")).toThrow();
    expect(() => parseToolRule("readFile")).toThrow();
    expect(() => parseToolRule("writeFile(src/*)")).toThrow();
    expect(() => parseToolRule("customTool")).toThrow();
  });

  it("matches tool rules against execution targets", () => {
    expect(matchesToolRule("Bash(git *)", "bash", "git log -n 5")).toBe(true);
    expect(matchesToolRule("Bash(git *)", "bash", "git")).toBe(true);
    expect(matchesToolRule("Bash(git *)", "bash", "rm -rf /")).toBe(false);
    expect(matchesToolRule("Write(src/*)", "writeFile", "src/index.ts")).toBe(true);
    expect(matchesToolRule("Write(src/*)", "readFile", "src/index.ts")).toBe(false);
    expect(matchesToolRule("Read(src/*)", "readFile", "src/index.ts")).toBe(true);
  });
});
