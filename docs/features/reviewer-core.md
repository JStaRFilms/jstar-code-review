# Feature: Reviewer Core

> **Status:** ✅ Production Ready  
> **Source:** `scripts/reviewer.ts`

## Overview

The **Reviewer Core** is the orchestrator of the J-Star system. It combines static analysis, RAG context retrieval, and LLM inference to provide a comprehensive code review of your staged changes.

## Workflow

1.  **Environment Check**: Validates `GEMINI_API_KEY` and `GROQ_API_KEY`.
2.  **Detective Scan**: Runs the [Detective Engine](./detective-engine.md) to catch static violations.
3.  **Git Diff**: Retrieves staged changes (`git diff --staged`).
    - *If no changes are staged, the process exits.*
4.  **Context Retrieval**:
    - Analyzes imports in the diff to generate search keywords.
    - Queries the [Local Brain](./indexer-brain.md) for relevant code snippets.
5.  **Chunking**:
    - Splits the diff into individual files.
    - **Exclusions**: Skips `.lock`, `.env`, `.json`, `.md` files, and `node_modules`.
    - **Size Limit**: Skips files > 8k tokens to prevent context window overflow.
6.  **LLM Review (The Judge)**:
    - Sends each file chunk to Groq (Model: `moonshotai/kimi-k2-instruct-0905`).
    - **System Prompt**: Enforces strict JSON output with `severity` and `fixPrompt`.
    - **Rate Limiting**: Waits 2 seconds between chunks.
7.  **Reporting**:
    - Aggregates findings from Detective and LLM.
    - Generates a dashboard report.

## The "Judge" Model

We use **Groq** for high-speed inference. The prompt instructs the model to act as a Senior Code Reviewer and categorize issues into:
- `P0_CRITICAL`: Security blockers.
- `P1_HIGH`: Architecture/Logic bugs.
- `P2_MEDIUM`: Code quality issues.
- `LGTM`: Approved.

## Error Handling

- **JSON Fallback**: If the LLM returns Markdown instead of JSON, a regex parser attempts to extract the JSON object.
- **Fail-Safe**: If parsing fails completely, the text is captured as a "Review Note" (Medium Severity).

## Usage

```bash
git add .
pnpm run review
```
