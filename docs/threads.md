---
title: "Managing Threads"
description: "How greg manages persistent conversation sessions, time-travel checkpoints, transcripts, and branching."
---

Every time you execute `greg`, the agent organizes its work into a **Thread**. A thread encapsulates multi-turn conversational memory, message sequence, tool invocations, results, and associated file delta checkpoints for your task.

Unlike stateless CLI tools that forget context between commands, `greg`'s thread system allows you to build features across iterative turns, inspect file mutation diffs, branch conversations into divergent experiments, and roll back changes safely.

<Note>
Looking for practical everyday examples of continuing sessions and reverting checkpoints? See [Common Workflows](/common-workflows) for step-by-step developer recipes.
</Note>

This page covers:

* [How Threads Work](#how-threads-work): Workspace isolation, on-disk storage, automatic titles, and coupling with checkpoints.
* [Continuing & Resuming Sessions](#continuing-resuming-sessions): Continuing the latest thread (`-c`), resuming by ID (`-r`), and time-travel branching (`--resume-session-at`).
* [Time-Travel Checkpoints & Safe Undo](#time-travel-checkpoints-safe-undo): Pre-mutation SHA-256 snapshots, viewing diffs, dry-run planning, and restoring files.
* [Managing Threads Subcommand Tree (`greg threads`)](#managing-threads-subcommand-tree-greg-threads): Listing, showing, creating, resuming, forking, exporting transcripts, pruning, and deleting sessions.
* [Execution Modifiers for Threads](#execution-modifiers-for-threads): CLI flags for controlling persistence, timeouts, reasoning effort, and turn limits.
* [Next Steps](#next-steps): Next guides to explore.

---

## How Threads Work

Threads are powered by the [@amaranthic/hernex](https://github.com/amaranthic/hernex) [`FileThreadStore`](https://github.com/amaranthic/hernex) and adhere to four core architectural principles:

```
+-------------------------------------------------------------------------+
|                    Workspace Directory (process.cwd())                  |
+-------------------------------------------------------------------------+
                                    |
          +-------------------------+-------------------------+
          |                                                   |
+----------------------+                             +--------------------+
|  Conversation Thread |<===========================>| Checkpoint Store   |
|  - Transcripts       |   (Tied to Turn & Thread)   | - Pre-mutation     |
|  - Tool Invocations  |                             |   snapshots        |
|  - Model Messages    |                             | - SHA-256 Diffs    |
+----------------------+                             +--------------------+
```

1. **Workspace Scoped**: Threads are automatically tied to the directory where you execute `greg` (`process.cwd()`). When you switch between project folders, `greg` keeps their conversation histories completely isolated.
2. **Persistent on Disk**: Sessions are stored under `~/.greg/threads/<thread-id>/` (or `$HERNEX_HOME/threads/<thread-id>/`), with thread metadata in `thread.json` and append-only conversation events in `transcript.jsonl`.
3. **Automated Titles**: Thread titles are automatically derived from your initial prompt (normalized up to 80 characters).
4. **Coupled to Checkpoints**: Every thread maintains an associated checkpoint manifest at `threads/<id>/checkpoints/manifest.json` and content-addressed blobs at `blobs/sha256/<hash>`, capturing SHA-256 pre-mutation snapshots before any file write or edit touches disk.

---

## Continuing & Resuming Sessions

You can interact with existing threads using standard CLI flags:

### 1. Continue the Latest Workspace Thread (`-c`)

To continue your most recent task in the current workspace without repeating previous context:

```bash
# Turn 1: Initial task
greg "Add a UserProfile interface to src/types.ts" --permission-mode acceptEdits

# Turn 2: Continues the same thread
greg -c "Now write a mock factory for that UserProfile interface" --permission-mode acceptEdits
```

### 2. Resume a Specific Thread by ID (`-r`)

To resume any historical thread by its unique identifier:

```bash
greg -r "4f8a1234-5678-90ab-cdef-1234567890ab" "Add unit tests for the changes we made earlier"
```

### 3. Time-Travel Branching (`--resume-session-at`)

If you want to step back to an earlier point in a conversation without re-running previous turns, pass `--resume-session-at <index>`. This truncates the active message transcript to that specific turn index:

```bash
greg -r <thread-id> --resume-session-at 2 "Let's take a different approach and use a Redis cache instead"
```

<Note>
**1-Based Turn Indexing**: The `--resume-session-at <index>` flag uses 1-based indexing representing the exact count of conversational turns to keep. For example, `--resume-session-at 1` retains only the first turn, while `--resume-session-at 2` preserves the first two turns and discards subsequent turns for divergent branching.
</Note>

---

## Time-Travel Checkpoints & Safe Undo

Checkpoints protect your code by capturing exact pre-mutation file states before tools like `Write` or `Edit` modify files. Every checkpoint is bound to its parent thread and indexed by both a unique UUID and a sequential integer (`1`, `2`, `3`...).

You can manage checkpoints using the `greg checkpoints` (or `greg checkpoint`) subcommand tree:

### 1. List Recorded Checkpoints

List all file mutation checkpoints recorded for a thread:

```bash
# List checkpoints for the latest thread in the workspace
greg checkpoints list

# List checkpoints for a specific thread
greg checkpoints list -t <thread-id>
```

Output includes the sequential index, checkpoint UUID, label, turn index, number of files affected, and creation timestamp:

```json
[
  {
    "sequence": 1,
    "id": "e2a3b4c5-6789-01ab-cdef-234567890abc",
    "label": "editFile:src/types.ts",
    "turnIndex": 1,
    "filesCount": 1,
    "createdAt": "2026-11-19T13:30:00.000Z"
  }
]
```

### 2. Show Checkpoint Details

Inspect the exact metadata and file entries stored in a checkpoint:

```bash
greg checkpoints show 1
```

### 3. View Mutation Diffs (`diff`)

Review file mutation actions and SHA-256 hash transitions recorded by a checkpoint:

```bash
# Human-readable summary
greg checkpoints diff 1
```

The output displays git-style status indicators (`A` added, `D` deleted, `M` modified) alongside 8-character SHA-256 hash transitions:

```text
Checkpoint: 1 (e2a3b4c5-6789-01ab-cdef-234567890abc)
Label: editFile:src/types.ts
Created: 2026-11-19T13:30:00.000Z

  M  src/types.ts (a1b2c3d4 -> e5f6a7b8)
```

To emit machine-readable JSON for tooling:
```bash
greg checkpoints diff 1 --json
```

### 4. Restore Workspace to a Checkpoint (`restore`)

Revert your workspace files back to their recorded pre-mutation state:

```bash
# Restore using sequence number
greg checkpoints restore 1

# Restore using checkpoint UUID
greg checkpoints restore "e2a3b4c5-6789-01ab-cdef-234567890abc"
```

#### Preflight Inspection (`--dry-run`)
Before rolling back files on disk, inspect the planned restoration actions and verify potential conflicts:

```bash
greg checkpoints restore 1 --dry-run
```

Outputs the restoration plan (files to restore, delete, or potential conflicts) in JSON without touching any files on disk.

#### Force Restoration (`--force`)
If files in your workspace were modified outside of `greg` after the checkpoint was created, `greg` will guard against overwriting external changes. Pass `--force` to override conflicts:

```bash
greg checkpoints restore 1 --force
```

---

## Managing Threads Subcommand Tree (`greg threads`)

`greg` provides a comprehensive `threads` subcommand tree to inspect, branch, and maintain your session history:

### 1. List Threads
List recent threads for the current workspace (shows ID, title, turn count, model, status, and last update timestamp):

```bash
greg threads list
```

Options:
* `-n, --limit <number>`: Maximum number of threads to list (default: 20).
* `--working-directory <dir>`: Filter threads by an alternative workspace path.

### 2. Show Thread Details
View complete metadata, working directory, model, reasoning level, and turn metrics for a specific session:

```bash
greg threads show <thread-id>
```

### 3. Create a Thread Explicitly
Initialize a new persistent conversation thread before executing tasks:

```bash
greg threads create --title "User Authentication Refactor"
```

### 4. Resume a Thread via Subcommand
Resume a thread directly using the subcommand, optionally passing your next prompt:

```bash
# Display session summary and turn count
greg threads resume <thread-id>

# Execute next turn immediately
greg threads resume <thread-id> "Run the test suite now"
```

### 5. Fork a Thread for Divergent Experiments
Branch an existing session into a brand new thread. The new thread inherits the full transcript history of the parent thread, allowing you to experiment with divergent approaches without altering the original:

```bash
greg threads fork <thread-id> --title "Alternative caching implementation"
```

You can also fork up to a specific transcript sequence number using `--at-sequence`:
```bash
greg threads fork <thread-id> --at-sequence 4
```

### 6. Export Session Transcripts
Display or pipe the complete structured event log of a session (user prompts, model messages, tool calls, and outputs):

```bash
greg threads transcript <thread-id> > session-transcript.json
```

Options:
* `-n, --limit <number>`: Maximum number of entries to return.
* `--after <sequence>`: Only return transcript events recorded after this sequence number.

### 7. Prune & Purge Threads
Clean up disk space by pruning the oldest conversation threads or purging all sessions:

```bash
# Prune the 10 oldest threads in the current workspace
greg threads prune 10

# Prune across all workspaces without interactive confirmation
greg threads prune 20 -y --all-workspaces

# Purge all threads completely in the current workspace
greg threads prune -1 -y
```

<Note>
**Purging All Threads**: Pass `-1` as the count to prune all conversation threads at once. To purge threads across every project on your machine rather than just the active directory, include `--all-workspaces`:

```bash
# Purge all threads across all workspaces globally
greg threads prune -1 -y --all-workspaces
```

The `-y` (`--yes`) flag bypasses the interactive confirmation prompt (`[y/N]`) and is mandatory when executing prune commands in CI/CD pipelines or non-interactive scripts.
</Note>

### 8. Delete a Thread Permanently
Permanently delete an individual thread and its transcript history from disk:

```bash
greg threads delete <thread-id>
```

---

## Execution Modifiers for Threads

When running or resuming a thread, customize execution behavior with dedicated flags:

| Flag | Description | Example |
| :--- | :--- | :--- |
| `--no-session-persistence` | Run ephemerally in memory without writing thread logs or checkpoints to disk | `greg "Review diff" --no-session-persistence` |
| `--bare` | Suppress hooks, ambient instruction files, and persistent settings | `greg "Task" --bare` |
| `--effort <level>` | Reasoning effort (`none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`) | `greg -c "Task" --effort high` |
| `--max-turns <number>` | Ceiling for agent turn loop steps before stopping | `greg -c "Fix bug" --max-turns 15` |
| `--timeout <duration>` | Wall-clock execution timeout (e.g. `10m`, `30s`) | `greg "Refactor" --timeout 5m` |
| `--json-schema <schema>` | Enforce structured output validated against a JSON Schema | `greg "Parse logs" --json-schema '{...}'` |
| `--system-prompt <prompt>` | Override default system instructions | `greg "Task" --system-prompt "..."` |
| `--append-system-prompt <prompt>` | Append custom instructions to the active prompt | `greg "Task" --append-system-prompt "..."` |

---

## Next Steps

Now that you understand session persistence and rollback mechanics:

* [Common Workflows](/common-workflows): Explore step-by-step recipes for bug fixing, refactoring, and test automation.
* [Managing Providers](/model-providers): Configure your preferred model, reasoning effort levels, and automatic fallback chains.
* [Quickstart](/quickstart): Return to the quickstart to practice everyday agent commands.
