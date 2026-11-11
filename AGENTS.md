# Project Operating Guardrails

## 1. Explicit Direction Only

- Execute only what the user explicitly directs. Do not run ahead or execute unprompted tasks.

## 2. Structured Summaries

- After every completed task or step, provide a clear, concise summary covering:
  - **What was done**
  - **What is next** (if subsequent steps are planned or waiting)

## 3. Tool & Skill Efficiency

- Actively and efficiently leverage available skills (e.g. `ai-sdk`, `migrate-ai-sdk-v6-to-v7`), MCP servers, and environment tools.

## 4. Verification Over Assumptions

- Never assume library APIs, package signatures, or options from model training data; treat training data as legacy.
- Always inspect installed package docs, declarations, and source code directly in `node_modules`.

## 5. Test Suite Architecture

- Do not create random or excessive test files.
- Restrict all test suites to a maximum of 6 to 8 high-quality, high-coverage test files located strictly within the `tests/` directory.

## 6. Strict Casing Standards

- Strictly enforce `camelCase` (for variables, properties, functions, methods) and `PascalCase` (for classes, types, interfaces, enums).
- No other casing styles (e.g. `snake_case`) are allowed in code identifiers.

## 7. Comprehensive JSDoc Documentation

- Heavily document all modules, functions, classes, interfaces, types, parameters, and return types using rich JSDoc comments (`/** ... */`).
- Every exported symbol must include a description, `@param` descriptions, `@returns` descriptions, and usage examples where beneficial.

## 8. Barrel Export & Import Standard (`index.ts`)

- Never import internal files or export directly across module boundaries; always use `index.ts` barrels.
- Every module directory (e.g. `constants/`, `settings/`, `policy/`, `core/`, `output/`, `utils/`, `cli/`) must provide an authoritative `index.ts` exporting its public surface.
- All cross-module imports must resolve strictly via the target module's `index.ts` barrel (e.g., `../settings/index.js`).
