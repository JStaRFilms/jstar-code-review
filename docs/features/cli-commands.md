# Feature: CLI Reference

> **Status:** ✅ Production Ready  
> **Entry Point:** `bin/jstar.js`, `package.json`

## Overview

J-Star is designed to be run via `pnpm` scripts or the `jstar` binary.

## Commands

### `pnpm run review`
**Description:** Runs the full review pipeline on staged files.
- Checks environment variables.
- Runs Detective Engine.
- Checks content vs Local Brain.
- Generates Dashboard.

**Prerequisites:**
- Staged changes (`git add ...`)
- Initialized index (`pnpm run index:init`)

---

### `pnpm run chat`
**Description:** Resume an interactive session from the last review.
- Loads `.jstar/session.json`.
- Skips analysis, goes straight to debate menu.
- Supports `--headless` flag for AI agents.

**When to use:**
- Continue debating issues from a previous review.
- Let AI agents interact via stdin/stdout protocol.

---

### `pnpm run index:init`
**Description:** Scans the codebase and creates a fresh vector index.
- **Target:** Auto-detects `src`, `lib`, or uses cwd.
- **Output:** Writes to `.jstar/storage/`.

**When to run:**
- On fresh install.
- After major refactors.
- If the reviewer seems "forgetful".

---

### `pnpm run index:watch`
**Description:** Runs the indexer in watch mode (experimental).

---

### `pnpm run detect`
**Description:** Runs ONLY the Detective Engine (static analysis).
- Fast check for secrets and pattern violations.
- Does not use LLM.
- Does not require API keys.

---

### `pnpm run build`
**Description:** Compiles the TypeScript scripts to JavaScript.
- Uses `tsc`.

---

## CLI Flags

| Flag | Commands | Description |
|------|----------|-------------|
| `--json` | `review` | Output JSON to stdout, logs to stderr. Skips interactive session. |
| `--headless` | `chat` | Enable stdin/stdout JSON protocol for AI agents. |

**Examples:**
```bash
# CI/CD: Get JSON report
jstar review --json > report.json

# AI Agent: Interact via stdin/stdout
echo '{"action": "list"}' | jstar chat --headless
```

See [Headless Mode](./headless-mode.md) for full protocol documentation.

---

## Configuration (`.env.local`)

| Variable | Description | Required |
|----------|-------------|----------|
| `GEMINI_API_KEY` | Key for Google Gemini (Embeddings). | ✅ |
| `GROQ_API_KEY` | Key for Groq (LLM Inference). | ✅ |

