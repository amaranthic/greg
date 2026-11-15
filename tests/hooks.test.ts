/**
 * @fileoverview Comprehensive unit and integration test suite for Greg hooks system.
 * @packageDocumentation
 */

import { describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { hookExitCodes } from "../src/constants/index.js";
import {
  buildHookEnvironment,
  commandHookSchema,
  executeCommandHook,
  hooksConfigSchema,
  loadHooksConfig,
  matchesToolNamePattern,
  parseEvaluatorDecision,
  promptHookSchema,
  resolveMatchingHooks,
  resolvePromptHookCandidateModels,
  type CommandHook,
  type HookInput,
  type HookMatcher,
  type PromptHook,
} from "../src/hooks/index.js";
import type { ResolvedConfiguration } from "../src/settings/index.js";

const testTempDir = path.join(process.cwd(), ".tmp-test-hooks");

describe("Hooks Configuration Schema & Defaults", () => {
  it("parses empty object with deterministic defaults", () => {
    const parsed = hooksConfigSchema.parse({});
    expect(parsed.disableGlobalHooks).toBe(false);
    expect(parsed.disableAllHooks).toBe(false);
    expect(parsed.hooks).toEqual({});
  });

  it("validates command hook schema with defaults", () => {
    const raw = {
      type: "command",
      command: "echo 'hello'",
    };
    const parsed = commandHookSchema.parse(raw);
    expect(parsed.type).toBe("command");
    expect(parsed.shell).toBe("bash");
    expect(parsed.timeout).toBe(60);
    expect(parsed.once).toBe(false);
  });

  it("validates prompt hook schema with fallback models", () => {
    const raw = {
      type: "prompt",
      prompt: "Verify safety: $ARGUMENTS",
      model: "google/gemini-2.5-flash",
      fallbackModels: ["groq/llama-3.3-70b-versatile"],
      appendSystemPrompt: "Enforce strict JWT check.",
    };
    const parsed = promptHookSchema.parse(raw);
    expect(parsed.type).toBe("prompt");
    expect(parsed.model).toBe("google/gemini-2.5-flash");
    expect(parsed.fallbackModels).toHaveLength(1);
    expect(parsed.appendSystemPrompt).toBe("Enforce strict JWT check.");
  });

  it("rejects unknown hook types", () => {
    const raw = {
      type: "unknownType",
      command: "echo 1",
    };
    expect(() => commandHookSchema.parse(raw)).toThrow();
  });
});

describe("Hooks Config File Loader & Merging", () => {
  it("loads and merges project and global hooks files correctly", async () => {
    const projectDir = path.join(testTempDir, "project-merge");
    const homeDir = path.join(testTempDir, "home-merge");

    await mkdir(path.join(projectDir, ".greg", "config"), { recursive: true });
    await mkdir(path.join(homeDir, "config"), { recursive: true });

    const projectConfig = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "echo 'project bash'" }],
          },
        ],
      },
    };

    const globalConfig = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Write",
            hooks: [{ type: "command", command: "echo 'global write'" }],
          },
        ],
        Stop: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "bun test" }],
          },
        ],
      },
    };

    await writeFile(
      path.join(projectDir, ".greg", "config", "hooks.json"),
      JSON.stringify(projectConfig),
    );
    await writeFile(
      path.join(homeDir, "config", "hooks.json"),
      JSON.stringify(globalConfig),
    );

    const resolved = await loadHooksConfig(projectDir, homeDir);
    expect(resolved.PreToolUse).toHaveLength(2);
    expect(resolved.PreToolUse[0]?.matcher).toBe("Bash");
    expect(resolved.PreToolUse[1]?.matcher).toBe("Write");
    expect(resolved.Stop).toHaveLength(1);

    await rm(projectDir, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  });

  it("honors disableGlobalHooks flag in project config", async () => {
    const projectDir = path.join(testTempDir, "project-isolate");
    const homeDir = path.join(testTempDir, "home-isolate");

    await mkdir(path.join(projectDir, ".greg", "config"), { recursive: true });
    await mkdir(path.join(homeDir, "config"), { recursive: true });

    const projectConfig = {
      disableGlobalHooks: true,
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "echo 'project bash'" }],
          },
        ],
      },
    };

    const globalConfig = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Write",
            hooks: [{ type: "command", command: "echo 'global write'" }],
          },
        ],
      },
    };

    await writeFile(
      path.join(projectDir, ".greg", "config", "hooks.json"),
      JSON.stringify(projectConfig),
    );
    await writeFile(
      path.join(homeDir, "config", "hooks.json"),
      JSON.stringify(globalConfig),
    );

    const resolved = await loadHooksConfig(projectDir, homeDir);
    expect(resolved.PreToolUse).toHaveLength(1);
    expect(resolved.PreToolUse[0]?.matcher).toBe("Bash");

    await rm(projectDir, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  });

  it("honors disableAllHooks master kill-switch", async () => {
    const projectDir = path.join(testTempDir, "project-killswitch");
    const homeDir = path.join(testTempDir, "home-killswitch");

    await mkdir(path.join(projectDir, ".greg", "config"), { recursive: true });
    await mkdir(path.join(homeDir, "config"), { recursive: true });

    const projectConfig = {
      disableAllHooks: true,
      hooks: {
        PreToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "echo 'should not run'" }],
          },
        ],
      },
    };

    await writeFile(
      path.join(projectDir, ".greg", "config", "hooks.json"),
      JSON.stringify(projectConfig),
    );

    const resolved = await loadHooksConfig(projectDir, homeDir);
    expect(resolved.PreToolUse).toHaveLength(0);
    expect(resolved.PostToolUse).toHaveLength(0);
    expect(resolved.Stop).toHaveLength(0);

    await rm(projectDir, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  });

  it("returns empty hooks when no configuration files exist", async () => {
    const resolved = await loadHooksConfig(
      "/nonexistent/project/dir",
      "/nonexistent/home/dir",
    );
    expect(resolved.PreToolUse).toHaveLength(0);
    expect(resolved.Stop).toHaveLength(0);
  });
});

describe("Hook Pattern Matching & `if` Condition Pre-Filtering", () => {
  it("matches tool names against pipe-separated and wildcard patterns", () => {
    expect(matchesToolNamePattern("Bash", "Bash|Write")).toBe(true);
    expect(matchesToolNamePattern("Write", "Bash|Write")).toBe(true);
    expect(matchesToolNamePattern("Edit", "Bash|Write")).toBe(false);
    expect(matchesToolNamePattern("Edit", "*")).toBe(true);
    expect(matchesToolNamePattern("Edit", "")).toBe(true);
    expect(matchesToolNamePattern("Edit", undefined)).toBe(true);
    expect(matchesToolNamePattern("Bash", "^(Bash|Sh)$")).toBe(true);
  });

  it("filters hooks based on tool name and `if` conditions", () => {
    const matchers: HookMatcher[] = [
      {
        matcher: "Bash|Write",
        hooks: [
          {
            type: "command",
            command: "echo 'git check'",
            if: "Bash(git push *)",
            shell: "bash",
            timeout: 30,
            once: false,
          },
          {
            type: "command",
            command: "echo 'general write check'",
            if: "Write(src/**/*.ts)",
            shell: "bash",
            timeout: 30,
            once: false,
          },
          {
            type: "command",
            command: "echo 'unconditional bash check'",
            if: "Bash",
            shell: "bash",
            timeout: 30,
            once: false,
          },
        ],
      },
    ];

    // Case 1: Bash running git push -> matches git hook and unconditional hook
    const gitPushHooks = resolveMatchingHooks(
      matchers,
      "Bash",
      { command: "git push origin main" },
      process.cwd(),
    );
    expect(gitPushHooks).toHaveLength(2);
    expect((gitPushHooks[0] as CommandHook).command).toBe("echo 'git check'");
    expect((gitPushHooks[1] as CommandHook).command).toBe("echo 'unconditional bash check'");

    // Case 2: Bash running ls -> matches only unconditional hook
    const lsHooks = resolveMatchingHooks(
      matchers,
      "Bash",
      { command: "ls -la" },
      process.cwd(),
    );
    expect(lsHooks).toHaveLength(1);
    expect((lsHooks[0] as CommandHook).command).toBe("echo 'unconditional bash check'");

    // Case 3: Write matching file path -> matches general write check
    const writeHooks = resolveMatchingHooks(
      matchers,
      "Write",
      { path: "src/core/engine.ts" },
      process.cwd(),
    );
    expect(writeHooks).toHaveLength(1);
    expect((writeHooks[0] as CommandHook).command).toBe("echo 'general write check'");
  });
});

describe("Command Hook Subprocess Runner & Exit Code Protocol", () => {
  const baseInput: HookInput = {
    sessionId: "test-session-123",
    hookEvent: "PreToolUse",
    projectDir: process.cwd(),
    cwd: process.cwd(),
    model: "dummy",
    turnIndex: 1,
    toolName: "Bash",
    toolInput: { command: "echo test" },
  };

  it("injects GREG_* environment variables and interpolates custom env", () => {
    const hook: CommandHook = {
      type: "command",
      command: "echo 1",
      shell: "bash",
      timeout: 10,
      once: false,
      env: {
        CUSTOM_FLAG: "strict",
      },
    };

    const env = buildHookEnvironment(hook, baseInput);
    expect(env.GREG_PROJECT_DIR).toBe(baseInput.projectDir);
    expect(env.GREG_HOOK_EVENT).toBe("PreToolUse");
    expect(env.GREG_SESSION_ID).toBe("test-session-123");
    expect(env.GREG_TOOL_NAME).toBe("Bash");
    expect(env.CUSTOM_FLAG).toBe("strict");
  });

  it("handles exit code 0 as success with plain text", async () => {
    const hook: CommandHook = {
      type: "command",
      command: "echo 'allowed'",
      shell: "bash",
      timeout: 10,
      once: false,
    };

    const result = await executeCommandHook(hook, baseInput);
    expect(result.blocked).toBe(false);
    expect(result.nonBlockingError).toBe(false);
    expect(result.stdout.trim()).toBe("allowed");
  });

  it("handles exit code 0 with structured JSON output", async () => {
    const hook: CommandHook = {
      type: "command",
      command: "echo '{\"additionalContext\":\"lint clean\",\"updatedInput\":{\"command\":\"echo modified\"}}'",
      shell: "bash",
      timeout: 10,
      once: false,
    };

    const result = await executeCommandHook(hook, baseInput);
    expect(result.blocked).toBe(false);
    expect(result.additionalContext).toBe("lint clean");
    expect(result.updatedInput).toEqual({ command: "echo modified" });
  });

  it("handles exit code 0 with structured block decision", async () => {
    const hook: CommandHook = {
      type: "command",
      command: "echo '{\"decision\":\"block\",\"reason\":\"Security policy violation\"}'",
      shell: "bash",
      timeout: 10,
      once: false,
    };

    const result = await executeCommandHook(hook, baseInput);
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toBe("Security policy violation");
  });

  it("handles exit code 2 as dedicated blocking veto with stderr", async () => {
    const hook: CommandHook = {
      type: "command",
      command: "echo 'Force push rejected' >&2 && exit 2",
      shell: "bash",
      timeout: 10,
      once: false,
    };

    const result = await executeCommandHook(hook, baseInput);
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain("Force push rejected");
    expect(result.nonBlockingError).toBe(false);
  });

  it("treats other non-zero exit codes as non-blocking warning", async () => {
    const hook: CommandHook = {
      type: "command",
      command: "echo 'minor warning' >&2 && exit 1",
      shell: "bash",
      timeout: 10,
      once: false,
    };

    const result = await executeCommandHook(hook, baseInput);
    expect(result.blocked).toBe(false);
    expect(result.nonBlockingError).toBe(true);
    expect(result.errorMessage).toContain("non-blocking code 1");
  });
});

describe("Prompt Hook Model Resolution & Decision Parsing", () => {
  const dummyConfig: ResolvedConfiguration = {
    model: "anthropic/claude-3-5-sonnet",
    fallbackModels: ["google/gemini-2.5-flash"],
    apiKey: "dummy-key",
    baseUrl: "http://localhost:8080/v1",
    homeDirectory: "/home/user/.greg",
    settings: {
      version: 1,
      model: "anthropic/claude-3-5-sonnet",
      permissionMode: "default",
      allowedTools: [],
      disallowedTools: [],
      maxTurns: 50,
      timeout: "30m",
      fallbackModels: ["google/gemini-2.5-flash"],
    },
  };

  it("gracefully skips invalid or unrecognized providers in fallbackModels", () => {
    const hook: PromptHook = {
      type: "prompt",
      prompt: "Verify input: $ARGUMENTS",
      model: "google/gemini-2.5-flash",
      fallbackModels: [
        "invalidProvider/bad-model",
        "openai/gpt-4o",
      ],
      timeout: 30,
      once: false,
    };

    const candidates = resolvePromptHookCandidateModels(hook, dummyConfig);
    expect(candidates).toContain("google/gemini-2.5-flash");
    expect(candidates).toContain("openai/gpt-4o");
    expect(candidates).not.toContain("invalidProvider/bad-model");
  });

  it("parses evaluator decision from direct and markdown-wrapped JSON", () => {
    const directTrue = parseEvaluatorDecision('{"ok": true}');
    expect(directTrue?.ok).toBe(true);

    const directFalse = parseEvaluatorDecision('{"ok": false, "reason": "Secret key leaked"}');
    expect(directFalse?.ok).toBe(false);
    expect(directFalse?.reason).toBe("Secret key leaked");

    const markdownWrapped = parseEvaluatorDecision(
      'Here is my evaluation:\n```json\n{\n  "ok": false,\n  "reason": "Hardcoded AWS secret"\n}\n```',
    );
    expect(markdownWrapped?.ok).toBe(false);
    expect(markdownWrapped?.reason).toBe("Hardcoded AWS secret");

    const invalid = parseEvaluatorDecision("I approve this request with no json");
    expect(invalid).toBeNull();
  });
});
