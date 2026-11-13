# greg

[![npm version](https://img.shields.io/npm/v/@amaranthic/greg.svg?style=flat-square)](https://www.npmjs.com/package/@amaranthic/greg)
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

```bash
npm install -g @amaranthic/greg
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
greg "Refactor src/utils/format.ts to export formatDuration" --permissionMode acceptEdits

# Allow specific shell test commands
greg "Fix failing tests" --permissionMode acceptEdits --allowedTools "Bash(bun test *)"
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
  - Scoped allow rules strictly enforce boundaries (e.g. `--allowedTools "Read(src/*)"` allows `src/`, but immediately denies reading outside files).
  - Background processes are seamlessly handled—`taskManager` is automatically coupled to `Bash` authorization.
- **🔄 Resumable Threads**: Seamless multi-turn session continuation with `-c` (latest thread) or `-r <id>`.

---

## 💡 Practical Recipes

```bash
# Extract structured JSON for CI/CD automation
greg "List exported symbols in src/settings/index.ts" -o json | jq -r '.result'

# Stream real-time NDJSON events
greg "Build project and inspect compiler output" -o stream-json --verbose

# Run with strictly scoped read and shell permissions
greg "Audit package.json dependencies" --tools "Read,Bash" --allowedTools "Read(package.json),Bash(npm audit)"

# Preflight inspect a checkpoint restore without touching files
greg checkpoints restore 1 --dryRun

# Continue the conversation in the same thread
greg -c "Now add unit tests for those changes"
```

---

## 🎛️ Primary CLI Options

| Flag                           | Description                                                               | Default          |
| :----------------------------- | :------------------------------------------------------------------------ | :--------------- |
| `-p, --print`                  | Run non-interactively in print mode                                       | Active           |
| `-o, --outputFormat <format>`  | `text` \| `json` \| `stream-json`                                         | `text`           |
| `-m, --model <provider/model>` | Frontier model override                                                   | `dummy`          |
| `-e, --effort <level>`         | Reasoning effort (`none`, `low`, `medium`, `high`, `max`)                 | Provider default |
| `-s, --maxTurns <number>`      | Maximum turn loop iterations                                              | `50`             |
| `-t, --timeout <duration>`     | Wall-clock timeout (e.g. `30m`, `10s`)                                    | `30m`            |
| `--permissionMode <mode>`      | `default` \| `acceptEdits` \| `plan` \| `bypassPermissions`               | `default`        |
| `--allowedTools <rules>`       | Allow specific tools (e.g. `Bash(git *)`, `Write(src/*)`, `Read(docs/*)`) | `[]`             |
| `--disallowedTools <rules>`    | Deny specific tools (always overrides allows)                             | `[]`             |
| `--tools <names>`              | Filter exposed tool catalogue (e.g. `Read,Bash`; `""` fails closed)       | `default`        |
| `-c, --continue`               | Continue latest workspace thread session                      | —                |
| `-r, --resume <id>`            | Resume a specific thread session by ID                        | —                |
| `--home <dir>`                 | Override state storage and configuration directory            | `~/.greg`        |

---

## 📄 License

MIT © [Amaranthic](https://github.com/amaranthic)
