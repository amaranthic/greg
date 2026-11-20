---
title: "Quickstart"
description: "Install greg in your terminal, configure your provider, and complete your first autonomous task in under two minutes."
---

This quickstart walks you through getting up and running with `greg` in your terminal: installing the standalone binary, setting up your preferred model provider, exploring a repository, applying safe code edits, verifying solutions with tests, and managing multi-turn sessions.

<Note>
`greg` is distributed as a self-contained native binary with zero runtime dependencies. You do not need Node.js, Bun, or Python installed to run official releases. For manual downloads or building from source, see [Installation](/installation).
</Note>

This page covers:

- [Prerequisites](#prerequisites): What you need before getting started.
- [Step 1: Install Greg](#step-1-install-greg): Downloading and verifying the standalone binary.
- [Step 2: Configure Your Model Provider](#step-2-configure-your-model-provider): Setting API keys and default frontier models across providers.
- [Step 3: Ask Your First Question](#step-3-ask-your-first-question): Read-only codebase exploration and architecture queries.
- [Step 4: Make Your First Code Change](#step-4-make-your-first-code-change): Authorizing file mutations with `--permission-mode acceptEdits`.
- [Step 5: Run Tests & Verify Solutions](#step-5-run-tests-verify-solutions): Constraining shell execution with scoped `--allowed-tools`.
- [Step 6: Pipe Terminal Data into Greg](#step-6-pipe-terminal-data-into-greg): Unix composability with `stdin` pipes.
- [Step 7: Continue Conversations with `-c`](#step-7-continue-conversations-with--c): Multi-turn session persistence.
- [Essential Commands Cheat Sheet](#essential-commands-cheat-sheet): Quick reference of daily commands.
- [Next Steps](#next-steps): Guided links to deeper topics.

---

## Prerequisites

Before beginning, ensure you have:

- A terminal emulator (`bash`, `zsh`, `fish`, or terminal multiplexer).
- An existing project directory or Git repository to test in.
- An API key for your preferred frontier AI model provider (Anthropic, Google Gemini, OpenAI, DeepSeek, Groq, or OpenRouter).

---

## Step 1: Install Greg

Install `greg` using the official installation script for macOS, Linux, or WSL:

```bash
curl -fsSL https://raw.githubusercontent.com/amaranthic/greg/main/installer/install.sh | bash
```

The script automatically detects your operating system and CPU architecture, downloads the matching precompiled binary, places it in `~/.greg/bin`, and updates your shell profile (`PATH`).

Once the installer completes, open a new terminal window and verify the installation:

```bash
greg --version
```

<Tip>
You can update `greg` to the latest release at any time by running `greg update`.
</Tip>

---

## Step 2: Configure Your Model Provider

Set your provider API key as an environment variable and configure your default frontier model. Choose your provider below:

<CodeGroup>
```bash Anthropic
# 1. Export your Anthropic API key
export ANTHROPIC_API_KEY="sk-ant-..."

# 2. Set Claude Sonnet 4.6 as your default model

greg config set model anthropic/claude-sonnet-4-6

````

```bash Google Gemini
# 1. Export your Gemini API key (or GOOGLE_API_KEY)
export GEMINI_API_KEY="AIzaSy..."

# 2. Set Gemini 3.8 Flash as your default model
greg config set model google/gemini-3.8-flash
````

```bash OpenAI
# 1. Export your OpenAI API key
export OPENAI_API_KEY="sk-proj-..."

# 2. Set GPT-5 as your default model
greg config set model openai/gpt-5
```

```bash DeepSeek
# 1. Export your DeepSeek API key
export DEEPSEEK_API_KEY="sk-..."

# 2. Set DeepSeek-V4 Pro as your default model
greg config set model deepseek/deepseek-v4-pro
```

```bash Groq
# 1. Export your Groq API key
export GROQ_API_KEY="gsk_..."

# 2. Set Llama 3.3 70B Versatile as your default model
greg config set model groq/llama-3.3-70b-versatile
```

```bash OpenRouter
# 1. Export your OpenRouter API key
export OPENROUTER_API_KEY="sk-or-..."

# 2. Route across models via OpenRouter
greg config set model openrouter/anthropic/claude-sonnet-4-6
```

</CodeGroup>

Verify your active configuration:

```bash
greg config get model
```

<Tip>
Add your `export` statement to your shell profile (`~/.zshrc` or `~/.bashrc`) so your credentials load automatically in every terminal session.
</Tip>

---

## Step 3: Ask Your First Question

Navigate to any project repository:

```bash
cd /path/to/your/project
```

Ask `greg` to inspect and summarize the codebase:

```bash
greg "What does this project do, what are the primary dependencies, and where is the main entry point?"
```

`greg` autonomously discovers your directory structure using `Glob`, inspects package manifests and configurations using `Read`, and streams a clean answer directly to `stdout`.

Try more targeted exploration queries:

```bash
# Trace an execution path
greg "How does user authentication work in this application? Which files handle token verification?"

# Inspect complex data models
greg "Explain the key database schemas and relationships defined in src/models"
```

<Note>
`greg` runs by default in fail-closed read-only mode. It can read files and query language servers to answer questions, but will never modify files or run dangerous commands without your explicit consent.
</Note>

---

## Step 4: Make Your First Code Change

To permit `greg` to create or edit files, pass `--permission-mode acceptEdits`:

```bash
greg "Add a slugify helper function to src/utils/strings.ts that converts strings to URL-friendly slugs" \
  --permission-mode acceptEdits
```

`greg` will:

1. Locate `src/utils/strings.ts` (or create it if it does not exist).
2. Inspect your repository's formatting, casing, and style conventions.
3. Automatically record a pre-mutation snapshot checkpoint before touching disk.
4. Apply the edits cleanly.

### Safe Edits with Instant Rollback

Every file mutation made by `greg` is backed by a content-addressed snapshot. If you ever want to revert changes:

```bash
# 1. Inspect the recorded diff
greg checkpoints diff 1

# 2. Revert the workspace back to the pre-mutation state
greg checkpoints restore 1
```

---

## Step 5: Run Tests & Verify Solutions

Instruct `greg` to diagnose an issue and verify its fix by executing your test runner. Use `--allowed-tools` to authorize specific shell commands safely:

```bash
greg "Add unit tests for our new slugify function in tests/strings.test.ts and run the test runner to verify they pass" \
  --permission-mode acceptEdits \
  --allowed-tools "Bash(bun test *)"
```

`greg` writes the test file, executes `bun test`, evaluates the test output, and resolves any assertion failures until all tests pass.

---

## Step 6: Pipe Terminal Data into Greg

`greg` follows the Unix philosophy: clean Markdown and code stream to `stdout`, while diagnostic logs remain isolated on `stderr`. You can pipe data from standard terminal utilities directly into `greg`:

```bash
# Audit uncommitted Git changes before committing
git diff | greg "Review these changes for subtle bugs, performance regressions, or security flaws"

# Diagnose a crash from a log file
tail -n 80 error.log | greg "Diagnose what caused this exception and suggest a fix"

# Pipe output into clipboard (macOS / Linux)
greg "Generate a .gitignore for a modern TypeScript Bun project" | pbcopy
```

---

## Step 7: Continue Conversations with `-c`

`greg` automatically organizes your work into workspace-scoped persistent threads. Use `-c` (or `--continue`) to continue your task across multiple turns without repeating context:

```bash
# Turn 1: Scaffold an interface
greg "Add a UserProfile interface to src/types.ts" --permission-mode acceptEdits

# Turn 2: Continue the conversation in the same thread
greg -c "Now add a mock factory function for UserProfile in tests/helpers.ts" --permission-mode acceptEdits

# Turn 3: Verify the changes with tests
greg -c "Run the test suite and confirm everything compiles cleanly" \
  --permission-mode acceptEdits \
  --allowed-tools "Bash(npm test)"
```

View past sessions in the current workspace:

```bash
greg threads list
```

---

## Essential Commands Cheat Sheet

| Command                                       | Purpose                                        | Example                                                      |
| :-------------------------------------------- | :--------------------------------------------- | :----------------------------------------------------------- |
| `greg "prompt"`                               | Run an autonomous task in read-only print mode | `greg "Explain this repository"`                             |
| `greg "prompt" --permission-mode acceptEdits` | Allow file modifications                       | `greg "Add healthcheck route" --permission-mode acceptEdits` |
| `greg -c "prompt"`                            | Continue the latest workspace session          | `greg -c "Now add unit tests"`                               |
| `greg -r <id> "prompt"`                       | Resume a specific session by thread ID         | `greg -r 4f8a1234-... "Refactor this"`                       |
| `git diff \| greg "prompt"`                   | Ingest piped standard input                    | `git diff \| greg "Summarize changes"`                       |
| `greg checkpoints list`                       | List file mutation snapshot checkpoints        | `greg checkpoints list`                                      |
| `greg checkpoints diff <seq>`                 | View file diff for a recorded checkpoint       | `greg checkpoints diff 1`                                    |
| `greg checkpoints restore <seq>`              | Roll back workspace to a checkpoint            | `greg checkpoints restore 1`                                 |
| `greg threads list`                           | List conversation threads in workspace         | `greg threads list`                                          |
| `greg config get [key]`                       | Inspect active configuration settings          | `greg config get model`                                      |
| `greg config set <key> <val>`                 | Persist a configuration setting                | `greg config set model anthropic/claude-sonnet-4-6`          |
| `greg update`                                 | Update greg to the latest release              | `greg update`                                                |

---

## Next Steps

Now that you have completed your first task, explore these guides to unlock `greg`'s full capabilities:

- [Common Workflows](/common-workflows): In-depth step-by-step recipes for bug fixing, refactoring, test generation, and CI automation.
- [Managing Threads](/threads): Master multi-turn persistence, time-travel branching (`--resume-session-at`), and checkpoint rollbacks.
- [Managing Providers](/model-providers): Configure credentials, base URL overrides, reasoning effort, and fallback chains across 13+ providers.
- [Installation Guide](/installation): Detailed setup for all operating systems, offline releases, and source compilation.
