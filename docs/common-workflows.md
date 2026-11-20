---
title: "Common Workflows"
description: "Step-by-step recipes for exploring codebases, fixing bugs, refactoring, writing tests, piping data, and running CI pipelines with greg."
---

This guide collects practical, battle-tested recipes for everyday development with `greg`. Because `greg` is designed as a **print agent** that conforms strictly to the Unix philosophy—reading from `stdin`, streaming clean answers to `stdout`, isolating diagnostic logs to `stderr`, and managing state through content-addressed checkpoints—it fits seamlessly into interactive terminals, shell scripts, and automated CI pipelines alike.

<Note>
For deep dives on session persistence and time-travel rollback mechanics, see [Managing Threads](/threads). For configuring model providers and API keys, see [Managing Providers](/model-providers).
</Note>

This page covers:

- [Prompt Recipes](#prompt-recipes): Step-by-step patterns for exploring unfamiliar code, debugging errors, refactoring, writing test suites, and handling PR reviews.
- [Plan Before Editing](#plan-before-editing): Reconnaissance mode to inspect proposed architectural changes before touching disk files.
- [Resume Conversations & Iterative Sittings](#resume-conversations-iterative-sittings): Continuing tasks across multiple commands with `-c` and `-r`.
- [Snapshot Rollbacks with Checkpoints](#snapshot-rollbacks-with-checkpoints): Preflighting diffs and restoring previous workspace states.
- [Run Parallel Sessions with Git Worktrees](#run-parallel-sessions-with-git-worktrees): Running concurrent agent turns without branch collisions.
- [Unix Pipelines & Shell Automation](#unix-pipelines-shell-automation): Piping `stdin`, filtering structured JSON, and handling POSIX exit codes in shell scripts.

---

## Prompt Recipes

These prompt patterns tackle core development tasks. Run them directly in your shell or adapt the wording to your repository conventions.

### Understand New Codebases

When joining a new project or auditing an unfamiliar service, use `greg` to quickly map the architecture, identify key entry points, and trace execution flows.

#### 1. Get a High-Level Architecture Overview

Navigate to the project root and ask `greg` to inspect the directory layout and explain the core patterns:

```bash
cd /path/to/project

greg "Give me a high-level overview of this codebase. What are the key architectural layers, entry points, and design patterns used here?"
```

`greg` activates `Glob`, `Read`, and language server analysis (`Lsp`) to inspect configuration files, package manifests, and directory trees before producing a structured breakdown.

#### 2. Find Relevant Code & Symbols

Pinpoint where specific business logic lives without searching manually through thousands of lines:

```bash
greg "Where is user session authentication and token validation implemented? List the relevant files and describe how the auth middleware interacts with the database."
```

#### 3. Trace Execution Flow

Trace how data moves from an external request down to storage:

```bash
greg "Trace the checkout workflow from the HTTP route handler in src/routes/checkout.ts through the billing service to the payment gateway integration. Highlight any retry or rollback logic."
```

<Tip>
**Enabling & Configuring Language Servers**: `greg` includes built-in LSP integration for TypeScript, Python, Rust, Go, CSS, HTML, and JSON to achieve compiler-grade definition navigation and type checking.

By default, `enableLsp` is `false` to optimize startup time. To enable LSP code intelligence globally:

```bash
greg config set enableLsp true
```

Language servers can be inspected, customized, or registered using the `greg lsp` subcommand tree:

```bash
# List all registered LSP servers
greg lsp list

# Register a custom language server (e.g. gopls for Go)
greg lsp add gopls --command gopls --extensions .go

# Register TypeScript LSP with custom arguments and environment variables
greg lsp add typescript \
  --command typescript-language-server \
  --args --stdio \
  --extensions .ts .tsx \
  --env NODE_ENV=development

# Remove a registered language server
greg lsp remove gopls
```

To run a prompt without language server overhead or to disable LSP for a single execution, pass the `--disable-lsp` flag:

```bash
greg "Give me a high-level overview of src/utils/format.ts" --disable-lsp
```

</Tip>

---

### Fix Bugs Efficiently

Resolve test regressions, runtime exceptions, and type errors by giving `greg` reproduction steps and allowing safe, verified edits.

#### 1. Pipe the Error Stack Trace Directly into Greg

Pipe your failing test output or application crash log straight into `greg` via `stdin`:

```bash
bun test | greg "A test is failing in our test suite. Analyze the stack trace from stdin, identify the root cause, and explain what needs to be fixed."
```

Because `greg` ingests piped standard input automatically, you don't need to copy and paste lengthy stack traces into string literals.

#### 2. Apply Surgical Edits with `--permission-mode acceptEdits`

Once you understand the fix, authorize `greg` to edit workspace files directly while restricting arbitrary shell commands:

```bash
greg "Fix the null pointer exception in src/services/user.ts when avatarUrl is undefined. Add defensive fallbacks." \
  --permission-mode acceptEdits
```

#### 3. Verify the Fix with Scoped Tool Permissions

Instruct `greg` to apply the fix and verify it immediately by running your test runner using `--allowed-tools`:

```bash
greg "Fix the race condition in src/queue/worker.ts and run the test suite to verify the fix passes." \
  --permission-mode acceptEdits \
  --allowed-tools "Bash(bun test *)"
```

Here, `greg` can mutate files and run `bun test`, but cannot execute any unauthorized shell commands (like `rm` or `curl`).

<Tip>
If `greg`'s edits introduce unexpected regressions, you can instantly revert the workspace with `greg checkpoints restore 1`. See [Snapshot Rollbacks](#snapshot-rollbacks-with-checkpoints).
</Tip>

---

### Refactor & Modernize Code

Modernize legacy patterns, migrate deprecated API calls, and maintain consistency across large codebases.

#### 1. Identify Legacy or Deprecated Code

Search for outdated patterns across your repository:

```bash
greg "Audit src/ for deprecated Node.js crypto methods (like crypto.createCipher) or outdated Promise patterns. List all files requiring modernization."
```

#### 2. Execute Multi-File Modernization

Execute the refactor across affected modules with auto-approved file edits:

```bash
greg "Refactor all usages of callbacks in src/utils/fs.ts to use async/await and node:fs/promises. Ensure all exported function signatures retain backward compatibility." \
  --permission-mode acceptEdits
```

#### 3. Verify Formatting & Type Checking

Ensure your refactored code passes type checks and linter rules:

```bash
greg "Run typecheck and linter, then fix any type errors or lint warnings introduced by our refactor." \
  --permission-mode acceptEdits \
  --allowed-tools "Bash(npm run typecheck)" "Bash(npm run lint -- --fix)"
```

---

### Work with Tests

Generate robust, framework-idiomatic unit and integration tests that mirror your existing testing conventions.

#### 1. Identify Untested Code Paths

Ask `greg` to analyze test coverage and highlight missed edge cases:

```bash
greg "Compare src/auth/token.ts against tests/auth/token.test.ts. Which helper functions or edge cases (e.g. expired tokens, malformed headers, clock skew) lack test coverage?"
```

#### 2. Generate Test Suites Matching Project Patterns

Direct `greg` to scaffold tests following existing style, assertions, and mock helpers:

```bash
greg "Add comprehensive unit tests for src/auth/token.ts in tests/auth/token.test.ts. Follow the existing Vitest patterns used in other tests/ files, covering invalid signatures, token expiry, and empty payloads." \
  --permission-mode acceptEdits
```

#### 3. Run and Iterate on Test Failures

Instruct `greg` to execute the new test suite and iterate until every assertion passes:

```bash
greg "Run the new token tests. If any tests fail, inspect the failure output, update the test mocks or implementation, and re-run until all tests pass." \
  --permission-mode acceptEdits \
  --allowed-tools "Bash(npm test -- tests/auth/token.test.ts)"
```

---

### Git & Pull Request Workflows

Generate release notes, conventional commit messages, and detailed PR descriptions directly from your Git working tree.

#### 1. Generate Conventional Commit Messages

Pipe your staged Git diff into `greg` to produce a concise, semantic commit message:

```bash
git diff --staged | greg "Generate a single Conventional Commits message (e.g. feat(auth): ..., fix(db): ...) summarizing these staged changes. Output only the commit message."
```

You can commit directly in one line:

```bash
git commit -m "$(git diff --staged | greg 'Draft a conventional commit message for these changes. Output ONLY the message subject and body.')"
```

#### 2. Draft Comprehensive Pull Request Descriptions

Generate a structured markdown description for your pull request:

```bash
git diff main...HEAD | greg "Draft a GitHub pull request description for these changes. Include an Overview, Key Changes bullet points, and Testing Verification steps." > .github/pull_request_template.md
```

#### 3. Review Staged Changes for Security & Performance

Audit your diff before pushing to remote:

```bash
git diff origin/main | greg "Review this diff for security vulnerabilities, secret leaks, performance bottlenecks, or unhandled edge cases. Group findings by severity."
```

---

## Plan Before Editing

For complex tasks involving architectural changes or high-risk modifications, use **Plan Mode** (`--permission-mode plan`).

In plan mode, `greg` runs in reconnaissance:

- Write and execute tools (`Write`, `Edit`, `Bash`) are completely hidden from the model.
- Only read-only tools (`Read`, `Glob`, `Grep`, `Lsp`, `WebFetch`, `WebSearch`) are active.
- `greg` inspects files, maps dependencies, and presents a detailed implementation blueprint without touching a single file on disk.

### Step 1: Run in Plan Mode

```bash
greg "We need to migrate our database client from Prisma to Kysely. Formulate a comprehensive, step-by-step migration plan covering schema generation, connection pooling, and query updates." \
  --permission-mode plan
```

`greg` will explore your repository and stream a structured plan to `stdout`:

```markdown
### Migration Blueprint: Prisma to Kysely

1. **Dependencies**:
   - Install `kysely` and `pg`.
   - Keep `@prisma/client` temporarily for backward compatibility.
2. **Database Connection**:
   - Create `src/db/kysely.ts` with a PostgresDialect pool.
3. **Type Generation**:
   - Add `kysely-codegen` script to `package.json`.
4. **Query Migration Order**:
   - Migrate `src/repositories/userRepository.ts` first as a proof of concept.
   - Run existing repository tests to verify query parity.
```

### Step 2: Execute the Approved Plan

Once you have reviewed the plan, execute the first step with auto-approved file edits:

```bash
greg -c "Proceed with Step 2: create src/db/kysely.ts configured with PostgresDialect and environment-based pool settings." \
  --permission-mode acceptEdits
```

---

## Resume Conversations & Iterative Sittings

Tasks often require multi-turn refinement. `greg` maintains workspace-scoped conversation threads so you never have to repeat context.

### Continue the Latest Workspace Session (`-c`)

Use the `-c` (or `--continue`) flag to pick up right where your last command left off:

```bash
# Turn 1: Scaffold interface
greg "Create a PaymentGateway interface in src/billing/types.ts with charge, refund, and verify methods." \
  --permission-mode acceptEdits

# Turn 2: Continue in the same thread
greg -c "Now implement a StripePaymentGateway in src/billing/stripe.ts implementing that interface." \
  --permission-mode acceptEdits

# Turn 3: Add unit tests
greg -c "Write unit tests for StripePaymentGateway using mocked stripe SDK calls." \
  --permission-mode acceptEdits \
  --allowed-tools "Bash(npm test)"
```

### Resume a Specific Historical Thread (`-r`)

If you switch branches or work on multiple features concurrently, list your workspace threads and resume any session by its ID:

```bash
# List recent threads
greg threads list

# Output:
# [
#   {
#     "id": "7b2c6114-d89e-4906-9f99-0d3b81d92875",
#     "title": "Create a PaymentGateway interface in src/billing/types.ts",
#     "updatedAt": "2026-11-19T10:15:00Z"
#   }
# ]

# Resume by ID
greg -r "7b2c6114-d89e-4906-9f99-0d3b81d92875" "Add webhook signature verification to the stripe gateway." \
  --permission-mode acceptEdits
```

### Time-Travel Branching (`--resume-session-at`)

If a solution took a wrong turn, you can fork or step back to an earlier message turn without re-running earlier steps:

```bash
# Truncate conversation history to turn 2 and explore an alternate implementation
greg -r "7b2c6114-d89e-4906-9f99-0d3b81d92875" --resume-session-at 2 \
  "Instead of Stripe, let's implement a BraintreePaymentGateway class." \
  --permission-mode acceptEdits
```

---

## Snapshot Rollbacks with Checkpoints

Whenever `greg` modifies or writes files, it automatically records content-addressed SHA-256 pre-mutation snapshots using Hernex's `FileCheckpointStore`. If an agent run produces undesirable changes, you can inspect the diff and restore your workspace safely.

### 1. List Recorded Checkpoints

View the checkpoints captured during your current or latest session:

```bash
greg checkpoints list
```

Output:

```text
Available checkpoints for thread "7b2c6114-d89e-4906-9f99-0d3b81d92875":
  #1 [2026-11-19T10:14:22Z] (id: a1b2c3d4) Files modified: 2, created: 1
  #2 [2026-11-19T10:16:05Z] (id: e5f6a7b8) Files modified: 1, created: 0
```

### 2. Inspect the File Diff

Inspect the unified diff between your current workspace files and the recorded checkpoint:

```bash
greg checkpoints diff 1
```

### 3. Preflight Dry-Run Restoration

Verify which files will be overwritten or restored before touching disk:

```bash
greg checkpoints restore 1 --dry-run
```

Output:

```json
{
  "threadId": "7b2c6114-d89e-4906-9f99-0d3b81d92875",
  "checkpointId": "a1b2c3d4",
  "filesToRestore": ["src/billing/types.ts", "src/billing/stripe.ts"],
  "filesToDelete": ["src/billing/stripe.test.ts"],
  "conflicts": []
}
```

### 4. Execute Restoration

Instantly revert the workspace back to the snapshot state:

```bash
greg checkpoints restore 1
```

---

## Run Parallel Sessions with Git Worktrees

When working on multiple features or running long-running agent tasks simultaneously, avoid branch collisions by combining `greg` with Git worktrees.

Because `greg` scopes threads and checkpoints to `process.cwd()`, each worktree operates as a completely isolated workspace with its own conversation history and rollback tree.

### 1. Create a New Git Worktree

```bash
git worktree add ../project-auth-refactor -b feature/auth-refactor
cd ../project-auth-refactor
```

### 2. Run Greg in the Isolated Worktree

```bash
greg "Refactor JWT token parsing to support RS256 asymmetric keys." \
  --permission-mode acceptEdits \
  --allowed-tools "Bash(bun test)"
```

### 3. Work Simultaneously in Your Main Repository

While `greg` works in the worktree, your main working tree remains completely untouched:

```bash
cd /path/to/project
# Continue normal development or run a different greg task in parallel
greg "Fix CSS flexbox alignment in the navigation bar." --permission-mode acceptEdits
```

### 4. Clean Up When Finished

Once the feature branch is merged, remove the worktree:

```bash
cd /path/to/project
git worktree remove ../project-auth-refactor
```

---

## Unix Pipelines & Shell Automation

`greg` is built for command-line composability. It reads input from `stdin`, streams output to `stdout`, and sends diagnostics to `stderr`.

```
                   +------------------+
  stdin (pipes)    |                  |   stdout (clean Markdown/code)
------------------>|      greg        |-------------------------------->
                   |   Print Agent    |
                   |                  |   stderr (diagnostics & logs)
                   +------------------+-------------------------------->
```

### Stream Clean Output to Downstream Utilities

Extract data, copy to clipboard, or write directly to target files:

```bash
# Copy generated markdown directly to system clipboard (macOS / Linux)
greg "Draft release notes for v2.4.0 based on git log -n 20" | pbcopy

# Pipe generated code directly into a target file
greg "Generate a JSON schema for a customer order with items, totals, and address." > schema.json
```

### Pipe External Command Diagnostics into Greg

Diagnose build failures or linter errors without leaving the terminal:

```bash
# Ingest compiler errors directly
tsc --noEmit 2>&1 | greg "Explain each TypeScript compilation error and show how to fix them."

# Analyze Docker build errors
docker build . 2>&1 | greg "Analyze why this container build failed and suggest Dockerfile modifications."
```

### Batch Processing with Structured JSON

When integrating `greg` into CI/CD scripts or automated tools, request structured JSON output with `--output-format json`:

```bash
greg "Analyze src/routes/api.ts and return a JSON list of all exported endpoints with their HTTP methods and paths." \
  --output-format json | jq '.result'
```

For real-time streaming event pipelines, use `--output-format stream-json` to receive newline-delimited JSON events for every step, tool invocation, and token chunk.

### Shell Exit Codes in CI/CD Scripts

`greg` returns standard POSIX exit codes so your automation scripts can react deterministically:

| Exit Code | Constant           | Meaning                                                                 |
| :-------- | :----------------- | :---------------------------------------------------------------------- |
| `0`       | `success`          | Agent execution completed successfully.                                 |
| `1`       | `runtimeError`     | Runtime error, uncaught exception, or model communication failure.      |
| `2`       | `permissionDenied` | Operation aborted because a tool was denied under fail-closed security. |
| `4`       | `timeout`          | Wall-clock execution exceeded the configured `--timeout` limit.         |

Here is an example CI workflow script that runs `greg` to verify type safety and automatically exits on failure:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Running automated code review with greg..."

if ! greg "Perform a strict code audit on git diff origin/main. Report any security flaws or unhandled errors." \
  --model anthropic/claude-sonnet-4-6 \
  --timeout 120s; then
  EXIT_CODE=$?
  if [ "$EXIT_CODE" -eq 2 ]; then
    echo "Review failed: unauthorized tool execution requested."
  elif [ "$EXIT_CODE" -eq 4 ]; then
    echo "Review failed: agent timed out after 120 seconds."
  else
    echo "Review failed with runtime error code $EXIT_CODE."
  fi
  exit "$EXIT_CODE"
fi

echo "Code review completed successfully."
```
