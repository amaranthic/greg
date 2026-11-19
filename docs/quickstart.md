---
title: "Quickstart"
description: "Install greg in your terminal, configure your provider, and complete your first autonomous task."
---

> Install greg in your terminal, configure your provider, and make your first autonomous code change.

This quickstart covers getting started with `greg` in your terminal: installing the native binary, setting your API key, exploring a repository, making safe code edits, and running tests.

## Before you begin

Make sure you have:

* A terminal open (`bash`, `zsh`, `fish`, or terminal emulator)
* A code project or Git repository to work in
* An API key for your preferred frontier AI model provider (Anthropic, Google Gemini, OpenAI, DeepSeek, or an OpenAI-compatible endpoint)

## Step 1: Install greg

Install `greg` using the official installer for macOS, Linux, or WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/amaranthic/greg/main/installer/install.sh | bash
```

The installer detects your operating system and CPU architecture, downloads the standalone native binary, and configures it in your PATH.

When the installer finishes, open a new terminal window and verify the installation:

```bash
greg --version
```

The command prints the installed `greg` version number.

<Note>
  You can update greg to the latest release at any time by running `greg update`. For manual release downloads, custom paths, or building from source, see the [Installation guide](/installation).
</Note>

## Step 2: Configure your model provider

Set your API key as an environment variable and configure your default model:

<CodeGroup>
```bash Anthropic
# 1. Set your Anthropic API key
export ANTHROPIC_API_KEY="your-api-key"

# 2. Set Claude Sonnet as your default model
greg config set model anthropic/claude-sonnet-4-6
```

```bash Google Gemini
# 1. Set your Gemini API key (or GOOGLE_API_KEY)
export GEMINI_API_KEY="your-api-key"

# 2. Set Gemini Flash as your default model
greg config set model google/gemini-3.8-flash
```

```bash OpenAI
# 1. Set your OpenAI API key
export OPENAI_API_KEY="your-api-key"

# 2. Set GPT-5 as your default model
greg config set model openai/gpt-5
```

```bash DeepSeek
# 1. Set your DeepSeek API key
export DEEPSEEK_API_KEY="your-api-key"

# 2. Set DeepSeek-V4 Pro as your default model
greg config set model deepseek/deepseek-v4-pro
```

```bash Groq
# 1. Set your Groq API key
export GROQ_API_KEY="your-api-key"

# 2. Set high-throughput Llama 3.3 70B as your default model
greg config set model groq/llama-3.3-70b-versatile
```

```bash OpenRouter
# 1. Set your OpenRouter API key
export OPENROUTER_API_KEY="your-api-key"

# 2. Route across models via OpenRouter
greg config set model openrouter/anthropic/claude-sonnet-4-6
```
</CodeGroup>

To verify your configuration, run:

```bash
greg config get model
```

<Tip>
  Add your `export` line to your shell profile (`~/.zshrc` or `~/.bashrc`) so your key is loaded automatically in every terminal session.
</Tip>

## Step 3: Ask your first question

Navigate to any project directory on your machine:

```bash
cd /path/to/your/project
```

Ask `greg` to inspect and explain the project:

```bash
greg "What does this project do and where is the main entry point?"
```

`greg` autonomously discovers your files, reads relevant configurations and entrypoints, and streams a clean answer directly to your terminal.

You can also ask targeted questions:

```bash
# Explore folder architecture
greg "Explain how the project is structured and what each folder contains"

# Trace specific functionality
greg "Where is user authentication handled and how are tokens validated?"

# Understand dependencies
greg "What external libraries does this project depend on and why?"
```

<Note>
  `greg` discovers and reads your workspace files automatically. You do not need to manually copy-paste context or files into the prompt.
</Note>

## Step 4: Make your first code change

When you want `greg` to edit or create files, pass `--permission-mode acceptEdits`. This permits `greg` to apply file modifications directly:

```bash
greg "Add an input validation helper function to src/utils" --permission-mode acceptEdits
```

`greg` will:
1. Locate the appropriate file in your workspace
2. Inspect the existing coding conventions and style
3. Apply the changes cleanly to disk

### Safe edits with instant undo

Every file edit `greg` makes is automatically snapshotted before changes touch disk. If you want to undo changes at any point:

```bash
# 1. View recent checkpoints
greg checkpoints list

# 2. Revert the workspace to a previous checkpoint
greg checkpoints restore 1
```

## Step 5: Run tests and verify fixes

You can ask `greg` to diagnose bugs and verify solutions by running your test runner. Use `--allowed-tools` to authorize specific shell test commands:

```bash
greg "Run the test suite and fix any failing tests" \
  --permission-mode acceptEdits \
  --allowed-tools "Bash(bun test *)"
```

`greg` will run your tests, analyze failure output, edit the code to fix the root cause, and re-run the tests until they pass.

## Step 6: Pipe terminal output into greg

`greg` follows the Unix philosophy: clean results flow to `stdout` while diagnostic logs stay on `stderr`. You can pipe data from standard terminal tools directly into `greg`:

```bash
# Review uncommitted git changes before committing
git diff | greg "Review these changes for security issues or edge cases"

# Diagnose a server crash from recent error logs
tail -n 100 app-error.log | greg "Diagnose what caused this error and suggest a fix"
```

## Step 7: Continue conversation threads

You can continue working on a task without repeating previous context by using `-c` (`--continue`):

```bash
# First turn: create a helper
greg "Add a slugify string utility function in src/utils" --permission-mode acceptEdits

# Second turn: continue the thread to add tests
greg -c "Now write unit tests covering that new slugify function" --permission-mode acceptEdits
```

To list past conversation sessions in the current workspace:

```bash
greg threads list
```

---

## Essential commands

Here are the most common commands for daily use:

| Command | What it does | Example |
| :--- | :--- | :--- |
| `greg "prompt"` | Run an autonomous task in print mode | `greg "Explain this codebase"` |
| `git diff \| greg "prompt"` | Pipe standard input into greg | `git diff \| greg "Review changes"` |
| `greg -c "prompt"` | Continue the latest session in workspace | `greg -c "Now add unit tests"` |
| `greg -r <id> "prompt"` | Resume a specific session thread by ID | `greg -r thr_123 "Continue work"` |
| `greg checkpoints list` | List recorded file checkpoints | `greg checkpoints list` |
| `greg checkpoints restore <id>` | Roll back workspace to a checkpoint | `greg checkpoints restore 1` |
| `greg config get [key]` | View active configuration settings | `greg config get model` |
| `greg config set <key> <val>` | Update a persistent setting | `greg config set model anthropic/claude-sonnet-4-6` |
| `greg update` | Update greg to the latest release | `greg update` |

---

## Next steps

Now that you've completed your first task, explore these guides to go deeper:

* [Model Providers](/model-providers): Configure Claude, Gemini, GPT-5, and reasoning effort levels.
* [Everyday Workflows](/everyday-usage/common-workflows): In-depth recipes for refactoring, debugging, and terminal automation.
* [Permissions & Safety](/power-users/permissions-and-safety): Learn how permission modes and scoped allow rules protect your code.
* [CLI Reference](/reference/cli): Complete reference of all command-line flags and options.
