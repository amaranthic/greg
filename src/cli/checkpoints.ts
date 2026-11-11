/**
 * @fileoverview Subcommands for inspecting and restoring content-addressed delta checkpoints.
 * @packageDocumentation
 */

import { Command } from "commander";
import { FileCheckpointStore, FileThreadStore } from "@amaranthic/hernex";
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
 * Creates the commander Command for the `checkpoints` subcommand tree.
 *
 * @returns Fully configured commander Command instance for `checkpoints`.
 *
 * @example
 * ```typescript
 * const checkpointsCmd = createCheckpointsCommand();
 * program.addCommand(checkpointsCmd);
 * ```
 */
export function createCheckpointsCommand(): Command {
  const checkpoints = new Command("checkpoints").description(
    "Inspect and restore content-addressed workspace file delta snapshots",
  );

  checkpoints
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

  checkpoints
    .command("restore <id>")
    .description("Restore workspace files to their recorded pre-mutation state")
    .option("-t, --thread <id>", "Safe thread identifier (defaults to latest thread in workspace)")
    .option("--dryRun", "Preflight inspect the restoration plan without touching disk files")
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
        const list = await checkpointStore.listCheckpoints(threadId);
        const matched = list.find((cp) => String(cp.sequence) === id || cp.id === id);
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

  return checkpoints;
}
