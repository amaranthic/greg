/**
 * @fileoverview Subcommands for inspecting and restoring content-addressed delta checkpoints.
 * @packageDocumentation
 */

import { Command } from "commander";
import { FileCheckpointStore, FileThreadStore, type CheckpointRecord } from "@amaranthic/hernex";
import { resolveHomeDirectory } from "../settings/index.js";
import { writeToStderr, writeToStdout } from "../utils/index.js";

/**
 * Options common to checkpoint subcommands.
 */
export interface CheckpointSubcommandOptions {
  /** Target thread ID. */
  readonly thread?: string | undefined;
  /** Optional home directory override. */
  readonly home?: string | undefined;
  /** Whether to preflight dry-run restoration plan. */
  readonly dryRun?: boolean | undefined;
  /** Whether to force restoration over uncommitted conflicts. */
  readonly force?: boolean | undefined;
  /** Whether to output structured JSON. */
  readonly json?: boolean | undefined;
}

/**
 * Resolves the thread identifier to target, either from explicit argument or by finding latest thread.
 *
 * @param store - Thread store instance.
 * @param explicitThreadId - Optional explicit thread ID.
 * @returns Resolved thread ID or throws if none found.
 */
async function resolveTargetThreadId(
  store: FileThreadStore,
  explicitThreadId?: string,
): Promise<string> {
  if (explicitThreadId && explicitThreadId.trim().length > 0) {
    return explicitThreadId.trim();
  }

  const latestThreads = await store.listThreads({
    workingDirectory: process.cwd(),
    limit: 1,
  });

  if (latestThreads.length > 0 && latestThreads[0]) {
    return latestThreads[0].id;
  }

  throw new Error(
    "No existing thread found for the current workspace. Pass --thread <id> explicitly.",
  );
}

/**
 * Resolves a checkpoint record by either sequence number or unique ID string.
 *
 * @param store - Checkpoint store instance.
 * @param threadId - Safe thread identifier.
 * @param identifier - Sequence number or UUID identifier string.
 * @returns Matched CheckpointRecord or undefined if not found.
 */
async function resolveCheckpointByIdOrSequence(
  store: FileCheckpointStore,
  threadId: string,
  identifier: string,
): Promise<CheckpointRecord | undefined> {
  const allCheckpoints = await store.listCheckpoints(threadId);
  return allCheckpoints.find((cp) => String(cp.sequence) === identifier || cp.id === identifier);
}

/**
 * Creates the commander Command for the `checkpoint` subcommand tree (with legacy `checkpoints` alias).
 *
 * @returns Fully configured commander Command instance for `checkpoint`.
 *
 * @example
 * ```typescript
 * const checkpointCmd = createCheckpointsCommand();
 * program.addCommand(checkpointCmd);
 * ```
 */
export function createCheckpointsCommand(): Command {
  const checkpoint = new Command("checkpoint")
    .alias("checkpoints")
    .description("Inspect and restore content-addressed workspace file delta snapshots");

  // Subcommand: list
  checkpoint
    .command("list")
    .description("List recorded file checkpoints for a thread")
    .option("-t, --thread <id>", "Safe thread identifier (defaults to latest thread in workspace)")
    .option("--home <dir>", "Override home directory path")
    .action(async (options: CheckpointSubcommandOptions, cmd: Command) => {
      const mergedOptions = { ...cmd.optsWithGlobals(), ...options };
      const home = resolveHomeDirectory(mergedOptions.home);
      const threadStore = new FileThreadStore({ homeDirectory: home });
      const checkpointStore = new FileCheckpointStore({ homeDirectory: home });

      let threadId: string;
      try {
        threadId = await resolveTargetThreadId(threadStore, options.thread);
      } catch (err) {
        writeToStderr(`${(err as Error).message}\n`);
        process.exit(1);
      }

      try {
        const recordedCheckpoints = await checkpointStore.listCheckpoints(threadId);

        if (recordedCheckpoints.length === 0) {
          writeToStdout(`No checkpoints recorded for thread "${threadId}".\n`);
          return;
        }

        const payload = recordedCheckpoints.map((cp) => ({
          sequence: cp.sequence,
          id: cp.id,
          label: cp.label,
          turnIndex: cp.turnIndex,
          filesCount: cp.files.length,
          createdAt: new Date(cp.timestamp).toISOString(),
        }));

        writeToStdout(JSON.stringify(payload, null, 2) + "\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeToStderr(`Failed to list checkpoints: ${msg}\n`);
        process.exit(1);
      }
    });

  // Subcommand: show <id>
  checkpoint
    .command("show <id>")
    .description("Show detailed metadata and file entries for a specific checkpoint")
    .option("-t, --thread <id>", "Safe thread identifier (defaults to latest thread in workspace)")
    .option("--home <dir>", "Override home directory path")
    .action(async (id: string, options: CheckpointSubcommandOptions, cmd: Command) => {
      const mergedOptions = { ...cmd.optsWithGlobals(), ...options };
      const home = resolveHomeDirectory(mergedOptions.home);
      const threadStore = new FileThreadStore({ homeDirectory: home });
      const checkpointStore = new FileCheckpointStore({ homeDirectory: home });

      let threadId: string;
      try {
        threadId = await resolveTargetThreadId(threadStore, options.thread);
      } catch (err) {
        writeToStderr(`${(err as Error).message}\n`);
        process.exit(1);
      }

      try {
        const matched = await resolveCheckpointByIdOrSequence(checkpointStore, threadId, id);
        if (!matched) {
          writeToStderr(`Checkpoint "${id}" not found for thread "${threadId}".\n`);
          process.exit(1);
        }

        writeToStdout(JSON.stringify(matched, null, 2) + "\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeToStderr(`Failed to show checkpoint "${id}": ${msg}\n`);
        process.exit(1);
      }
    });

  // Subcommand: diff <id>
  checkpoint
    .command("diff <id>")
    .description("Show file mutation actions and hash transitions recorded in a checkpoint")
    .option("-t, --thread <id>", "Safe thread identifier (defaults to latest thread in workspace)")
    .option("--home <dir>", "Override home directory path")
    .option("--json", "Emit structured diff payload as JSON")
    .action(async (id: string, options: CheckpointSubcommandOptions, cmd: Command) => {
      const mergedOptions = { ...cmd.optsWithGlobals(), ...options };
      const home = resolveHomeDirectory(mergedOptions.home);
      const threadStore = new FileThreadStore({ homeDirectory: home });
      const checkpointStore = new FileCheckpointStore({ homeDirectory: home });

      let threadId: string;
      try {
        threadId = await resolveTargetThreadId(threadStore, options.thread);
      } catch (err) {
        writeToStderr(`${(err as Error).message}\n`);
        process.exit(1);
      }

      try {
        const matched = await resolveCheckpointByIdOrSequence(checkpointStore, threadId, id);
        if (!matched) {
          writeToStderr(`Checkpoint "${id}" not found for thread "${threadId}".\n`);
          process.exit(1);
        }

        const fileDiffs = matched.files.map((file) => {
          let action: "created" | "deleted" | "modified" | "unchanged";
          if (file.beforeHash === null && file.afterHash !== null) {
            action = "created";
          } else if (file.beforeHash !== null && file.afterHash === null) {
            action = "deleted";
          } else if (file.beforeHash !== file.afterHash) {
            action = "modified";
          } else {
            action = "unchanged";
          }
          return {
            relativePath: file.relativePath,
            action,
            beforeHash: file.beforeHash,
            afterHash: file.afterHash,
          };
        });

        if (mergedOptions.json) {
          const payload = {
            checkpointId: matched.id,
            sequence: matched.sequence,
            label: matched.label,
            files: fileDiffs,
          };
          writeToStdout(JSON.stringify(payload, null, 2) + "\n");
          return;
        }

        // Clean human git-style summary
        const lines: string[] = [
          `Checkpoint: ${matched.sequence} (${matched.id})`,
          `Label: ${matched.label}`,
          `Created: ${new Date(matched.timestamp).toISOString()}`,
          "",
        ];

        for (const diff of fileDiffs) {
          const indicator =
            diff.action === "created"
              ? "A"
              : diff.action === "deleted"
                ? "D"
                : diff.action === "modified"
                  ? "M"
                  : " ";
          const beforeSnippet = diff.beforeHash ? diff.beforeHash.slice(0, 8) : "none";
          const afterSnippet = diff.afterHash ? diff.afterHash.slice(0, 8) : "none";
          lines.push(`  ${indicator}  ${diff.relativePath} (${beforeSnippet} -> ${afterSnippet})`);
        }

        writeToStdout(lines.join("\n") + "\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeToStderr(`Failed to compute diff for checkpoint "${id}": ${msg}\n`);
        process.exit(1);
      }
    });

  // Subcommand: restore <id>
  checkpoint
    .command("restore <id>")
    .description("Restore workspace files to their recorded pre-mutation state")
    .option("-t, --thread <id>", "Safe thread identifier (defaults to latest thread in workspace)")
    .option("--dry-run", "Preflight inspect the restoration plan without touching disk files")
    .option("--force", "Force restore, overwriting uncommitted external conflicting changes")
    .option("--home <dir>", "Override home directory path")
    .action(async (id: string, options: CheckpointSubcommandOptions, cmd: Command) => {
      const mergedOptions = { ...cmd.optsWithGlobals(), ...options };
      const home = resolveHomeDirectory(mergedOptions.home);
      const threadStore = new FileThreadStore({ homeDirectory: home });
      const checkpointStore = new FileCheckpointStore({ homeDirectory: home });
      const workingDirectory = process.cwd();

      let threadId: string;
      try {
        threadId = await resolveTargetThreadId(threadStore, options.thread);
      } catch (err) {
        writeToStderr(`${(err as Error).message}\n`);
        process.exit(1);
      }

      let effectiveCheckpointId = id;
      try {
        const matched = await resolveCheckpointByIdOrSequence(checkpointStore, threadId, id);
        if (matched) {
          effectiveCheckpointId = matched.id;
        } else if (/^\d+$/.test(id)) {
          writeToStderr(`Failed to plan restore: Checkpoint not found: "${id}"\n`);
          process.exit(1);
        }
      } catch (listError) {
        const msg = listError instanceof Error ? listError.message : String(listError);
        writeToStderr(`Failed to inspect checkpoints: ${msg}\n`);
        process.exit(1);
      }

      if (options.dryRun) {
        try {
          const plan = await checkpointStore.planRestore(
            threadId,
            effectiveCheckpointId,
            workingDirectory,
          );
          writeToStdout(JSON.stringify(plan, null, 2) + "\n");
        } catch (planError) {
          writeToStderr(`Failed to plan restore: ${(planError as Error).message}\n`);
          process.exit(1);
        }
        return;
      }

      try {
        const outcome = await checkpointStore.restoreCheckpoint(
          threadId,
          effectiveCheckpointId,
          workingDirectory,
          {
            ...(options.force !== undefined ? { force: options.force } : {}),
          },
        );
        writeToStdout(
          `Successfully restored checkpoint "${id}". Restored: ${outcome.filesRestored}, Deleted: ${outcome.filesDeleted}, Overwritten: ${outcome.conflictsOverwritten}\n`,
        );
      } catch (restoreError) {
        writeToStderr(`Restore failed: ${(restoreError as Error).message}\n`);
        process.exit(1);
      }
    });

  return checkpoint;
}
