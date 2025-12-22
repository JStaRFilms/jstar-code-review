# J-Star Reviewer v2 - Architecture

> **Last Updated:** 2025-12-18  
> **Status:** ✅ Production Ready

## Overview

J-Star Reviewer v2 is a **local-first, context-aware AI code reviewer**. It uses a local vector index (brain) to provide relevant context to an LLM, combined with deterministic static analysis (Detective Engine).

## Key Changes from v1

| Feature | v1 | v2 |
|---------|----|----|
| **Embeddings** | OpenAI (paid) | Google Gemini (free tier) |
| **LLM** | OpenAI GPT-4 | Groq (moonshotai/kimi-k2) |
| **Context** | None | Local Vector Index (LlamaIndex) |
| **Static Analysis** | None | Detective Engine (regex-based) |
| **Rate Limiting** | None | Chunked reviews + exponential backoff |

---

## The Pipeline

```
┌─────────────────┐
│  git diff       │
│  --staged       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Detective      │  ← Deterministic checks (secrets, console.log, "use client")
│  Engine         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Local Brain    │  ← Gemini embeddings via LlamaIndex
│  (Retrieval)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Chunked        │  ← Splits diff by file, delays between API calls
│  Review Queue   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Groq LLM       │  ← moonshotai/kimi-k2-instruct-0905
│  (The Judge)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Aggregated     │
│  Report         │
└─────────────────┘
```

---

## Key Components

### `scripts/reviewer.ts`
[📖 See Feature Doc](./reviewer-core.md)
Orchestrates the review process:
- Runs Detective Engine
- Loads diff and chunks by file
- Retrieves context from local brain
- Sends chunked requests to Groq
- Aggregates final report

### `scripts/detective.ts`
[📖 See Feature Doc](./detective-engine.md)
Deterministic static analysis engine:
- **SEC-001:** Hardcoded secrets
- **ARCH-001:** `console.log` in production
- **ARCH-002:** `"use client"` placement

### `scripts/indexer.ts`
[📖 See Feature Doc](./indexer-brain.md)
Scans the codebase and builds a local vector index:
- **Input:** `scripts/` directory
- **Output:** `.jstar/storage/` (persisted embeddings)
- **Embedding Model:** `text-embedding-004` (Google Gemini)

### `scripts/dashboard.ts`
[📖 See Feature Doc](./dashboard-reporter.md)
Generates the final Markdown report logic.

### `scripts/gemini-embedding.ts`
Custom embedding adapter for Google Gemini.
- Implements retry with exponential backoff
- Serial processing to respect free-tier limits

### `scripts/mock-llm.ts`
Mock LLM to satisfy LlamaIndex dependencies during indexing.

---

## Detailed Feature Documentation

- [🕵️ Detective Engine](./detective-engine.md)
- [🧠 Indexer & Local Brain](./indexer-brain.md)
- [⚖️ Reviewer Core](./reviewer-core.md)
- [💻 CLI Reference](./cli-commands.md)
- [📊 Dashboard & Reporting](./dashboard-reporter.md)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | ✅ | For Gemini embeddings (or `GOOGLE_API_KEY`) |
| `GROQ_API_KEY` | ✅ | For Groq LLM reviews |

---

## Rate Limiting Strategy

### Indexing (Gemini)
- Serial processing (1 chunk at a time)
- 1s delay between requests
- Exponential backoff on 429 errors (2s, 4s, 8s...)

### Reviewing (Groq)
- Chunked by file
- 2s delay between chunks
- Files >8k tokens are skipped
- Excluded files: lockfiles, .env, .json, .md, .jstar/

---

## Usage

```bash
# Index the codebase (run once, or when files change)
pnpm run index:init

# Review staged changes
git add <files>
pnpm run review
```

---

## File Exclusions

The reviewer automatically skips:
- `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`
- `.env*` files
- `.json` files (config, not code)
- `.md` files (documentation)
- `.jstar/` metadata
