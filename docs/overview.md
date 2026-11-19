---
title: "Overview"
description: "greg is an autonomous print agent that reads your codebase, edits files, runs commands, and integrates with your terminal workflows."
---

> greg is an autonomous print agent that reads your codebase, edits files, runs commands, and integrates with your terminal workflows. Available directly in your terminal.

greg is an AI-powered coding assistant that helps you build features, fix bugs, and automate development tasks. It understands your entire codebase and can work across multiple files and tools to get things done.

## Get started

Install `greg` with the official installer on macOS, Linux, or WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/amaranthic/greg/main/installer/install.sh | bash
```

The installer downloads the standalone native binary and places it in your PATH. When the installer finishes, open a new terminal window and run `greg --version`.

<Note>
  You can update greg to the latest release at any time by running `greg update`.
</Note>

### Configure your provider

Set your API key and default frontier model:

```bash
# Anthropic Claude
export ANTHROPIC_API_KEY="your-api-key"
greg config set model anthropic/claude-sonnet-4-6

# Or Google Gemini
export GEMINI_API_KEY="your-api-key"
greg config set model google/gemini-3.8-flash
```

Then start greg in any project:

```bash
cd your-project
greg "Explain the project structure and key entrypoints"
```

<Tip>
  See [Quickstart](/quickstart) for a step-by-step walkthrough of your first task.
</Tip>

## What you can do

Here are some of the everyday ways you can use greg:

### Understand unfamiliar codebases

Ask questions about architecture, control flow, or specific implementations in plain language. `greg` searches files, follows imports, and explains how systems interact without requiring you to manually trace dependencies.

```bash
greg "Explain how request authentication and token refresh are handled in this app"
```

### Build features and refactor across files

Describe what you need in natural language. `greg` plans the implementation, edits files across multiple directories, and preserves your project's formatting and styling conventions.

```bash
greg "Add an input validation schema to the user registration endpoint" --permission-mode acceptEdits
```

### Diagnose bugs and verify fixes with tests

Paste an error message or tell `greg` to fix failing tests. It inspects test output, locates the root cause, applies fixes, and re-executes your test runner to confirm the solution works.

```bash
greg "Fix failing unit tests in tests/engine.test.ts" \
  --permission-mode acceptEdits \
  --allowed-tools "Bash(bun test tests/engine.test.ts)"
```

### Pipe and automate in the terminal

`greg` is built on the Unix philosophy: clean results flow to `stdout`, while tool activity and progress logs remain isolated on `stderr`. This makes `greg` composable with standard command-line tools:

```bash
# Review staged git changes before committing
git diff --staged | greg "Review these changes for security issues or regressions"

# Investigate server errors
tail -n 100 app-error.log | greg "Diagnose what caused this crash and suggest a fix"
```

### Safe workspace edits with instant rollback

Every file mutation `greg` makes is automatically snapshotted before changes are written. You can inspect diffs and safely revert changes at any point:

```bash
# Restore workspace to a previous checkpoint
greg checkpoints restore 1
```

## Next steps

Once you've installed greg, explore these guides to learn more:

* [Quickstart](/quickstart): Walk through your first real task, from exploring a codebase to editing files and verifying tests.
* [Model Providers](/model-providers): Configure Claude, Gemini, GPT-5, and reasoning effort levels.
* [Everyday Workflows](/everyday-usage/common-workflows): Patterns for refactoring, debugging, and terminal piping.
* [Permissions & Safety](/power-users/permissions-and-safety): Understand permission modes and scoped wildcard security.
* [CLI Reference](/reference/cli): Complete list of all command-line flags and options.
