/**
 * @fileoverview Subcommands for inspecting and restoring content-addressed delta checkpoints.
 * @packageDocumentation
 */

import { defineCommand } from "citty";
import { FileCheckpointStore, FileThreadStore } from "@amaranthic/hernex";
import { resolveHomeDirectory } from "../settings/index.js";
import { writeToStderr, writeToStdout } from "../utils/index.js";

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
 * Command for listing recorded snapshots for a thread session.
 */
export const checkpointsListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List recorded file checkpoints for a thread",
  },
  args: {
    thread: {
      type: "string",
      description: "Safe thread identifier (defaults to latest thread in workspace)",
    },
    home: {
      type: "string",
      description: "Override home directory path",
    },
  },
  async run({ args }) {
    const home = resolveHomeDirectory(args.home);
    const threadStore = new FileThreadStore({ homeDirectory: home });
    const checkpointStore = new FileCheckpointStore({ homeDirectory: home });

    let threadId: string;
    try {
      threadId = await resolveTargetThreadId(threadStore, args.thread);
    } catch (err) {
      writeToStderr(`${(err as Error).message}\n`);
      process.exit(1);
    }

    const checkpoints = await checkpointStore.listCheckpoints(threadId);

    if (checkpoints.length === 0) {
      writeToStdout(`No checkpoints recorded for thread "${threadId}".\n`);
      return;
    }

    const payload = checkpoints.map((cp) => ({
      sequence: cp.sequence,
      id: cp.id,
      label: cp.label,
      turnIndex: cp.turnIndex,
      filesCount: cp.files.length,
      createdAt: new Date(cp.timestamp).toISOString(),
    }));

    writeToStdout(JSON.stringify(payload, null, 2) + "\n");
  },
});

/**
 * Command for evaluating or restoring files back to a previous checkpoint state.
 */
export const checkpointsRestoreCommand = defineCommand({
  meta: {
    name: "restore",
    description: "Restore workspace files to their recorded pre-mutation state",
  },
  args: {
    id: {
      type: "positional",
      description: "Safe checkpoint identifier to restore",
      required: true,
    },
    thread: {
      type: "string",
      description: "Safe thread identifier (defaults to latest thread in workspace)",
    },
    dryRun: {
      type: "boolean",
      description: "Preflight inspect the restoration plan without touching disk files",
      default: false,
    },
    force: {
      type: "boolean",
      description: "Force restore, overwriting uncommitted external conflicting changes",
      default: false,
    },
    home: {
      type: "string",
      description: "Override home directory path",
    },
  },
  async run({ args }) {
    const home = resolveHomeDirectory(args.home);
    const threadStore = new FileThreadStore({ homeDirectory: home });
    const checkpointStore = new FileCheckpointStore({ homeDirectory: home });
    const workingDirectory = process.cwd();

    let threadId: string;
    try {
      threadId = await resolveTargetThreadId(threadStore, args.thread);
    } catch (err) {
      writeToStderr(`${(err as Error).message}\n`);
      process.exit(1);
    }

    if (args.dryRun) {
      try {
        const plan = await checkpointStore.planRestore(threadId, args.id, workingDirectory);
        writeToStdout(JSON.stringify(plan, null, 2) + "\n");
      } catch (planError) {
        writeToStderr(`Failed to plan restore: ${(planError as Error).message}\n`);
        process.exit(1);
      }
      return;
    }

    try {
      const outcome = await checkpointStore.restoreCheckpoint(threadId, args.id, workingDirectory, {
        force: args.force,
      });
      writeToStdout(
        `Successfully restored checkpoint "${args.id}". Restored: ${outcome.filesRestored}, Deleted: ${outcome.filesDeleted}, Overwritten: ${outcome.conflictsOverwritten}\n`,
      );
    } catch (restoreError) {
      writeToStderr(`Restore failed: ${(restoreError as Error).message}\n`);
      process.exit(1);
    }
  },
});

/**
 * Top-level checkpoints command bundling listing and rollback subcommands.
 */
export const checkpointsCommand = defineCommand({
  meta: {
    name: "checkpoints",
    description: "Inspect and restore content-addressed workspace file delta snapshots",
  },
  subCommands: {
    list: checkpointsListCommand,
    restore: checkpointsRestoreCommand,
  },
});
