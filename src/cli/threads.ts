/**
 * @fileoverview Subcommands for inspecting and managing conversation thread sessions.
 * @packageDocumentation
 */

import { defineCommand } from "citty";
import { FileThreadStore } from "@amaranthic/hernex";
import { resolveHomeDirectory } from "../settings/index.js";
import { writeToStderr, writeToStdout } from "../utils/index.js";

/**
 * Command for listing stored thread sessions.
 */
export const threadsListCommand = defineCommand({
  meta: {
    name: "list",
    description: "List persisted conversation threads",
  },
  args: {
    home: {
      type: "string",
      description: "Override home directory path",
    },
    limit: {
      type: "string",
      description: "Maximum number of threads to list",
      default: "20",
    },
  },
  async run({ args }) {
    const home = resolveHomeDirectory(args.home);
    const store = new FileThreadStore({ homeDirectory: home });
    const limit = parseInt(args.limit, 10);

    const threads = await store.listThreads({
      workingDirectory: process.cwd(),
      limit: Number.isFinite(limit) ? limit : 20,
    });

    if (threads.length === 0) {
      writeToStdout("No active threads found for this workspace.\n");
      return;
    }

    const payload = threads.map((t) => ({
      id: t.id,
      title: t.title ?? "(untitled)",
      turnCount: t.turnCount,
      model: t.model ?? "unknown",
      status: t.status,
      updatedAt: t.updatedAt,
    }));

    writeToStdout(JSON.stringify(payload, null, 2) + "\n");
  },
});

/**
 * Command for displaying detailed metadata for a single thread.
 */
export const threadsShowCommand = defineCommand({
  meta: {
    name: "show",
    description: "Display metadata and status for a specific thread",
  },
  args: {
    id: {
      type: "positional",
      description: "Safe thread identifier",
      required: true,
    },
    home: {
      type: "string",
      description: "Override home directory path",
    },
  },
  async run({ args }) {
    const home = resolveHomeDirectory(args.home);
    const store = new FileThreadStore({ homeDirectory: home });

    const metadata = await store.getThread(args.id);
    if (!metadata) {
      writeToStderr(`Thread "${args.id}" not found.\n`);
      process.exit(1);
    }

    writeToStdout(JSON.stringify(metadata, null, 2) + "\n");
  },
});

/**
 * Command for deleting a thread session and its associated persistent artifacts.
 */
export const threadsDeleteCommand = defineCommand({
  meta: {
    name: "delete",
    description: "Delete a conversation thread session",
  },
  args: {
    id: {
      type: "positional",
      description: "Safe thread identifier to delete",
      required: true,
    },
    home: {
      type: "string",
      description: "Override home directory path",
    },
  },
  async run({ args }) {
    const home = resolveHomeDirectory(args.home);
    const store = new FileThreadStore({ homeDirectory: home });

    const removed = await store.deleteThread(args.id);
    if (removed) {
      writeToStdout(`Deleted thread "${args.id}".\n`);
    } else {
      writeToStderr(`Thread "${args.id}" not found.\n`);
      process.exit(1);
    }
  },
});

/**
 * Top-level threads command bundling all session management operations.
 */
export const threadsCommand = defineCommand({
  meta: {
    name: "threads",
    description: "Manage persistent conversation threads and session transcripts",
  },
  subCommands: {
    list: threadsListCommand,
    show: threadsShowCommand,
    delete: threadsDeleteCommand,
  },
});
