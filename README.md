# greg

<p align="center">
  <strong>The headless AI coding agent built for the Unix pipeline.</strong>
</p>

<p align="center">
  <a href="https://greg-docs.mintlify.site"><img src="https://img.shields.io/badge/docs-greg--docs.mintlify.site-blue.svg?style=flat-square" alt="Documentation"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-black.svg?style=flat-square" alt="Runtime: Bun"></a>
  <a href="https://github.com/amaranthic/hernex"><img src="https://img.shields.io/badge/engine-Hernex-blue.svg?style=flat-square" alt="Engine: Hernex"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License: MIT"></a>
</p>

---

## 🚀 Why greg?

Most AI coding assistants try to replace your development environment with heavy Electron apps or fullscreen TUIs that hijack your terminal. 

**greg takes the opposite approach.** 

Designed as a pure **print agent** adhering to the Unix philosophy, `greg` runs non-interactively in your shell, script, or CI pipeline:
- **`stdin`** ingests your context, diffs, and prompt streams.
- **`stdout`** emits pure, parseable results or structured JSON.
- **`stderr`** isolates diagnostics, tool status, and progress without polluting downstream commands.
- Standard POSIX exit codes ensure your shell scripts and CI gates fail fast and reliably.

```bash
# Pipe code directly into greg, pipe the review straight into your tools
git diff | greg "Review this patch for memory leaks and race conditions"

# Extract strictly validated JSON for automation
greg "Analyze src/auth and list exposed endpoints" -o json | jq -r '.result'
```

---

## ⚡ What Makes greg Different

### 🖨️ True Pipeline Native
No popups, no prompts asking you to press Enter. Feed `greg` via pipes (`cat error.log | greg "Diagnose failure"`), redirect stdout to files, or stream newline-delimited JSON (`-o stream-json`) directly into other automated services.

### ⏪ Time-Travel Rollbacks (CAS Checkpoints)
Never fear an agent making bad edits. Every file change is cryptographically hashed with SHA-256 before modification. If you don't like what `greg` wrote, undo instantly:
```bash
greg checkpoints restore 1
```

### 🛡️ Fail-Closed Security & Permissions
Choose how much autonomy you grant with built-in permission modes:
* `default`: Safe reconnaissance (read-only file inspection and web search).
* `acceptEdits`: Automated code writing and refactoring with shell execution locked down.
* `plan`: Zero disk mutations—architectural planning only.
* Scoped wildcard rules like `--allowed-tools "Read(src/*),Bash(bun test *)"` keep operations strictly within your project boundaries.

### 🪝 Event-Driven Lifecycle Hooks
Intercept, mutate, or veto actions using custom shell scripts or secondary LLM evaluators:
* **`Start`**: Rewrites prompts, verifies environments, or injects repository context before the model starts.
* **`PreToolUse`**: Intercepts dangerous commands (`git push`, destructive scripts) before execution.
* **`PostToolUse`**: Automatically formats files (Prettier, Biome, rustfmt) right after edits.
* **`Stop`**: Runs tests before exit—vetoing completion and re-prompting the model if assertions fail.

### 🌐 Model Agnostic
Route queries to frontier intelligence across Anthropic Claude, Google Gemini, OpenAI, DeepSeek, Groq, or self-hosted local gateways. Configure fallbacks to seamlessly switch models if an API rate-limits.

---

## ⚡ 60-Second Quickstart

### 1. Install

```bash
curl -fsSL https://raw.githubusercontent.com/amaranthic/greg/main/installer/install.sh | bash
```

### 2. Set Your Key & Model

```bash
# Pick your preferred provider (Anthropic, Gemini, OpenAI, etc.)
export GEMINI_API_KEY="your-api-key"
greg config set model google/gemini-3.8-flash
```

### 3. Run

```bash
# Ask questions about your code
greg "Explain the request flow in src/core"

# Autonomous refactoring with safe workspace edits
greg "Refactor src/utils/format.ts to export formatDuration" --permission-mode acceptEdits

# Fix bugs and run test suites
greg "Fix failing test cases" --permission-mode acceptEdits --allowed-tools "Bash(bun test *)"
```

---

## 📖 Complete Documentation

Looking for CLI flags, lifecycle hook recipes, permission policies, or CI/CD pipeline examples?

Visit the official documentation site:

👉 **[https://greg-docs.mintlify.site](https://greg-docs.mintlify.site)**

* **[Quickstart Guide](https://greg-docs.mintlify.site/quickstart)**: Setup, credentials, and first run.
* **[Permission System](https://greg-docs.mintlify.site/permissions)**: Fail-closed security rules and modes.
* **[Lifecycle Hooks](https://greg-docs.mintlify.site/hooks)**: Automate linting, prompt mutation, and veto checks.
* **[Threads & Checkpoints](https://greg-docs.mintlify.site/threads)**: Session resumption and time-travel rollback.
* **[CI/CD & Pre-Commit](https://greg-docs.mintlify.site/ci-cd)**: Headless pipeline automation.
* **[How Greg Works](https://greg-docs.mintlify.site/how-greg-works)**: Architectural deep dive into the Hernex engine.

---

## 📄 License

MIT © [Amaranthic](https://github.com/amaranthic)
