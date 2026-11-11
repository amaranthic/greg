/**
 * @fileoverview Unit and integration tests for settings schema, persistence, and resolution.
 * @packageDocumentation
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addSettingValue,
  getSettingValue,
  normalizeModelString,
  readSettingsFile,
  removeSettingValue,
  resolveEffectiveConfiguration,
  resolveHomeDirectory,
  resolveProviderApiKey,
  resolveProviderBaseUrl,
  setSettingValue,
  settingsSchema,
  unsetSettingValue,
  writeSettingsFile,
} from "../src/settings/index.js";

describe("Settings Schema & Defaults", () => {
  it("parses empty input with deterministic version 1 and defaults", () => {
    const parsed = settingsSchema.parse({});
    expect(parsed.version).toBe(1);
    expect(parsed.model).toBe("dummy");
    expect(parsed.permissionMode).toBe("default");
    expect(parsed.maxTurns).toBe(50);
    expect(parsed.timeout).toBe("30m");
    expect(parsed.allowedTools).toEqual([]);
    expect(parsed.disallowedTools).toEqual([]);
  });

  it("rejects unknown permission modes", () => {
    expect(() => settingsSchema.parse({ permissionMode: "invalidMode" })).toThrow();
  });
});

describe("Settings File Persistence & Algorithmic Modification", () => {
  it("performs atomic read and write of settings", async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), "greg-settings-test-"));
    try {
      const initial = await readSettingsFile(tempHome);
      expect(initial.model).toBe("dummy");

      const modified = setSettingValue(initial, "model", "anthropic/claude-3-7-sonnet");
      await writeSettingsFile(tempHome, modified);

      const reloaded = await readSettingsFile(tempHome);
      expect(reloaded.model).toBe("anthropic/claude-3-7-sonnet");
    } finally {
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("algorithmically adds, gets, removes, and unsets settings", () => {
    let settings = settingsSchema.parse({});

    // get
    expect(getSettingValue(settings, "model")).toBe("dummy");

    // set
    settings = setSettingValue(settings, "model", "google/gemini-2.5-flash");
    expect(settings.model).toBe("google/gemini-2.5-flash");

    // add to array
    settings = addSettingValue(settings, "allowedTools", "Bash(bun test *)");
    expect(settings.allowedTools).toEqual(["Bash(bun test *)"]);

    // add duplicate (idempotent)
    settings = addSettingValue(settings, "allowedTools", "Bash(bun test *)");
    expect(settings.allowedTools).toEqual(["Bash(bun test *)"]);

    // remove from array
    settings = removeSettingValue(settings, "allowedTools", "Bash(bun test *)");
    expect(settings.allowedTools).toEqual([]);

    // unset
    settings = unsetSettingValue(settings, "model");
    expect(settings.model).toBe("dummy");
  });
});

describe("Model Normalization & Credential Resolution", () => {
  it("normalizes bare model names to compatible provider", () => {
    const bare = normalizeModelString("dummy");
    expect(bare.model).toBe("compatible/dummy");
    expect(bare.provider).toBe("compatible");
    expect(bare.modelId).toBe("dummy");

    const full = normalizeModelString("anthropic/claude-3-7-sonnet");
    expect(full.model).toBe("anthropic/claude-3-7-sonnet");
    expect(full.provider).toBe("anthropic");
    expect(full.modelId).toBe("claude-3-7-sonnet");
  });

  it("resolves default and override base URLs", () => {
    const anthropicDefault = resolveProviderBaseUrl("anthropic");
    expect(anthropicDefault).toBe("https://api.anthropic.com/v1");

    const compatibleDefault = resolveProviderBaseUrl("compatible");
    expect(compatibleDefault).toBe("http://localhost:8080/v1");

    const cliOverride = resolveProviderBaseUrl("openai", "https://custom.endpoint.com/v1");
    expect(cliOverride).toBe("https://custom.endpoint.com/v1");
  });

  it("resolves API keys and fallbacks", () => {
    const cliKey = resolveProviderApiKey("anthropic", "sk-custom-test-key");
    expect(cliKey).toBe("sk-custom-test-key");

    const fallbackKey = resolveProviderApiKey("compatible");
    expect(fallbackKey).toBe("dummy");
  });

  it("resolves home directory correctly", () => {
    const resolved = resolveHomeDirectory("/custom/path");
    expect(resolved).toBe(path.resolve("/custom/path"));
  });

  it("resolves effective configuration with layered precedence", async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), "greg-effective-test-"));
    try {
      const config = await resolveEffectiveConfiguration(
        {
          model: "openai/gpt-4o",
          home: tempHome,
          bare: true,
        },
        process.cwd(),
      );

      expect(config.model).toBe("openai/gpt-4o");
      expect(config.provider).toBe("openai");
      expect(config.modelId).toBe("gpt-4o");
      expect(config.homeDirectory).toBe(tempHome);
    } finally {
      await rm(tempHome, { recursive: true, force: true });
    }
  });
});
