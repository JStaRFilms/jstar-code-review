# Prompts & Persona (`src/prompts.ts`)

## Purpose
The Central Brain of J Star. This module exports the System Prompts and User Prompt builders that define the bot's persona, rules, and output format. It serves as the single source of truth for how the AI "thinks" and "speaks".

## Core Exports

### 1. System Prompts
- **`TRIAGE_SYSTEM_PROMPT`**: The "Gatekeeper". Designed for speed and cost-efficiency. It classifies PRs to decide if a deep review is necessary.
- **`ANALYST_SYSTEM_PROMPT`**: The "Sentinel". The main logic for deep code review. It enforces the "Strict Senior Engineer" persona and demands strict JSON output.
- **`CHUNK_REVIEW_SYSTEM_PROMPT`**: The "Worker". A specialized prompt for reviewing single files in isolation, used during Map-Reduce operations for large PRs.

### 2. Prompt Builders
- **`buildAnalystUserPrompt`**: Mechanisms to assemble the context window. It intelligently injects:
    -   The list of files to audit.
    -   The diff (truncated if necessary).
    -   **Existing Documentation Inventory** (to prevent false "missing docs" flags).
- **`buildChunkReviewPrompt`**: Creates a highly focused prompt for a single file, injecting project architecture and relevant feature docs context.

## Guardrails & Anti-Hallucination
The prompts have been battle-hardened against specific failures:

1.  **Strict JSON Enforcement**: Explicit rules to prevent the model from translating JSON keys (e.g., `verdict` -> `овердикт`) or outputting Markdown code fences.
2.  **Context Anchoring**: Constraints to stop the model from hallucinating that it is reviewing a Resume or Job Application (preventing "Job Title/직책" errors).
3.  **Deleted Code Safety**: Strict instructions to ignore bugs in lines starting with `-`, as they no longer exist.
4.  **Line Number Precision**: Requirements to output specific line numbers for every finding.

## Usage Example

```typescript
import { ANALYST_SYSTEM_PROMPT, buildAnalystUserPrompt } from './prompts';

// 1. Initialize with the System Prompt
const systemMessage = ANALYST_SYSTEM_PROMPT;

// 2. Build the User Context
// Injects the diff and awareness of existing docs to avoid false positives
const userMessage = buildAnalystUserPrompt(
  ['src/auth.ts', 'src/types.ts'], // Files to focus on
  ['src/auth.ts', 'src/types.ts', 'README.md'], // All files
  diffString, // The git diff
  ['auth.md', 'architecture.md'] // List of existing doc files
);

// 3. Generate Response (using Vercel AI SDK)
const response = await generateObject({
  model: groq('moonshotai/kimi-k2-instruct-0905'),
  system: systemMessage,
  prompt: userMessage,
  schema: JStarReviewSchema
});
```
