# J Star Reviewer - Scoring Logic

## Core Philosophy: "Quality Score" (High = Good)
To avoid AI confusion, we strictly use **Quality Score** (0-100).
- **100**: Perfection. Use for safe/clean code.
- **0**: Disaster. Use for critical security holes or broken code.

> [!CAUTION]
> **DO NOT USE "RISK SCORE"!**
> Previous iterations used "Risk Score" where 0 was safe and 100 was dangerous.
> This caused the AI to output `0` for perfect code, which the system then interpreted as "0 Quality" (Dangerous).
> **ALWAYS OPTIMIZE FOR QUALITY (High Score).**

## Weighted Partial Scoring
The J Star Reviewer uses a **Two-Stage Process** (Triage -> Deep Review).
This creates a scoring challenge: Triage skips "Safe" files to save cost, meaning the Deep Review only sees "Bad" files.

If we simply averaged the Deep Review scores, the Global Score would **drop** when a user fixes all their simple files (because only the complex/buggy ones remain to be audited).

### The Formula
To fix this, we assume that **any file skipped by Triage has a Quality Score of 100.**

```typescript
FinalScore = ((AuditedScore * AuditedCount) + (100 * SkippedCount)) / TotalCount
```

### Example Scenario
- **Total Files:** 10
- **Triage Result:** 2 suspicious files, 8 safe files.
- **Deep Review:** Audits the 2 suspicious files. Finds issues. Gives them an average score of **50**.

**Calculation:**
- Audited Part: `50 * 2 = 100` points
- Skipped Part: `100 * 8 = 800` points
- Total Points: `900`
- **Final Score:** `900 / 10 = 90`

**Outcome:** The user gets a **90/100** (A-), reflecting that most of their PR is solid, even though the specific files reviewed were problematic.
