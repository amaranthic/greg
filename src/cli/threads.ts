/**
 * @fileoverview Subcommands for inspecting and managing conversation thread sessions.
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import {
  FileThreadStore,
  type NewTranscriptEntry,
  type ThreadMetadata,
  type TranscriptEntry,
} from "@amaranthic/hernex";
import { resolveHomeDirectory } from "../settings/index.js";
import { writeToStderr, writeToStdout } from "../utils/index.js";
import { executeRunAction } from "./run.js";

/**
 * Maps a sequenced transcript entry to an unsequenced entry for appending into a new thread.
 *
 * @param entry - Authoritative sequenced transcript entry.
 * @returns Unsequenced entry suitable for appending.
 */
function toNewTranscriptEntry(entry: TranscriptEntry): NewTranscriptEntry {
  switch (entry.type) {
    case "turnStarted":
      return {
        type: "turnStarted",
        turnIndex: entry.turnIndex,
        userPrompt: entry.userPrompt,
        timestamp: entry.timestamp,
        ...(entry.version ? { version: entry.version } : {}),
      };
    case "modelMessage":
      return {
        type: "modelMessage",
        turnIndex: entry.turnIndex,
        message: entry.message,
        timestamp: entry.timestamp,
        ...(entry.version ? { version: entry.version } : {}),
      };
    case "toolCall":
      return {
        type: "toolCall",
        turnIndex: entry.turnIndex,
        callId: entry.callId,
        toolName: entry.toolName,
        parameters: entry.parameters,
        timestamp: entry.timestamp,
        ...(entry.version ? { version: entry.version } : {}),
      };
    case "toolResult":
      return {
        type: "toolResult",
        turnIndex: entry.turnIndex,
        callId: entry.callId,
        toolName: entry.toolName,
        result: entry.result,
        isError: entry.isError,
        timestamp: entry.timestamp,
        ...(entry.version ? { version: entry.version } : {}),
      };
    case "checkpointRef":
      return {
        type: "checkpointRef",
        turnIndex: entry.turnIndex,
        checkpointId: entry.checkpointId,
        checkpointSequence: entry.checkpointSequence,
        timestamp: entry.timestamp,
        ...(entry.version ? { version: entry.version } : {}),
      };
    case "turnFinished":
      return {
        type: "turnFinished",
        turnIndex: entry.turnIndex,
        finishReason: entry.finishReason,
        timestamp: entry.timestamp,
        ...(entry.usage ? { usage: entry.usage } : {}),
        ...(entry.version ? { version: entry.version } : {}),
      };
  }
}

/**
 * Options common to thread subcommands.
 */
export interface ThreadSubcommandOptions {
  /** Optional home directory override. */
  readonly home?: string | undefined;
  /** Maximum number of items to list. */
  readonly limit?: string | undefined;
  /** Optional workspace directory filter. */
  readonly workingDirectory?: string | undefined;
  /** Optional title for thread creation or forking. */
  readonly title?: string | undefined;
  /** Optional transcript sequence boundary for forking. */
  readonly atSequence?: string | undefined;
  /** Optional sequence filter to list transcript entries after. */
  readonly after?: string | undefined;
  /** Whether to bypass confirmation for destructive prune operations. */
  readonly yes?: boolean | undefined;
  /** Whether to include all workspaces during thread pruning. */
  readonly allWorkspaces?: boolean | undefined;
  /** Force execution without safety prompts. */
  readonly force?: boolean | undefined;
}

/**
 * Creates the commander Command for the `thread` subcommand tree (with legacy `threads` alias).
 *
 * @returns Fully configured commander Command instance for `thread`.
 *
 * @example
 * ```typescript
 * const threadCmd = createThreadsCommand();
 * program.addCommand(threadCmd);
 * ```
 */
export function createThreadsCommand(): Command {
  const thread = new Command("thread")
    .alias("threads")
    .description("Manage persistent conversation threads and session transcripts");

  // Subcommand: list
  thread
    .command("list")
    .description("List persisted conversation threads")
    .option("--home <dir>", "Override home directory path")
    .option("-n, --limit <number>", "Maximum number of threads to list", "20")
    .option("--working-directory <dir>", "Filter threads by workspace directory")
    .action(async (options: ThreadSubcommandOptions, cmd: Command) => {
      const mergedOptions = { ...cmd.optsWithGlobals(), ...options };
      const home = resolveHomeDirectory(mergedOptions.home);
      const store = new FileThreadStore({ homeDirectory: home });
      const parsedLimit = mergedOptions.limit ? parseInt(mergedOptions.limit, 10) : 20;
      const targetCwd = mergedOptions.workingDirectory ?? process.cwd();

      try {
        const threadList = await store.listThreads({
          workingDirectory: targetCwd,
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

  // Subcommand: show <id>
  thread
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

  // Subcommand: create
  thread
    .command("create")
    .description("Create a new persistent conversation thread")
    .option("--home <dir>", "Override home directory path")
    .option("--title <title>", "Descriptive title for the conversation thread")
    .action(async (options: ThreadSubcommandOptions, cmd: Command) => {
      const mergedOptions = { ...cmd.optsWithGlobals(), ...options };
      const home = resolveHomeDirectory(mergedOptions.home);
      const store = new FileThreadStore({ homeDirectory: home });
      const newThreadId = randomUUID();

      try {
        const created = await store.createThread({
          id: newThreadId,
          workingDirectory: process.cwd(),
          ...(mergedOptions.title ? { title: mergedOptions.title } : {}),
        });

        writeToStdout(JSON.stringify(created, null, 2) + "\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeToStderr(`Failed to create thread: ${msg}\n`);
        process.exit(1);
      }
    });

  // Subcommand: resume <id> [prompt]
  thread
    .command("resume <id> [prompt]")
    .description("Resume execution of a persistent conversation thread")
    .option("--home <dir>", "Override home directory path")
    .action(
      async (
        id: string,
        promptArgument: string | undefined,
        options: ThreadSubcommandOptions,
        cmd: Command,
      ) => {
        const mergedOptions = { ...cmd.optsWithGlobals(), ...options };
        const home = resolveHomeDirectory(mergedOptions.home);
        const store = new FileThreadStore({ homeDirectory: home });

        try {
          const metadata = await store.getThread(id);
          if (!metadata) {
            writeToStderr(`Thread "${id}" not found.\n`);
            process.exit(1);
          }

          if (promptArgument && promptArgument.trim().length > 0) {
            await executeRunAction({
              resume: id,
              prompt: promptArgument.trim(),
              home,
            });
          } else {
            writeToStdout(
              `Thread "${id}" found (${metadata.title ?? "untitled"}, ${metadata.turnCount} turns).\nPass a prompt to execute: greg thread resume ${id} "Next instruction"\n`,
            );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          writeToStderr(`Failed to resume thread "${id}": ${msg}\n`);
          process.exit(1);
        }
      },
    );

  // Subcommand: fork <id>
  thread
    .command("fork <id>")
    .description("Fork an existing conversation thread into a new branch")
    .option("--home <dir>", "Override home directory path")
    .option("--title <title>", "Title for the newly forked thread")
    .option("--at-sequence <number>", "Transcript sequence number to fork up to")
    .action(async (id: string, options: ThreadSubcommandOptions, cmd: Command) => {
      const mergedOptions = { ...cmd.optsWithGlobals(), ...options };
      const home = resolveHomeDirectory(mergedOptions.home);
      const store = new FileThreadStore({ homeDirectory: home });

      try {
        const sourceMeta = await store.getThread(id);
        if (!sourceMeta) {
          writeToStderr(`Source thread "${id}" not found.\n`);
          process.exit(1);
        }

        const transcript = await store.getTranscript(id);
        const parsedSequence = mergedOptions.atSequence
          ? parseInt(mergedOptions.atSequence, 10)
          : undefined;

        const filteredEntries: readonly TranscriptEntry[] = Number.isFinite(parsedSequence)
          ? transcript.filter((entry) => entry.sequence <= parsedSequence!)
          : transcript;

        const newThreadId = randomUUID();
        const forkedTitle = mergedOptions.title ?? `Fork of ${sourceMeta.title ?? id}`;

        const newMeta: ThreadMetadata = await store.createThread({
          id: newThreadId,
          workingDirectory: sourceMeta.workingDirectory,
          title: forkedTitle,
          ...(sourceMeta.model ? { model: sourceMeta.model } : {}),
          ...(sourceMeta.reasoning ? { reasoning: sourceMeta.reasoning } : {}),
        });

        for (const entry of filteredEntries) {
          await store.appendTranscript(newThreadId, toNewTranscriptEntry(entry));
        }

        writeToStdout(JSON.stringify(newMeta, null, 2) + "\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeToStderr(`Failed to fork thread "${id}": ${msg}\n`);
        process.exit(1);
      }
    });

  // Subcommand: transcript <id>
  thread
    .command("transcript <id>")
    .description("Inspect the sequenced transcript entries for a conversation thread")
    .option("--home <dir>", "Override home directory path")
    .option("-n, --limit <number>", "Maximum number of entries to return")
    .option("--after <sequence>", "Only return entries recorded after this sequence number")
    .action(async (id: string, options: ThreadSubcommandOptions, cmd: Command) => {
      const mergedOptions = { ...cmd.optsWithGlobals(), ...options };
      const home = resolveHomeDirectory(mergedOptions.home);
      const store = new FileThreadStore({ homeDirectory: home });

      try {
        const transcript = await store.getTranscript(id);
        const parsedAfter = mergedOptions.after ? parseInt(mergedOptions.after, 10) : undefined;
        const parsedLimit = mergedOptions.limit ? parseInt(mergedOptions.limit, 10) : undefined;

        let entries = transcript;
        if (Number.isFinite(parsedAfter)) {
          entries = entries.filter((e) => e.sequence > parsedAfter!);
        }
        if (Number.isFinite(parsedLimit) && parsedLimit! > 0) {
          entries = entries.slice(0, parsedLimit!);
        }

        writeToStdout(JSON.stringify(entries, null, 2) + "\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeToStderr(`Failed to inspect transcript for thread "${id}": ${msg}\n`);
        process.exit(1);
      }
    });

  // Subcommand: prune <count>
  thread
    .command("prune <count>")
    .description("Prune the oldest conversation threads or -1 to purge all")
    .option("-y, --yes", "Bypass interactive confirmation")
    .option("--home <dir>", "Override home directory path")
    .option("--all-workspaces", "Prune threads across all workspaces")
    .action(async (countArg: string, options: ThreadSubcommandOptions, cmd: Command) => {
      const mergedOptions = { ...cmd.optsWithGlobals(), ...options };
      const home = resolveHomeDirectory(mergedOptions.home);
      const store = new FileThreadStore({ homeDirectory: home });

      const parsedCount = parseInt(countArg, 10);
      if (!Number.isFinite(parsedCount) || (parsedCount <= 0 && parsedCount !== -1)) {
        writeToStderr(
          `Error: Invalid prune count "${countArg}". Provide a positive integer or -1 for all.\n`,
        );
        process.exit(1);
      }

      try {
        const allThreads = await store.listThreads(
          mergedOptions.allWorkspaces ? undefined : { workingDirectory: process.cwd() },
        );

        if (allThreads.length === 0) {
          writeToStdout("No threads available to prune.\n");
          return;
        }

        // Sort oldest first (ascending by updatedAt)
        const sortedOldestFirst = [...allThreads].sort(
          (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
        );

        const targetThreads =
          parsedCount === -1 ? sortedOldestFirst : sortedOldestFirst.slice(0, parsedCount);

        // Interactive confirmation if running in interactive TTY without --yes
        if (!mergedOptions.yes) {
          if (process.stdin.isTTY === true) {
            const rl = createInterface({ input: process.stdin, output: process.stdout });
            const promptMsg = `Are you sure you want to permanently prune ${targetThreads.length} thread(s)? [y/N] `;
            const answer = await rl.question(promptMsg);
            rl.close();
            if (answer.trim().toLowerCase() !== "y" && answer.trim().toLowerCase() !== "yes") {
              writeToStdout("Prune operation aborted.\n");
              return;
            }
          } else {
            writeToStderr(
              "Error: Pruning requires confirmation. Pass --yes to confirm in non-interactive environments.\n",
            );
            process.exit(1);
          }
        }

        let prunedCount = 0;
        for (const t of targetThreads) {
          const removed = await store.deleteThread(t.id);
          if (removed) {
            prunedCount++;
          }
        }

        writeToStdout(`Pruned ${prunedCount} thread(s).\n`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeToStderr(`Failed to prune threads: ${msg}\n`);
        process.exit(1);
      }
    });

  // Subcommand: delete <id>
  thread
    .command("delete <id>")
    .description("Delete a conversation thread session")
    .option("--home <dir>", "Override home directory path")
    .option("-f, --force", "Force deletion without additional validation")
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

  return thread;
}
