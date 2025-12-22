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

## Configuration (`.env.local`)

| Variable | Description | Required |
|----------|-------------|----------|
| `GEMINI_API_KEY` | Key for Google Gemini (Embeddings). | ✅ |
| `GROQ_API_KEY` | Key for Groq (LLM Inference). | ✅ |
