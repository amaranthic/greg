# greg

[![Runtime](https://img.shields.io/badge/runtime-Bun-black.svg?style=flat-square)](https://bun.sh)
[![Engine](https://img.shields.io/badge/engine-Hernex-blue.svg?style=flat-square)](https://github.com/amaranthic/harnex)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg?style=flat-square)](LICENSE)

**greg** is a post-modern, terminal-native **print agent** powered by the `@amaranthic/hernex` microkernel. Built on the Unix philosophy, `greg` executes autonomous software engineering tasks and streams clean results directly to `stdout`—while strictly isolating all diagnostics, tool executions, and status notices to `stderr`.

```bash
git diff | greg "Review this patch for edge cases and regressions"
```

---

## ⚡ Quickstart

### 1. Install

Install `greg` with the official installer (automatically detects your platform and downloads the standalone native binary):

```bash
curl -fsSL https://raw.githubusercontent.com/amaranthic/greg/main/installer/install.sh | bash
```

Or install a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/amaranthic/greg/main/installer/install.sh | bash -s -- --version 0.1.0
```

### 2. Configure Your Provider

Set your API key and default frontier model:

```bash
# Anthropic (e.g. Claude Sonnet 4.6)
export ANTHROPIC_API_KEY="your-api-key"
greg config set model anthropic/claude-sonnet-4-6

# Google Gemini (e.g. Gemini 3.8 Flash)
export GEMINI_API_KEY="your-api-key"
greg config set model google/gemini-3.8-flash

# OpenAI (e.g. GPT-5)
export OPENAI_API_KEY="your-api-key"
greg config set model openai/gpt-5
```

### 3. Run

```bash
# Direct question (clean streaming text on stdout)
greg "Explain the architecture of src/core"

# Autonomous coding with safe workspace file edits
greg "Refactor src/utils/format.ts to export formatDuration" --permission-mode acceptEdits

# Allow specific shell test commands
greg "Fix failing tests" --permission-mode acceptEdits --allowed-tools "Bash(bun test *)"
```

---

## ✨ Key Capabilities

- **🖨️ True Print-Native Execution**: Pipes cleanly into standard Unix filters (`git diff | greg "..." | jq`). Emits POSIX exit codes (`0` success, `2` permission denied, `4` timeout).
- **⏪ Time-Travel CAS Snapshots**: SHA-256 content-addressed file snapshots recorded before every mutation. Undo safely at any time:
  ```bash
  greg checkpoints restore 1
  ```
- **🌐 Frontier Model Agnostic**: First-slash routing across Anthropic, Google, OpenAI, DeepSeek, Groq, and local compatible gateways (`compatible/dummy`).
- **🛡️ Deterministic Permission Modes**:
  - `default`: Read-only reconnaissance tools (`Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`) auto-allowed. Mutations and shell require explicit allow rules.
  - `acceptEdits`: Workspace edits (`Write`, `Edit`) auto-approved. Shell commands require explicit allow rules.
  - `plan`: Pure reconnaissance; mutating tools and shell execution are excluded.
  - `bypassPermissions`: Full autonomous execution.
- **🔒 Scoped Wildcard Security**:
  - Concise PascalCase tool format: `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep`, `WebFetch`, `WebSearch`.
  - Scoped allow rules strictly enforce boundaries (e.g. `--allowed-tools "Read(src/*)"` allows `src/`, but immediately denies reading outside files).
  - Background processes are seamlessly handled—`taskManager` is automatically coupled to `Bash` authorization.
- **🔄 Resumable Threads**: Seamless multi-turn session continuation with `-c` (latest thread) or `-r <id>`.

---

## 💡 Practical Recipes

```bash
# Extract structured JSON for CI/CD automation
greg "List exported symbols in src/settings/index.ts" -o json | jq -r '.result'

# Structured output strictly validated against a JSON Schema
greg "List 3 release highlights" --json-schema '{"type":"object","properties":{"items":{"type":"array"}},"required":["items"]}'

# Fallback model chain tried left-to-right on failure
greg "Deep code refactoring" -m anthropic/claude-3-7-sonnet --fallback-model google/gemini-flash-latest,openrouter/openrouter/free

# Stream real-time NDJSON events
greg "Build project and inspect compiler output" -o stream-json --verbose

# Bidirectional stream-json agent pipeline
cat prompts.ndjson | greg --input-format stream-json --output-format stream-json

# Run with strictly scoped read and shell permissions
greg "Audit package.json dependencies" --tools "Read,Bash" --allowed-tools "Read(package.json),Bash(npm audit)"

# Preflight inspect a checkpoint restore without touching files
greg checkpoints restore 1 --dry-run

# Continue the conversation in the same thread
greg -c "Now add unit tests for those changes"
```

---

## 🎛️ Primary CLI Options

| Flag                             | Description                                                               | Default          |
| :------------------------------- | :------------------------------------------------------------------------ | :--------------- |
| `-p, --print`                    | Run non-interactively in print mode                                       | Active           |
| `-o, --output-format <format>`   | `text` \| `json` \| `stream-json`                                         | `text`           |
| `--input-format <format>`        | `text` \| `stream-json` (bidirectional stdin streaming)                   | `text`           |
| `-m, --model <provider/model>`   | Frontier model override                                                   | `dummy`          |
| `--fallback-model <models>`      | Comma-separated fallback models tried left-to-right on failure            | `[]`             |
| `--json-schema <schema>`         | JSON Schema string for structured output validation                       | —                |
| `-e, --effort <level>`           | Reasoning effort (`none`, `low`, `medium`, `high`, `max`)                 | Provider default |
| `-s, --max-turns <number>`       | Maximum turn loop iterations                                              | `50`             |
| `-t, --timeout <duration>`       | Wall-clock timeout (e.g. `30m`, `10s`)                                    | `30m`            |
| `--permission-mode <mode>`       | `default` \| `acceptEdits` \| `plan` \| `bypassPermissions`               | `default`        |
| `--allowed-tools <rules>`        | Allow specific tools (e.g. `Bash(git *)`, `Write(src/*)`, `Read(docs/*)`) | `[]`             |
| `--disallowed-tools <rules>`     | Deny specific tools (always overrides allows)                             | `[]`             |
| `--tools <names>`                | Filter exposed tool catalogue (e.g. `Read,Bash`; `""` fails closed)       | `default`        |
| `--dangerously-skip-permissions` | Bypass all tool permission checks                                         | —                |
| `-c, --continue`                 | Continue latest workspace thread session                                  | —                |
| `-r, --resume <id>`              | Resume a specific thread session by ID                                    | —                |
| `--resume-session-at <index>`    | Branch conversation at a specific transcript sequence index               | —                |
| `--no-session-persistence`       | Run ephemerally without persisting history or snapshots                   | —                |
| `--home <dir>`                   | Override state storage and configuration directory                        | `~/.greg`        |
| `--bare`                         | Suppress hooks, ambient instruction discovery, and persistent settings    | —                |
| `--verbose`                      | Emit diagnostic tool activity and status to stderr                        | —                |
| `--api-key <key>`                | Explicit provider API key override                                        | —                |
| `--base-url <url>`               | Explicit provider base URL override                                       | —                |

---

## 🪝 Lifecycle Hooks

`greg` supports customizable lifecycle hooks defined in `.greg/config/hooks.json` (project level) or `~/.greg/config/hooks.json` (global level).

Supported lifecycle events:

- `PreToolUse`: Evaluated prior to tool invocation. Can approve, rewrite inputs (`updatedInput`), or block.
- `PostToolUse`: Evaluated after tool execution. Can inspect outputs and supply `additionalContext`.
- `UserPromptSubmit`: Evaluated before dispatching a user prompt turn to the model. Can veto the turn.
- `Stop`: Evaluated when the agent considers completing.

Hooks can be `"command"` (subprocess shell scripts) or `"prompt"` (LLM-evaluated assertions).

### Exit Code Protocol for Command Hooks

- **`0`**: Success / Allow. May output structured JSON (`{"decision": "block", "reason": "..."}`, `{"updatedInput": {...}}`, or `{"additionalContext": "..."}`).
- **`2`**: Dedicated blocking veto. Immediately aborts execution with stderr as the blocking reason.
- **Any other non-zero**: Non-blocking warning logged to stderr; execution proceeds.

---

## 📄 License

MIT © [Amaranthic](https://github.com/amaranthic)
