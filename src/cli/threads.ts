/**
 * @fileoverview Subcommands for inspecting and managing conversation thread sessions.
 * @packageDocumentation
 */

import { Command } from "commander";
import { FileThreadStore } from "@amaranthic/hernex";
import { resolveHomeDirectory } from "../settings/index.js";
import { writeToStderr, writeToStdout } from "../utils/index.js";

/**
 * Options common to thread subcommands.
 */
export interface ThreadSubcommandOptions {
  /** Optional home directory override. */
  readonly home?: string | undefined;
  /** Maximum number of threads to list. */
  readonly limit?: string | undefined;
}

/**
 * Creates the commander Command for the `threads` subcommand tree.
 *
 * @returns Fully configured commander Command instance for `threads`.
 *
 * @example
 * ```typescript
 * const threadsCmd = createThreadsCommand();
 * program.addCommand(threadsCmd);
 * ```
 */
export function createThreadsCommand(): Command {
  const threads = new Command("threads").description(
    "Manage persistent conversation threads and session transcripts",
  );

  threads
    .command("list")
    .description("List persisted conversation threads")
    .option("--home <dir>", "Override home directory path")
    .option("-n, --limit <number>", "Maximum number of threads to list", "20")
    .action(async (options: ThreadSubcommandOptions, cmd: Command) => {
      const mergedOptions = { ...cmd.optsWithGlobals(), ...options };
      const home = resolveHomeDirectory(mergedOptions.home);
      const store = new FileThreadStore({ homeDirectory: home });
      const parsedLimit = mergedOptions.limit ? parseInt(mergedOptions.limit, 10) : 20;

      try {
        const threadList = await store.listThreads({
          workingDirectory: process.cwd(),
          limit: Number.isFinite(parsedLimit) ? parsedLimit : 20,
        });

        if (threadList.length === 0) {
          writeToStdout("No active threads found for this workspace.\n");
          return;
        }

        const payload = threadList.map((t) => ({
          id: t.id,
          title: t.title ?? "(untitled)",
          turnCount: t.turnCount,
          model: t.model ?? "unknown",
          status: t.status,
          updatedAt: t.updatedAt,
        }));

        writeToStdout(JSON.stringify(payload, null, 2) + "\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeToStderr(`Failed to list threads: ${msg}\n`);
        process.exit(1);
      }
    });

  threads
    .command("show <id>")
    .description("Display metadata and status for a specific thread")
    .option("--home <dir>", "Override home directory path")
    .action(async (id: string, options: ThreadSubcommandOptions, cmd: Command) => {
      const mergedOptions = { ...cmd.optsWithGlobals(), ...options };
      const home = resolveHomeDirectory(mergedOptions.home);
      const store = new FileThreadStore({ homeDirectory: home });

      try {
        const metadata = await store.getThread(id);
        if (!metadata) {
          writeToStderr(`Thread "${id}" not found.\n`);
          process.exit(1);
        }

        writeToStdout(JSON.stringify(metadata, null, 2) + "\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeToStderr(`Failed to inspect thread "${id}": ${msg}\n`);
        process.exit(1);
      }
    });

  threads
    .command("delete <id>")
    .description("Delete a conversation thread session")
    .option("--home <dir>", "Override home directory path")
    .action(async (id: string, options: ThreadSubcommandOptions, cmd: Command) => {
      const mergedOptions = { ...cmd.optsWithGlobals(), ...options };
      const home = resolveHomeDirectory(mergedOptions.home);
      const store = new FileThreadStore({ homeDirectory: home });

      try {
        const removed = await store.deleteThread(id);
        if (removed) {
          writeToStdout(`Deleted thread "${id}".\n`);
        } else {
          writeToStderr(`Thread "${id}" not found.\n`);
          process.exit(1);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeToStderr(`Failed to delete thread "${id}": ${msg}\n`);
        process.exit(1);
      }
    });

  return threads;
}
