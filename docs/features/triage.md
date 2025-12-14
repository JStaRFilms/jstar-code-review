# Triage System

The **Gatekeeper** stage that filters PR files before expensive deep review.

## Purpose
Running a powerful LLM on every file is expensive and slow. Triage uses a fast/cheap model to identify only the **Critical Files** (auth, API, database, logic), saving 80%+ cost on routine PRs.

## Model
- **Default:** `llama-3.1-8b-instant` (via Groq)
- **Configurable:** Set `TRIAGE_MODEL` env var.

## Input
- List of all files changed in the PR with status (e.g. `src/auth.ts [removed]`).
- Diff length (for sizing estimation).

## Output (`TriageResult`)
```typescript
{
  risk_level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
  files_to_audit: string[], // Max 5 files
  ignore_reason: string | null
}
```

## Rules (from `TRIAGE_SYSTEM_PROMPT`)
- **IGNORE:** Lockfiles, images, stylesheets, test snapshots, localization files.
- **FOCUS:** Authentication logic, API endpoints, database schemas, data processing, security code.
- **LOW RISK:** If PR is only text/docs/README, return empty `files_to_audit`.

## Key Behavior
If `files_to_audit` is empty, the pipeline **stops** and posts a "No critical files detected" comment. This is a **cost optimization**.
