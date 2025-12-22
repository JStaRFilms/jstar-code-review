# Feature: Interactive Debate Engine

**The "Debate Engine" transforms J-Star from a static linter into a conversational teammate.**

Instead of just reporting errors, J-Star assigns confidence scores to its findings and stays online to defend them. Developers can challenge specific issues, forcing the AI to re-query the [Local Brain](./indexer-brain.md) with new context.

## Core Capabilities

### 1. Confidence Scoring
Every finding is assigned a score (1-5) by the LLM:
*   **5/5 (Certain):** Explicit violation found in the diff or immediate context.
*   **3/5 (Unsure):** Likely an issue, but dependencies are missing from the diff.
*   **1/5 (Low):** Potential false positive or nitpick.

### 2. The Debate Loop
A **REPL (Read-Eval-Print Loop)** that runs after the initial review.
1.  **User Challenges:** "This isn't null because `utils.ensure()` guards it."
2.  **RAG Re-Query:** The system extracts keywords (`utils.ensure`, `null guard`) and queries the vector database.
3.  **Re-Evaluation:** The LLM acts as a Judge, comparing the **Original Finding** + **User Argument** + **New Context**.
4.  **Verdict:**
    *   **Withdrawn:** "Ah, you are right. `ensure()` throws. Issue removed." (Status: `resolved`)
    *   **Upheld:** "I checked `ensure()`, but it only logs warnings. The error persists." (Status: `unchanged`)

### 3. Intent Recognition
The engine distinguishes between:
*   **Questions:** ("What does this mean?") -> Triggers **Teacher Mode** (Explanation).
*   **Arguments:** ("This is wrong because...") -> Triggers **Judge Mode** (Evaluation).

## Architecture

*   **Entry Point:** `scripts/reviewer.ts` (loops instead of exiting).
*   **Logic:** `scripts/core/debate.ts` (handles the RAG/LLM calls).
*   **UI:** `scripts/ui/interaction.ts` (wraps `prompts` for the menu).
*   **State:** Findings are tracked in-memory during the session.

## Usage

```bash
jstar review
# ... analysis runs ...
# Interactive Menu appears:
# [5/5] Critical Bug in Auth
# > [Discuss]
```
