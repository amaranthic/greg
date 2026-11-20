---
title: "Overview"
description: "greg is a post-modern autonomous print agent that reads codebases, edits files, executes tests, and seamlessly integrates with Unix terminal pipelines."
---

`greg` is an autonomous print agent built from the ground up for command-line developers. Powered by the [@amaranthic/hernex](https://github.com/amaranthic/hernex) engine, `greg` bridges frontier reasoning models to your local development environment—discovering project structure, tracing execution flows, applying multi-file code modifications, executing test suites, and rolling back changes with content-addressed snapshots.

Unlike traditional interactive terminal chat applications that trap your workflow inside a conversational loop, `greg` follows the **Unix philosophy**: it ingests context from `stdin`, streams clean answers and code to `stdout`, isolates tool execution telemetry to `stderr`, and exits with standard POSIX exit codes.

<Note>
Ready to dive straight in? Follow the [Quickstart](/quickstart) to run your first task in under two minutes, or see [Common Workflows](/common-workflows) for step-by-step developer recipes.
</Note>

This page covers:

- [The Print Agent Philosophy](#the-print-agent-philosophy): Clean stream separation, composability with Unix pipes, and scriptable automation.
- [Core Capabilities](#core-capabilities): Codebase mapping, atomic file edits, test verification, checkpoints, and multi-turn threads.
- [Quick Setup](#quick-setup): Installing the standalone binary and setting your first frontier provider.
- [Everyday Usage Patterns](#everyday-usage-patterns): Exploring, debugging, refactoring, and piping in action.
- [Architecture at a Glance](#architecture-at-a-glance): How the agent engine, policy guardrails, and checkpoint stores interact.
- [Next Steps](#next-steps): Guided links to deeper documentation.

---

## The Print Agent Philosophy

Most developer agents wrap models in heavy, stateful interactive UIs that take over your entire terminal screen. While useful for casual inquiries, this breaks the core strength of the Unix command line: **composability**.

`greg` operates as a **print agent**:

```
                   +------------------+
  stdin (pipes)    |                  |   stdout (clean Markdown/code)
------------------>|      greg        |-------------------------------->
                   |   Print Agent    |
                   |                  |   stderr (diagnostics & telemetry)
                   +------------------+-------------------------------->
```

1. **Clean Standard Output (`stdout`)**: Only the final response, generated code, or structured JSON is written to `stdout`. You can safely pipe `greg` into downstream tools (`| jq`, `| pbcopy`, `> patch.diff`) without scraping away ANSI progress bars or diagnostic chatter.
2. **Diagnostic Standard Error (`stderr`)**: Step counters, tool execution notices (`Read(src/index.ts)`, `Bash(bun test)`), LSP diagnostics, and permission warnings are routed strictly to `stderr`.
3. **Pipeline Ingestion (`stdin`)**: Pipe compiler errors, diffs, log files, or database schemas directly into `greg` without manually copying and pasting lengthy inputs into string arguments.
4. **Deterministic Exit Codes**: Emits POSIX exit codes (`0` for success, `1` for runtime error, `2` for fail-closed permission denial, `4` for timeout) so shell scripts and CI workflows can react deterministically.

---

## Core Capabilities

`greg` pairs frontier intelligence with local filesystem and execution tools:

- **Autonomous Codebase Exploration**: Employs `Glob`, `Grep`, `Read`, and native `Lsp` (Language Server Protocol) to navigate large repositories, trace definitions, and discover architectural patterns without loading thousands of irrelevant files into context.
- **Deterministic Permission Guardrails**: Runs by default in read-only mode. File edits require `--permission-mode acceptEdits`, while arbitrary shell commands can be restricted to strict wildcard patterns (e.g. `--allowed-tools "Bash(bun test *)"`).
- **Content-Addressed Delta Checkpoints**: Every file modification is automatically snapshotted before changes touch disk using Hernex's `FileCheckpointStore`. You can preflight unified diffs with `greg checkpoints diff` and roll back mistakes instantly with `greg checkpoints restore`.
- **Persistent Multi-Turn Threads**: Conversation memory is persisted per workspace. Continue tasks seamlessly across sittings with `-c`, resume by ID with `-r`, or time-travel branch with `--resume-session-at <index>`.
- **Frontier Model Agnostic**: Routes across Anthropic Claude, Google Gemini, OpenAI GPT-5, DeepSeek, Groq, OpenRouter, and local OpenAI-compatible endpoints using simple `provider/model` identifiers.

---

## Quick Setup

Get up and running with a single curl command:

### 1. Install the Native Binary

```bash
curl -fsSL https://raw.githubusercontent.com/amaranthic/greg/main/installer/install.sh | bash
```

The installer detects your OS (macOS, Linux, WSL) and architecture (Apple Silicon ARM64, x86_64), downloads the standalone release binary, and configures your `PATH`.

### 2. Configure Your Frontier Provider

Export your API key and set your default frontier model:

```bash
# Set your preferred API key
export ANTHROPIC_API_KEY="sk-ant-..."

# Configure your default model
greg config set model anthropic/claude-sonnet-4-6
```

### 3. Run Your First Task

```bash
cd /path/to/project
greg "Give me a high-level architectural overview of this project"
```

<Tip>
For detailed multi-provider configuration (including Google Gemini, OpenAI, Groq, and custom gateways), visit [Managing Providers](/model-providers).
</Tip>

---

## Everyday Usage Patterns

Here is how `greg` fits naturally into day-to-day developer workflows:

### 1. Understand Unfamiliar Code

Ask targeted questions about control flow, dependencies, or architectural patterns:

```bash
greg "Explain how authentication and session cookies are validated in this app"
```

### 2. Autonomous Bug Fixing with Test Verification

Pass reproduction steps, allow file edits, and constrain shell execution to your test runner:

```bash
greg "Fix the race condition in src/queue/worker.ts and verify the fix passes unit tests" \
  --permission-mode acceptEdits \
  --allowed-tools "Bash(bun test tests/worker.test.ts)"
```

### 3. Terminal Piping & Code Review

Pipe git changes or log files directly into `greg` for instant analysis:

```bash
# Review staged diff for security vulnerabilities or regression risks
git diff --staged | greg "Audit these staged changes for potential security flaws"

# Generate release notes and copy to clipboard
git log -n 15 --oneline | greg "Draft concise release notes from these commits" | pbcopy
```

### 4. Risk-Free Refactoring with Instant Rollback

Experiment with large-scale code modernization knowing you can revert at any moment:

```bash
# Perform refactor
greg "Refactor callback patterns in src/fs.ts to async/await" --permission-mode acceptEdits

# Inspect diff between current workspace and pre-mutation checkpoint
greg checkpoints diff 1

# Revert immediately if unwanted changes were made
greg checkpoints restore 1
```

---

## Architecture at a Glance

`greg` is built on modular components that ensure safety, persistence, and performance:

```
+-------------------------------------------------------------------------+
|                               Greg CLI                                  |
|   - Arg parsing (Commander)  - Flag resolution  - Input/Output sinks   |
+-------------------------------------------------------------------------+
                                    |
+-------------------------------------------------------------------------+
|                             Hernex Engine                               |
|   - Multi-turn execution loop  - Model routing  - Streaming handlers    |
+-------------------------------------------------------------------------+
       |                           |                          |
+---------------+          +------------------+       +-------------------+
| Policy Guard  |          | Checkpoint Store |       |   Thread Store    |
| - Fail-closed |          | - SHA-256 pre-   |       | - Persistent disk |
| - Wildcards   |          |   mutation diffs |       |   session memory  |
| - Mode checks |          | - Undo / Restore |       | - Fork / Branch   |
+---------------+          +------------------+       +-------------------+
       |                           |                          |
+-------------------------------------------------------------------------+
|                              Tool Registry                              |
|   Read | Write | Edit | Bash | Glob | Grep | Lsp | WebFetch | WebSearch |
+-------------------------------------------------------------------------+
```

---

## Next Steps

Explore the full documentation suite to master `greg`:

- [Quickstart](/quickstart): Step-by-step tutorial taking you through your first complete editing task.
- [Installation Guide](/installation): Detailed setup instructions for macOS, Linux, WSL, Android Termux, manual downloads, and source builds.
- [Managing Threads](/threads): Master session persistence, branching, transcript exports, and checkpoint rollback workflows.
- [Managing Providers](/model-providers): Configure API credentials, base URLs, reasoning effort budgets, and automatic fallback chains across 13+ providers.
- [Common Workflows](/common-workflows): Practical recipes for exploration, refactoring, test generation, and CI automation.
