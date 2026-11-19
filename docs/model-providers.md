---
title: "Managing Providers"
description: "Configure and route across all frontier models and inference providers supported by greg and Hernex."
---

`greg` is frontier-model agnostic. Powered by the [@amaranthic/hernex](https://github.com/amaranthic/hernex) engine, it connects to every major frontier AI provider, open-source inference router, and local gateway using a unified, single-string model format.

```bash
# Anthropic
greg "Refactor this module" -m anthropic/claude-sonnet-4-6

# DeepSeek
greg "Review this algorithm" -m deepseek/deepseek-v4-pro

# Local Gateway
greg "Explain this file" -m compatible/my-local-model
```

---

## How Model Routing Works

`greg` uses Hernex's **first-slash routing rule** to determine which provider adapter to invoke:

```text
[provider]/[model-id]
```

* **Before the first slash**: The provider identifier (e.g., `anthropic`, `google`, `openai`, `deepseek`, `groq`, `openrouter`).
* **After the first slash**: The model identifier passed directly to that provider. Any subsequent slashes are preserved as part of the model name (essential for multi-tenant routers like OpenRouter).

### Examples

| Model String | Provider | Model ID Sent to Provider |
| :--- | :--- | :--- |
| `anthropic/claude-sonnet-4-6` | `anthropic` | `claude-sonnet-4-6` |
| `google/gemini-3.8-flash` | `google` | `gemini-3.8-flash` |
| `openai/gpt-5` | `openai` | `gpt-5` |
| `deepseek/deepseek-v4-pro` | `deepseek` | `deepseek-v4-pro` |
| `groq/llama-3.3-70b-versatile` | `groq` | `llama-3.3-70b-versatile` |
| `openrouter/anthropic/claude-sonnet-4-6` | `openrouter` | `anthropic/claude-sonnet-4-6` |
| `compatible/qwen2.5-coder-32b` | `compatible` | `qwen2.5-coder-32b` |

---

## Credential & Base URL Resolution

When connecting to a provider, `greg` resolves your credentials and API endpoints using a deterministic order of precedence.

### Environment Variable Compilation Formula

To determine the exact environment variable name for any provider prefix, `greg` normalizes the provider segment (the text before the first `/`) using this exact regex logic:

```typescript
// From src/settings/resolve.ts
const normalizedProvider = provider.toUpperCase().replace(/[^A-Z0-9]/g, "_");
const specificApiKeyVar = `${normalizedProvider}_API_KEY`;
const specificBaseUrlVar = `${normalizedProvider}_BASE_URL`;
```

1. Converts the provider name to uppercase: `.toUpperCase()`.
2. Replaces all non-alphanumeric characters with underscores: `/[^A-Z0-9]/g` → `_`.
3. Appends `_API_KEY` or `_BASE_URL`.

| Provider String Prefix | Normalized Name | Generated API Key Env Var | Generated Base URL Env Var |
| :--- | :--- | :--- | :--- |
| `anthropic/` | `ANTHROPIC` | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` |
| `openai/` | `OPENAI` | `OPENAI_API_KEY` | `OPENAI_BASE_URL` |
| `nvidiaNim/` | `NVIDIANIM` | `NVIDIANIM_API_KEY` | `NVIDIANIM_BASE_URL` |
| `custom-gateway/` | `CUSTOM_GATEWAY` | `CUSTOM_GATEWAY_API_KEY` | `CUSTOM_GATEWAY_BASE_URL` |

<Note>
  **Provider Aliases**: Certain providers feature built-in aliases in [src/settings/resolve.ts](file:///home/nolan/works/greg/src/settings/resolve.ts) that are evaluated in addition to the standard formula:
  * **Google (`google/`)**: `greg` checks `GEMINI_API_KEY` first, then falls back to `GOOGLE_API_KEY`.
  * **NVIDIA (`nvidiaNim/`)**: `greg` accepts `NVIDIA_API_KEY` and `NVIDIA_NIM_API_KEY` in addition to `NVIDIANIM_API_KEY`.
</Note>

---

### API Key Precedence
1. **CLI Flag Overrides**: `--api-key <key>` explicitly overrides all environment settings for a single command.
2. **Provider-Specific Variables**: Derived via the formula above (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`).
3. **Provider Aliases**:
   * Google: Checks `GEMINI_API_KEY` first, then falls back to `GOOGLE_API_KEY`.
   * NVIDIA: Checks `NVIDIA_API_KEY` first, then falls back to `NVIDIA_NIM_API_KEY`.
4. **Generic Fallback**: If no provider-specific variable is found, `greg` checks the generic `API_KEY` environment variable.

### Base URL Precedence & Environment Overrides
Just like API keys, **every provider's base URL is fully configurable via environment variables**:

1. **CLI Flag Override**: `--base-url <url>` overrides the endpoint for a single run.
2. **Provider-Specific Variables**: Derived via the formula above (`${NORMALIZED_PROVIDER}_BASE_URL`). Every provider has a dedicated variable:
   * `ANTHROPIC_BASE_URL`
   * `OPENAI_BASE_URL`
   * `GOOGLE_BASE_URL`
   * `DEEPSEEK_BASE_URL`
   * `GROQ_BASE_URL`
   * `OPENROUTER_BASE_URL`
   * `XAI_BASE_URL`
   * `MISTRAL_BASE_URL`
   * `COHERE_BASE_URL`
   * `TOGETHERAI_BASE_URL`
   * `ALIBABA_BASE_URL`
   * `NVIDIANIM_BASE_URL`
   * `COMPATIBLE_BASE_URL`
3. **Generic Fallback**: If no provider-specific variable is set, `greg` checks the global `BASE_URL` environment variable.
4. **Built-in Default**: If unset, Hernex uses the provider's official default endpoint.

#### Example: Routing Through Proxies or AI Gateways

You can direct traffic through corporate proxies, LiteLLM, Portkey, or Cloudflare AI Gateway without changing CLI commands:

```bash
# Route OpenAI traffic through Cloudflare AI Gateway
export OPENAI_BASE_URL="https://gateway.ai.cloudflare.com/v1/my-account/my-gateway/openai"
export OPENAI_API_KEY="your-openai-key"
greg "Task" -m openai/gpt-5

# Route Anthropic through an internal corporate proxy
export ANTHROPIC_BASE_URL="https://proxy.internal.corp/anthropic/v1"
export ANTHROPIC_API_KEY="your-anthropic-key"
greg "Task" -m anthropic/claude-sonnet-4-6
```

---

## Supported Providers

Below is the complete matrix of built-in providers bundled with `greg` and Hernex:

| Provider | Prefix | Required API Key | Base URL Override Env | Default Base URL |
| :--- | :--- | :--- | :--- | :--- |
| **Anthropic** | `anthropic/` | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` | `https://api.anthropic.com/v1` |
| **Google Gemini** | `google/` | `GEMINI_API_KEY` or `GOOGLE_API_KEY` | `GOOGLE_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` |
| **OpenAI** | `openai/` | `OPENAI_API_KEY` | `OPENAI_BASE_URL` | `https://api.openai.com/v1` |
| **DeepSeek** | `deepseek/` | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/v1` |
| **Groq** | `groq/` | `GROQ_API_KEY` | `GROQ_BASE_URL` | `https://api.groq.com/openai/v1` |
| **xAI** | `xai/` | `XAI_API_KEY` | `XAI_BASE_URL` | `https://api.x.ai/v1` |
| **OpenRouter** | `openrouter/` | `OPENROUTER_API_KEY` | `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` |
| **Mistral AI** | `mistral/` | `MISTRAL_API_KEY` | `MISTRAL_BASE_URL` | `https://api.mistral.ai/v1` |
| **Together AI** | `togetherai/` | `TOGETHERAI_API_KEY` | `TOGETHERAI_BASE_URL` | `https://api.together.xyz/v1` |
| **Cohere** | `cohere/` | `COHERE_API_KEY` | `COHERE_BASE_URL` | `https://api.cohere.com/v2` |
| **Alibaba DashScope** | `alibaba/` | `ALIBABA_API_KEY` | `ALIBABA_BASE_URL` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` |
| **NVIDIA NIM** | `nvidiaNim/` | `NVIDIA_API_KEY` or `NVIDIA_NIM_API_KEY` | `NVIDIANIM_BASE_URL` | `https://integrate.api.nvidia.com/v1` |
| **Vercel AI Gateway** | `vercelgateway/` | `VERCEL_API_KEY` | `VERCELGATEWAY_BASE_URL` | `https://ai.gateway.vercel.dev/v1` |
| **Compatible / Local** | `compatible/` | Any string (or `dummy`) | `COMPATIBLE_BASE_URL` | `http://localhost:8080/v1` |

---

## Setting Your Default Model

You can persist your default model globally so you don't need to specify `-m` or `--model` on every run:

```bash
# Set default model
greg config set model anthropic/claude-sonnet-4-6

# Inspect current model setting
greg config get model
```

To run a task with a temporary model override:

```bash
greg "Explain this codebase" --model google/gemini-3.8-flash
```

---

## Reasoning Effort (`--effort`)

Frontier reasoning models (such as Claude Sonnet 4.6 thinking mode, OpenAI o3 / o4-mini, or Gemini thinking) support configurable reasoning effort. You can specify the reasoning budget per command or configure it persistently:

```bash
# Run with high reasoning effort
greg "Solve this complex architectural race condition" --effort high
```

Supported effort values:
* `none`
* `minimal`
* `low`
* `medium`
* `high`
* `xhigh`
* `max`

You can also set a default reasoning effort level in your settings:

```bash
greg config set effort medium
```

---

## Automatic Fallback Chains

In production environments, rate limits (HTTP 429) or transient provider outages can interrupt tasks. `greg` supports ordered **fallback chains** that automatically fail over from left to right if your primary model fails:

```bash
greg "Generate unit tests" \
  --model anthropic/claude-sonnet-4-6 \
  --fallback-model "google/gemini-3.8-flash,openrouter/openai/gpt-5"
```

You can also configure permanent fallback models in your settings:

```bash
greg config add fallbackModels google/gemini-3.8-flash
greg config add fallbackModels deepseek/deepseek-v4-pro
```

If the primary model exhausts its retry budget or encounters a non-recoverable error, `greg` automatically initializes the next candidate model in the chain and resumes execution seamlessly.

---

## Local & Custom OpenAI-Compatible Gateways

To connect `greg` to local models running on Ollama, vLLM, LM Studio, or private corporate proxies, use the `compatible/` provider:

```bash
# Connect to a local Ollama instance running Qwen
greg "Inspect this function" \
  --model compatible/qwen2.5-coder:32b \
  --base-url http://localhost:11434/v1
```

Or connect to an internal enterprise gateway:

```bash
greg "Review this PR" \
  --model compatible/internal-llm \
  --base-url https://gateway.internal.corp/v1 \
  --api-key "$INTERNAL_GATEWAY_TOKEN"
```
