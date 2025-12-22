# Feature: Local Brain (Indexer)

> **Status:** ✅ Production Ready  
> **Source:** `scripts/indexer.ts`, `scripts/gemini-embedding.ts`

## Overview

The **Local Brain** is the retrieval-augmented generation (RAG) engine of J-Star. It scans your codebase, generates vector embeddings using Google's Gemini model, and stores them in a local index. This allows the Reviewer to "understand" your project's context when reviewing changes.

## Architecture

### 1. Ingestion (`SimpleDirectoryReader`)
The indexer reads files from your source directory. It attempts to auto-detect the source:
1.  `--path` argument (if provided)
2.  `src/`
3.  `lib/`
4.  `app/`
5.  `scripts/`
6.  Current directory (`.`)

### 2. Embeddings (`GeminiEmbedding`)
We use a custom `GeminiEmbedding` class to interface with Google's `text-embedding-004` model.
- **Serial Processing**: Requests are processed one by one to respect free-tier rate limits.
- **Retry Logic**: Implements exponential backoff for `429 Too Many Requests` errors.

### 3. Storage (`LlamaIndex`)
The vectors are stored locally in `.jstar/storage/`.
- `doc_store.json`: Raw text content.
- `vector_store.json`: The mathematical embeddings.
- `index_store.json`: Metadata about the index structure.

## Usage

### Initialization
Run this once when you first set up the project or if you've made significant changes and need a fresh start.

```bash
pnpm run index:init
```

### Watch Mode
Keep the index up-to-date as you work (experimental).

```bash
pnpm run index:watch
```

## Configuration

Required Environment Variable in `.env.local`:
- `GEMINI_API_KEY` (or `GOOGLE_API_KEY`)

## Why Local?
- **Privacy**: Your code stays on your machine (except for the embedding generation call).
- **Speed**: Retrieval is instant once indexed.
- **Cost**: Uses the free tier of Gemini API.
