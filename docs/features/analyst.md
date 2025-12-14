# Deep Review (The Analyst)

The **Sentinel** stage that performs deep code analysis on critical files.

## Purpose
After Triage identifies risky files, the Analyst performs a thorough review using a powerful reasoning model. It finds bugs, security issues, logic errors, and documentation gaps.

## Model
- **Default:** `moonshotai/kimi-k2-instruct-0905` (via Groq)
- **Configurable:** Set `ANALYST_MODEL` env var.

## Input
- The actual diff content of the `files_to_audit`.
  - **Single-Shot Limit:** < 6000 tokens (approx).
  - **Chunked:** Used automatically if > 6000 tokens.
- Project context (`.jstar/architecture.md`, `.jstar/rules.md`).
- Existing docs inventory (`docs/features/*.md`).

## Output (`JStarReviewResult`)
```typescript
{
  summary: {
    quality_score: 0-100, // 100 = Perfect
    verdict: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
    tone: 'encouraging' | 'critical' | 'neutral'
  },
  findings: Finding[]
}
```

## The J Star Tone Matrix
- **Authority:** High. No "I think" or "maybe". Direct statements.
- **Brevity:** Max 2 sentences per finding. No filler.
- **Personality:** "The Strict Senior Engineer". Professional, zero fluff.
- **Constructive:** Always offer a fix or direction.

## Severity Levels
| Level | Description |
| :--- | :--- |
| CRITICAL | Security vulnerability, data leak, auth bypass, production crash |
| HIGH | Race condition, missing validation, performance disaster, missing docs for new features |
| MEDIUM | Edge case not handled, potential null reference, suboptimal pattern |
| NITPICK | Minor style preference (use sparingly) |

## Required Fields
- **`title`:** Short, explicit, non-generic (e.g., "SQL Injection in Login").
- **`fix_prompt`:** REQUIRED for CRITICAL, HIGH, and MEDIUM issues.

## Intelligent Deletion Handling
The Analyst is aware of file status (`[added]`, `[modified]`, `[removed]`).
- **Removed Files:** It ignores "bugs" inside deleted code (e.g., unused variables in a file that is being deleted).
- **Dangerous Deletions:** It WIIL flag if a deletion seems dangerous (e.g., removing auth middleware without replacement).
