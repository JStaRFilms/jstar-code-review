# [DEPRECATED] J Star Reviewer - Architecture (v1)

> **⚠️ WARNING:** This document describes v1 of the architecture. The current codebase uses v2 (Local-First).
> Please refer to [architecture-v2.md](./architecture-v2.md) for the current design.

# J Star Reviewer - Architecture

## Overview
J Star is a **Two-Stage** AI Code Reviewer designed for cost-efficiency and high-signal feedback. It avoids the "Review Everything" trap by first filtering for risk and then deep-diving only where necessary.

## The Pipeline

### 1. Triage (The Gatekeeper)
- **Model:** Fast/Cheap (e.g. `llama-3.1-8b-instant`, `gpt-4o-mini`)
- **Input:** File list + Diff Metadata
- **Goal:** Identify **Critical Files** (Auth, API, Logic, Database).
- **Output:** A list of `files_to_audit` (max 5).
- **Logic:** If a PR is just CSS/Docs/Images, Triage returns "LOW RISK" and the process stops (Cost = near zero).

### 2. The Analyst (The Sentinel)
- **Model:** Smart/Reasoning (e.g. `llama-3.3-70b-versatile`, `gpt-4o`)
- **Input:** The actual diff content of the `files_to_audit`.
- **Goal:** Find bugs using the **J Star Tone Matrix** (Strict, Senior, No Fluff).
- **Scaling:**
    - **Single-Shot:** For small diffs (< 8k tokens), sends everything in one prompt.
    - **Map-Reduce:** For huge diffs, splits by file, reviews each in parallel, and aggregates the results.

### 3. The Orchestrator (`src/orchestrator.ts`)
The glue code that manages the flow:
1. Validates Env (`types.ts`).
2. Fetches PR context from GitHub.
3. Runs Triage.
4. Runs Analyst (Single or Chunked).
5. **Calculates Weighted Score** (See [Scoring Logic](./scoring-logic.md)).
6. Posts comment to GitHub.

## Key Components

### `src/prompts.ts`
The "Brain". Contains the System Prompts that define the persona and rules.
- **Rule 1:** Always return JSON.
- **Rule 2:** Documentation is per-FEATURE (prevents false positives on missing docs).

### `src/types.ts`
The "Skeleton". Zod schemas that enforce strict structure on the AI output.
- `TriageSchema`: Defines risk levels.
- `JStarReviewSchema`: Defines the finding structure and `quality_score`.
