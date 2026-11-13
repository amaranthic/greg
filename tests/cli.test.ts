/**
 * @fileoverview End-to-end integration tests for Greg CLI command routing, flags, and exit codes.
 * @packageDocumentation
 */

import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gregVersion } from "../src/constants/index.js";

describe("Greg CLI End-to-End Execution", () => {
  const cliEntry = path.resolve("src/main.ts");

  it("prints version on --version", async () => {
    const proc = Bun.spawn(["bun", cliEntry, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(output.trim()).toBe(gregVersion);
  });

  it("prints help menu on --help", async () => {
    const proc = Bun.spawn(["bun", cliEntry, "--help"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(output).toContain("The post-modern autonomous print agent");
    expect(output).toContain("config");
    expect(output).toContain("threads");
    expect(output).toContain("checkpoints");
  });

  it("rejects run when neither prompt nor stdin is provided", async () => {
    const proc = Bun.spawn(["bun", cliEntry], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Close stdin immediately so no input is sent
    proc.stdin.end();

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
    expect(stderr).toContain(
      "Error: Input must be provided either as a prompt argument or through piped stdin.",
    );
  });

  it("executes config subcommands with custom home directory", async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), "greg-cli-test-"));
    try {
      // 1. config get
      const getProc = Bun.spawn(["bun", cliEntry, "config", "get", "--home", tempHome], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const getOutput = await new Response(getProc.stdout).text();
      const getCode = await getProc.exited;

      expect(getCode).toBe(0);
      const parsed = JSON.parse(getOutput);
      expect(parsed.version).toBe(1);
      expect(parsed.model).toBe("dummy");

      // 2. config set
      const setProc = Bun.spawn(
        ["bun", cliEntry, "config", "set", "model", "google/gemini-2.5-flash", "--home", tempHome],
        { stdout: "pipe", stderr: "pipe" },
      );
      const setCode = await setProc.exited;
      expect(setCode).toBe(0);

      // 3. verify set value
      const verifyProc = Bun.spawn(
        ["bun", cliEntry, "config", "get", "model", "--home", tempHome],
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const verifyOutput = await new Response(verifyProc.stdout).text();
      const verifyCode = await verifyProc.exited;

      expect(verifyCode).toBe(0);
      expect(verifyOutput.trim()).toBe("google/gemini-2.5-flash");

      // 4. config unset
      const unsetProc = Bun.spawn(
        ["bun", cliEntry, "config", "unset", "model", "--home", tempHome],
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const unsetCode = await unsetProc.exited;
      expect(unsetCode).toBe(0);
    } finally {
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("handles threads list command with clean output", async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), "greg-threads-test-"));
    try {
      const proc = Bun.spawn(["bun", cliEntry, "threads", "list", "--home", tempHome], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(0);
      expect(output).toContain("No active threads found");
    } finally {
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("accepts positional prompt and dispatches to engine", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        cliEntry,
        "ping test",
        "--timeout",
        "10ms",
        "--bare",
        "--noSessionPersistence",
        "-o",
        "json",
        "-m",
        "compatible/dummy",
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(4);
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty("exitCode", 4);
  });

  it("rejects unknown setting key on config set with exit code 1", async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), "greg-cfg-err-"));
    try {
      const proc = Bun.spawn(
        ["bun", cliEntry, "config", "set", "invalid_key", "value", "--home", tempHome],
        { stdout: "pipe", stderr: "pipe" },
      );
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(1);
      expect(stderr).toContain('Unrecognized configuration key: "invalid_key"');
    } finally {
      await rm(tempHome, { recursive: true, force: true });
    }
  });

  it("handles invalid thread ID cleanly without crashing with a raw stack trace", async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), "greg-thread-err-"));
    try {
      const proc = Bun.spawn(
        ["bun", cliEntry, "threads", "show", "../../../etc/passwd", "--home", tempHome],
        { stdout: "pipe", stderr: "pipe" },
      );
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(1);
      expect(stderr).toContain("Invalid thread identifier");
    } finally {
      await rm(tempHome, { recursive: true, force: true });
    }
  });
});
